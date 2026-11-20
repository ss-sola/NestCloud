/** 读取当前模板中必需的元素。 */
export function elementById<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`页面缺少元素 #${id}`);
  return element as T;
}

export function showLoading() {
  elementById('loadingOverlay').classList.add('active');
}

// 隐藏 loading
export function hideLoading() {
  elementById('loadingOverlay').classList.remove('active');
}

// 显示提示信息
export function showAlert(message: string, type = 'success') {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} position-fixed`;
  alert.style.top = '20px';
  alert.style.right = '20px';
  alert.style.zIndex = '2000';
  alert.style.minWidth = '300px';
  alert.textContent = message;

  document.body.appendChild(alert);

  setTimeout(() => {
    alert.classList.add('fade');
    setTimeout(() => {
      if (alert.parentNode) {
        alert.remove();
      }
    }, 300);
  }, 3000);
}

export async function loadHtmlFragment(url: string, selector: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    const html = await res.text();
    const container = document.querySelector(selector);
    if (!container) throw new Error(`页面缺少容器 ${selector}`);
    container.innerHTML = html;
  } catch (error) {
    console.error(error);
  }
}
export function setEditorContent(instance: { setValue(value: string): void }, content: unknown) {
  const value =
    typeof content === 'string' ? content : JSON.stringify(content ?? {}, null, config.tabSize);
  instance.setValue(value);
}

export function getEditorContent(instance: { getValue(): string }) {
  return instance.getValue();
}
export async function checkRes<T = unknown>(res: Response): Promise<T> {
  const data: { code: number; message?: string; data: T } = await res.json();
  if (!res.ok || data.code !== 200) {
    showAlert(data.message || '请求失败', 'danger');
    hideLoading();
    throw new Error(data.message || '请求失败');
  }
  return data.data;
}

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (!value) return '未发布';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function escapeHtml(value: unknown = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
export const config = {
  value: '{}',
  language: 'json',
  fontSize: 14,
  tabSize: 2,
  insertSpaces: true,
  rulers: [80],
  renderIndentGuides: true,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  theme: 'vs',
};
