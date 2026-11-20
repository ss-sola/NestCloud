import { checkRes, hideLoading, showAlert, showLoading } from '../utils.js';
import { renderRegistryDashboard } from './registry-ui.js';

interface RegistryOverview {
  storageType: 'memory' | 'redis';
  serviceCount: number;
  instanceCount: number;
  auditCount: number;
  latestHeartbeatAt?: string;
  latestChangeAt?: string;
  metrics: {
    registerCount: number;
    unregisterCount: number;
    expireCount: number;
    heartbeatSuccessCount: number;
    heartbeatFailureCount: number;
    discoverCount: number;
    discoverMissCount: number;
  };
}

interface RegistryInstance {
  id: string;
  baseUrl?: string;
  host: string;
  port: number;
  group?: string;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

interface RegistryService {
  name: string;
  instanceCount: number;
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

export async function removeRegistryInstance(instanceId: string) {
  showLoading();
  try {
    const response = await fetch(
      `${location.origin}/api/registry/unregister/${encodeURIComponent(instanceId)}`,
      {
        method: 'POST',
      },
    );
    await checkRes<boolean>(response);
    showAlert('实例已从注册中心移除');
    await loadRegistryDashboard({}, { silent: true });
  } finally {
    hideLoading();
  }
}

async function fetchOverview() {
  const response = await fetch(`${location.origin}/api/registry/overview`);
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
  const response = await fetch(
    `${location.origin}/api/registry/services${queryString ? `?${queryString}` : ''}`,
  );
  return checkRes<RegistryService[]>(response);
}

async function fetchAudits() {
  const params = new URLSearchParams();
  params.set('limit', String(registryQuery.auditLimit));
  const response = await fetch(`${location.origin}/api/registry/audits?${params.toString()}`);
  return checkRes<RegistryAudit[]>(response);
}
