import { expect, it } from 'vitest';
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
