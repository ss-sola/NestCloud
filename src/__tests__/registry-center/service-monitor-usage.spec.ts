import { describe, expect, it } from 'vitest';
import type { ProcessMetricsSnapshot } from '@nest-cloud/sdk';
import type { ServiceMonitorCacheEntry } from '../../registry-center/monitor/service-monitor.types';
import { ServiceMonitorUsageUtil } from '../../registry-center/monitor/service-monitor-usage.util';

const base: ProcessMetricsSnapshot = {
  collectedAt: '2026-11-25T00:00:00.000Z',
  cpuPercent: 10,
  cpuWindowMs: 2_000,
  rssBytes: 1,
  heapUsedBytes: 1,
  heapTotalBytes: 1,
  uptimeSeconds: 500,
  systemUsedMemoryBytes: 40,
  systemTotalMemoryBytes: 100,
  diskUsedBytes: 40,
  diskTotalBytes: 100,
};
const target = { id: '1', name: 'worker', host: '127.0.0.1', port: 3200, scheme: 'http:' } as const;

function sample(
  at: number,
  changes: Partial<ProcessMetricsSnapshot>,
  previous?: ServiceMonitorCacheEntry,
): ServiceMonitorCacheEntry {
  const metrics = { ...base, ...changes };
  return {
    row: { ...target, status: 'available', metrics },
    receivedAt: at,
    highUsageSince: ServiceMonitorUsageUtil.track(metrics, at, { previous, maxGapMs: 20_000 }),
  };
}

describe('服务资源持续高占用', () => {
  it('同一实例的 CPU、内存、磁盘可以独立达标，收到满 60 秒的样本后进入统计', () => {
    let latest = sample(0, { cpuPercent: 80, systemUsedMemoryBytes: 85, diskUsedBytes: 85 });
    for (let at = 10_000; at < 60_000; at += 10_000) {
      latest = sample(at, { cpuPercent: 80, systemUsedMemoryBytes: 85, diskUsedBytes: 85 }, latest);
    }
    expect(ServiceMonitorUsageUtil.sustainedResources(latest, 40_000)).toEqual([]);
    latest = sample(
      60_000,
      { cpuPercent: 80, systemUsedMemoryBytes: 85, diskUsedBytes: 85 },
      latest,
    );
    expect(ServiceMonitorUsageUtil.sustainedResources(latest, 40_000)).toEqual([
      'cpu',
      'memory',
      'disk',
    ]);
    expect(ServiceMonitorUsageUtil.sustainedResources(latest, 60_001)).toEqual([]);
  });

  it('CPU 和磁盘交替升高、采样间断、采集失败或进程重启都不能累计旧时长', () => {
    let latest = sample(0, { cpuPercent: 100 });
    for (let at = 10_000; at <= 60_000; at += 10_000) {
      latest = sample(at, at % 20_000 ? { diskUsedBytes: 90 } : { cpuPercent: 100 }, latest);
    }
    expect(ServiceMonitorUsageUtil.sustainedResources(latest, 40_000)).toEqual([]);
    expect(sample(81_000, { cpuPercent: 100 }, latest).highUsageSince?.cpu).toBe(81_000);
    expect(sample(70_000, { cpuPercent: 100, uptimeSeconds: 10 }, latest).highUsageSince?.cpu).toBe(
      70_000,
    );
    latest.row.status = 'failed';
    expect(sample(70_000, { cpuPercent: 100 }, latest).highUsageSince?.cpu).toBe(70_000);
  });
});
