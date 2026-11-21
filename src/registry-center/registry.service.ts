import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { getConfig, ProjectException } from '@nest-cloud/sdk';
import { MemoryRegistryStore, RedisRegistryStore, RegistryStore } from './registry.store';
import { RegistryRegistration, RegistryServiceQuery } from './registry.types';
import { CLEAR_TIMEOUT, DEFAULT_AUDIT_LIMIT, DEFAULT_REDIS_PREFIX } from './registry.constants';
import { ConfigServiceKeys } from '../config-keys';

@Injectable()
export class RegistryService implements OnModuleDestroy {
  private readonly logger: Logger = new Logger(RegistryService.name);
  private readonly store: RegistryStore;

  constructor() {
    const redisUrl = getConfig<string>(ConfigServiceKeys.RegistryRedisUrl, '', false);
    const auditLimit = Number(
      getConfig<string>(ConfigServiceKeys.RegistryAuditLimit, String(DEFAULT_AUDIT_LIMIT), false),
    );

    this.store = redisUrl
      ? new RedisRegistryStore({
          redisUrl,
          auditLimit,
          keyPrefix: getConfig<string>(
            ConfigServiceKeys.RegistryRedisKeyPrefix,
            DEFAULT_REDIS_PREFIX,
            false,
          ),
        })
      : new MemoryRegistryStore({ auditLimit });
  }

  async onModuleDestroy() {
    await this.store.destroy();
  }

  // 服务注册
  register(instance: RegistryRegistration) {
    this.logger.log(`Registering instance: ${JSON.stringify(instance)}`);
    return this.store.register(instance);
  }

  // 服务下线
  unregister(id: string) {
    return this.store.unregister(id);
  }

  async setAvailability(id: string, enabled: boolean) {
    if (!(await this.store.setAvailability(id, enabled))) {
      throw new ProjectException('实例已不存在，请刷新后重试', 404);
    }
  }

  // 心跳续约
  heartbeat(id: string) {
    return this.store.heartbeat(id);
  }

  // 服务发现
  async discover(serviceName: string, group?: string) {
    const instances = await this.store.getService(serviceName, group);
    if (instances.length === 0) {
      throw new ProjectException(`未发现可用的服务实例: ${serviceName}`, 404);
    }
    return instances;
  }

  // 手动清理默认采用和定时清理相同的租约期限。
  cleanup(timeout = CLEAR_TIMEOUT) {
    return this.store.cleanup(timeout);
  }

  getAll() {
    return this.store.getAll();
  }

  getOverview() {
    return this.store.getOverview();
  }

  getServices(query: RegistryServiceQuery = {}) {
    return this.store.getServiceSummaries(query);
  }

  getAuditLogs(limit?: number) {
    return this.store.getAuditLogs(limit);
  }
}
