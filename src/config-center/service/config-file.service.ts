import { BaseService, PageCommon, ProjectException } from '@nest-cloud/sdk';
import { ConfigFile } from '../entities/config-file.entity';
import { ConfigFileForm, ConfigFileUpdateForm } from '../form/config-file.form';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigVersionService } from './config-version.service';
import { ConfigContentUtil } from '../utils/config-content.util';
import { CONFIG_WRITE_CONFLICT_CODES } from '../../constants/config-file.constants';
import { Like, Repository } from 'typeorm';

/** Default page size used by config file listing when callers omit paging parameters. */
const DEFAULT_CONFIG_PAGE_SIZE = 10;

type PullConfigOptions = {
  serviceName?: string;
  names?: string[];
};

type ConfigSnapshot = {
  id: number;
  name: string;
  format: string;
  content: string;
  description?: string;
  md5: string;
  version: number;
  isPublished: boolean;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ConfigAggregate = {
  name: string;
  latestPublished: ConfigSnapshot | null;
  currentDraft: ConfigSnapshot | null;
  activeRecord: ConfigSnapshot | null;
  versionCount: number;
  updatedAt?: Date;
};

@Injectable()
export class ConfigFileService extends BaseService<ConfigFile> {
  private readonly logger = new Logger(ConfigFileService.name);

  constructor(
    @InjectRepository(ConfigFile)
    private readonly configFileRepo: Repository<ConfigFile>,
  ) {
    super(configFileRepo);
  }

  async paginateWithName(page: PageCommon, published?: string, format?: string) {
    const { pageNum = 1, pageSize = DEFAULT_CONFIG_PAGE_SIZE, search } = page;

    const where = {} as Record<string, any>;
    if (search) {
      where['name'] = Like(`%${search}%`);
    }

    const records = await this.configFileRepo.find({
      where,
      order: { updatedAt: 'DESC', id: 'DESC' },
    });

    let aggregates = this.buildAggregates(records);

    if (published !== undefined) {
      const expectPublished = published === 'true';
      aggregates = aggregates.filter((item) =>
        expectPublished ? !!item.latestPublished : !!item.currentDraft,
      );
    }

    if (format) {
      aggregates = aggregates.filter(
        (item) =>
          item.currentDraft?.format === format ||
          item.latestPublished?.format === format ||
          item.activeRecord?.format === format,
      );
    }

    aggregates.sort((left, right) => {
      const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
      const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
      return rightTime - leftTime;
    });

    const total = aggregates.length;
    const list = aggregates.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    return {
      list,
      total,
      summary: {
        nameCount: total,
        publishedCount: aggregates.filter((item) => !!item.latestPublished).length,
        draftCount: aggregates.filter((item) => !!item.currentDraft).length,
      },
    };
  }

  async createOrUpdate(data: ConfigFileForm) {
    return this.create(data);
  }

  override create(data: ConfigFileForm): Promise<ConfigFile> {
    const format = data.format ?? ConfigContentUtil.detectFormat(data.name);
    return this.writeVersion((versions) => versions.saveDraft({ ...data, format }, data.id));
  }

  override update(id: number, data: ConfigFileUpdateForm): Promise<ConfigFile> {
    return this.writeVersion((versions) => versions.saveDraft(data, id));
  }

  async removeItems(ids: number[]) {
    return await this.configFileRepo.delete(ids);
  }

  async publish(id: number) {
    return this.writeVersion((versions) => versions.publish(id));
  }

  private async writeVersion(action: (versions: ConfigVersionService) => Promise<ConfigFile>) {
    try {
      // 同名草稿可能尚无行可锁。可串行化事务也保护不存在的草稿和版本号分配。
      return await this.configFileRepo.manager.transaction('SERIALIZABLE', (manager) =>
        action(new ConfigVersionService(manager.getRepository(ConfigFile))),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        CONFIG_WRITE_CONFLICT_CODES.includes(error.code)
      ) {
        throw new ProjectException('配置已被其他请求修改，请重试', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async findLatestConfig(name: string) {
    return await this.findLatestPublishedByName(name);
  }

  async getVersionHistory(name: string) {
    const records = await this.configFileRepo.find({
      where: { name },
      order: { version: 'DESC', updatedAt: 'DESC', id: 'DESC' },
    });

    return records.map((item) => this.toSnapshot(item));
  }

  async pullPublishedConfigs(options: PullConfigOptions) {
    const candidateNames = this.resolveNames(options.serviceName, options.names);

    const where = candidateNames.map((name) => ({
      name,
      isPublished: true,
    }));

    const configs = await this.configFileRepo.find({
      where,
      order: { version: 'DESC', publishedAt: 'DESC', id: 'DESC' },
    });
    const selected = new Map<string, { file: ConfigFile; values: Record<string, unknown> }>();
    const invalidNames = new Set<string>();
    for (const file of configs) {
      if (selected.has(file.name)) continue;
      try {
        const values = ConfigContentUtil.parse(file.format, file.content);
        selected.set(file.name, { file, values });
        invalidNames.delete(file.name);
      } catch (error) {
        if (!(error instanceof ProjectException)) throw error;
        this.logger.warn(`跳过无法解析的已发布配置：${file.name} v${file.version}`);
        invalidNames.add(file.name);
      }
    }
    if (invalidNames.size) {
      throw new ProjectException('所选配置缺少可解析的已发布版本', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const ordered = candidateNames.flatMap((name) => {
      const match = selected.get(name);
      return match ? [match] : [];
    });
    const mergedConfig = ordered.reduce<Record<string, unknown>>(
      (result, item) => this.deepMerge(result, item.values),
      {},
    );

    return {
      serviceName: options.serviceName,
      configs: ordered.map(({ file: item }) => ({
        id: item.id,
        name: item.name,
        format: item.format,
        content: item.content,
        md5: item.md5,
        version: item.version,
        publishedAt: item.publishedAt,
      })),
      mergedConfig,
    };
  }

  private buildAggregates(records: ConfigFile[]): ConfigAggregate[] {
    const map = new Map<string, ConfigAggregate>();

    for (const record of records) {
      const current = map.get(record.name) || {
        name: record.name,
        latestPublished: null,
        currentDraft: null,
        activeRecord: null,
        versionCount: 0,
      };

      current.versionCount += 1;

      if (record.isPublished) {
        if (
          !current.latestPublished ||
          this.comparePublishedPriority(record, current.latestPublished) < 0
        ) {
          current.latestPublished = this.toSnapshot(record);
        }
      } else if (
        !current.currentDraft ||
        new Date(record.updatedAt).getTime() > new Date(current.currentDraft.updatedAt).getTime()
      ) {
        current.currentDraft = this.toSnapshot(record);
      }

      current.activeRecord = current.currentDraft || current.latestPublished;
      current.updatedAt = new Date(
        Math.max(
          current.currentDraft ? new Date(current.currentDraft.updatedAt).getTime() : 0,
          current.latestPublished ? new Date(current.latestPublished.updatedAt).getTime() : 0,
        ),
      );

      map.set(record.name, current);
    }

    return [...map.values()];
  }

  private toSnapshot(item: ConfigFile): ConfigSnapshot {
    return {
      id: item.id,
      name: item.name,
      format: item.format,
      content: item.content,
      description: item.description,
      md5: item.md5,
      version: item.version,
      isPublished: item.isPublished,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private async findLatestPublishedByName(name: string) {
    return await this.configFileRepo.findOne({
      where: { name, isPublished: true },
      order: { version: 'DESC', publishedAt: 'DESC', id: 'DESC' },
    });
  }

  private comparePublishedPriority(
    left: { version?: number | null; publishedAt?: Date | null; id?: number | null },
    right: { version?: number | null; publishedAt?: Date | null; id?: number | null },
  ) {
    if ((left.version ?? 0) !== (right.version ?? 0)) {
      return (right.version ?? 0) - (left.version ?? 0);
    }

    const leftPublishedAt = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightPublishedAt = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    if (leftPublishedAt !== rightPublishedAt) {
      return rightPublishedAt - leftPublishedAt;
    }

    return (right.id ?? 0) - (left.id ?? 0);
  }

  private resolveNames(serviceName?: string, names?: string[]) {
    if (names?.length) {
      return [...new Set(names.filter(Boolean))];
    }

    const defaults = ['application.yaml', 'application.yml', 'application.json', 'application.env'];

    if (!serviceName) {
      return defaults;
    }

    return [
      ...defaults,
      `${serviceName}.yaml`,
      `${serviceName}.yml`,
      `${serviceName}.json`,
      `${serviceName}.env`,
    ];
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const output = { ...target };

    for (const [key, value] of Object.entries(source)) {
      if (
        ConfigContentUtil.isMapping(value) &&
        Object.hasOwn(output, key) &&
        ConfigContentUtil.isMapping(output[key])
      ) {
        output[key] = this.deepMerge(output[key], value);
        continue;
      }

      Object.defineProperty(output, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    return output;
  }
}
