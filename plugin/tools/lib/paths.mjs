// 插件目录和工程目录。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LgCliError} from './errors.mjs';

// 插件根目录（plugin/），从本文件的位置推出来。
export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const referencesDir = path.join(pluginRoot, 'references');
export const editorDir = path.join(pluginRoot, 'editor');
export const templatesDir = path.join(pluginRoot, 'templates');
export const frameworkDir = path.join(pluginRoot, 'framework');

/** 一条命令自己的生成目录 .lgui/build/<命令>/（dev、verify、test 各用各的）：几条命令同时跑时不会互相删对方的文件。 */
export const buildDir = (root, command) => path.join(root, '.lgui', 'build', command);

/**
 * 写几条命令共用的生成目录（.lgui/build/types/、headless/、i18n/）：files 是 文件名 → 内容。
 * 只写这些文件、删掉目录里多余的，不先把整个目录删掉再建——别的命令同时在写这个目录时，整个删会报 ENOTEMPTY。
 */
export function writeDir(dir, files) {
  fs.mkdirSync(dir, {recursive: true});
  for (const [name, content] of files) fs.writeFileSync(path.join(dir, name), content);
  for (const name of fs.readdirSync(dir)) if (!files.has(name)) fs.rmSync(path.join(dir, name), {recursive: true, force: true});
  return [...files.keys()].map(name => path.join(dir, name));
}

// 从 start 往上找 .lgui/project.json，返回工程根目录；找不到报 LGUI-CLI-002。
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.lgui', 'project.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new LgCliError('LGUI-CLI-002', `从 ${path.resolve(start)} 往上都没有找到 .lgui/project.json，这里不在 LGUI 工程里。`, {
        fix: '先运行 lgui init 建工程，或者 cd 到工程目录里再运行。'
      });
    }
    dir = parent;
  }
}
