import { elementById, escapeHtml, formatDateTime } from '../utils.js';
import {
  getSelectedService,
  loadRegistryDashboard,
  registryAudits,
  registryOverview,
  registryQuery,
  registryServices,
  removeRegistryInstance,
  selectRegistryService,
  selectedServiceName,
} from './registry-data.js';

export function bindRegistryEvents() {
  elementById('registryRefreshBtn').onclick = () => loadRegistryDashboard();
  const search = elementById<HTMLInputElement>('registrySearchInput');
  search.oninput = () => loadRegistryDashboard({ search: search.value.trim() });
  const group = elementById<HTMLSelectElement>('registryGroupFilter');
  group.onchange = () => loadRegistryDashboard({ group: group.value });
  const limit = elementById<HTMLSelectElement>('registryAuditLimit');
  limit.onchange = () => loadRegistryDashboard({ auditLimit: Number(limit.value) });
}

export function renderRegistryDashboard() {
  renderOverview();
  renderGroupFilter();
  renderServiceTable();
  renderInstanceTable();
  renderAuditTable();
}

function renderOverview() {
  if (!registryOverview) {
    return;
  }

  elementById('registryStorageType').textContent =
    registryOverview.storageType === 'redis' ? 'Redis' : 'Memory';
  elementById('registryServiceCount').textContent = String(registryOverview.serviceCount ?? 0);
  elementById('registryInstanceCount').textContent = String(registryOverview.instanceCount ?? 0);
  elementById('registryAuditCount').textContent = String(registryOverview.auditCount ?? 0);
  elementById('registerMetricCount').textContent = String(
    registryOverview.metrics?.registerCount ?? 0,
  );
  elementById('unregisterMetricCount').textContent = String(
    (registryOverview.metrics?.unregisterCount ?? 0) + (registryOverview.metrics?.expireCount ?? 0),
  );
  elementById('heartbeatMetricCount').textContent =
    `${registryOverview.metrics?.heartbeatSuccessCount ?? 0} / ${registryOverview.metrics?.heartbeatFailureCount ?? 0}`;
  elementById('discoverMetricCount').textContent =
    `${registryOverview.metrics?.discoverCount ?? 0} / ${registryOverview.metrics?.discoverMissCount ?? 0}`;
  elementById('registryLatestHeartbeat').textContent =
    `最近心跳：${formatDateTime(registryOverview.latestHeartbeatAt)}`;
  elementById('registryLastChangeAt').textContent =
    `最近变更：${formatDateTime(registryOverview.latestChangeAt)}`;
  elementById<HTMLInputElement>('registrySearchInput').value = registryQuery.search;
  elementById<HTMLSelectElement>('registryAuditLimit').value = String(registryQuery.auditLimit);
}

function renderGroupFilter() {
  const filter = elementById<HTMLSelectElement>('registryGroupFilter');
  const groups = Array.from(
    new Set(registryServices.flatMap((service) => service.groups || []).filter(Boolean)),
  ).sort();

  filter.innerHTML = '<option value="">全部分组</option>';
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    filter.appendChild(option);
  });
  filter.value = registryQuery.group;
}

function renderServiceTable() {
  const tbody = elementById('registryServiceTableBody');
  const empty = elementById('registryServiceEmpty');
  tbody.innerHTML = '';

  if (!registryServices.length) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  registryServices.forEach((service) => {
    const tr = document.createElement('tr');
    if (service.name === selectedServiceName) {
      tr.classList.add('registry-row-active');
    }
    tr.innerHTML = `
      <td><a href="#" class="registry-table-link" data-name="${escapeHtml(service.name)}">${escapeHtml(service.name)}</a></td>
      <td>${service.instanceCount}</td>
      <td>
        <div class="registry-group-badges">
          ${
            service.groups.length
              ? service.groups
                  .map((group) => `<span class="registry-badge">${escapeHtml(group)}</span>`)
                  .join('')
              : '<span class="registry-badge muted">未分组</span>'
          }
        </div>
      </td>
      <td>${formatDateTime(service.latestHeartbeatAt)}</td>
      <td><button class="btn btn-sm btn-outline-primary registry-view-service" data-name="${escapeHtml(service.name)}">查看实例</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody
    .querySelectorAll<HTMLElement>('.registry-table-link, .registry-view-service')
    .forEach((element) => {
      element.onclick = (event) => {
        event.preventDefault();
        const { name } = element.dataset;
        if (name !== undefined) selectRegistryService(name);
      };
    });
}

function renderInstanceTable() {
  const selectedService = getSelectedService();
  const tbody = elementById('registryInstanceTableBody');
  const empty = elementById('registryInstanceEmpty');
  tbody.innerHTML = '';

  elementById('selectedServiceName').textContent = selectedService?.name || '-';
  elementById('selectedServiceInstanceCount').textContent = String(
    selectedService?.instanceCount || 0,
  );
  elementById('selectedServiceGroups').textContent =
    selectedService?.groups?.join(', ') || '未分组';

  if (!selectedService || !selectedService.instances.length) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  selectedService.instances.forEach((instance) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(instance.id)}</td>
      <td>${escapeHtml(instance.baseUrl || `${instance.host}:${instance.port}`)}</td>
      <td>${instance.group ? `<span class="registry-badge">${escapeHtml(instance.group)}</span>` : '<span class="registry-badge muted">未分组</span>'}</td>
      <td>${formatDateTime(instance.lastHeartbeat)}</td>
      <td><div class="registry-instance-meta">${escapeHtml(JSON.stringify(instance.metadata || {}, null, 2))}</div></td>
      <td><button class="btn btn-sm btn-outline-danger registry-remove-instance" data-id="${escapeHtml(instance.id)}">摘除实例</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll<HTMLButtonElement>('.registry-remove-instance').forEach((element) => {
    element.onclick = async () => {
      const { id } = element.dataset;
      if (id !== undefined) await removeRegistryInstance(id);
    };
  });
}

function renderAuditTable() {
  const tbody = elementById('registryAuditTableBody');
  const empty = elementById('registryAuditEmpty');
  tbody.innerHTML = '';

  if (!registryAudits.length) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  registryAudits.forEach((event) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDateTime(event.timestamp)}</td>
      <td><span class="registry-audit-type ${escapeHtml(event.type)}">${escapeHtml(formatAuditType(event.type))}</span></td>
      <td>${escapeHtml(event.serviceName || '-')}</td>
      <td>${escapeHtml(event.instanceId || '-')}</td>
      <td>${escapeHtml(event.message || '-')}</td>
    `;
    tbody.appendChild(tr);
  });
}

function formatAuditType(type: string) {
  switch (type) {
    case 'register':
      return '注册';
    case 'unregister':
      return '下线';
    case 'expire':
      return '超时摘除';
    case 'heartbeat-miss':
      return '心跳失败';
    case 'discover-miss':
      return '发现失败';
    default:
      return type;
  }
}
