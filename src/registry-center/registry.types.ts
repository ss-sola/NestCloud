import type { ServiceInstance } from '@nest-cloud/sdk';

export type { ServiceInstance };

/** 租约时间由存储层在注册或续约时生成。 */
export type RegistryRegistration = Omit<
  RegistryInstance,
  'lastHeartbeat' | 'disabled' | 'heartbeatSuccessStreak'
>;

export interface RegistryInstance extends ServiceInstance {
  /** 以毫秒计。旧租约可能未记录间隔和连续成功次数。 */
  heartbeatInterval?: number;
  heartbeatSuccessStreak?: number;
  /** 控制台已暂停该实例参与服务发现，租约仍可续约。 */
  disabled?: true;
}

export type RegistryInstanceHealth = 'healthy' | 'warning' | 'critical';

export type RegistryServiceHealth = RegistryInstanceHealth | 'unavailable';

export interface RegistryInstanceSummary extends RegistryInstance {
  health: RegistryInstanceHealth;
}

export type RegistryStorageType = 'memory' | 'redis';

export type RegistryAuditEventType =
  | 'register'
  | 'unregister'
  | 'disable'
  | 'enable'
  | 'expire'
  | 'heartbeat-miss'
  | 'discover-miss';

export interface RegistryAuditEvent {
  id: string;
  type: RegistryAuditEventType;
  timestamp: string;
  serviceName: string;
  instanceId?: string;
  group?: string;
  host?: string;
  port?: number;
  message?: string;
  metadata?: Record<string, any>;
}

export interface RegistryMetricSnapshot {
  registerCount: number;
  unregisterCount: number;
  heartbeatSuccessCount: number;
  heartbeatFailureCount: number;
  expireCount: number;
  discoverCount: number;
  discoverMissCount: number;
}

export interface RegistryOverview {
  storageType: RegistryStorageType;
  serviceCount: number;
  instanceCount: number;
  groupCount: number;
  auditCount: number;
  latestHeartbeatAt?: string;
  latestChangeAt?: string;
  heartbeat: {
    healthyInstanceCount: number;
    timedOutInstanceCount: number;
  };
  metrics: RegistryMetricSnapshot;
}

export interface RegistryServiceQuery {
  search?: string;
  group?: string;
}

export interface RegistryServiceSummary {
  name: string;
  instanceCount: number;
  health: RegistryServiceHealth;
  healthScore: number | null;
  groups: string[];
  latestHeartbeat: number;
  latestHeartbeatAt?: string;
  instances: RegistryInstanceSummary[];
}
