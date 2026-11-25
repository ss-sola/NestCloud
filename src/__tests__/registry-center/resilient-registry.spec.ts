import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRegistryStore, type RedisRegistryStore } from '../../registry-center/registry.store';
import { ResilientRegistryStore } from '../../registry-center/resilient-registry.store';

const worker = { id: '1', name: 'worker', host: '127.0.0.1', port: 3400 };

describe('注册中心 Redis 降级和恢复', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('断线保持镜像和本地续约，恢复后重新采用共享实例', async () => {
    vi.useFakeTimers();
    const redis = {
      available: true,
      getAllInstances: vi.fn().mockResolvedValue([{ ...worker, lastHeartbeat: Date.now() }]),
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
      await store.register({ ...worker, id: 'local', name: 'local-only' });
      expect((await store.getAll())['local-only']).toHaveLength(1);
      expect((await store.getOverview()).storageType).toBe('memory');

      redis.available = true;
      redis.getAllInstances.mockResolvedValue([{ ...worker, lastHeartbeat: Date.now() }]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await store.getAllInstances()).toEqual([
        { ...worker, lastHeartbeat: Date.now() - 5000 },
      ]);
      expect(redis.getAllInstances).toHaveBeenCalledTimes(3);
    } finally {
      await store.destroy();
    }
  });
});
