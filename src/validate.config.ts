import { DatabaseConfig } from '@nest-cloud/sdk';

/**
 * config-service 配置校验。继承 DatabaseConfig（含 ServiceName/Port/DB 六项）。
 * config-service 本身是注册中心，不向注册中心注册自身，故无 RegistryUrl 校验。
 */
export class ConfigServiceConfig extends DatabaseConfig {}
