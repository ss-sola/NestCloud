import type { config } from '../utils.js';
import type { ConfigEditor, ConfigModal } from './types.js';

/** 控制台通过 script 标签加载 AMD、Monaco 和 Bootstrap。 */
declare global {
  interface Window {
    require: {
      config(options: { paths: { vs: string } }): void;
      (modules: string[], onLoad: () => void, onError: () => void): void;
    };
    MonacoEnvironment: {
      getWorkerUrl(workerId: string, label: string): string;
    };
    monaco: {
      editor: {
        create(element: HTMLElement, options: typeof config & { readOnly?: boolean }): ConfigEditor;
        setModelLanguage(model: object, language: string): void;
      };
    };
    bootstrap: {
      Modal: new (element: HTMLElement) => ConfigModal;
    };
  }
}
