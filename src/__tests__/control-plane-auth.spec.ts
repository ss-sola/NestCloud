import { Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlaneAuthGuard } from '../guards/control-plane-auth.guard';

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

@Module({ controllers: [ControlPlaneController] })
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
});
