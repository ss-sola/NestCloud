import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const bootstrapManifest = require.resolve('bootstrap/package.json');
const bootstrap = dirname(bootstrapManifest);
const popper = dirname(createRequire(bootstrapManifest).resolve('@popperjs/core/package.json'));
const monaco = dirname(require.resolve('monaco-editor/package.json'));
const vendor = resolve(import.meta.dirname, '../public/vendor');
const bootstrapOutput = resolve(vendor, 'bootstrap');
const monacoOutput = resolve(vendor, 'monaco-editor');

// 仅重建这两个依赖的输出目录，以清除升级后已经移除的资源。
for (const output of [bootstrapOutput, monacoOutput]) {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
}

for (const file of [
  'dist/css/bootstrap.min.css',
  'dist/css/bootstrap.min.css.map',
  'dist/js/bootstrap.bundle.min.js',
  'dist/js/bootstrap.bundle.min.js.map',
  'LICENSE',
]) {
  copyFileSync(resolve(bootstrap, file), resolve(bootstrapOutput, basename(file)));
}
copyFileSync(resolve(popper, 'LICENSE.md'), resolve(bootstrapOutput, 'LICENSE-popper.md'));

// 按上游相对路径提供 AMD 模块、Worker、字体、语言文件及调试映射。
for (const directory of ['min', 'min-maps']) {
  cpSync(resolve(monaco, directory), resolve(monacoOutput, directory), { recursive: true });
}
// 0.52.2 的语言模块从 min/min-maps 请求映射，npm 包却将其放在根 min-maps。
const languageMaps = resolve(monacoOutput, 'min/min-maps');
mkdirSync(languageMaps, { recursive: true });
for (const name of readdirSync(resolve(monaco, 'min-maps'))) {
  if (name.startsWith('nls.messages.') && name.endsWith('.js.map')) {
    copyFileSync(resolve(monaco, 'min-maps', name), resolve(languageMaps, name));
  }
}
for (const filename of ['LICENSE', 'ThirdPartyNotices.txt']) {
  copyFileSync(resolve(monaco, filename), resolve(monacoOutput, filename));
}
