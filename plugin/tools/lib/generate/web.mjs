// 网页用的界面包：每个包输出到 <out>/<包名>/，内含 package.xml（FairyGUI-dom 实际请求的文件名，内容是 Layabox 格式的二进制包）、
// 按资源 ID 命名的散图 <资源ID>.png 和声音 <资源ID>.mp3；再写一份 <out>/manifest.json，网页运行时靠它找到散图和声音。
// 声音：OpenFairyGUI 0.7.0 会把导出的（或被引用的）声音写成 <包名>_<资源ID>.mp3，包里记的文件名是 <资源ID>.mp3；
// 这里和图片一样直接从 ui/assets/ 复制登记过的每个声音，放在包目录下、用包里记的那个文件名。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openFairyGUI} from '../vendor.mjs';
import {LgCliError} from '../errors.mjs';
import {readUiProject, quiet} from './read.mjs';
import {prepareAtlas, atlasError} from './atlas.mjs';

// 一个声音在 ui/assets/ 里的文件。
const soundFile = (assets, pkgName, sound) => path.join(assets, pkgName, sound.getPath().replace(/^\/+/, ''), sound.getFile());

export async function generateWeb(fairyPath, out) {
  const {core, functions} = openFairyGUI();
  const document = await readUiProject(fairyPath); // 登记了却不存在的声音文件，校验时就报 LGUI-CLI-020
  document.getRoot().setProjectType(4); // Layabox
  const assets = path.join(path.dirname(fairyPath), 'assets');
  const soundsOf = pkg => pkg.listResources().filter(resource => resource instanceof core.SoundResource);
  await prepareAtlas(document, assets); // 图集上限：没写 maxAtlasSize 的包用 LGUI 的默认值，图比上限大就报 LGUI-CLI-113
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-web-'));
  try {
    const {log} = await quiet(() => functions.publishNode({document, output: temp, assetsPath: assets, compressed: false, fileExtension: 'fui', codeGeneration: false, plugins: []})).catch(error => { throw atlasError(error); });
    fs.rmSync(out, {recursive: true, force: true});
    fs.mkdirSync(out, {recursive: true});
    const manifest = {schemaVersion: 1, packages: {}};
    const files = [];
    for (const pkg of document.getRoot().listPackages()) {
      const name = pkg.getName();
      const dir = path.join(out, name);
      fs.mkdirSync(dir, {recursive: true});
      const binary = path.join(temp, `${name}.fui`);
      if (!fs.existsSync(binary)) throw new LgCliError('LGUI-CLI-021', `OpenFairyGUI 没有生成包 ${name} 的 ${name}.fui。`, {fix: '这是生成步骤的缺陷，请把输出报告给维护者。'});
      fs.copyFileSync(binary, path.join(dir, 'package.xml'));
      files.push(path.join(dir, 'package.xml'));
      const images = {};
      for (const image of pkg.listImageResources()) {
        // 直接从 ui/assets/ 读图片字节（OpenFairyGUI 后端的 readResourceBytes 有 1 MiB 上限）。
        const source = path.join(assets, name, image.getPath().replace(/^\/+/, ''), image.getFileName());
        if (!fs.existsSync(source)) {
          throw new LgCliError('LGUI-CLI-021', `包 ${name} 的图片 ${image.getId()} 指向的文件不存在：${source}。`, {file: `ui/assets/${name}/package.xml`, fix: '把图片放回 package.xml 写的位置，或者从 package.xml 里删掉这条图片资源。'});
        }
        const file = `${image.getId()}${path.extname(image.getFileName()) || '.png'}`;
        fs.copyFileSync(source, path.join(dir, file));
        images[image.getId()] = file;
        files.push(path.join(dir, file));
      }
      const sounds = {};
      for (const sound of soundsOf(pkg)) {
        const file = `${sound.getId()}${path.extname(sound.getFile()) || '.mp3'}`;
        fs.copyFileSync(soundFile(assets, name, sound), path.join(dir, file));
        sounds[sound.getId()] = {name: sound.getName(), file};
        files.push(path.join(dir, file));
      }
      manifest.packages[pkg.getId()] = {name, images, sounds};
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    files.push(path.join(out, 'manifest.json'));
    return {out, files, manifest, log};
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
