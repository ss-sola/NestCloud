import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisRegistryStore } from '../../registry-center/registry.store';
import {
  EXPIRE_REGISTRY_LEASE,
  RENEW_REGISTRY_LEASE,
} from '../../constants/registry-lease.constants';

const redis = vi.hoisted(() => ({
  connect: vi.fn(),
  on: vi.fn(),
  hGet: vi.fn(),
  hSet: vi.fn(),
  hVals: vi.fn(),
  sRem: vi.fn(),
  sAdd: vi.fn(),
  eval: vi.fn(),
  hIncrBy: vi.fn(),
  lPush: vi.fn(),
  lTrim: vi.fn(),
  isOpen: false,
}));
vi.mock('@redis/client', () => ({ createClient: () => redis }));

const lease = {
  id: 'worker-1',
  name: 'worker',
  host: 'localhost',
  port: 3400,
  lastHeartbeat: 1000,
};
const observed = JSON.stringify(lease);

describe('Redis registry leases', () => {
  let store: RedisRegistryStore;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(61_001);
    store = new RedisRegistryStore({ redisUrl: 'redis://localhost', keyPrefix: 'test' });
  });

  afterEach(async () => {
    await store.destroy();
    vi.useRealTimers();
  });

  it('skips a renewed snapshot without changing the index, metric or audit', async () => {
    const atBoundary = JSON.stringify({ ...lease, id: 'worker-2', lastHeartbeat: 1001 });
    redis.hVals.mockResolvedValue([observed, atBoundary]);
    redis.eval.mockResolvedValue(0); // The observed instance renewed before deletion.

    await store.cleanup(60_000);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(EXPIRE_REGISTRY_LEASE, {
      keys: ['test:instances'],
      arguments: [lease.id, observed],
    });
    expect(redis.sRem).not.toHaveBeenCalled();
    expect(redis.hIncrBy).not.toHaveBeenCalled();
    expect(redis.lPush).not.toHaveBeenCalled();
  });

  it('reports a miss when cleanup wins the race with a heartbeat', async () => {
    redis.hGet.mockResolvedValueOnce(observed).mockResolvedValueOnce(null);
    redis.eval.mockResolvedValueOnce(0);

    await expect(store.heartbeat(lease.id)).resolves.toEqual({ success: false });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.hIncrBy).toHaveBeenCalledWith('test:metrics', 'heartbeatFailureCount', 1);
  });

  it('retries against the latest registration and preserves its advertised address', async () => {
    const updated = { ...lease, baseUrl: 'https://worker.example.com/api', metadata: { tags: [] } };
    redis.hGet.mockResolvedValueOnce(observed).mockResolvedValueOnce(JSON.stringify(updated));
    redis.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(store.heartbeat(lease.id)).resolves.toEqual({ success: true });
    expect(redis.eval).toHaveBeenLastCalledWith(RENEW_REGISTRY_LEASE, {
      keys: ['test:instances'],
      arguments: [
        lease.id,
        JSON.stringify(updated),
        JSON.stringify({ ...updated, lastHeartbeat: 61_001 }),
      ],
    });
    expect(redis.hIncrBy).toHaveBeenCalledExactlyOnceWith(
      'test:metrics',
      'heartbeatSuccessCount',
      1,
    );
  });

  it('counts the winning cleanup once and preserves discovery and the index when the same ID re-registers', async () => {
    let row: string | null = observed;
    const members = new Set([lease.id]);
    const updated = { ...lease, baseUrl: 'https://worker.example.com/api' };
    redis.hVals.mockImplementation(async () => (row ? [row] : []));
    redis.hGet.mockImplementation(async () => row);
    redis.hSet.mockImplementation(async (_key, _id, value: string) => {
      row = value;
    });
    redis.sAdd.mockImplementation(async (_key, id: string) => members.add(id));
    redis.eval.mockImplementation(async (script, { keys, arguments: args }) => {
      expect(script).toBe(EXPIRE_REGISTRY_LEASE);
      expect(keys).toEqual(['test:instances']);
      if (row !== args[1]) return 0;
      row = null;
      return 1;
    });
    redis.sRem.mockImplementationOnce(async (_key, id: string) => {
      // 过期租约已删除；新注册成功之后，旧清理任务才开始修改分属另一槽的索引。
      await store.register(updated);
      members.delete(id);
      expect(await store.getService(lease.name)).toMatchObject([{ id, baseUrl: updated.baseUrl }]);
    });

    await Promise.all([store.cleanup(60_000), store.cleanup(60_000)]);
    expect(members.has(lease.id)).toBe(true);
    expect(redis.sRem).toHaveBeenCalledTimes(1);
    const expirations = redis.hIncrBy.mock.calls.filter((args) => args[1] === 'expireCount');
    expect(expirations).toEqual([['test:metrics', 'expireCount', 1]]);
    const audits = redis.lPush.mock.calls.map(([, item]) => JSON.parse(item));
    expect(audits.filter((event) => event.type === 'expire')).toHaveLength(1);
  });
});
