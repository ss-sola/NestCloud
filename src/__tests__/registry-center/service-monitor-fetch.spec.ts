import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceMonitorFetchService } from '../../client/service-monitor-fetch.service';
import type { ServiceMonitorTarget } from '../../registry-center/monitor/service-monitor.types';

const legacy = {
  collectedAt: '2026-11-25T00:00:00.000Z',
  cpuPercent: 0,
  cpuWindowMs: 2_000,
  rssBytes: 10,
  heapUsedBytes: 5,
  heapTotalBytes: 8,
  uptimeSeconds: 5,
};
const target: ServiceMonitorTarget = {
  id: 'worker',
  name: 'worker',
  host: '127.0.0.1',
  port: 3200,
  scheme: 'http:',
};

describe('服务监控快照协议', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('允许旧 SDK 缺省系统字段，并透传新版字段', async () => {
    const client = new ServiceMonitorFetchService();
    const signal = new AbortController().signal;
    const next = {
      ...legacy,
      cpuLogicalCoreCount: 8,
      systemTotalMemoryBytes: 16 * 1024 ** 3,
      systemUsedMemoryBytes: 4 * 1024 ** 3,
      diskTotalBytes: 1024 ** 4,
      diskUsedBytes: 0,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(legacy)))
      .mockResolvedValueOnce(new Response(JSON.stringify(next)));
    vi.stubGlobal('fetch', fetch);
    expect(await client.fetch(target, 'test-token', signal)).toEqual(legacy);
    expect(await client.fetch(target, 'test-token', signal)).toEqual(next);
  });

  it('拒绝已用量超过总量的磁盘数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...legacy,
            diskTotalBytes: 100,
            diskUsedBytes: 101,
          }),
        ),
      ),
    );
    await expect(
      new ServiceMonitorFetchService().fetch(target, 'test-token', new AbortController().signal),
    ).rejects.toThrow('磁盘指标格式错误');
  });
});
