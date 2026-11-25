import { createClient, type RedisClientType } from '@redis/client';
import { Logger } from '@nestjs/common';
import { EXPIRE_REGISTRY_LEASE, WRITE_REGISTRY_LEASE } from '../constants/registry-lease.constants';
import {
  CLEAR_INTERVAL,
  CLEAR_TIMEOUT,
  DEFAULT_AUDIT_LIMIT,
  DEFAULT_REDIS_PREFIX,
  REGISTRY_REDIS_RESILIENCE_OPTIONS,
} from './registry.constants';
import {
  RegistryAuditEvent,
  MemoryLeaseChange,
  RecoveryLease,
  RegistryAuditEventType,
  RegistryInstance,
  RegistryMetricSnapshot,
  RegistryOverview,
  RegistryRegistration,
  RegistryServiceQuery,
  RegistryServiceSummary,
  RegistryStorageType,
  ServiceInstance,
} from './registry.types';
import { RegistryHealthUtil } from './utils/registry-health.util';

type RegistryStoreOptions = {
  clearInterval?: number;
  clearTimeout?: number;
  auditLimit?: number;
};

type RedisRegistryStoreOptions = RegistryStoreOptions & {
  redisUrl: string;
  keyPrefix?: string;
  /** 降级模式下断线立即交回调用方，避免命令在离线队列中重复执行。 */
  failFast?: boolean;
};

const logger = new Logger('RegistryStore');
// 非 JSON 前缀使旧版中心也会在发现列表中跳过短期下线记录。
const REMOVED_PREFIX = 'removed:';

const EMPTY_METRICS = (): RegistryMetricSnapshot => ({
  registerCount: 0,
  unregisterCount: 0,
  heartbeatSuccessCount: 0,
  heartbeatFailureCount: 0,
  expireCount: 0,
  discoverCount: 0,
  discoverMissCount: 0,
});

