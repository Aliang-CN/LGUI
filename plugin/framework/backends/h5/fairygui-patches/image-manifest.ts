// 补丁 2：散图映射。lgui 生成的网页界面包里，图片是按资源 ID 命名的散图，manifest.json 记着每个包里每张图片的散图文件名。
// 加 UIPackage.setImageManifest / loadImageManifest；读包（UIPackage 实例的 loadPackage）之后把每张图片的 file 改成「包目录 + 散图文件名」。
// 包或图片不在映射里报 LGUI-RT-010：异常从读包里抛出，补丁 6 让 UIPackage.loadPackage 返回的 Promise 因此 reject，包也不登记。
import * as fgui from '../vendor/fairygui.module.js';
import {LgRuntimeError} from '../../../core/index';
import {add, after, field} from './hook';

const PATCH = 2;

type Manifest = {schemaVersion: 1; packages: Record<string, {images: Record<string, string>}>};
let manifest: Manifest | null = null;

const invalid = (message: string): LgRuntimeError => new LgRuntimeError('LGUI-RT-010', message, '重新运行 lgui dev 生成界面包。');

function setImageManifest(value: unknown): void {
  const m = value as Partial<Manifest> | null;
  if (!m || m.schemaVersion !== 1 || typeof m.packages !== 'object' || m.packages === null) throw invalid('散图映射 manifest.json 的格式不对（要求 schemaVersion 1）。');
  manifest = m as Manifest;
}

async function loadImageManifest(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw invalid(`读不到散图映射 ${url}（HTTP ${response.status}）。`);
  setImageManifest(await response.json());
}

export function installImageManifest(): void {
  add(PATCH, fgui.UIPackage, 'UIPackage', 'setImageManifest', setImageManifest);
  add(PATCH, fgui.UIPackage, 'UIPackage', 'loadImageManifest', loadImageManifest);
  after<fgui.UIPackage>(PATCH, fgui.UIPackage.prototype, 'UIPackage', 'loadPackage', (pkg, args) => {
    if (!manifest) return;
    const entry = manifest.packages[pkg.id];
    if (!entry) throw invalid(`散图映射里没有包 ${pkg.name}（${pkg.id}）。`);
    const url = String(args[1]);
    for (const item of field<fgui.PackageItem[]>(pkg, '_items')) {
      if (item.type !== fgui.PackageItemType.Image) continue;
      const file = entry.images[item.id];
      if (!file) throw invalid(`散图映射里没有包 ${pkg.name} 的图片 ${item.id}。`);
      item.file = url + file;
    }
  });
}
