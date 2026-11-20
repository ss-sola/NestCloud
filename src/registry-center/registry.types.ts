import type { ServiceInstance } from '@nest-cloud/sdk';

export type { ServiceInstance };

/** 租约时间由存储层在注册或续约时生成。 */
export type RegistryRegistration = Omit<ServiceInstance, 'lastHeartbeat'>;

export type RegistryStorageType = 'memory' | 'redis';

export type RegistryAuditEventType =
  | 'register'
  | 'unregister'
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
  metrics: RegistryMetricSnapshot;
}

export interface RegistryServiceQuery {
  search?: string;
  group?: string;
}

export interface RegistryServiceSummary {
  name: string;
  instanceCount: number;
  groups: string[];
  latestHeartbeat: number;
  latestHeartbeatAt?: string;
  instances: ServiceInstance[];
}
