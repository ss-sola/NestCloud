import { initJsonEditors } from './config-editor.js';
import { loadConfigData } from './config-data.js';
import { bindUIEvents } from './config-ui.js';
import { initModal } from './config-modal.js';
import { loadHtmlFragment } from '../utils.js';

export async function initConfigUI() {
  await loadHtmlFragment('html/config-file.html', '.main-content');
  initModal();
  const disposeEditors = initJsonEditors();
  void loadConfigData();
  bindUIEvents();
  return disposeEditors;
}