export abstract class RegistryStore {
  abstract readonly storageType: RegistryStorageType;
  protected readonly auditLimit: number;
  protected readonly heartbeatTimeout: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: RegistryStoreOptions = {}) {
    this.auditLimit = options.auditLimit ?? DEFAULT_AUDIT_LIMIT;
    this.heartbeatTimeout = options.clearTimeout ?? CLEAR_TIMEOUT;
    this.startCleanupTask(options.clearInterval ?? CLEAR_INTERVAL);
  }

  abstract register(instance: RegistryRegistration): Promise<ServiceInstance>;
  abstract unregister(id: string): Promise<boolean>;
  abstract setAvailability(id: string, enabled: boolean): Promise<boolean>;
  abstract heartbeat(id: string): Promise<{ success: boolean }>;
  abstract getService(name: string, group?: string): Promise<ServiceInstance[]>;
  abstract cleanup(timeout: number): Promise<void>;
  abstract getAllInstances(): Promise<RegistryInstance[]>;
  abstract getMetrics(): Promise<RegistryMetricSnapshot>;
  abstract getAuditLogs(limit?: number): Promise<RegistryAuditEvent[]>;
  abstract destroy(): Promise<void>;

  async getAll() {
    return groupInstancesByService(
      (await this.getAllInstances()).filter((instance) => !instance.disabled),
    );
  }

  async getOverview(): Promise<RegistryOverview> {
    const instances = await this.getAllInstances();
    const cutoff = Date.now() - this.heartbeatTimeout;
    const timedOutInstanceCount = instances.filter(
      (instance) => instance.lastHeartbeat < cutoff,
    ).length;
    const metrics = await this.getMetrics();
    const [latestAudit] = await this.getAuditLogs(1);

    return {
      ...buildOverview(
        instances.filter((instance) => !instance.disabled),
        metrics,
        latestAudit,
        this.storageType,
        await this.getAuditCount(),
      ),
      heartbeat: {
        healthyInstanceCount: instances.length - timedOutInstanceCount,
        timedOutInstanceCount,
      },
    };
  }

  async getServiceSummaries(query: RegistryServiceQuery = {}): Promise<RegistryServiceSummary[]> {
    return buildServiceSummaries(await this.getAllInstances(), query);
  }

  protected async getAuditCount() {
    return (await this.getAuditLogs(this.auditLimit)).length;
  }

  protected renewLease(instance: RegistryInstance) {
    const now = Math.max(Date.now(), instance.lastHeartbeat);
    instance.heartbeatSuccessStreak = RegistryHealthUtil.nextSuccessStreak(instance, now);
    instance.lastHeartbeat = now;
  }

  private startCleanupTask(interval: number): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      void this.cleanup(this.heartbeatTimeout).catch((err) => {
        logger.error(
          `[RegistryStore] cleanup error: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, interval);
  }

  protected stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export class MemoryRegistryStore extends RegistryStore {
  onLeaseChange?: (kind: MemoryLeaseChange, instance: RegistryInstance) => void;
  readonly storageType: RegistryStorageType = 'memory';
  private readonly serviceMap = new Map<string, Map<string, RegistryInstance>>();
  private readonly cacheMap = new Map<string, RegistryInstance>();
  private readonly auditLogs: RegistryAuditEvent[] = [];
  private readonly metrics = EMPTY_METRICS();

  replaceInstances(instances: RegistryInstance[]): void {
    this.cacheMap.clear();
    this.serviceMap.clear();
    for (const instance of instances) this.rememberInstance(instance);
  }

  rememberInstance(instance: RegistryInstance): void {
    const previous = this.cacheMap.get(instance.id);
    if (previous) this.removeInstance(previous);
    const copy = { ...instance };
    this.cacheMap.set(copy.id, copy);
    const serviceInstances = this.serviceMap.get(copy.name) ?? new Map<string, RegistryInstance>();
    serviceInstances.set(copy.id, copy);
    this.serviceMap.set(copy.name, serviceInstances);
  }

  register(instance: RegistryRegistration): Promise<RegistryInstance> {
    const current = this.cacheMap.get(instance.id);
    const nextInstance = {
      ...instance,
      lastHeartbeat: Date.now(),
      heartbeatSuccessStreak: 0,
      disabled: current?.disabled,
      availabilityUpdatedAt: current?.availabilityUpdatedAt,
    };

    this.rememberInstance(nextInstance);
    this.onLeaseChange?.('register', nextInstance);
    this.incrementMetric('registerCount');
    this.pushAudit(createAuditEvent('register', nextInstance, '实例已注册或更新'));

    return Promise.resolve(nextInstance);
  }

  unregister(id: string): Promise<boolean> {
    const instance = this.cacheMap.get(id);
    if (!instance) {
      return Promise.resolve(false);
    }

    this.removeInstance(instance);
    this.onLeaseChange?.('unregister', instance);
    this.incrementMetric('unregisterCount');
    this.pushAudit(createAuditEvent('unregister', instance, '实例已下线'));
    return Promise.resolve(true);
  }

  setAvailability(id: string, enabled: boolean): Promise<boolean> {
    const instance = this.cacheMap.get(id);
    if (!instance) return Promise.resolve(false);
    instance.availabilityUpdatedAt = Math.max(
      Date.now(),
      (instance.availabilityUpdatedAt ?? 0) + 1,
    );
    if (Boolean(instance.disabled) === enabled) {
      instance.disabled = enabled ? undefined : true;
      this.pushAudit(createAvailabilityAudit(instance, enabled));
    }
    this.onLeaseChange?.('availability', instance);
    return Promise.resolve(true);
  }

  heartbeat(id: string): Promise<{ success: boolean }> {
    const instance = this.cacheMap.get(id);
    if (!instance) {
      this.incrementMetric('heartbeatFailureCount');
      this.pushAudit({
        id: createAuditId(),
        type: 'heartbeat-miss',
        timestamp: new Date().toISOString(),
        serviceName: '',
        instanceId: id,
        message: '心跳续约失败，实例不存在',
      });
      return Promise.resolve({ success: false });
    }

    this.renewLease(instance);
    this.onLeaseChange?.('heartbeat', instance);
    this.incrementMetric('heartbeatSuccessCount');
    return Promise.resolve({ success: true });
  }

  getService(name: string, group?: string): Promise<ServiceInstance[]> {
    const instances = Array.from(this.serviceMap.get(name)?.values() ?? []).filter(
      (instance) => !instance.disabled && (!group || instance.group === group),
    );

    this.incrementMetric('discoverCount');
    if (instances.length === 0) {
      this.incrementMetric('discoverMissCount');
      this.pushAudit({
        id: createAuditId(),
        type: 'discover-miss',
        timestamp: new Date().toISOString(),
        serviceName: name,
        group,
        message: '未发现可用实例',
      });
    }

    return Promise.resolve(
      instances.sort((left, right) => right.lastHeartbeat - left.lastHeartbeat),
    );
  }

  cleanup(timeout: number): Promise<void> {
    const now = Date.now();
    for (const instance of this.cacheMap.values()) {
      if (now - instance.lastHeartbeat <= timeout) {
        continue;
      }

      this.removeInstance(instance);
      this.onLeaseChange?.('expire', instance);
      this.incrementMetric('expireCount');
      this.pushAudit(createAuditEvent('expire', instance, '实例心跳超时，已自动摘除'));
    }

    return Promise.resolve();
  }

  getAllInstances(): Promise<RegistryInstance[]> {
    return Promise.resolve(Array.from(this.cacheMap.values()).sort(sortInstances));
  }

  getMetrics(): Promise<RegistryMetricSnapshot> {
    return Promise.resolve({ ...this.metrics });
  }

  getAuditLogs(limit = this.auditLimit): Promise<RegistryAuditEvent[]> {
    return Promise.resolve(this.auditLogs.slice(0, limit));
  }

  destroy(): Promise<void> {
    this.stopCleanupTask();
    return Promise.resolve();
  }

  private removeInstance(instance: ServiceInstance) {
    this.removeFromServiceMap(instance);
    this.cacheMap.delete(instance.id);
  }

  private removeFromServiceMap(instance: ServiceInstance) {
    const serviceInstances = this.serviceMap.get(instance.name);
    if (!serviceInstances) {
      return;
    }

    serviceInstances.delete(instance.id);
    if (serviceInstances.size === 0) {
      this.serviceMap.delete(instance.name);
    }
  }

  private incrementMetric(key: keyof RegistryMetricSnapshot) {
    this.metrics[key] += 1;
  }

  private pushAudit(event: RegistryAuditEvent) {
    this.auditLogs.unshift(event);
    if (this.auditLogs.length > this.auditLimit) {
      this.auditLogs.length = this.auditLimit;
    }
  }
}

export class RedisRegistryStore extends RegistryStore {
  readonly storageType: RegistryStorageType = 'redis';
  private readonly client: RedisClientType;
  private readonly ready: Promise<RedisClientType>;
  private readonly failFast: boolean;
  private readonly keys: {
    instances: string;
    metrics: string;
    audits: string;
    service: (serviceName: string) => string;
  };

  constructor(options: RedisRegistryStoreOptions) {
    super(options);
    this.failFast = options.failFast ?? false;
    const prefix = options.keyPrefix || DEFAULT_REDIS_PREFIX;

    this.keys = {
      instances: `${prefix}:instances`,
      metrics: `${prefix}:metrics`,
      audits: `${prefix}:audits`,
      service: (serviceName: string) => `${prefix}:service:${serviceName}`,
    };

    this.client = createClient({
      url: options.redisUrl,
      ...(this.failFast ? REGISTRY_REDIS_RESILIENCE_OPTIONS : {}),
    });
    this.client.on('error', (error) => {
      logger.error(
        `[RedisRegistryStore] redis error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
    this.ready = this.client.connect();
    if (this.failFast) void this.ready.catch(() => undefined);
  }

  get available(): boolean {
    return this.client.isReady;
  }

  /** 使用原始心跳时间与共享记录合并。重试只校正最终状态，不重复累加操作计数。 */
  async reconcile(change: RecoveryLease): Promise<void> {
    const local = change.instance;
    await this.ensureReady();
    for (;;) {
      const snapshot = (await this.client.hGet(this.keys.instances, local.id)) ?? null;
      const current = parseInstance(snapshot);
      if (change.kind === 'remove' || Date.now() - local.lastHeartbeat > this.heartbeatTimeout) {
        const cutoff = change.kind === 'remove' ? change.cutoff : local.lastHeartbeat;
        if (current && current.lastHeartbeat > cutoff) return;
        if (!(await this.rememberRemoval(local.id, snapshot, cutoff))) continue;
        await this.syncServiceIndex(local, false);
        if (current && current.name !== local.name) await this.syncServiceIndex(current, false);
        return;
      }
      // Redis 重启清空数据时恢复仍然有效的本地租约；显式下线后只有更新的注册才能重建它。
      if (
        snapshot?.startsWith(REMOVED_PREFIX) &&
        (change.registeredAt ?? 0) <= removedLease(snapshot).at
      )
        return;
      const newerLease = !current || local.lastHeartbeat >= current.lastHeartbeat;
      const next = {
        ...(newerLease && change.registeredAt !== undefined ? local : (current ?? local)),
      };
      if (newerLease) {
        next.lastHeartbeat = local.lastHeartbeat;
        next.heartbeatSuccessStreak = local.heartbeatSuccessStreak;
      }
      if (current) {
        next.disabled = current.disabled;
        next.availabilityUpdatedAt = current.availabilityUpdatedAt;
      }
      const localTime = local.availabilityUpdatedAt ?? 0;
      const sharedTime = current?.availabilityUpdatedAt ?? 0;
      if (
        change.availabilityChanged &&
        (localTime > sharedTime || (localTime === sharedTime && local.disabled))
      ) {
        next.disabled = local.disabled;
        next.availabilityUpdatedAt = localTime;
      }
      if (!(await this.writeLease(next, snapshot))) continue;
      if (current && current.name !== next.name) await this.syncServiceIndex(current, false);
      await this.syncServiceIndex(next, !next.disabled);
      return;
    }
  }

  async register(instance: RegistryRegistration) {
    await this.ensureReady();
    for (;;) {
      const snapshot = (await this.client.hGet(this.keys.instances, instance.id)) ?? null;
      const current = parseInstance(snapshot);
      const nextInstance = {
        ...instance,
        lastHeartbeat: Date.now(),
        heartbeatSuccessStreak: 0,
        disabled: current?.disabled,
        availabilityUpdatedAt: current?.availabilityUpdatedAt,
      };
      if (!(await this.writeLease(nextInstance, snapshot))) continue;
      if (current && current.name !== instance.name) {
        await this.syncServiceIndex(current, false);
      }
      await this.syncServiceIndex(nextInstance, !nextInstance.disabled);
      await this.incrementMetric('registerCount');
      await this.pushAudit(createAuditEvent('register', nextInstance, '实例已注册或更新'));
      return nextInstance;
    }
  }

  async unregister(id: string) {
    await this.ensureReady();
    for (;;) {
      const snapshot = (await this.client.hGet(this.keys.instances, id)) ?? null;
      const instance = parseInstance(snapshot);
      if (!instance) return false;
      if (!(await this.rememberRemoval(id, snapshot, Date.now()))) continue;
      await this.syncServiceIndex(instance, false);
      await this.incrementMetric('unregisterCount');
      await this.pushAudit(createAuditEvent('unregister', instance, '实例已下线'));
      return true;
    }
  }

  async setAvailability(id: string, enabled: boolean) {
    await this.ensureReady();
    for (;;) {
      const snapshot = (await this.client.hGet(this.keys.instances, id)) ?? null;
      const instance = parseInstance(snapshot);
      if (!instance) return false;
      const changed = Boolean(instance.disabled) === enabled;
      instance.disabled = enabled ? undefined : true;
      instance.availabilityUpdatedAt = Math.max(
        Date.now(),
        (instance.availabilityUpdatedAt ?? 0) + 1,
      );
      if (!(await this.writeLease(instance, snapshot))) continue;
      if (!changed) return true;
      await this.syncServiceIndex(instance, enabled);
      await this.pushAudit(createAvailabilityAudit(instance, enabled));
      return true;
    }
  }

  async heartbeat(id: string) {
    await this.ensureReady();
    for (;;) {
      const snapshot = await this.client.hGet(this.keys.instances, id);
      const instance = parseInstance(snapshot ?? null);
      if (!snapshot || !instance) break;

      this.renewLease(instance);
      if (await this.writeLease(instance, snapshot)) {
        await this.incrementMetric('heartbeatSuccessCount');
        return { success: true };
      }
    }

    await this.incrementMetric('heartbeatFailureCount');
    await this.pushAudit({
      id: createAuditId(),
      type: 'heartbeat-miss',
      timestamp: new Date().toISOString(),
      serviceName: '',
      instanceId: id,
      message: '心跳续约失败，实例不存在',
    });
    return { success: false };
  }

  async getService(name: string, group?: string) {
    // 实例哈希是租约的事实来源。旧服务索引跨槽维护，其短暂滞后不应影响服务发现。
    const instances = (await this.readInstances()).filter(
      (instance) =>
        !instance.disabled && instance.name === name && (!group || instance.group === group),
    );

    await this.incrementMetric('discoverCount');
    if (instances.length === 0) {
      await this.incrementMetric('discoverMissCount');
      await this.pushAudit({
        id: createAuditId(),
        type: 'discover-miss',
        timestamp: new Date().toISOString(),
        serviceName: name,
        group,
        message: '未发现可用实例',
      });
    }

    return instances.sort(sortInstances);
  }

  async cleanup(timeout: number) {
    await this.ensureReady();
    const snapshots = await this.client.hVals(this.keys.instances);
    const cutoff = Date.now() - timeout;

    for (const snapshot of snapshots) {
      if (snapshot.startsWith(REMOVED_PREFIX)) {
        const removed = removedLease(snapshot);
        if (Date.now() - removed.at > this.heartbeatTimeout) {
          await this.client.eval(EXPIRE_REGISTRY_LEASE, {
            keys: [this.keys.instances],
            arguments: [removed.id, snapshot],
          });
        }
        continue;
      }
      const instance = parseInstance(snapshot);
      if (!instance || instance.lastHeartbeat >= cutoff) {
        continue;
      }

      const removed = await this.client.eval(EXPIRE_REGISTRY_LEASE, {
        keys: [this.keys.instances],
        arguments: [instance.id, snapshot],
      });
      if (removed === 1) {
        await Promise.all([
          this.syncServiceIndex(instance, false),
          this.incrementMetric('expireCount'),
          this.pushAudit(createAuditEvent('expire', instance, '实例心跳超时，已自动摘除')),
        ]);
      }
    }
  }

  async getAllInstances() {
    return (await this.readInstances()).sort(sortInstances);
  }

  private async readInstances() {
    await this.ensureReady();
    const rawInstances = await this.client.hVals(this.keys.instances);
    return rawInstances
      .map(parseInstance)
      .filter((instance): instance is RegistryInstance => instance !== null);
  }

  async getMetrics() {
    await this.ensureReady();
    const rawMetrics = await this.client.hGetAll(this.keys.metrics);
    return normalizeMetrics(rawMetrics);
  }

  async getAuditLogs(limit = this.auditLimit) {
    await this.ensureReady();
    const rawAuditLogs = await this.client.lRange(this.keys.audits, 0, limit - 1);
    return rawAuditLogs
      .map((item) => parseAudit(item))
      .filter((item): item is RegistryAuditEvent => item !== null);
  }

  protected async getAuditCount() {
    await this.ensureReady();
    return this.client.lLen(this.keys.audits);
  }

  async destroy() {
    this.stopCleanupTask();
    if (this.failFast) {
      if (this.client.isOpen) this.client.destroy();
      return;
    }
    await this.ensureReady();
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async ensureReady() {
    if (this.failFast) {
      if (!this.available) throw new Error('注册中心 Redis 尚未就绪');
      return;
    }
    await this.ready;
  }

  private async getInstance(id: string) {
    const raw = await this.client.hGet(this.keys.instances, id);
    return parseInstance(raw ?? null);
  }

  private async writeLease(instance: RegistryInstance, snapshot: string | null) {
    return (
      (await this.client.eval(WRITE_REGISTRY_LEASE, {
        keys: [this.keys.instances],
        arguments: [instance.id, snapshot ?? '', JSON.stringify(instance)],
      })) === 1
    );
  }

  private async rememberRemoval(id: string, snapshot: string | null, at: number) {
    if (snapshot?.startsWith(REMOVED_PREFIX) && removedLease(snapshot).at >= at) return true;
    return (
      (await this.client.eval(WRITE_REGISTRY_LEASE, {
        keys: [this.keys.instances],
        arguments: [id, snapshot ?? '', REMOVED_PREFIX + JSON.stringify({ id, at })],
      })) === 1
    );
  }

  /** 兼容仍读取服务集合的旧版中心。每次写后复查租约，纠正其间注册、改名或注销留下的索引。 */
  private async syncServiceIndex(instance: ServiceInstance, listed: boolean) {
    const key = this.keys.service(instance.name);
    for (;;) {
      if (listed) await this.client.sAdd(key, instance.id);
      else await this.client.sRem(key, instance.id);
      const current = await this.getInstance(instance.id);
      const shouldList = current?.name === instance.name && !current.disabled;
      if (listed === shouldList) return;
      listed = shouldList;
    }
  }

  private async incrementMetric(key: keyof RegistryMetricSnapshot) {
    await this.client.hIncrBy(this.keys.metrics, key, 1);
  }

  private async pushAudit(event: RegistryAuditEvent) {
    await this.client.lPush(this.keys.audits, JSON.stringify(event));
    await this.client.lTrim(this.keys.audits, 0, this.auditLimit - 1);
  }
}

function groupInstancesByService(instances: ServiceInstance[]) {
  const grouped = new Map<string, ServiceInstance[]>();

  for (const instance of instances) {
    const serviceInstances = grouped.get(instance.name) ?? [];
    serviceInstances.push(instance);
    grouped.set(instance.name, serviceInstances);
  }

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([name, items]) => [name, items.sort(sortInstances)]),
  );
}

