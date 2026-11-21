import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const bootstrapManifest = require.resolve('bootstrap/package.json');
const bootstrap = dirname(bootstrapManifest);
const popper = dirname(createRequire(bootstrapManifest).resolve('@popperjs/core/package.json'));
const monaco = resolve(dirname(require.resolve('monaco-editor')), '../..');
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

// 保留 AMD 模块、Worker、字体和语言文件的相对路径。
cpSync(resolve(monaco, 'min'), resolve(monacoOutput, 'min'), { recursive: true });
for (const filename of ['LICENSE', 'ThirdPartyNotices.txt']) {
  copyFileSync(resolve(monaco, filename), resolve(monacoOutput, filename));
}
