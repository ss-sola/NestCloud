import { AppModule } from './app.module';
import { bootstrap, ConfigKeys, getConfig } from '@nest-cloud/sdk';
import { ConfigServiceConfig } from './validate.config';
import { ControlPlaneAuthGuard } from './guards/control-plane-auth.guard';

void bootstrap({
  AppModule,
  validateConfig: ConfigServiceConfig,
  configureApp: (app) => {
    const token = getConfig<string>(ConfigKeys.ControlPlaneToken, '', false);
    if (token) app.useGlobalGuards(new ControlPlaneAuthGuard(token));
  },
});