function buildServiceSummaries(
  instances: RegistryInstance[],
  query: RegistryServiceQuery,
): RegistryServiceSummary[] {
  const normalizedSearch = query.search?.trim().toLowerCase();
  const now = Date.now();
  const summaryMap = new Map<string, Omit<RegistryServiceSummary, 'health' | 'healthScore'>>();

  for (const instance of instances) {
    if (normalizedSearch && !instance.name.toLowerCase().includes(normalizedSearch)) {
      continue;
    }

    if (query.group && instance.group !== query.group) {
      continue;
    }

    const summary = summaryMap.get(instance.name) ?? {
      name: instance.name,
      instanceCount: 0,
      groups: [],
      latestHeartbeat: 0,
      latestHeartbeatAt: undefined,
      instances: [],
    };

    summary.instances.push({
      ...instance,
      health: RegistryHealthUtil.instanceHealth(instance, now),
    });
    if (!instance.disabled) summary.instanceCount += 1;
    if (instance.group && !summary.groups.includes(instance.group)) {
      summary.groups.push(instance.group);
    }
    if (instance.lastHeartbeat > summary.latestHeartbeat) {
      summary.latestHeartbeat = instance.lastHeartbeat;
      summary.latestHeartbeatAt = new Date(instance.lastHeartbeat).toISOString();
    }

    summaryMap.set(instance.name, summary);
  }

  return Array.from(summaryMap.values())
    .map((summary) => ({
      ...summary,
      ...RegistryHealthUtil.serviceHealth(summary.instances),
      groups: summary.groups.sort(),
      instances: summary.instances.sort(sortInstances),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildOverview(
  instances: ServiceInstance[],
  metrics: RegistryMetricSnapshot,
  latestAudit: RegistryAuditEvent | undefined,
  storageType: RegistryStorageType,
  auditCount: number,
): Omit<RegistryOverview, 'heartbeat'> {
  const services = new Set<string>();
  const groups = new Set<string>();
  let latestHeartbeat = 0;

  for (const instance of instances) {
    services.add(instance.name);
    if (instance.group) {
      groups.add(instance.group);
    }
    latestHeartbeat = Math.max(latestHeartbeat, instance.lastHeartbeat);
  }

  return {
    storageType,
    serviceCount: services.size,
    instanceCount: instances.length,
    groupCount: groups.size,
    auditCount,
    latestHeartbeatAt: latestHeartbeat ? new Date(latestHeartbeat).toISOString() : undefined,
    latestChangeAt: latestAudit?.timestamp,
    metrics,
  };
}

function createAuditEvent(
  type: RegistryAuditEventType,
  instance: ServiceInstance,
  message: string,
): RegistryAuditEvent {
  return {
    id: createAuditId(),
    type,
    timestamp: new Date().toISOString(),
    serviceName: instance.name,
    instanceId: instance.id,
    group: instance.group,
    host: instance.host,
    port: instance.port,
    metadata: instance.metadata,
    message,
  };
}

function createAvailabilityAudit(instance: RegistryInstance, enabled: boolean) {
  return createAuditEvent(
    enabled ? 'enable' : 'disable',
    instance,
    enabled ? '实例已恢复服务发现' : '实例已手动摘除',
  );
}

function createAuditId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortInstances(left: ServiceInstance, right: ServiceInstance) {
  return right.lastHeartbeat - left.lastHeartbeat;
}

function removedLease(snapshot: string): { id: string; at: number } {
  return JSON.parse(snapshot.slice(REMOVED_PREFIX.length));
}

function parseInstance(raw: string | null) {
  if (!raw || raw.startsWith(REMOVED_PREFIX)) {
    return null;
  }

  try {
    const instance = JSON.parse(raw) as RegistryInstance & { heartbeatInterval?: unknown };
    delete instance.heartbeatInterval;
    return instance;
  } catch {
    return null;
  }
}

function parseAudit(raw: string) {
  try {
    return JSON.parse(raw) as RegistryAuditEvent;
  } catch {
    return null;
  }
}

function normalizeMetrics(rawMetrics: Record<string, string>) {
  const metrics = EMPTY_METRICS();
  for (const key of Object.keys(metrics) as Array<keyof RegistryMetricSnapshot>) {
    metrics[key] = Number(rawMetrics[key] ?? 0);
  }
  return metrics;
}
