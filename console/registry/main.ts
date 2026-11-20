import { loadHtmlFragment } from '../utils.js';
import { loadRegistryDashboard } from './registry-data.js';
import { bindRegistryEvents } from './registry-ui.js';

const REFRESH_INTERVAL_MS = 3000;

let registryRefreshTimer: number | null = null;
let visibilityHandlerBound = false;
let registryViewActive = false;

function setRefreshStatus(text: string) {
  const status = document.getElementById('registryRefreshStatus');
  if (status) {
    status.textContent = text;
  }
}

function stopRegistryRefresh() {
  registryViewActive = false;
  if (registryRefreshTimer) {
    window.clearInterval(registryRefreshTimer);
    registryRefreshTimer = null;
  }
}

function startRegistryRefresh() {
  stopRegistryRefresh();
  registryViewActive = true;
  registryRefreshTimer = window.setInterval(() => {
    if (!registryViewActive) {
      return;
    }

    if (document.hidden) {
      setRefreshStatus('自动刷新：已暂停');
      return;
    }

    setRefreshStatus('自动刷新：运行中');
    void loadRegistryDashboard({}, { silent: true });
  }, REFRESH_INTERVAL_MS);
}

function bindVisibilityHandler() {
  if (visibilityHandlerBound) {
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (!registryViewActive) {
      return;
    }

    setRefreshStatus(document.hidden ? '自动刷新：已暂停' : '自动刷新：运行中');
    if (!document.hidden) {
      void loadRegistryDashboard({}, { silent: true });
    }
  });
  visibilityHandlerBound = true;
}

export async function initRegistryUI() {
  await loadHtmlFragment('html/registry-center.html', '.main-content');
  bindRegistryEvents();
  bindVisibilityHandler();
  await loadRegistryDashboard();
  startRegistryRefresh();
  return stopRegistryRefresh;
}
