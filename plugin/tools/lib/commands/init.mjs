// lgui init [目录] [--name 名称] [--code-only]：新建工程。
import fs from 'node:fs';
import path from 'node:path';
import {LgCliError} from '../errors.mjs';
import {templatesDir, frameworkDir} from '../paths.mjs';
import {pluginVersion} from '../version.mjs';
import {generateProjectTypes} from '../generate/index.mjs';

// 复制进工程 .lgui/framework/ 的部分。Unity 包模板（backends/unity/package/）不复制，导出时从插件里取。
export const frameworkParts = ['index.ts', 'host.ts', 'env.d.ts', 'core', 'mvc', 'backends/h5', 'backends/headless', 'backends/unity/adapter'];

export function copyFramework(target) {
  fs.rmSync(target, {recursive: true, force: true});
  for (const part of frameworkParts) {
    const from = path.join(frameworkDir, part);
    // 缺的是插件里的文件，不在工程里：路径写进说明，不写 file
    if (!fs.existsSync(from)) throw new LgCliError('LGUI-CLI-011', `插件里缺少框架文件 framework/${part}（插件目录 ${path.dirname(frameworkDir)}）。`, {fix: '插件不完整，重新安装 LGUI 插件。'});
    fs.cpSync(from, path.join(target, part), {recursive: true});
  }
}

export async function init({args, flags, cwd}) {
  const dir = path.resolve(cwd, args[0] ?? '.');
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new LgCliError('LGUI-CLI-010', `目录 ${dir} 已经存在而且不是空的，不会覆盖。`, {fix: '换一个新目录，或者先把这个目录清空。'});
  }
  const name = flags.name ?? path.basename(dir);
  const codeOnly = Boolean(flags['code-only']);
  const version = pluginVersion();
  fs.mkdirSync(dir, {recursive: true});
  fs.cpSync(path.join(templatesDir, 'project'), dir, {recursive: true});
  const jsonText = value => JSON.stringify(value).slice(1, -1);
  for (const file of ['package.json', '.lgui/project.json']) {
    const full = path.join(dir, file);
    let content = fs.readFileSync(full, 'utf8').replaceAll('__LGUI_PROJECT_NAME__', jsonText(name)).replaceAll('__LGUI_VERSION__', version);
    if (codeOnly && file === '.lgui/project.json') {
      content = content.replace('"placeholder": "ui://Common/placeholder"', '"placeholder": null');
    }
    fs.writeFileSync(full, content);
  }
  if (codeOnly) {
    fs.rmSync(path.join(dir, 'ui/assets/Common/placeholder.png'), {force: true});
    const commonXml = path.join(dir, 'ui/assets/Common/package.xml');
    fs.writeFileSync(commonXml, fs.readFileSync(commonXml, 'utf8').replace(/^\s*<image id="placehd1"[^>]*\/>\r?\n/m, ''));
  }
  copyFramework(path.join(dir, '.lgui', 'framework'));
  const {types} = await generateProjectTypes(dir);
  return {
    data: {root: dir, name, lguiVersion: version, codeOnly, components: types.components},
    summary: [`已在 ${dir} 新建 LGUI 工程「${name}」（LGUI ${version}${codeOnly ? '，无图模式' : ''}）。`, `下一步：cd ${dir}，然后运行 lgui dev 打开预览。`]
  };
}
