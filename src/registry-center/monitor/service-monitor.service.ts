import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigKeys, getConfig } from '@nest-cloud/sdk';
import { ServiceMonitorFetchService } from '../../client/service-monitor-fetch.service';
import { ConfigServiceKeys } from '../../config-keys';
import {
  SERVICE_MONITOR_DEFAULTS as defaults,
  SERVICE_MONITOR_HIGH_USAGE,
} from '../../constants/service-monitor.constants';
import { CLEAR_TIMEOUT } from '../registry.constants';
import { RegistryService } from '../registry.service';
import { ServiceMonitorTargets } from './service-monitor-targets';
import { ServiceMonitorCacheService } from './service-monitor-cache.service';
import { ServiceMonitorUsageUtil } from './service-monitor-usage.util';
import type {
  ServiceMonitorCache,
  ServiceMonitorCacheEntry,
  ServiceMonitorRow,
  ServiceMonitorTarget,
} from './service-monitor.types';

@Injectable()
export class ServiceMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceMonitorService.name);
  private readonly token = getConfig(ConfigKeys.ServiceMonitorToken, '', false);
  private readonly enabled = Boolean(
    this.token && getConfig(ConfigKeys.ControlPlaneToken, '', false),
  );
  private readonly intervalMs = getConfig(
    ConfigServiceKeys.ServiceMonitorIntervalMs,
    defaults.intervalMs,
  );
  private readonly targets = new ServiceMonitorTargets(
    getConfig(ConfigServiceKeys.ServiceMonitorTrustedHosts, '', false),
    getConfig(ConfigServiceKeys.ServiceMonitorStaticTargets, '', false),
  );
  private readonly stop = new AbortController();
  private readonly cache = new Map<string, ServiceMonitorCacheEntry>();
  private timer?: ReturnType<typeof setInterval>;
  private collecting = false;
  private lastCompletedAt?: string;
  private registryUnavailable = false;
  private lastShared?: ServiceMonitorCache;
  private collectionMode?: 'redis' | 'memory' | 'standby';

  constructor(
    private readonly registry: RegistryService,
    private readonly client: ServiceMonitorFetchService,
    private readonly shared: ServiceMonitorCacheService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.collect(), this.intervalMs).unref();
    void this.collect();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.stop.abort();
  }

  async snapshot() {
    const shared = this.enabled ? await this.shared.read() : undefined;
    if (shared) this.lastShared = shared;
    const latest = shared ?? this.lastShared;
    const useShared = latest && latest.lastCompletedAt >= (this.lastCompletedAt ?? '');
    const entries = useShared ? latest.entries : this.cache.values();
    const cutoff = Date.now() - this.intervalMs * defaults.staleAfterIntervals;
    let highUsageCount = 0;
    const list = Array.from(entries, (entry): ServiceMonitorRow => {
      const { row, receivedAt } = entry;
      const highUsage = ServiceMonitorUsageUtil.sustainedResources(entry, cutoff);
      if (highUsage.length) {
        highUsageCount += 1;
        return { ...row, highUsage };
      }
      return row.status === 'available' && receivedAt !== undefined && receivedAt < cutoff
        ? { ...row, status: 'stale' }
        : row;
    });
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastCompletedAt: useShared ? latest.lastCompletedAt : this.lastCompletedAt,
      registryUnavailable: useShared ? latest.registryUnavailable : this.registryUnavailable,
      storage: shared && useShared ? 'redis' : 'memory',
      highUsageCount,
      highUsagePolicy: SERVICE_MONITOR_HIGH_USAGE,
      list,
    };
  }

  async collect(): Promise<void> {
    if (!this.enabled || this.collecting || this.stop.signal.aborted) return;
    this.collecting = true;
    try {
      const mode = await this.shared.claim(this.intervalMs);
      const previousMode = this.collectionMode;
      this.collectionMode = mode;
      if (mode === 'standby' || this.stop.signal.aborted) return;
      if (mode === 'redis' && previousMode !== 'redis') {
        const previous = await this.shared.read();
        const cutoff = Date.now() - this.intervalMs * defaults.staleAfterIntervals;
        if (previous && previous.lastCompletedAt >= (this.lastCompletedAt ?? '')) {
          this.cache.clear();
          for (const entry of previous.entries) {
            if (entry.receivedAt !== undefined && entry.receivedAt >= cutoff) {
              this.cache.set(entry.row.id, entry);
            }
          }
        }
      }
      const targets = await this.resolveTargets();
      if (this.stop.signal.aborted) return;

      const ids = new Set(targets.map((target) => target.id));
      if (!this.registryUnavailable) {
        for (const id of this.cache.keys()) {
          if (!ids.has(id)) this.cache.delete(id);
        }
      }
      for (const target of targets) {
        if (!this.cache.has(target.id))
          this.cache.set(target.id, { row: { ...target, status: 'pending' } });
      }

      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(defaults.concurrency, targets.length) },
        async (_, index) => {
          await delay(index * defaults.startSpacingMs, undefined, { signal: this.stop.signal });
          while (!this.stop.signal.aborted && nextIndex < targets.length) {
            await this.collectTarget(targets[nextIndex++]);
          }
        },
      );
      await Promise.all(workers);
      if (!this.stop.signal.aborted) {
        this.lastCompletedAt = new Date().toISOString();
        if (mode === 'redis') {
          await this.shared.write(
            {
              lastCompletedAt: this.lastCompletedAt,
              registryUnavailable: this.registryUnavailable,
              entries: Array.from(this.cache.values()),
            },
            this.intervalMs,
          );
        }
      }
    } catch {
      if (!this.stop.signal.aborted) this.logger.warn('服务指标采集轮次未完成');
    } finally {
      this.collecting = false;
    }
  }

  private async resolveTargets(): Promise<ServiceMonitorTarget[]> {
    const cutoff = Date.now() - CLEAR_TIMEOUT;
    const targets: ServiceMonitorTarget[] = [];
    try {
      for (const {
        id,
        name,
        host,
        port,
        lastHeartbeat,
      } of await this.registry.getInstancesForMonitoring()) {
        if (lastHeartbeat >= cutoff)
          targets.push({ id: `registry:${id}`, name, host, port, scheme: 'http:' });
      }
      this.registryUnavailable = false;
    } catch {
      this.registryUnavailable = true;
      // 注册存储临时失败时，保留已发现实例的上次快照，仅刷新固定目标。
    }
    const fixedAddresses = new Set(this.targets.fixed.map(({ host, port }) => `${host}:${port}`));
    return [
      ...targets.filter(({ host, port }) => !fixedAddresses.has(`${host.toLowerCase()}:${port}`)),
      ...this.targets.fixed,
    ];
  }

  private async collectTarget(target: ServiceMonitorTarget): Promise<void> {
    const configured = this.targets.fixed.some((fixed) => fixed.id === target.id);
    if (!configured && !this.targets.contains(target.host)) {
      this.cache.set(target.id, { row: { ...target, status: 'excluded' } });
      return;
    }
    const previous = this.cache.get(target.id);
    try {
      const metrics = await this.client.fetch(target, this.token, this.stop.signal);
      if (this.stop.signal.aborted) return;
      const status = metrics ? 'available' : 'unavailable';
      const receivedAt = metrics ? Date.now() : undefined;
      const highUsageSince =
        metrics && receivedAt !== undefined
          ? ServiceMonitorUsageUtil.track(metrics, receivedAt, {
              previous:
                previous?.row.host === target.host && previous.row.port === target.port
                  ? previous
                  : undefined,
              maxGapMs: this.intervalMs * defaults.staleAfterIntervals,
            })
          : undefined;
      this.cache.set(target.id, {
        row: { ...target, status, metrics },
        receivedAt,
        highUsageSince,
      });
    } catch {
      if (this.stop.signal.aborted) return;
      this.cache.set(target.id, {
        row: { ...target, status: 'failed', metrics: previous?.row.metrics },
        receivedAt: previous?.receivedAt,
      });
    }
  }
}
