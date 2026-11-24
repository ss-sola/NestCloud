import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import request from 'supertest';
import { ConfigFileController } from '../../config-center/controller/config-file.controller';
import { ConfigFile } from '../../config-center/entities/config-file.entity';
import { ConfigFileService } from '../../config-center/service/config-file.service';

// 本测试验证 HTTP 和版本流程，不依赖 PostgreSQL 或装饰器生成的列元数据。
vi.mock('../../config-center/entities/config-file.entity', () => ({ ConfigFile: class {} }));

type Filter = Partial<Pick<ConfigFile, 'id' | 'name' | 'isPublished'>>;

class VersionRepository {
  rows: ConfigFile[] = [];
  private revision = 0;

  manager = {
    transaction: async (
      isolation: string,
      run: (manager: { getRepository: () => VersionRepository }) => Promise<unknown>,
    ) => {
      if (isolation !== 'SERIALIZABLE') throw new Error('测试仓储仅支持可串行化事务');
      const snapshot = new VersionRepository();
      snapshot.rows = structuredClone(this.rows);
      const revision = this.revision;
      const result = await run({ getRepository: () => snapshot });
      if (this.revision !== revision) {
        throw Object.assign(new Error('Serialization conflict'), { code: '40001' });
      }
      this.rows = snapshot.rows;
      this.revision++;
      return result;
    },
  };

  create(data: Partial<ConfigFile>) {
    return { ...data };
  }

  async save(data: ConfigFile) {
    const row = Object.assign(new ConfigFile(), data, { id: this.rows.length + 1 });
    this.rows.push(row);
    return row;
  }

  async update(id: number, data: Partial<ConfigFile>) {
    Object.assign(this.rows.find((row) => row.id === id)!, data);
  }

  async find({ where }: { where: Filter[] }) {
    return this.rows
      .filter((row) =>
        where.some((filter) => Object.entries(filter).every(([key, value]) => row[key] === value)),
      )
      .sort((left, right) => right.version - left.version || right.id - left.id);
  }

  async findOne({ where }: { where: Filter }) {
    return (await this.find({ where: [where] }))[0] ?? null;
  }
}

describe('配置草稿与发布', () => {
  let repository: VersionRepository;
  let service: ConfigFileService;
  let app: INestApplication | undefined;
  const draft = { name: 'application.json', format: 'json', content: '{"port":3000}' };

  beforeEach(() => {
    repository = new VersionRepository();
    service = new ConfigFileService(repository as unknown as Repository<ConfigFile>);
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('管理页面可通过实际 HTTP 路由保存、发布、部分编辑并拉取', async () => {
    // Vitest 转译器未生成 Nest 的构造参数元数据。
    Reflect.defineMetadata('design:paramtypes', [ConfigFileService], ConfigFileController);
    const module = await Test.createTestingModule({
      controllers: [ConfigFileController],
      providers: [{ provide: ConfigFileService, useValue: service }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
    const http = request(app.getHttpServer());
    const saved = await http.post('/api/config-files').send(draft).expect(201);
    const id = saved.body.data.id;
    const first = await http.post(`/api/config-files/${id}/publish`).expect(201);
    const second = await http
      .put(`/api/config-files/${id}`)
      .send({ content: '{"port":3100}', version: 999, isPublished: true, md5: 'ignored' })
      .expect(200);
    expect(second.body.data).toMatchObject({ version: 1, isPublished: false });
    expect(second.body.data.id).not.toBe(id);
    expect(repository.rows.find((item) => item.id === id)).toMatchObject({
      content: draft.content,
      version: 1,
      md5: first.body.data.md5,
      isPublished: true,
    });
    const pulled = await http
      .get('/api/config-files/client/pull')
      .query({ names: draft.name })
      .expect(200);
    expect(pulled.body.data.mergedConfig).toEqual({ port: 3000 });
    const next = await http.post(`/api/config-files/${second.body.data.id}/publish`).expect(201);
    expect(next.body.data.version).toBe(2);
  });

  it.each([
    ['json', '{'],
    ['json', 'null'],
    ['json', '[]'],
    ['json', ''],
    ['yaml', 'a: ['],
    ['yml', '- x'],
    ['yaml', '2026-01-01'],
    ['env', 'PORT=3000\ninvalid line'],
    ['properties', 'invalid line'],
  ])('保留无效 %s 草稿及上一有效发布版本（%s）', async (format, content) => {
    const first = await service.createOrUpdate(draft);
    await service.publish(first.id);
    const edit = await service.createOrUpdate({ ...draft, id: first.id, content, format });
    await expect(service.publish(edit.id)).rejects.toMatchObject({ status: 400 });
    expect(await service.findOne(edit.id)).toMatchObject({ isPublished: false });
    expect((await service.pullPublishedConfigs({ names: [draft.name] })).mergedConfig).toEqual({
      port: 3000,
    });
  });

  it.each([
    ['yaml', 'service:\n  port: 42', { service: { port: 42 } }],
    ['jsonc', '{\n// 部署地址\n"url":"https://host/a//b", /* 监听 */ "port":42\n}', { url: 'https://host/a//b', port: 42 }],
    ['env', 'export KEY="two\nlines"\nEMPTY=\n# comment', { KEY: 'two\nlines', EMPTY: '' }],
    ['properties', 'KEY: value\n! comment', { KEY: 'value' }],
  ])('已发布 %s 使用同一解析器供客户端拉取', async (format, content, expected) => {
    const record = await service.createOrUpdate({ ...draft, format, content });
    await service.publish(record.id);
    expect((await service.pullPublishedConfigs({ names: [draft.name] })).mergedConfig).toEqual(
      expected,
    );
  });

  it('推断 JSONC，向旧客户端返回原文和解析值，并拒绝有语法错误的草稿', async () => {
    const content = '{ /* 监听 */ "port": 3500 }';
    const row = await service.createOrUpdate({ name: 'worker.jsonc', content });
    await service.publish(row.id);
    const pull = await service.pullPublishedConfigs({ serviceName: 'worker', names: ['worker.json'] });
    expect(pull.configs[0]).toMatchObject({ format: 'jsonc', content });
    expect(pull.mergedConfig).toEqual({ port: 3500 });
    const invalid = await service.update(row.id, { content: '{"port":3500} /*' });
    await expect(service.publish(invalid.id)).rejects.toMatchObject({ status: 400 });
  });

  it('并发编辑和发布时冲突返回 409，重试编辑保留已发布快照', async () => {
    const record = await service.createOrUpdate(draft);
    const patch = { content: '{"port":3100}' };
    const writes = await Promise.allSettled([
      service.publish(record.id),
      service.update(record.id, patch),
    ]);
    expect(writes.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { status: 409 } },
    ]);
    if (writes[0].status === 'rejected') await service.publish(record.id);
    const published = await service.findOne(record.id);
    await service.update(record.id, patch);
    expect(await service.findOne(record.id)).toEqual(published);
    expect(published?.isPublished).toBe(true);
  });

  it('旧库已有异常发布时返回上一有效快照及其版本元数据', async () => {
    const record = await service.createOrUpdate(draft);
    const first = await service.publish(record.id);
    repository.rows.push({ ...first, id: 2, version: 2, content: 'broken' } as ConfigFile);
    const pull = await service.pullPublishedConfigs({ names: [draft.name] });
    expect(pull.configs[0]).toMatchObject({ id: first.id, version: 1, md5: first.md5 });
    expect(pull.mergedConfig).toEqual({ port: 3000 });
    repository.rows.shift();
    await expect(service.pullPublishedConfigs({ names: [draft.name] })).rejects.toMatchObject({
      status: 422,
    });
  });
});
