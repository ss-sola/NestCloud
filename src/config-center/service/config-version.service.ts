import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { HttpStatus } from '@nestjs/common';
import { ConfigFile } from '../entities/config-file.entity';
import { ConfigFileUpdateForm } from '../form/config-file.form';
import { ConfigContentUtil } from '../utils/config-content.util';

/** 由配置服务使用当前事务的 Repository 构造，草稿及版本写入共享同一快照。 */
export class ConfigVersionService extends BaseService<ConfigFile> {
  async saveDraft(data: ConfigFileUpdateForm, id?: number): Promise<ConfigFile> {
    const source = id == null ? null : await this.requireRecord(id);
    const name = data.name ?? source?.name;
    if (!name?.trim()) throw new ProjectException('配置名称不能为空', HttpStatus.BAD_REQUEST);

    const draft =
      source && !source.isPublished
        ? source
        : await this.repository.findOne({
            where: { name, isPublished: false },
            order: { updatedAt: 'DESC', id: 'DESC' },
          });
    const previous = draft ?? source;
    const content = data.content?.trim() ?? previous?.content;
    if (content === undefined) throw new ProjectException('缺少配置正文', HttpStatus.BAD_REQUEST);
    const fields = {
      name,
      content,
      format: data.format ?? previous?.format ?? ConfigContentUtil.detectFormat(name),
      description: data.description ?? previous?.description,
      md5: ConfigContentUtil.md5(content),
    };

    if (draft) return (await this.update(draft.id, fields))!;
    const latest = await this.latestPublished(name);
    return this.create({ ...fields, version: latest?.version ?? 0, isPublished: false });
  }

  async publish(id: number): Promise<ConfigFile> {
    const draft = await this.requireRecord(id);
    if (draft.isPublished) return draft;
    ConfigContentUtil.parse(draft.format, draft.content);

    const latest = await this.latestPublished(draft.name);
    return (await this.update(id, {
      version: (latest?.version ?? draft.version) + 1,
      md5: ConfigContentUtil.md5(draft.content),
      isPublished: true,
      publishedAt: new Date(),
    }))!;
  }

  private async requireRecord(id: number) {
    const record = await this.findOne(id);
    if (!record) throw new ProjectException('配置不存在', HttpStatus.NOT_FOUND);
    return record;
  }

  private latestPublished(name: string) {
    return this.repository.findOne({
      where: { name, isPublished: true },
      order: { version: 'DESC', publishedAt: 'DESC', id: 'DESC' },
    });
  }
}
