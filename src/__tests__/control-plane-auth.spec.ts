import { Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createRedisSession } from '@nest-cloud/sdk';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlaneAuthGuard } from '../guards/control-plane-auth.guard';
import { ControlPlaneSessionController } from '../config-center/controller/control-plane-session.controller';

const publish = vi.fn();

@Controller()
class ControlPlaneController {
  @Get('registry/all')
  discover() {
    return {};
  }

  @Post('config-files/publish')
  publish() {
    publish();
    return {};
  }
}

@Module({ controllers: [ControlPlaneController, ControlPlaneSessionController] })
class ControlPlaneModule {}

describe('控制面 Token', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    publish.mockClear();
  });

  it('为读写接口统一拦截缺失和错误凭证，允许正确凭证', async () => {
    app = await NestFactory.create(ControlPlaneModule, { logger: false });
    app.useGlobalGuards(new ControlPlaneAuthGuard('deployment-token'));
    await app.init();
    const http = request(app.getHttpServer());
    await http.get('/registry/all').expect(401);
    await http.post('/config-files/publish').set('Authorization', 'Bearer incorrect').expect(401);
    expect(publish).not.toHaveBeenCalled();
    await http.get('/registry/all').set('Authorization', 'Bearer deployment-token').expect(200);
    await http
      .post('/config-files/publish')
      .set('Authorization', 'Bearer deployment-token')
      .expect(201);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('正确 Token 建立浏览器会话，刷新和同源管理请求沿用会话', async () => {
    app = await NestFactory.create(ControlPlaneModule, { logger: false });
    app.setGlobalPrefix('public/api');
    app.use(createRedisSession({ secret: 'test-session-signing-secret', ttlMs: 60_000 }));
    app.useGlobalGuards(new ControlPlaneAuthGuard('deployment-token'));
    await app.init();

    const browser = request.agent(app.getHttpServer());
    const loginPath = '/public/api/control-plane/session';
    const registryPath = '/public/api/registry/all';
    await browser.post(loginPath).set('Authorization', 'Bearer incorrect').expect(401);
    const login = await browser
      .post(loginPath)
      .set('Authorization', 'Bearer deployment-token')
      .expect(204);
    const cookie = login.headers['set-cookie'][0];
    expect(cookie).toContain('Path=/public/api/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toMatch(/expires|max-age/i);

    await browser.get(registryPath).set('Sec-Fetch-Site', 'same-origin').expect(200);
    await browser.get(registryPath).set('Sec-Fetch-Site', 'same-origin').expect(200);
    await browser.get(registryPath).set('Sec-Fetch-Site', 'same-site').expect(401);
    await browser.post(loginPath).set('Sec-Fetch-Site', 'same-origin').expect(401);
    await request(app.getHttpServer())
      .get(registryPath)
      .set('Sec-Fetch-Site', 'same-origin')
      .expect(401);
  });
});
