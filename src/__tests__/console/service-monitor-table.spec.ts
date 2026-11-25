import { describe, expect, it, vi } from 'vitest';

const settings = {
  service: '',
  page: 1,
  size: 2,
  sort: 'cpu' as const,
  direction: 'descending' as 'ascending' | 'descending',
};
const rows = [
  { name: 'system-service', host: '127.0.0.1', port: 3200, status: 'pending', metrics: undefined },
  ...[9, 0, 105].map((cpuPercent, index) => ({
    name: index === 1 ? 'gateway-service' : 'system-service',
    host: '127.0.0.1',
    port: 3201 + index,
    status: 'available',
    metrics: {
      cpuPercent,
      rssBytes: 1,
      heapUsedBytes: 1,
      heapTotalBytes: 1,
      collectedAt: '2026-11-25T00:00:00.000Z',
    },
  })),
];

function loadTable() {
  return vi.importActual<{
    getMonitorTablePage(
      items: typeof rows,
      options: typeof settings,
    ): { rows: typeof rows; total: number; page: number; pageCount: number };
  }>('../../../console/registry/service-monitor-table.ts');
}

describe('服务监控列表', () => {
  it('按数值排序并分组筛选，零值保留且缺失值排在最后', async () => {
    const { getMonitorTablePage } = await loadTable();
    expect(getMonitorTablePage(rows, settings).rows.map((row) => row.metrics?.cpuPercent)).toEqual([
      105, 9,
    ]);
    expect(
      getMonitorTablePage(rows, { ...settings, direction: 'ascending', size: 4 }).rows.map(
        (row) => row.metrics?.cpuPercent,
      ),
    ).toEqual([0, 9, 105, undefined]);
    expect(
      getMonitorTablePage(rows, { ...settings, service: 'gateway-service', page: 2 }),
    ).toMatchObject({ page: 1, pageCount: 1, total: 1, rows: [rows[2]] });
  });

  it('自动刷新后缩小到有效页，并保留服务筛选', async () => {
    const { getMonitorTablePage } = await loadTable();
    const page = getMonitorTablePage(rows.slice(0, 2), {
      ...settings,
      page: 3,
      service: 'system-service',
    });
    expect(page).toMatchObject({ page: 1, pageCount: 1, total: 2 });
    expect(getMonitorTablePage(rows, { ...settings, service: 'missing' }).rows).toEqual([]);
  });
});
