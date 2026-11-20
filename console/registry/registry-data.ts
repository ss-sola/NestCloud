import { checkRes, hideLoading, showAlert, showLoading } from '../utils.js';
import { fetchControlPlane } from '../control-plane-auth.js';
import { renderRegistryDashboard } from './registry-ui.js';

interface RegistryOverview {
  storageType: 'memory' | 'redis';
  serviceCount: number;
  instanceCount: number;
  auditCount: number;
  latestHeartbeatAt?: string;
  latestChangeAt?: string;
  heartbeat: {
    healthyInstanceCount: number;
    timedOutInstanceCount: number;
  };
  metrics: {
    registerCount: number;
    unregisterCount: number;
    expireCount: number;
    discoverCount: number;
    discoverMissCount: number;
  };
}

type RegistryInstanceHealth = 'healthy' | 'warning' | 'critical';

interface RegistryInstance {
  id: string;
  baseUrl?: string;
  host: string;
  port: number;
  group?: string;
  lastHeartbeat: number;
  health: RegistryInstanceHealth;
  disabled?: true;
  metadata?: Record<string, unknown>;
}

export type RegistryServiceHealth = RegistryInstanceHealth | 'unavailable';

interface RegistryService {
  name: string;
  instanceCount: number;
  health: RegistryServiceHealth;
  healthScore: number | null;
  groups: string[];
  latestHeartbeatAt?: string;
  instances: RegistryInstance[];
}

interface RegistryAudit {
  type: string;
  timestamp: string;
  serviceName: string;
  instanceId?: string;
  message?: string;
}

interface RegistryQuery {
  search: string;
  group: string;
  auditLimit: number;
}

export let registryOverview: RegistryOverview | null = null;
export let registryServices: RegistryService[] = [];
export let registryAudits: RegistryAudit[] = [];
export let registryQuery: RegistryQuery = {
  search: '',
  group: '',
  auditLimit: 20,
};

export let selectedServiceName = '';
let isLoading = false;

export async function loadRegistryDashboard(
  overrides: Partial<RegistryQuery> = {},
  { silent = false }: { silent?: boolean } = {},
) {
  if (isLoading) {
    return;
  }

  registryQuery = {
    ...registryQuery,
    ...overrides,
  };

  isLoading = true;
  if (!silent) {
    showLoading();
  }

  try {
    const [overview, services, audits] = await Promise.all([
      fetchOverview(),
      fetchServices(),
      fetchAudits(),
    ]);

    registryOverview = overview;
    registryServices = services;
    registryAudits = audits;

    if (
      !selectedServiceName ||
      !registryServices.some((service) => service.name === selectedServiceName)
    ) {
      selectedServiceName = registryServices[0]?.name || '';
    }

    renderRegistryDashboard();
  } catch (error) {
    console.error(error);
  } finally {
    isLoading = false;
    if (!silent) {
      hideLoading();
    }
  }
}

export function getSelectedService() {
  return registryServices.find((service) => service.name === selectedServiceName) || null;
}

export function selectRegistryService(serviceName: string) {
  selectedServiceName = serviceName;
  renderRegistryDashboard();
}

export async function setRegistryInstanceAvailability(id: string, enabled: boolean) {
  const response = await fetchControlPlane('/api/registry/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, state: enabled ? 'enabled' : 'disabled' }),
  }).catch((error: unknown) => {
    showAlert('无法连接注册中心，请重试', 'danger');
    throw error;
  });
  await checkRes<boolean>(response);
  showAlert(enabled ? '实例已恢复服务发现' : '实例已摘除');
  await loadRegistryDashboard({}, { silent: true });
}

async function fetchOverview() {
  const response = await fetchControlPlane(`${location.origin}/api/registry/overview`);
  return checkRes<RegistryOverview>(response);
}

async function fetchServices() {
  const params = new URLSearchParams();
  if (registryQuery.search) {
    params.set('search', registryQuery.search);
  }
  if (registryQuery.group) {
    params.set('group', registryQuery.group);
  }

  const queryString = params.toString();
  const response = await fetchControlPlane(
    `${location.origin}/api/registry/services${queryString ? `?${queryString}` : ''}`,
  );
  return checkRes<RegistryService[]>(response);
}

async function fetchAudits() {
  const params = new URLSearchParams();
  params.set('limit', String(registryQuery.auditLimit));
  const response = await fetchControlPlane(
    `${location.origin}/api/registry/audits?${params.toString()}`,
  );
  return checkRes<RegistryAudit[]>(response);
}
