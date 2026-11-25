import { fetchControlPlane } from '../control-plane-auth.js';
import { elementById } from '../utils.js';
import {
  formatMonitorAddress,
  getMonitorTablePage,
  monitorStatuses,
  type MonitorRow,
  type MonitorSortField,
  type MonitorTableOptions,
} from './service-monitor-table.js';

interface MonitorSnapshot {
  enabled: boolean;
  intervalMs: number;
  lastCompletedAt?: string;
  registryUnavailable: boolean;
  storage: 'redis' | 'memory';
  highUsageCount?: number;
  highUsagePolicy?: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    durationMs: number;
  };
  list: MonitorRow[];
}

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
const usageColumns = { cpu: 3, memory: 5, disk: 7 } as const;

const byteUnits = [
  { size: 1024 ** 4, label: 'TiB' },
  { size: 1024 ** 3, label: 'GiB' },
  { size: 1024 ** 2, label: 'MiB' },
];

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  const unit = byteUnits.find(({ size }) => bytes >= size) ?? byteUnits[2];
  return `${numberFormat.format(bytes / unit.size)} ${unit.label}`;
}

function utilization(used?: number, total?: number): number | undefined {
  return used !== undefined && total ? (used / total) * 100 : undefined;
}

function capacityLabel(used?: number, percent?: number): string {
  return percent === undefined
    ? formatBytes(used)
    : `${formatBytes(used)} (${numberFormat.format(percent)}%)`;
}

function addMeter(cell: HTMLTableCellElement, percent: number | null | undefined, color: string) {
  if (percent == null) return;
  const meter = document.createElement('progress');
  meter.className = `monitor-meter monitor-meter-${color}`;
  meter.max = 100;
  meter.value = Math.min(100, percent);
  meter.setAttribute('aria-hidden', 'true');
  cell.append(meter);
}

function renderRows(body: HTMLTableSectionElement, rows: MonitorRow[], service: string): void {
  if (rows.length === 0) {
    const placeholder = document.createElement('tr');
    const cell = placeholder.insertCell();
    cell.colSpan = 11;
    cell.className = 'text-secondary text-center py-4';
    cell.textContent = service ? '所选服务暂无实例指标' : '暂无服务实例指标';
    body.replaceChildren(placeholder);
    return;
  }

  body.replaceChildren(
    ...rows.map((instance) => {
      const row = document.createElement('tr');
      const { name, status, metrics } = instance;
      const memoryPercent = utilization(
        metrics?.systemUsedMemoryBytes,
        metrics?.systemTotalMemoryBytes,
      );
      const diskPercent = utilization(metrics?.diskUsedBytes, metrics?.diskTotalBytes);
      const cells = [
        name,
        formatMonitorAddress(instance),
        '',
        metrics?.cpuPercent == null ? '—' : `${numberFormat.format(metrics.cpuPercent)}%`,
        metrics?.cpuLogicalCoreCount == null
          ? '—'
          : numberFormat.format(metrics.cpuLogicalCoreCount),
        capacityLabel(metrics?.systemUsedMemoryBytes, memoryPercent),
        formatBytes(metrics?.diskTotalBytes),
        capacityLabel(metrics?.diskUsedBytes, diskPercent),
        formatBytes(metrics?.rssBytes),
        metrics
          ? `${formatBytes(metrics.heapUsedBytes)} / ${formatBytes(metrics.heapTotalBytes)}`
          : '—',
        metrics ? dateFormat.format(new Date(metrics.collectedAt)) : '—',
      ];
      for (const value of cells) row.insertCell().textContent = value;
      row.cells[0].className = 'monitor-service-name';
      row.cells[1].className = 'monitor-instance-address';
      const badge = document.createElement('span');
      badge.className = `monitor-status monitor-status-${status}`;
      badge.textContent = monitorStatuses[status];
      row.cells[2].append(badge);
      addMeter(row.cells[3], metrics?.cpuPercent, 'cpu');
      addMeter(row.cells[5], memoryPercent, 'memory');
      addMeter(row.cells[7], diskPercent, 'disk');
      if (instance.highUsage?.length) {
        row.classList.add('monitor-high-usage');
        const label = document.createElement('span');
        label.className = 'monitor-usage-label';
        label.textContent = '持续高占用';
        row.cells[0].append(label);
        for (const resource of instance.highUsage) {
          row.cells[usageColumns[resource]].classList.add('monitor-high-usage-metric');
        }
      }
      return row;
    }),
  );
}

