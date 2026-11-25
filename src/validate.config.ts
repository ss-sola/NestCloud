import { DatabaseConfig } from '@nest-cloud/sdk';
import { IsInt, IsString, Max, Min } from 'class-validator';
import { SERVICE_MONITOR_DEFAULTS } from './constants/service-monitor.constants';

/**
 * config-service 配置校验。继承 DatabaseConfig（含 ServiceName/Port/DB 六项）。
 * config-service 本身是注册中心，不向注册中心注册自身，故无 RegistryUrl 校验。
 */
export class ConfigServiceConfig extends DatabaseConfig {
  @IsInt()
  @Min(SERVICE_MONITOR_DEFAULTS.minIntervalMs)
  @Max(SERVICE_MONITOR_DEFAULTS.maxIntervalMs)
  ServiceMonitorIntervalMs: number = SERVICE_MONITOR_DEFAULTS.intervalMs;

  @IsString()
  ServiceMonitorTrustedHosts = '';

  @IsString()
  ServiceMonitorStaticTargets = '';
}
