import type { ConfigEditor, ConfigModal, ConfigSnapshot } from './types.js';
import { getConfigById, loadConfigData, loadVersionHistory } from './config-data.js';
import { getConfigEditors, setEditorLanguage } from './config-editor.js';
import {
  elementById,
  escapeHtml,
  showLoading,
  hideLoading,
  showAlert,
  setEditorContent,
  getEditorContent,
  checkRes,
  formatDateTime,
} from '../utils.js';

let currentConfigId: number | null = null;

let configModal: ConfigModal;
let viewModal: ConfigModal;
let deleteModal: ConfigModal;
let historyModal: ConfigModal;

let elements: ReturnType<typeof getModalElements>;

export function initModal() {
  configModal = new window.bootstrap.Modal(elementById('configModal'));
  viewModal = new window.bootstrap.Modal(elementById('viewModal'));
  deleteModal = new window.bootstrap.Modal(elementById('deleteModal'));
  historyModal = new window.bootstrap.Modal(elementById('historyModal'));

  elements = getModalElements();
}

function getModalElements() {
  return {
    modalTitle: elementById('modalTitle'),
    viewModalTitle: elementById('viewModalTitle'),
    configForm: elementById<HTMLFormElement>('configForm'),
    configName: elementById<HTMLInputElement>('configName'),
    configFormat: elementById<HTMLSelectElement>('configFormat'),
    configVersion: elementById('configVersion'),
    configStatus: elementById('configStatus'),
    configPublishedAt: elementById('configPublishedAt'),
    configMd5: elementById('configMd5'),
    configDescription: elementById<HTMLTextAreaElement>('configDescription'),
    modalHint: elementById('modalHint'),
    viewConfigFormat: elementById('viewConfigFormat'),
    viewConfigVersion: elementById('viewConfigVersion'),
    viewConfigStatus: elementById('viewConfigStatus'),
    viewConfigPublishedAt: elementById('viewConfigPublishedAt'),
    viewConfigDescription: elementById('viewConfigDescription'),
    historyModalTitle: elementById('historyModalTitle'),
    historyTableBody: elementById<HTMLTableSectionElement>('historyTableBody'),
    historyEmptyState: elementById('historyEmptyState'),
    confirmDeleteBtn: elementById<HTMLButtonElement>('confirmDeleteBtn'),
  };
}
// 新增配置
export async function openAddModal() {
  const editors = await getConfigEditors();
  if (!editors) return;
  currentConfigId = null;
  elements.modalTitle.textContent = '新增配置';
  elements.configName.value = '';
  elements.configFormat.value = 'yaml';
  elements.configVersion.textContent = '0';
  elements.configStatus.textContent = '草稿';
  elements.configPublishedAt.textContent = '未发布';
  elements.configMd5.textContent = '-';
  elements.configDescription.value = '';
  elements.modalHint.textContent = '保存只更新草稿，发布会递增版本号并立即生效。';
  setEditorLanguage(editors.editor, 'yaml');
  setEditorContent(editors.editor, '');
  configModal.show();
}

// 编辑配置
export async function openEditModal(id: number) {
  const editors = await getConfigEditors();
  if (!editors) return;
  const aggregate = getConfigById(id);
  const config = aggregate?.currentDraft || aggregate?.latestPublished;
  if (!aggregate || !config) return;

  currentConfigId = config.id;
  elements.modalTitle.textContent = `编辑配置 - ${aggregate.name}`;
  elements.configName.value = aggregate.name;
  elements.configFormat.value = config.format || 'yaml';
  elements.configVersion.textContent = String(config.version ?? 0);
  elements.configStatus.textContent = config.isPublished ? '已发布' : '草稿';
  elements.configPublishedAt.textContent = formatDateTime(config.publishedAt);
  elements.configMd5.textContent = config.md5 || '-';
  elements.configDescription.value = config.description || '';
  elements.modalHint.textContent = config.isPublished
    ? '当前是已发布版本。保存时会自动生成或覆盖同名草稿，不会改动已发布版本。'
    : '当前正在编辑草稿。保存会更新这份草稿，发布会生成新的已发布版本。';
  setEditorLanguage(editors.editor, config.format);
  setEditorContent(editors.editor, config.content);
  configModal.show();
}

// 查看配置
export async function openViewModal(id: number) {
  const editors = await getConfigEditors();
  if (!editors) return;
  const aggregate = getConfigById(id);
  const config = aggregate?.currentDraft || aggregate?.latestPublished;
  if (!aggregate || !config) return;

  openViewSnapshot(editors.viewEditor, config, aggregate.name);
  viewModal.show();
}

