import { expect, it, vi } from 'vitest';
import { MemoryRegistryStore } from '../registry-center/registry.store';

it('注册的实例可按分组发现，下线后不再响应心跳', async () => {
  const store = new MemoryRegistryStore();
  const instance = {
    id: 'example-1',
    name: 'example',
    group: 'test',
    host: '127.0.0.1',
    port: 3002,
    lastHeartbeat: 0,
  };

  try {
    const registered = await store.register(instance);
    expect(await store.getService('example', 'test')).toEqual([registered]);
    expect(await store.getService('example', 'other')).toEqual([]);
    expect(await store.heartbeat(instance.id)).toEqual({ success: true });
    expect(await store.unregister(instance.id)).toBe(true);
    expect(await store.getService('example')).toEqual([]);
    expect(await store.heartbeat(instance.id)).toEqual({ success: false });
  } finally {
    await store.destroy();
  }
});

it('手动摘除后继续续约和接受注册更新，恢复前始终不参与发现', async () => {
  const store = new MemoryRegistryStore();
  const instance = { id: 'worker-1', name: 'worker', host: 'localhost', port: 3300 };

  try {
    await store.register(instance);
    expect(await store.setAvailability(instance.id, false)).toBe(true);
    expect(await store.heartbeat(instance.id)).toEqual({ success: true });
    await store.register({ ...instance, port: 3301 });
    expect(await store.getService(instance.name)).toEqual([]);
    expect(await store.getAll()).toEqual({});
    expect(await store.getOverview()).toMatchObject({ serviceCount: 0, instanceCount: 0 });
    expect(await store.getServiceSummaries()).toMatchObject([
      { instanceCount: 0, instances: [{ id: instance.id, disabled: true }] },
    ]);

    expect(await store.setAvailability(instance.id, true)).toBe(true);
    expect(await store.getService(instance.name)).toMatchObject([{ id: instance.id, port: 3301 }]);
    await store.unregister(instance.id);
    expect(await store.setAvailability(instance.id, true)).toBe(false);
    expect(await store.heartbeat(instance.id)).toEqual({ success: false });
    await store.register(instance);
    expect(await store.getService(instance.name)).toHaveLength(1);
  } finally {
    await store.destroy();
  }
});

it('按当前租约统计心跳正常和超时的实例，重复续约只计一个实例', async () => {
  vi.useFakeTimers();
  const timeout = 180_000;
  const store = new MemoryRegistryStore();
  const instance = { id: 'one', name: 'worker', host: 'localhost', port: 3300 };
  const start = 1_000;

  try {
    vi.setSystemTime(start);
    await store.register(instance);
    await store.register({ ...instance, id: 'two', port: 3301 });
    await store.setAvailability(instance.id, false);

    vi.setSystemTime(start + timeout);
    await store.heartbeat(instance.id);
    await store.heartbeat(instance.id);
    await store.heartbeat('unknown');
    expect(await store.getOverview()).toMatchObject({
      instanceCount: 1,
      heartbeat: { healthyInstanceCount: 2, timedOutInstanceCount: 0 },
      metrics: { heartbeatSuccessCount: 2, heartbeatFailureCount: 1 },
    });

    vi.setSystemTime(start + timeout + 1);
    expect((await store.getOverview()).heartbeat).toEqual({
      healthyInstanceCount: 1,
      timedOutInstanceCount: 1,
    });

    await store.cleanup(timeout);
    expect((await store.getOverview()).heartbeat).toEqual({
      healthyInstanceCount: 1,
      timedOutInstanceCount: 0,
    });
  } finally {
    await store.destroy();
    vi.useRealTimers();
  }
});

it('实例健康状态反映连续心跳结果，恢复后重新累计三次成功', async () => {
  vi.useFakeTimers();
  const store = new MemoryRegistryStore();
  const interval = 30_000;
  const instance = {
    id: 'health-1',
    name: 'worker',
    host: 'localhost',
    port: 3300,
  };
  const start = 10_000;
  const readHealth = async () => (await store.getServiceSummaries())[0].instances[0].health;

  try {
    vi.setSystemTime(start);
    await store.register(instance);
    expect(await readHealth()).toBe('warning');

    for (let beat = 1; beat <= 3; beat += 1) {
      vi.setSystemTime(start + beat * interval);
      await store.heartbeat(instance.id);
      expect(await readHealth()).toBe(beat === 3 ? 'healthy' : 'warning');
    }

    const lastHeartbeat = start + 3 * interval;
    vi.setSystemTime(lastHeartbeat + 30_999);
    expect(await readHealth()).toBe('healthy');
    vi.setSystemTime(lastHeartbeat + 31_000);
    expect(await readHealth()).toBe('warning');
    vi.setSystemTime(lastHeartbeat + 90_999);
    expect(await readHealth()).toBe('warning');
    vi.setSystemTime(lastHeartbeat + 91_000);
    expect(await readHealth()).toBe('critical');

    for (let beat = 1; beat <= 3; beat += 1) {
      vi.setSystemTime(lastHeartbeat + 91_000 + (beat - 1) * interval);
      await store.heartbeat(instance.id);
      expect(await readHealth()).toBe(beat === 3 ? 'healthy' : 'warning');
    }

    await store.setAvailability(instance.id, false);
    expect(await readHealth()).toBe('healthy');
  } finally {
    await store.destroy();
    vi.useRealTimers();
  }
});

it('按启用的实例计算健康均分，明细仍显示摘除实例的心跳状态', async () => {
  vi.useFakeTimers();
  const store = new MemoryRegistryStore();
  const interval = 30_000;
  const start = 10_000;
  const primary = {
    id: 'health-1',
    name: 'worker',
    host: 'localhost',
    port: 3300,
  };
  const peer = { ...primary, id: 'health-2', port: 3301 };
  const readSummary = async () => (await store.getServiceSummaries())[0];

  try {
    vi.setSystemTime(start);
    await store.register(primary);
    await store.register(peer);
    for (let beat = 1; beat <= 3; beat += 1) {
      vi.setSystemTime(start + beat * interval);
      await store.heartbeat(primary.id);
    }
    expect(await readSummary()).toMatchObject({ health: 'healthy', healthScore: 75 });

    vi.setSystemTime(start + 4 * interval);
    await store.heartbeat(primary.id);
    expect(await readSummary()).toMatchObject({
      health: 'warning',
      healthScore: 50,
      instances: [
        { id: primary.id, health: 'healthy' },
        { id: peer.id, health: 'critical' },
      ],
    });

    await store.setAvailability(peer.id, false);
    expect(await readSummary()).toMatchObject({
      health: 'healthy',
      healthScore: 100,
      instances: [{ id: primary.id }, { id: peer.id, disabled: true, health: 'critical' }],
    });
    await store.setAvailability(peer.id, true);

    vi.setSystemTime(start + 5 * interval + 1000);
    expect(await readSummary()).toMatchObject({ health: 'warning', healthScore: 25 });
    vi.setSystemTime(start + 7 * interval + 1000);
    expect(await readSummary()).toMatchObject({ health: 'critical', healthScore: 0 });

    await store.setAvailability(primary.id, false);
    await store.setAvailability(peer.id, false);
    expect(await readSummary()).toMatchObject({ health: 'unavailable', healthScore: null });
  } finally {
    await store.destroy();
    vi.useRealTimers();
  }
});
