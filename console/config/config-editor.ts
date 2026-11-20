import type { ConfigEditor } from './types.js';
import { config, elementById, showAlert } from '../utils.js';

interface ConfigEditors {
  editor: ConfigEditor;
  viewEditor: ConfigEditor;
}

let editorsReady: Promise<ConfigEditors | null> = Promise.resolve(null);

const languageMap: Record<string, string> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  env: 'ini',
  properties: 'ini',
};

export function initJsonEditors() {
  const editContainer = elementById('jsoneditor');
  const viewContainer = elementById('viewJsonEditor');
  let active = true;
  let instances: ConfigEditors | undefined;
  // AMD 和编辑器 Worker 共用绝对地址，以支持 /public/ 和反向代理子路径。
  const vs = new URL('../../vendor/monaco-editor/min/vs', import.meta.url).href;
  window.require.config({ paths: { vs } });
  window.MonacoEnvironment = {
    getWorkerUrl: () => `${vs}/base/worker/workerMain.js`,
  };

  const ready = new Promise<ConfigEditors | null>((resolve) => {
    window.require(
      ['vs/editor/editor.main'],
      () => {
        if (!active || !editContainer.isConnected) {
          resolve(null);
          return;
        }
        instances = {
          editor: window.monaco.editor.create(editContainer, config),
          viewEditor: window.monaco.editor.create(viewContainer, { ...config, readOnly: true }),
        };
        resolve(instances);
      },
      () => {
        if (active) showAlert('配置编辑器加载失败', 'danger');
        resolve(null);
      },
    );
  });
  editorsReady = ready;
  return () => {
    active = false;
    if (editorsReady === ready) editorsReady = Promise.resolve(null);
    instances?.editor.dispose();
    instances?.viewEditor.dispose();
  };
}

/** 等待当前页面的编辑器，切页后放弃已排队的操作。 */
export async function getConfigEditors() {
  const ready = editorsReady;
  const instances = await ready;
  return ready === editorsReady ? instances : null;
}

export function setEditorLanguage(instance: ConfigEditor, format = 'yaml') {
  const model = instance.getModel();
  if (!model) return;
  window.monaco.editor.setModelLanguage(model, languageMap[format] || 'plaintext');
}