export async function initServiceMonitorUI(): Promise<() => void> {
  const template = elementById<HTMLTemplateElement>('serviceMonitorTemplate');
  const container = document.querySelector('.main-content')!;
  container.replaceChildren(template.content.cloneNode(true));
  const status = container.querySelector<HTMLElement>('[data-monitor-status]')!;
  const button = container.querySelector<HTMLButtonElement>('[data-monitor-refresh]')!;
  const body = container.querySelector<HTMLTableSectionElement>('[data-monitor-body]')!;
  const serviceSelect = container.querySelector<HTMLSelectElement>('[data-monitor-service]')!;
  const sizeSelect = container.querySelector<HTMLSelectElement>('[data-monitor-page-size]')!;
  const pagination = container.querySelector<HTMLElement>('[data-monitor-pagination]')!;
  const previousPage = container.querySelector<HTMLButtonElement>('[data-monitor-prev]')!;
  const nextPage = container.querySelector<HTMLButtonElement>('[data-monitor-next]')!;
  const summary = {
    services: container.querySelector<HTMLElement>('[data-monitor-services]')!,
    instances: container.querySelector<HTMLElement>('[data-monitor-instances]')!,
    available: container.querySelector<HTMLElement>('[data-monitor-available]')!,
    highUsage: container.querySelector<HTMLElement>('[data-monitor-high-usage]')!,
  };
  const policy = container.querySelector<HTMLElement>('[data-monitor-high-usage-policy]')!;
  const sortButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-monitor-sort]'),
    (button) => ({
      button,
      label: button.textContent ?? '',
      field: button.dataset.monitorSort as MonitorSortField,
    }),
  );
  const controller = new AbortController();
  let timer: number | undefined;
  let refreshing = false;
  let refreshDelay = 10_000;
  let previousRows: string | undefined;
  let previousServices: string | undefined;
  let rows: MonitorRow[] = [];
  const tableOptions: MonitorTableOptions = {
    service: '',
    page: 1,
    size: Number(sizeSelect.value),
    sort: 'name',
    direction: 'ascending',
  };

  const renderSummary = (snapshot: MonitorSnapshot) => {
    const counts = {
      services: new Set(rows.map((row) => row.name)).size,
      instances: rows.length,
      available: rows.filter((row) => row.status === 'available').length,
      highUsage: snapshot.highUsageCount ?? 0,
    };
    for (const key of Object.keys(summary) as Array<keyof typeof summary>) {
      const label = numberFormat.format(counts[key]);
      if (summary[key].textContent !== label) summary[key].textContent = label;
    }
    summary.highUsage.parentElement!.dataset.active = String(counts.highUsage > 0);
    const threshold = snapshot.highUsagePolicy;
    const label = threshold
      ? `CPU ≥ ${threshold.cpuPercent}% · 内存 ≥ ${threshold.memoryPercent}% · 磁盘 ≥ ${threshold.diskPercent}% · 持续 ≥ ${threshold.durationMs / 1000} 秒`
      : '';
    if (policy.textContent !== label) policy.textContent = label;
  };

  const renderTable = () => {
    const result = getMonitorTablePage(rows, tableOptions);
    tableOptions.page = result.page;
    const serialized = JSON.stringify([tableOptions.service, result.rows]);
    if (serialized !== previousRows) {
      renderRows(body, result.rows, tableOptions.service);
      previousRows = serialized;
    }
    const label = result.total
      ? `共 ${result.total} 个实例 · 第 ${result.page} / ${result.pageCount} 页`
      : '共 0 个实例';
    if (pagination.textContent !== label) pagination.textContent = label;
    previousPage.disabled = result.page === 1;
    nextPage.disabled = result.page === result.pageCount;
  };

  const updateServices = () => {
    const names = [...new Set(rows.map((row) => row.name))];
    if (tableOptions.service && !names.includes(tableOptions.service))
      names.push(tableOptions.service);
    names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
    const serialized = JSON.stringify(names);
    if (serialized === previousServices) return;
    serviceSelect.replaceChildren(
      new Option('全部服务', ''),
      ...names.map((name) => new Option(name, name)),
    );
    serviceSelect.value = tableOptions.service;
    previousServices = serialized;
  };

  const renderSort = () => {
    for (const { button, label, field } of sortButtons) {
      const active = field === tableOptions.sort;
      const header = button.closest('th');
      if (active) header?.setAttribute('aria-sort', tableOptions.direction);
      else header?.removeAttribute('aria-sort');
      button.textContent = active
        ? `${label} ${tableOptions.direction === 'ascending' ? '↑' : '↓'}`
        : label;
    }
  };

  const refresh = async () => {
    if (refreshing || controller.signal.aborted || document.hidden) return;
    window.clearTimeout(timer);
    refreshing = true;
    button.disabled = true;
    try {
      const response = await fetchControlPlane('/api/registry/monitor', {
        signal: controller.signal,
      });
      const result: { code: number; data: MonitorSnapshot } = await response.json();
      if (!response.ok || result.code !== 200) throw new Error('读取服务监控失败');
      if (!status.isConnected) return;
      const snapshot = result.data;
      refreshDelay = Math.min(snapshot.intervalMs, 10_000);
      status.textContent = snapshot.enabled
        ? `采集周期 ${snapshot.intervalMs / 1000} 秒 · ${snapshot.storage === 'redis' ? 'Redis' : '内存'}${snapshot.registryUnavailable ? ' · 注册实例清单暂不可用' : ''}${snapshot.lastCompletedAt ? ` · 上轮完成 ${dateFormat.format(new Date(snapshot.lastCompletedAt))}` : ''}`
        : '采集尚未启用，请检查注册中心的监控密钥和控制面鉴权配置。';
      rows = snapshot.list;
      renderSummary(snapshot);
      updateServices();
      renderTable();
    } catch {
      if (status.isConnected && !controller.signal.aborted)
        status.textContent = '读取服务监控失败。';
    } finally {
      refreshing = false;
      button.disabled = false;
      if (!controller.signal.aborted && status.isConnected && !document.hidden) {
        timer = window.setTimeout(() => void refresh(), refreshDelay);
      }
    }
  };

  status.textContent = '正在读取服务监控…';
  renderSort();
  serviceSelect.onchange = () => {
    tableOptions.service = serviceSelect.value;
    tableOptions.page = 1;
    renderTable();
  };
  sizeSelect.onchange = () => {
    tableOptions.size = Number(sizeSelect.value);
    tableOptions.page = 1;
    renderTable();
  };
  previousPage.onclick = () => {
    tableOptions.page -= 1;
    renderTable();
  };
  nextPage.onclick = () => {
    tableOptions.page += 1;
    renderTable();
  };
  for (const { button, field } of sortButtons) {
    button.onclick = () => {
      if (field === tableOptions.sort) {
        tableOptions.direction =
          tableOptions.direction === 'ascending' ? 'descending' : 'ascending';
      } else {
        tableOptions.sort = field;
        tableOptions.direction = ['name', 'address', 'status'].includes(field)
          ? 'ascending'
          : 'descending';
      }
      tableOptions.page = 1;
      renderSort();
      renderTable();
    };
  }
  button.onclick = () => void refresh();
  const onVisibility = () => {
    if (document.hidden) window.clearTimeout(timer);
    else void refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);
  void refresh();
  return () => {
    controller.abort();
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
