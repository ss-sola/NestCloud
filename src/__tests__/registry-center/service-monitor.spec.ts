import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@nest-cloud/sdk';
import type { ServiceMonitorFetchService } from '../../client/service-monitor-fetch.service';
import type { RegistryService } from '../../registry-center/registry.service';
import type { ServiceMonitorCacheService } from '../../registry-center/monitor/service-monitor-cache.service';
import { ServiceMonitorService } from '../../registry-center/monitor/service-monitor.service';

vi.mock('@nest-cloud/sdk', async (importActual) => ({
  ...(await importActual<typeof import('@nest-cloud/sdk')>()),
  getConfig: vi.fn((key: string, fallback: unknown) => {
    const entries: Record<string, string> = {
      ServiceMonitorToken: 'monitor-test-token',
      ControlPlaneToken: 'registry-test-token',
      ServiceMonitorTrustedHosts: '127.0.0.1/32',
      ServiceMonitorStaticTargets: 'gateway=http://127.0.0.1:3100',
    };
    return entries[key] ?? fallback;
  }),
}));

const metrics = {
  collectedAt: '2026-11-25T01:00:00.000Z',
  cpuPercent: 1.25,
  cpuWindowMs: 2000,
  rssBytes: 4096,
  heapUsedBytes: 1024,
  heapTotalBytes: 2048,
  uptimeSeconds: 600,
};

function setup() {
  const registry = {
    getInstancesForMonitoring: vi.fn().mockResolvedValue([
      {
        id: 'system',
        name: 'system-service',
        host: '127.0.0.1',
        port: 3200,
        lastHeartbeat: Date.now(),
      },
      { id: 'untrusted', name: 'other', host: '192.0.2.5', port: 3300, lastHeartbeat: Date.now() },
    ]),
  };
  const client = { fetch: vi.fn().mockResolvedValue(metrics) };
  const shared = { claim: vi.fn().mockResolvedValue('redis'), write: vi.fn(), read: vi.fn() };
  const service = new ServiceMonitorService(
    registry as unknown as RegistryService,
    client as unknown as ServiceMonitorFetchService,
    shared as unknown as ServiceMonitorCacheService,
  );
  return { service, registry, client, shared };
}

describe('服务监控采集', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('默认每 10 秒采集，去除不可信目标，保留 Redis 故障期间的内存快照', async () => {
    const { service, client, shared } = setup();
    try {
      await service.collect();
      expect(client.fetch.mock.calls.map(([target]) => target.name).sort()).toEqual([
        'gateway',
        'system-service',
      ]);
      expect(shared.write).toHaveBeenCalledTimes(1);
      const [saved] = shared.write.mock.calls[0];
      shared.read.mockResolvedValue(saved);
      expect(await service.snapshot()).toMatchObject({ intervalMs: 10_000, storage: 'redis' });
      shared.claim.mockResolvedValue('memory');
      shared.read.mockResolvedValue(undefined);
      client.fetch.mockRejectedValue(new Error('unavailable'));
      await service.collect();
      expect(await service.snapshot()).toMatchObject({
        intervalMs: 10_000,
        storage: 'memory',
        list: expect.arrayContaining([
          expect.objectContaining({ name: 'system-service', status: 'failed', metrics }),
          expect.objectContaining({ name: 'other', status: 'excluded' }),
        ]),
      });
      expect(shared.write).toHaveBeenCalledTimes(1);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('非租约持有者只读取缓存，不重复访问服务实例', async () => {
    const { service, client, registry, shared } = setup();
    try {
      shared.claim.mockResolvedValue('standby');
      await service.collect();
      expect(registry.getInstancesForMonitoring).not.toHaveBeenCalled();
      expect(client.fetch).not.toHaveBeenCalled();
      expect(getConfig).toHaveBeenCalledWith('ServiceMonitorIntervalMs', 10_000);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('共享快照中达标的资源会标注，同一实例只计一次', async () => {
    const { service, shared } = setup();
    const now = Date.now();
    const target = { id: 'worker', name: 'worker', host: '127.0.0.1', port: 3200, scheme: 'http:' };
    shared.read.mockResolvedValue({
      lastCompletedAt: new Date(now).toISOString(),
      registryUnavailable: false,
      entries: [
        {
          row: { ...target, status: 'available', metrics },
          receivedAt: now,
          highUsageSince: { cpu: now - 60_000, disk: now - 70_000 },
        },
        {
          row: { ...target, id: 'stale', status: 'available', metrics },
          receivedAt: now - 21_000,
          highUsageSince: { memory: now - 90_000 },
        },
      ],
    });
    try {
      expect(await service.snapshot()).toMatchObject({
        highUsageCount: 1,
        list: [
          { id: 'worker', highUsage: ['cpu', 'disk'] },
          { id: 'stale', status: 'stale' },
        ],
      });
    } finally {
      service.onModuleDestroy();
    }
  });
});
