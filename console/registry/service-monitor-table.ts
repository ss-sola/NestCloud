export const monitorStatuses = {
  pending: '等待采集',
  available: '正常',
  unavailable: '指标接口未启用',
  failed: '采集失败',
  stale: '数据已过期',
  excluded: '采集目标不在可信范围内',
} as const;

export interface MonitorRow {
  name: string;
  host: string;
  port: number;
  status: keyof typeof monitorStatuses;
  highUsage?: Array<'cpu' | 'memory' | 'disk'>;
  metrics?: {
    cpuPercent: number | null;
    cpuLogicalCoreCount?: number;
    systemTotalMemoryBytes?: number;
    systemUsedMemoryBytes?: number;
    diskTotalBytes?: number;
    diskUsedBytes?: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    collectedAt: string;
  };
}

const collator = new Intl.Collator('zh-CN', { numeric: true });

export function formatMonitorAddress({ host, port }: MonitorRow): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

const sortValues = {
  name: (row: MonitorRow) => row.name,
  address: formatMonitorAddress,
  status: (row: MonitorRow) => monitorStatuses[row.status],
  cpu: (row: MonitorRow) => row.metrics?.cpuPercent,
  cores: (row: MonitorRow) => row.metrics?.cpuLogicalCoreCount,
  systemMemory: (row: MonitorRow) => row.metrics?.systemUsedMemoryBytes,
  diskTotal: (row: MonitorRow) => row.metrics?.diskTotalBytes,
  diskUsed: (row: MonitorRow) => row.metrics?.diskUsedBytes,
  rss: (row: MonitorRow) => row.metrics?.rssBytes,
  heap: (row: MonitorRow) => row.metrics?.heapUsedBytes,
  time: (row: MonitorRow) => row.metrics && Date.parse(row.metrics.collectedAt),
};

export type MonitorSortField = keyof typeof sortValues;
export type MonitorTableOptions = {
  service: string;
  page: number;
  size: number;
  sort: MonitorSortField;
  direction: 'ascending' | 'descending';
};

export function getMonitorTablePage(rows: MonitorRow[], options: MonitorTableOptions) {
  const { service, size, sort, direction } = options;
  const value = sortValues[sort];
  const filtered = rows.filter((row) => !service || row.name === service);
  filtered.sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a == null && b != null) return 1;
    if (b == null && a != null) return -1;
    const result =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : collator.compare(String(a ?? ''), String(b ?? ''));
    return (
      result * (direction === 'ascending' ? 1 : -1) ||
      collator.compare(left.name, right.name) ||
      collator.compare(formatMonitorAddress(left), formatMonitorAddress(right))
    );
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pageCount, Math.max(1, options.page));
  const offset = (page - 1) * size;
  return { rows: filtered.slice(offset, offset + size), total, page, pageCount };
}