function openViewSnapshot(viewEditor: ConfigEditor, config: ConfigSnapshot, titleName: string) {
  elements.viewModalTitle.textContent = `查看配置 - ${titleName}`;
  elements.viewConfigFormat.textContent = (config.format || '-').toUpperCase();
  elements.viewConfigVersion.textContent = String(config.version ?? 0);
  elements.viewConfigStatus.textContent = config.isPublished ? '已发布' : '草稿';
  elements.viewConfigPublishedAt.textContent = formatDateTime(config.publishedAt);
  elements.viewConfigDescription.textContent = config.description || '暂无说明';
  setEditorLanguage(viewEditor, config.format);
  setEditorContent(viewEditor, config.content);
}

export async function openHistoryModal(name: string) {
  try {
    showLoading();
    const table = elements.historyTableBody;
    const history = await loadVersionHistory(name);
    if (!table.isConnected) return;
    elements.historyModalTitle.textContent = `版本历史 - ${name}`;
    elements.historyTableBody.innerHTML = '';
    elements.historyEmptyState.style.display = 'none';

    if (!history.length) {
      elements.historyEmptyState.style.display = 'block';
    } else {
      elements.historyEmptyState.style.display = 'none';
      history.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
                  <td>${item.id}</td>
                  <td>v${item.version ?? 0}</td>
                  <td>${escapeHtml(item.format?.toUpperCase() || '-')}</td>
                  <td><span class="status-badge ${item.isPublished ? 'published' : 'draft'}">${item.isPublished ? '已发布' : '草稿'}</span></td>
                  <td><div class="description-cell">${escapeHtml(item.description || '暂无说明')}</div></td>
                  <td>${formatDateTime(item.publishedAt)}</td>
                  <td>${formatDateTime(item.updatedAt)}</td>
                                    <td><button class="btn btn-sm btn-outline-primary history-view-btn" data-index="${index}">查看</button></td>
                `;
        elements.historyTableBody.appendChild(row);
      });

      elements.historyTableBody
        .querySelectorAll<HTMLButtonElement>('.history-view-btn')
        .forEach((button) => {
          button.onclick = async () => {
            const editors = await getConfigEditors();
            if (!editors) return;
            historyModal.hide();
            const target = history[Number.parseInt(button.dataset.index ?? '', 10)];
            if (!target) return;
            openViewSnapshot(editors.viewEditor, target, name);
            viewModal.show();
          };
        });
    }

    historyModal.show();
  } finally {
    hideLoading();
  }
}

// 删除配置
export function deleteConfig(id: number) {
  currentConfigId = id;
  deleteModal.show();

  elements.confirmDeleteBtn.onclick = async () => {
    try {
      showLoading();
      const res = await fetch(`${location.origin}/api/config-files`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify([currentConfigId]),
      });
      await checkRes(res);
      await loadConfigData();
      deleteModal.hide();
      showAlert('配置已删除', 'success');
    } finally {
      hideLoading();
    }
  };
}

// 保存配置
export async function saveConfig(publish = false) {
  if (!elements.configForm.checkValidity()) {
    elements.configForm.reportValidity();
    return;
  }

  const editors = await getConfigEditors();
  if (!editors) return;
  const configData = {
    id: currentConfigId,
    name: elements.configName.value.trim(),
    format: elements.configFormat.value,
    description: elements.configDescription.value.trim(),
    content: getEditorContent(editors.editor),
  };

  try {
    showLoading();
    const res = await fetch(`${location.origin}/api/config-files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configData),
    });
    const saved = await checkRes<Pick<ConfigSnapshot, 'id'>>(res);

    if (publish) {
      const publishRes = await fetch(`${location.origin}/api/config-files/${saved.id}/publish`, {
        method: 'POST',
      });
      await checkRes(publishRes);
    }

    await loadConfigData();
    configModal.hide();
    showAlert(
      publish
        ? '草稿已发布为新版本，原已发布版本保持不变'
        : currentConfigId
          ? '草稿已保存'
          : '配置已保存',
      'success',
    );
  } finally {
    hideLoading();
  }
}

export async function publishConfig(id: number) {
  const aggregate = getConfigById(id);
  const target = aggregate?.currentDraft;
  if (!target) {
    showAlert('当前没有可发布的草稿', 'warning');
    return;
  }

  try {
    showLoading();
    const res = await fetch(`${location.origin}/api/config-files/${target.id}/publish`, {
      method: 'POST',
    });
    await checkRes(res);
    await loadConfigData();
    showAlert('配置已发布', 'success');
  } finally {
    hideLoading();
  }
}
