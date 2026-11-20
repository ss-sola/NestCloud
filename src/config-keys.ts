/**
 * config-service 专用配置键常量。
 * 本服务内所有 getConfig() 调用必须引用此处的常量。
 */
export const ConfigServiceKeys = {
  /** 注册中心存储所用的 Redis 连接 URL（不填则使用内存存储） */
  RegistryRedisUrl: 'RegistryRedisUrl',
  /** 审计日志最大保留条数 */
  RegistryAuditLimit: 'RegistryAuditLimit',
  /** 注册中心数据在 Redis 中的键前缀 */
  RegistryRedisKeyPrefix: 'RegistryRedisKeyPrefix',
} as const;
