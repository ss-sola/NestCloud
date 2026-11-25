import { Logger } from '@nestjs/common';
import { MemoryRegistryStore, RedisRegistryStore, type RegistryStore } from './registry.store';
import type { RegistryRegistration, RegistryServiceQuery } from './registry.types';
import { REGISTRY_FALLBACK_SYNC_MS } from './registry.constants';

export type RegistryBackend = Pick<
  RegistryStore,
  | 'register'
  | 'unregister'
  | 'setAvailability'
  | 'heartbeat'
  | 'getService'
  | 'cleanup'
  | 'getAllInstances'
  | 'getAll'
  | 'getOverview'
  | 'getServiceSummaries'
  | 'getAuditLogs'
  | 'destroy'
>;

export class ResilientRegistryStore implements RegistryBackend {
  private readonly logger = new Logger(ResilientRegistryStore.name);
  private readonly timer: ReturnType<typeof setInterval>;
  private useRedis = false;
  private revision = 0;
  private pendingSync?: Promise<void>;
  private retryAt = 0;

  constructor(
    private readonly redis: RedisRegistryStore,
    private readonly memory: MemoryRegistryStore,
  ) {
    this.timer = setInterval(() => void this.synchronize(), REGISTRY_FALLBACK_SYNC_MS).unref();
    void this.synchronize();
  }

  register(instance: RegistryRegistration) {
    return this.run(
      (store) => store.register(instance),
      (registered) => this.memory.rememberInstance(registered),
    );
  }

  unregister(id: string) {
    return this.run(
      (store) => store.unregister(id),
      async () => {
        await this.memory.unregister(id);
      },
    );
  }

  setAvailability(id: string, enabled: boolean) {
    return this.run(
      (store) => store.setAvailability(id, enabled),
      async (found) => {
        if (found) await this.memory.setAvailability(id, enabled);
      },
    );
  }

  heartbeat(id: string) {
    return this.run(
      (store) => store.heartbeat(id),
      async ({ success }) => {
        if (success) await this.memory.heartbeat(id);
      },
    );
  }

  getService(name: string, group?: string) {
    return this.run((store) => store.getService(name, group));
  }

  cleanup(timeout: number) {
    return this.run(
      (store) => store.cleanup(timeout),
      () => this.memory.cleanup(timeout),
    );
  }

  getAll() {
    return this.run((store) => store.getAll());
  }

  getAllInstances() {
    return this.run((store) => store.getAllInstances());
  }

  getOverview() {
    return this.run((store) => store.getOverview());
  }

  getServiceSummaries(query?: RegistryServiceQuery) {
    return this.run((store) => store.getServiceSummaries(query));
  }

  getAuditLogs(limit?: number) {
    return this.run((store) => store.getAuditLogs(limit));
  }

  async destroy() {
    clearInterval(this.timer);
    await Promise.all([this.redis.destroy(), this.memory.destroy()]);
  }

  private async run<T>(
    operation: (store: RegistryStore) => Promise<T>,
    mirror?: (result: T) => void | Promise<void>,
  ): Promise<T> {
    if (!this.useRedis && this.redis.available) await this.synchronize();
    if (this.useRedis && this.redis.available) {
      try {
        const result = await operation(this.redis);
        if (mirror) {
          this.revision += 1;
          await mirror(result);
        }
        return result;
      } catch {
        this.markDegraded();
      }
    } else if (this.useRedis) {
      this.markDegraded();
    }
    if (mirror) this.revision += 1;
    return operation(this.memory);
  }

  private markDegraded(): void {
    if (this.useRedis) this.logger.warn('注册中心 Redis 不可用，已降级为进程内存');
    this.useRedis = false;
    this.retryAt = Date.now() + REGISTRY_FALLBACK_SYNC_MS;
  }

  private async synchronize(): Promise<void> {
    if (!this.redis.available) {
      if (this.useRedis) this.markDegraded();
      return;
    }
    if (Date.now() < this.retryAt) return;
    this.pendingSync ??= this.refreshMirror().finally(() => {
      this.pendingSync = undefined;
    });
    await this.pendingSync;
  }

  private async refreshMirror(): Promise<void> {
    const revision = this.revision;
    try {
      const shared = await this.redis.getAllInstances();
      // 同步期间的本地写入优先保留，下一轮再复制共享记录。
      if (this.useRedis && revision !== this.revision) return;
      this.memory.replaceInstances(shared);
      if (!this.useRedis) this.logger.log('注册中心已切换到共享 Redis');
      this.useRedis = true;
    } catch {
      this.markDegraded();
    }
  }
}
