import { REGISTRY_LEASE_TIMEOUT_MS } from '@nest-cloud/sdk';

export const CLEAR_INTERVAL = 30_000; // 清理过期服务间隔（毫秒）
export const CLEAR_TIMEOUT = REGISTRY_LEASE_TIMEOUT_MS;
export const HEARTBEAT_HEALTH_THRESHOLD = 3;
export const HEARTBEAT_GRACE_MS = 1_000;
export const INSTANCE_HEALTH_SCORES = { healthy: 100, warning: 50, critical: 0 } as const;
export const SERVICE_HEALTH_SCORE_THRESHOLDS = { healthy: 75, warning: 25 } as const;
export const DEFAULT_AUDIT_LIMIT = 200;
export const DEFAULT_REDIS_PREFIX = 'nest-cloud:registry';
export const REGISTRY_FALLBACK_SYNC_MS = 5_000;
export const REGISTRY_REDIS_RESILIENCE_OPTIONS = {
  disableOfflineQueue: true,
  pingInterval: 2_000,
  socket: {
    connectTimeout: 1_000,
    socketTimeout: 5_000,
    // @redis/client 默认在普通 socket 超时后停止重连。
    reconnectStrategy: (retries: number) =>
      Math.min(1_000, 100 * 2 ** retries) + Math.floor(Math.random() * 200),
  },
};
