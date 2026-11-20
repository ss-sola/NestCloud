import { elementById } from './utils.js';

let sessionVersion = 0;
let pendingAuthentication: Promise<void> | undefined;

/** 通过同源控制台 API 请求使用浏览器会话。 */
export async function fetchControlPlane(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('控制面 API 必须与控制台同源');
  }
  url.pathname = `/public${url.pathname}`;
  const requestedVersion = sessionVersion;
  const response = await fetch(url, init);
  if (response.status !== 401) return response;

  if (requestedVersion === sessionVersion) {
    pendingAuthentication ??= authenticate()
      .then(() => {
        sessionVersion += 1;
      })
      .finally(() => {
        pendingAuthentication = undefined;
      });
    await pendingAuthentication;
  }
  return fetch(url, init);
}

function authenticate(): Promise<void> {
  const dialog = elementById<HTMLDialogElement>('controlPlaneAuth');
  const form = elementById<HTMLFormElement>('controlPlaneAuthForm');
  const input = elementById<HTMLInputElement>('controlPlaneAuthToken');
  const submit = elementById<HTMLButtonElement>('controlPlaneAuthSubmit');
  const status = elementById('controlPlaneAuthStatus');
  const sessionUrl = new URL('/public/api/control-plane/session', location.origin);
  const submitLabel = submit.textContent;

  status.textContent = '';
  input.value = '';
  input.removeAttribute('aria-invalid');
  input.oninput = () => {
    status.textContent = '';
    input.removeAttribute('aria-invalid');
  };
  dialog.showModal();
  input.focus();

  return new Promise((resolve) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const token = input.value.trim();
      if (!token) {
        status.textContent = '请输入访问令牌。';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = '验证中…';
      form.setAttribute('aria-busy', 'true');
      input.readOnly = true;
      status.textContent = '';
      input.removeAttribute('aria-invalid');
      try {
        const response = await fetch(sessionUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'error',
        });
        if (response.ok) {
          input.value = '';
          form.onsubmit = null;
          dialog.close();
          resolve();
        } else {
          status.textContent =
            response.status === 401 ? '令牌无效，请核对后重试。' : '验证失败，请重试。';
          if (response.status === 401) input.setAttribute('aria-invalid', 'true');
        }
      } catch {
        status.textContent = '无法连接 NestCloud，请重试。';
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
        form.removeAttribute('aria-busy');
        input.readOnly = false;
        if (dialog.open) {
          input.focus();
          input.select();
        }
      }
    };
    dialog.oncancel = (event) => event.preventDefault();
  });
}
