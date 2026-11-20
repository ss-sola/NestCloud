import { elementById } from './utils.js';

let controlPlaneToken = '';
let pendingAuthentication: Promise<void> | undefined;

function request(url: URL, init: RequestInit | undefined, token: string) {
  if (!token) return fetch(url, init);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers, redirect: 'error' });
}

/** 仅向当前站点的控制面 API 发送凭证。 */
export async function fetchControlPlane(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin) throw new Error('控制面 API 必须与控制台同源');
  const sentToken = controlPlaneToken;
  const response = await request(url, init, sentToken);
  if (response.status !== 401) return response;

  if (sentToken === controlPlaneToken) {
    pendingAuthentication ??= authenticate().finally(() => {
      pendingAuthentication = undefined;
    });
    await pendingAuthentication;
  }
  return request(url, init, controlPlaneToken);
}

function authenticate(): Promise<void> {
  const dialog = elementById<HTMLDialogElement>('controlPlaneAuth');
  const form = elementById<HTMLFormElement>('controlPlaneAuthForm');
  const input = elementById<HTMLInputElement>('controlPlaneAuthToken');
  const submit = elementById<HTMLButtonElement>('controlPlaneAuthSubmit');
  const status = elementById('controlPlaneAuthStatus');
  const overviewUrl = new URL('/api/registry/overview', location.origin);

  status.textContent = '';
  input.value = '';
  dialog.showModal();
  input.focus();

  return new Promise((resolve) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const token = input.value.trim();
      if (!token) return;
      submit.disabled = true;
      status.textContent = '';
      try {
        const response = await request(overviewUrl, { cache: 'no-store' }, token);
        if (response.ok) {
          controlPlaneToken = token;
          input.value = '';
          form.onsubmit = null;
          dialog.close();
          resolve();
        } else {
          status.textContent =
            response.status === 401 ? 'Token 无效，请重试。' : '验证失败，请重试。';
          input.select();
        }
      } catch {
        status.textContent = '无法连接 NestCloud，请重试。';
      } finally {
        submit.disabled = false;
      }
    };
    dialog.oncancel = (event) => event.preventDefault();
  });
}
