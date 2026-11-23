import { AppModule } from './app.module';
import { bootstrap, ConfigKeys, getConfig } from '@nest-cloud/sdk';
import { ConfigServiceConfig } from './validate.config';
import { ControlPlaneAuthGuard } from './guards/control-plane-auth.guard';
import { CONSOLE_API_PREFIX, CONSOLE_ROOT } from './constants/control-plane-session.constants';
import type { NextFunction, Request, Response } from 'express';

void bootstrap({
  AppModule,
  validateConfig: ConfigServiceConfig,
  configureApp: (app) => {
    // 控制台 API 复用相同的业务路由，并用独立路径约束浏览器会话 Cookie 的发送范围。
    app.use((request: Request, _response: Response, next: NextFunction) => {
      if (request.url.startsWith(CONSOLE_API_PREFIX)) {
        request.url = request.url.slice(CONSOLE_ROOT.length);
      }
      next();
    });
    const token = getConfig<string>(ConfigKeys.ControlPlaneToken, '', false);
    if (token) app.useGlobalGuards(new ControlPlaneAuthGuard(token));
  },
});
