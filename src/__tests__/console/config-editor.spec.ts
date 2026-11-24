import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('JSONC 注释许可仅关联当前模型，切回 JSON 会恢复严格诊断', async () => {
  const existing = { uri: 'inmemory://existing/schema' };
  const options = { schemas: [existing], comments: 'error' };
  const defaults = {
    diagnosticsOptions: options,
    setDiagnosticsOptions: (next: typeof options) => { defaults.diagnosticsOptions = next; },
  };
  vi.stubGlobal('window', { monaco: { json: { jsonDefaults: defaults }, editor: { setModelLanguage: vi.fn() } } });
  const instance = (path: string) => ({
    getModel: () => ({ uri: { authority: 'model', path } }),
    getAction: vi.fn(), dispose: vi.fn(), getValue: vi.fn(), setValue: vi.fn(),
  });
  const edit = instance('/edit'), view = instance('/view');
  const { setEditorLanguage } = await vi.importActual<{
    setEditorLanguage(editor: typeof edit, format: string): void;
  }>('../../../console/config/config-editor.ts');
  setEditorLanguage(edit, 'jsonc');
  setEditorLanguage(view, 'jsonc');
  setEditorLanguage(edit, 'json');
  expect(defaults.diagnosticsOptions).toMatchObject({
    comments: 'error',
    schemas: [existing, { fileMatch: ['model/view'], schema: { allowComments: true } }],
  });
  setEditorLanguage(view, 'yaml');
  expect(defaults.diagnosticsOptions).toEqual(options);
});

it('重新进入配置页后，迟到的 Monaco 回调不会创建旧编辑器或覆盖当前页面', async () => {
  const pendingLoads: Array<() => void> = [];
  const requireMonaco = Object.assign(
    (_modules: string[], loaded: () => void) => pendingLoads.push(loaded),
    { config: vi.fn() },
  );
  const create = vi.fn((_host: { isConnected: boolean }) => ({ getModel: () => null, dispose: vi.fn() }));
  vi.stubGlobal('window', { require: requireMonaco, monaco: { editor: { create } } });

  const firstPage = { jsoneditor: { isConnected: true }, viewJsonEditor: { isConnected: true } };
  const secondPage = { jsoneditor: { isConnected: true }, viewJsonEditor: { isConnected: true } };
  let page = firstPage;
  vi.stubGlobal('document', { getElementById: (id: keyof typeof page) => page[id] });

  // 直接加载浏览器源模块，让用例在干净检出后也能运行。
  const { initJsonEditors, getConfigEditors } = await vi.importActual<{
    initJsonEditors(): () => void;
    getConfigEditors(): Promise<unknown>;
  }>('../../../console/config/config-editor.ts');

  const leaveFirstPage = initJsonEditors();
  const firstResult = getConfigEditors();
  leaveFirstPage();
  firstPage.jsoneditor.isConnected = false;
  firstPage.viewJsonEditor.isConnected = false;
  page = secondPage;

  const leaveSecondPage = initJsonEditors();
  try {
    expect(pendingLoads).toHaveLength(2);
    pendingLoads[1]();
    const current = await getConfigEditors();
    pendingLoads[0]();

    expect(await firstResult).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toBe(secondPage.jsoneditor);
    expect(create.mock.calls[1][0]).toBe(secondPage.viewJsonEditor);
    expect(current).toEqual({
      editor: create.mock.results[0].value,
      viewEditor: create.mock.results[1].value,
    });
    expect(await getConfigEditors()).toBe(current);
  } finally {
    leaveSecondPage();
  }
});
