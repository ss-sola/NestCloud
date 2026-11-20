import { renderTable, renderPagination } from './config-ui.js';
import { showLoading, hideLoading, checkRes } from '../utils.js';

import type {
  ConfigAggregate,
  ConfigPage,
  ConfigQuery,
  ConfigSnapshot,
  ConfigSummary,
} from './types.js';

export let allConfigs: ConfigAggregate[] = [];
export let totalConfigs = 0;
export let summary: ConfigSummary = {
  nameCount: 0,
  publishedCount: 0,
  draftCount: 0,
};
export let queryState: ConfigQuery = {
  pageNum: 1,
  pageSize: 10,
  search: '',
  published: '',
  format: '',
};

export async function loadConfigData(overrides: Partial<ConfigQuery> = {}) {
  const table = document.getElementById('configTableBody');
  if (!table) return;
  queryState = {
    ...queryState,
    ...overrides,
  };
  showLoading();
  const data = await fetchConfigPage();
  if (!table.isConnected) return;
  allConfigs = data.list;
  totalConfigs = data.total;
  summary = data.summary || {
    nameCount: data.total,
    publishedCount: 0,
    draftCount: 0,
  };
  renderTable();
  renderPagination();
  hideLoading();
}

export async function filterConfigs(overrides: Partial<ConfigQuery> = {}) {
  await loadConfigData({
    pageNum: 1,
    ...overrides,
  });
}

export async function goToPage(pageNum: number) {
  await loadConfigData({ pageNum });
}

export function getConfigById(id: number) {
  return (
    allConfigs.find(
      (item) =>
        item.activeRecord?.id === id ||
        item.currentDraft?.id === id ||
        item.latestPublished?.id === id,
    ) || null
  );
}

export function getConfigByName(name: string) {
  return allConfigs.find((item) => item.name === name) || null;
}

export async function loadVersionHistory(name: string) {
  const params = new URLSearchParams();
  params.set('name', name);
  const res = await fetch(`${location.origin}/api/config-files/history?${params}`);
  return checkRes<ConfigSnapshot[]>(res);
}

async function fetchConfigPage() {
  const params = new URLSearchParams();
  params.set('pageNum', String(queryState.pageNum));
  params.set('pageSize', String(queryState.pageSize));
  if (queryState.search) {
    params.set('search', queryState.search);
  }
  if (queryState.published !== '') {
    params.set('published', queryState.published);
  }
  if (queryState.format) {
    params.set('format', queryState.format);
  }

  const res = await fetch(`${location.origin}/api/config-files/page?${params}`);
  return checkRes<ConfigPage>(res);
}
