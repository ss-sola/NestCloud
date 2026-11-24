import type { ConfigEditor } from './types.js';
import { config, elementById, showAlert } from '../utils.js';

interface ConfigEditors {
  editor: ConfigEditor;
  viewEditor: ConfigEditor;
}

let editorsReady: Promise<ConfigEditors | null> = Promise.resolve(null);
const commentSchemaUri = 'inmemory://nestcloud/schema/jsonc';
const commentModels = new Set<string>();

// Monaco 的 JSON 语言服务共享诊断设置。仅给使用 JSONC 的模型关联允许注释的 schema。
function allowModelComments(instance: ConfigEditor, enabled: boolean) {
  const model = instance.getModel();
  if (!model) return;
  const pattern = model.uri.authority + model.uri.path;
  if (commentModels.has(pattern) === enabled) return;
  if (enabled) commentModels.add(pattern);
  else commentModels.delete(pattern);

  const defaults = window.monaco.json.jsonDefaults;
  const options = defaults.diagnosticsOptions;
  const schemas = (options.schemas ?? []).filter((item) => item.uri !== commentSchemaUri);
  if (commentModels.size) {
    schemas.push({ uri: commentSchemaUri, fileMatch: [...commentModels], schema: { allowComments: true } });
  }
  defaults.setDiagnosticsOptions({ ...options, schemas });
}

const languageMap: Record<string, string> = {
  json: 'json',
  jsonc: 'json',
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
    if (instances) {
      for (const instance of [instances.editor, instances.viewEditor]) {
        allowModelComments(instance, false);
        instance.dispose();
      }
    }
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
  allowModelComments(instance, format === 'jsonc');
  window.monaco.editor.setModelLanguage(model, languageMap[format] || 'plaintext');
}
