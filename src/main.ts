import { AppModule } from './app.module';
import { bootstrap } from '@nest-cloud/sdk';
import { ConfigServiceConfig } from './validate.config';

void bootstrap({
  AppModule,
  validateConfig: ConfigServiceConfig,
});
