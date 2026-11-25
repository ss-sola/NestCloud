import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createClient, type RedisClientType } from '@redis/client';
import { randomUUID } from 'node:crypto';
import { ConfigKeys, getConfig } from '@nest-cloud/sdk';
import { ConfigServiceKeys } from '../../config-keys';
import { SERVICE_MONITOR_DEFAULTS as defaults } from '../../constants/service-monitor.constants';
import {
  RENEW_MONITOR_LEASE,
  SAVE_MONITOR_SNAPSHOT,
} from '../../constants/service-monitor-redis.constants';
import { DEFAULT_REDIS_PREFIX, REGISTRY_REDIS_RESILIENCE_OPTIONS } from '../registry.constants';
import type { ServiceMonitorCache } from './service-monitor.types';

@Injectable()
export class ServiceMonitorCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ServiceMonitorCacheService.name);
  private readonly owner = randomUUID();
  private readonly client?: RedisClientType;
  private readonly key: string;
  private readonly leaseKey: string;

  constructor() {
    const prefix = getConfig(ConfigServiceKeys.RegistryRedisKeyPrefix, DEFAULT_REDIS_PREFIX, false);
    this.key = `${prefix}:{service-monitor}:latest`;
    this.leaseKey = `${prefix}:{service-monitor}:lease`;
    const redisUrl = getConfig(ConfigServiceKeys.RegistryRedisUrl, '', false);
    if (
      !redisUrl ||
      !getConfig(ConfigKeys.ServiceMonitorToken, '', false) ||
      !getConfig(ConfigKeys.ControlPlaneToken, '', false)
    )
      return;
    this.client = createClient({
      url: redisUrl,
      ...REGISTRY_REDIS_RESILIENCE_OPTIONS,
      commandsQueueMaxLength: 32,
    });
    this.client.on('error', () => this.logger.debug('指标 Redis 连接暂不可用'));
    void this.client.connect().catch(() => undefined);
  }

  async claim(ttlMs: number): Promise<'redis' | 'memory' | 'standby'> {
    if (!this.client?.isReady) return 'memory';
    try {
      const acquired = await this.client.eval(RENEW_MONITOR_LEASE, {
        keys: [this.leaseKey],
        arguments: [this.owner, String(this.ttl(ttlMs))],
      });
      return acquired === 1 ? 'redis' : 'standby';
    } catch {
      return 'memory';
    }
  }

  async read(): Promise<ServiceMonitorCache | undefined> {
    if (!this.client?.isReady) return;
    try {
      const raw = await this.client.get(this.key);
      if (raw) return JSON.parse(raw) as ServiceMonitorCache;
    } catch {
      // 请求退回当前副本内存里的最后一份快照。
    }
  }

  async write(snapshot: ServiceMonitorCache, ttlMs: number): Promise<void> {
    if (!this.client?.isReady) return;
    try {
      await this.client.eval(SAVE_MONITOR_SNAPSHOT, {
        keys: [this.leaseKey, this.key],
        arguments: [this.owner, JSON.stringify(snapshot), String(this.ttl(ttlMs))],
      });
    } catch {
      // 采集器已经保留本轮快照，连接恢复后重新竞争租约。
    }
  }

  onModuleDestroy(): void {
    if (this.client?.isOpen) this.client.destroy();
  }

  private ttl(intervalMs: number): number {
    return Math.max(defaults.minCacheTtlMs, intervalMs * 3);
  }
}
