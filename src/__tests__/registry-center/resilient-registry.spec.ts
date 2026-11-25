import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRegistryStore, type RedisRegistryStore } from '../../registry-center/registry.store';
import { ResilientRegistryStore } from '../../registry-center/resilient-registry.store';
import type { RecoveryLease, RegistryInstance } from '../../registry-center/registry.types';

const worker = { id: '1', name: 'worker', host: '127.0.0.1', port: 3400 };

describe('注册中心 Redis 降级和恢复', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('先补写断线变更，再读取共享实例；中途失败只重试未确认的实例', async () => {
    vi.useFakeTimers();
    const leases = new Map<string, RegistryInstance>([
      [worker.id, { ...worker, lastHeartbeat: Date.now() }],
    ]);
    const redis = {
      available: true,
      getAllInstances: vi.fn(async () => [...leases.values()]),
      reconcile: vi.fn(async (change: RecoveryLease) => {
        if (change.kind === 'remove') leases.delete(change.instance.id);
        else leases.set(change.instance.id, change.instance);
      }),
      getService: vi.fn().mockResolvedValue([worker]),
      destroy: vi.fn(),
    };
    const store = new ResilientRegistryStore(
      redis as unknown as RedisRegistryStore,
      new MemoryRegistryStore(),
    );
    try {
      expect(await store.getService('worker')).toEqual([worker]);
      redis.available = false;
      expect(await store.heartbeat(worker.id)).toEqual({ success: true });
      await store.setAvailability(worker.id, false);
      await store.register({ ...worker, id: 'local', name: 'local-only' });
      expect((await store.getAll())['local-only']).toHaveLength(1);
      expect((await store.getOverview()).storageType).toBe('memory');

      redis.available = true;
      const apply = redis.reconcile.getMockImplementation()!;
      redis.reconcile
        .mockImplementationOnce(apply)
        .mockRejectedValueOnce(new Error('disconnected'));
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await store.getOverview()).storageType).toBe('memory');
      expect(redis.getAllInstances).toHaveBeenCalledTimes(1);
      expect(await store.getService('worker')).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await store.getAllInstances()).toMatchObject([
        { id: worker.id, disabled: true },
        { id: 'local' },
      ]);
      expect(redis.reconcile.mock.calls.map(([change]) => change.instance.id)).toEqual([
        worker.id,
        'local',
        'local',
      ]);
    } finally {
      await store.destroy();
    }
  });
});
