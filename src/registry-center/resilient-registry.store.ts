import { Logger } from '@nestjs/common';
import { MemoryRegistryStore, RedisRegistryStore, type RegistryStore } from './registry.store';
import type {
  MemoryLeaseChange,
  RecoveryLease,
  RegistryInstance,
  RegistryRegistration,
  RegistryServiceQuery,
} from './registry.types';
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
  private readonly changes = new Map<string, RecoveryLease>();

  constructor(
    private readonly redis: RedisRegistryStore,
    private readonly memory: MemoryRegistryStore,
  ) {
    memory.onLeaseChange = (kind, instance) => {
      if (!this.useRedis) this.recordChange(kind, instance);
    };
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
    await this.pendingSync;
    this.memory.onLeaseChange = undefined;
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

  private recordChange(kind: MemoryLeaseChange, instance: RegistryInstance): void {
    const previous = this.changes.get(instance.id);
    const copy = { ...instance };
    if (kind === 'unregister' || kind === 'expire') {
      const cutoff = kind === 'expire' ? instance.lastHeartbeat : Date.now();
      this.changes.set(instance.id, { kind: 'remove', instance: copy, cutoff });
    } else {
      const prior = previous?.kind === 'update' ? previous : undefined;
      const recreated = kind === 'register' && previous?.kind === 'remove';
      let registeredAt = prior?.registeredAt;
      if (kind === 'register') {
        registeredAt = recreated
          ? Math.max(instance.lastHeartbeat, previous.cutoff + 1)
          : instance.lastHeartbeat;
      }
      // 下线后用相同 ID 新注册会开启新的流量状态，后续续约保留这次操作的顺序。
      if (recreated) copy.availabilityUpdatedAt = registeredAt;
      else if (prior?.availabilityChanged) {
        const priorTime = prior.instance.availabilityUpdatedAt ?? 0;
        copy.availabilityUpdatedAt = Math.max(
          copy.availabilityUpdatedAt ?? 0,
          priorTime + Number(prior.instance.disabled !== copy.disabled),
        );
      }
      this.changes.set(instance.id, {
        kind: 'update',
        instance: copy,
        registeredAt,
        availabilityChanged: recreated || kind === 'availability' || !!prior?.availabilityChanged,
      });
    }
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
      for (const [id, change] of this.changes) {
        await this.redis.reconcile(change);
        if (this.changes.get(id) === change) this.changes.delete(id);
      }
      const shared = await this.redis.getAllInstances();
      // 同步期间的本地写入优先保留，下一轮再复制共享记录。
      if (revision !== this.revision || this.changes.size || !this.redis.available) return;
      this.memory.replaceInstances(shared);
      if (!this.useRedis) this.logger.log('注册中心已切换到共享 Redis');
      this.useRedis = true;
    } catch {
      this.markDegraded();
    }
  }
}
