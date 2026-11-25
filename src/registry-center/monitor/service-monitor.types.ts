import type { ProcessMetricsSnapshot } from '@nest-cloud/sdk';

export interface ServiceMonitorTarget {
  id: string;
  name: string;
  host: string;
  port: number;
  scheme: 'http:' | 'https:';
}

export type ServiceMonitorResource = 'cpu' | 'memory' | 'disk';

export interface ServiceMonitorRow extends ServiceMonitorTarget {
  status: 'pending' | 'available' | 'unavailable' | 'failed' | 'stale' | 'excluded';
  metrics?: ProcessMetricsSnapshot;
  highUsage?: ServiceMonitorResource[];
}

export interface ServiceMonitorCache {
  lastCompletedAt: string;
  registryUnavailable: boolean;
  entries: ServiceMonitorCacheEntry[];
}

export interface ServiceMonitorCacheEntry {
  row: ServiceMonitorRow;
  receivedAt?: number;
  highUsageSince?: Partial<Record<ServiceMonitorResource, number>>;
}
