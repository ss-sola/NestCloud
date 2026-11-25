import type { ProcessMetricsSnapshot } from '@nest-cloud/sdk';
import { SERVICE_MONITOR_HIGH_USAGE as limits } from '../../constants/service-monitor.constants';
import type { ServiceMonitorCacheEntry, ServiceMonitorResource } from './service-monitor.types';

export class ServiceMonitorUsageUtil {
  static track(
    metrics: ProcessMetricsSnapshot,
    receivedAt: number,
    options: { previous?: ServiceMonitorCacheEntry; maxGapMs: number },
  ): ServiceMonitorCacheEntry['highUsageSince'] {
    const { previous, maxGapMs } = options;
    const lastAt = previous?.receivedAt;
    const sameProcess =
      previous?.row.status === 'available' &&
      previous.row.metrics !== undefined &&
      metrics.uptimeSeconds >= previous.row.metrics.uptimeSeconds;
    const prior =
      sameProcess && lastAt !== undefined && receivedAt >= lastAt && receivedAt - lastAt <= maxGapMs
        ? previous.highUsageSince
        : undefined;
    const cpu = metrics.cpuPercent != null && metrics.cpuPercent >= limits.cpuPercent;
    const memory = this.meetsThreshold(
      metrics.systemUsedMemoryBytes,
      metrics.systemTotalMemoryBytes,
      limits.memoryPercent,
    );
    const disk = this.meetsThreshold(
      metrics.diskUsedBytes,
      metrics.diskTotalBytes,
      limits.diskPercent,
    );
    if (!cpu && !memory && !disk) return undefined;
    return {
      cpu: cpu ? (prior?.cpu ?? receivedAt) : undefined,
      memory: memory ? (prior?.memory ?? receivedAt) : undefined,
      disk: disk ? (prior?.disk ?? receivedAt) : undefined,
    };
  }

  static sustainedResources(
    entry: ServiceMonitorCacheEntry,
    oldestValidSample: number,
  ): ServiceMonitorResource[] {
    const { row, receivedAt, highUsageSince } = entry;
    if (row.status !== 'available' || receivedAt === undefined || receivedAt < oldestValidSample) {
      return [];
    }
    return (['cpu', 'memory', 'disk'] as const).filter((resource) => {
      const startedAt = highUsageSince?.[resource];
      return startedAt !== undefined && receivedAt - startedAt >= limits.durationMs;
    });
  }

  private static meetsThreshold(
    used: number | undefined,
    total: number | undefined,
    percent: number,
  ) {
    return (
      used !== undefined && total !== undefined && total > 0 && used >= (total * percent) / 100
    );
  }
}
