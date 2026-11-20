import {
  filterConfigs,
  allConfigs,
  goToPage,
  queryState,
  summary,
  totalConfigs,
} from './config-data.js';
import { getConfigEditors, setEditorLanguage } from './config-editor.js';
import { elementById, showAlert, setEditorContent, escapeHtml, formatDateTime } from '../utils.js';
import {
  saveConfig,
  deleteConfig,
  openAddModal,
  openEditModal,
  openViewModal,
  publishConfig,
  openHistoryModal,
} from './config-modal.js';

export const pageSize = 10;

export function renderTable() {
  const tbody = elementById('configTableBody');
  const empty = elementById('emptyState');
  tbody.innerHTML = '';

  if (allConfigs.length === 0) {
    empty.style.display = 'block';
    updateOverview();
    return;
  }

  empty.style.display = 'none';

  for (const config of allConfigs) {
    const activeRecord = config.activeRecord;
    const latestPublished = config.latestPublished;
    const currentDraft = config.currentDraft;
    const tr = document.createElement('tr');
    tr.innerHTML = `
            <td>
                <a href="#" class="view-config config-link" data-id="${activeRecord?.id || 0}">${escapeHtml(config.name)}</a>
            </td>
            <td>${latestPublished ? `<span class="status-badge published">v${latestPublished.version ?? 0}</span>` : '<span class="text-muted">无</span>'}</td>
            <td>${currentDraft ? `<span class="status-badge draft">v${currentDraft.version ?? 0}</span>` : '<span class="text-muted">无</span>'}</td>
            <td><span class="format-pill">${escapeHtml((activeRecord?.format || latestPublished?.format || 'yaml').toUpperCase())}</span></td>
            <td>${activeRecord ? `v${activeRecord.version ?? 0}` : '-'}</td>
            <td>${formatDateTime(config.updatedAt)}</td>
      <td>
                <div class="table-actions">
                    <div class="table-actions-row">
                        <button class="btn btn-sm btn-outline-primary view-config" data-id="${activeRecord?.id || latestPublished?.id || 0}">查看</button>
                        <button class="btn btn-sm btn-outline-primary edit-config" data-id="${(currentDraft || latestPublished)?.id || 0}">编辑</button>
                        <button class="btn btn-sm btn-outline-secondary history-config" data-name="${escapeHtml(config.name)}">历史</button>
                    </div>
                    <div class="table-actions-row table-actions-row-secondary">
                        <button class="btn btn-sm btn-outline-success publish-config" data-id="${currentDraft?.id || 0}" ${currentDraft ? '' : 'disabled'}>发布草稿</button>
                        <button class="btn btn-sm btn-outline-danger delete-config" data-id="${(currentDraft || latestPublished)?.id || 0}">${currentDraft ? '删除草稿' : '删除发布版'}</button>
                    </div>
                </div>
      </td>`;
    tbody.appendChild(tr);
  }
  updateOverview();

  // 事件绑定
  document.querySelectorAll<HTMLElement>('.view-config').forEach((el) => {
    el.onclick = () => openViewModal(Number.parseInt(el.dataset.id ?? '', 10));
  });
  document.querySelectorAll<HTMLElement>('.edit-config').forEach((el) => {
    el.onclick = () => openEditModal(Number.parseInt(el.dataset.id ?? '', 10));
  });
  document.querySelectorAll<HTMLElement>('.delete-config').forEach((el) => {
    el.onclick = () => deleteConfig(Number.parseInt(el.dataset.id ?? '', 10));
  });
  document.querySelectorAll<HTMLElement>('.publish-config').forEach((el) => {
    el.onclick = () => publishConfig(Number.parseInt(el.dataset.id ?? '', 10));
  });
  document.querySelectorAll<HTMLElement>('.history-config').forEach((el) => {
    el.onclick = () => openHistoryModal(el.dataset.name ?? '');
  });
}

export function renderPagination() {
  const pagination = elementById('pagination');
  pagination.innerHTML = '';
  const totalPages = Math.ceil(totalConfigs / queryState.pageSize);
  if (totalPages <= 1) return;

  const createPageBtn = (
    label: string | number,
    disabled: boolean,
    page: number,
    active = false,
  ) => {
    const li = document.createElement('li');
    li.className = `page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}`;
    li.innerHTML = `<a class="page-link" href="#">${label}</a>`;
    li.onclick = (e) => {
      e.preventDefault();
      if (!disabled) {
        goToPage(page);
      }
    };
    pagination.appendChild(li);
  };

  createPageBtn('上一页', queryState.pageNum === 1, queryState.pageNum - 1);
  for (let i = 1; i <= totalPages; i++) {
    createPageBtn(i, false, i, i === queryState.pageNum);
  }
  createPageBtn('下一页', queryState.pageNum === totalPages, queryState.pageNum + 1);
}

export function bindUIEvents() {
  elementById('addBtn').onclick = openAddModal;
  elementById('refreshBtn').onclick = () => filterConfigs({});
  elementById('saveBtn').onclick = () => saveConfig(false);
  elementById('publishBtn').onclick = () => saveConfig(true);
  const searchInput = elementById<HTMLInputElement>('searchInput');
  searchInput.oninput = () => {
    filterConfigs({ search: searchInput.value.trim() });
  };
  const statusFilter = elementById<HTMLSelectElement>('statusFilter');
  statusFilter.onchange = () => {
    filterConfigs({ published: statusFilter.value });
  };
  const formatFilter = elementById<HTMLSelectElement>('formatFilter');
  formatFilter.onchange = () => {
    filterConfigs({ format: formatFilter.value });
  };
  const configFormat = elementById<HTMLSelectElement>('configFormat');
  configFormat.onchange = async () => {
    const editors = await getConfigEditors();
    if (editors) setEditorLanguage(editors.editor, configFormat.value);
  };
  elementById('formatJsonBtn').onclick = async () => {
    const editors = await getConfigEditors();
    if (!editors) return;
    try {
      const format = configFormat.value;
      const content = editors.editor.getValue();
      if (format !== 'json') {
        showAlert('当前仅支持 JSON 自动格式化', 'warning');
        return;
      }
      setEditorContent(editors.editor, JSON.parse(content));
    } catch {
      showAlert('JSON 格式错误，无法自动格式化', 'danger');
    }
  };
}

function updateOverview() {
  const totalPages = Math.max(1, Math.ceil(totalConfigs / queryState.pageSize));
  elementById('totalCount').textContent = String(summary.nameCount ?? totalConfigs);
  elementById('publishedCount').textContent = String(summary.publishedCount ?? 0);
  elementById('draftCount').textContent = String(summary.draftCount ?? 0);
  elementById('pageSummary').textContent = `第 ${queryState.pageNum} / ${totalPages} 页`;
}
