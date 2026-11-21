import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RegisterInstanceForm } from '../../registry-center/form/register-instance.form';
import { RegistryController } from '../../registry-center/registry.controller';
import { RegistryService } from '../../registry-center/registry.service';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const body = { type: 'body' as const, metatype: RegisterInstanceForm };
const identity = { id: 'worker-a', name: 'worker', group: 'blue', metadata: { region: 'east' } };

describe('注册接口地址协议', () => {
  it.each([
    [
      { host: '10.0.0.1', port: 8080 },
      { host: '10.0.0.1', port: 8080 },
    ],
    [{ baseUrl: 'https://gw/api' }, { baseUrl: 'https://gw/api', host: 'gw', port: 443 }],
    [
      { baseUrl: 'http://gw:9000/v1', host: '10.0.0.1', port: 8080 },
      { baseUrl: 'http://gw:9000/v1', host: '10.0.0.1', port: 8080 },
    ],
  ])('注册后原样发现地址和实例元数据', async (address, expected) => {
    const registry = new RegistryService();
    try {
      const controller = new RegistryController(registry);
      await controller.register(await pipe.transform({ ...identity, ...address }, body));
      expect(await registry.discover('worker', 'blue')).toEqual([
        expect.objectContaining({ ...identity, ...expected }),
      ]);
    } finally {
      await registry.onModuleDestroy();
    }
  });

  it('保留旧客户端的注册兼容性并丢弃上报的心跳间隔和时间', async () => {
    const registry = new RegistryService();
    try {
      const controller = new RegistryController(registry);
      await controller.register(
        await pipe.transform(
          {
            ...identity,
            host: 'localhost',
            port: 8080,
            heartbeatInterval: 120_000,
            lastHeartbeat: 0,
          },
          body,
        ),
      );
      const [instance] = await registry.discover(identity.name, identity.group);
      expect(instance).not.toHaveProperty('heartbeatInterval');
      expect(instance.lastHeartbeat).toBeGreaterThan(0);
    } finally {
      await registry.onModuleDestroy();
    }
  });

  it.each([
    {},
    { host: '10.0.0.1' },
    { port: 8080 },
    { baseUrl: 'file:///v1' },
    { baseUrl: 'https://gw/api?mode=1' },
    { baseUrl: 'https://gw/api#v1' },
    { baseUrl: 'https://user:password@gw/api' },
  ])('拒绝缺失地址或非法服务 URL', async (address) => {
    await expect(pipe.transform({ ...identity, ...address }, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
