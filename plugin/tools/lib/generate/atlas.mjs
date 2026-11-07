// 图集上限。OpenFairyGUI 默认 2048，竖屏的整屏背景（比如 1080×2600）就放不下，生成时报一句看不懂的「atlas: Could not pack every input」。
// LGUI 的默认上限是 ATLAS_MAX_SIZE；某个包要更大（或更小），在它的 package.xml 里写 <publish name="包名" maxAtlasSize="…"/>。
// 生成前逐张查图片尺寸，超过所在包的上限就报 LGUI-CLI-113，写明是哪张图、多大、怎么改；OpenFairyGUI 打图集失败也换成 LGUI-CLI-113。
import path from 'node:path';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {sharp} from '../vendor.mjs';

export const ATLAS_MAX_SIZE = 4096;

const fix = name => `把图缩到上限以内（全屏背景按设计尺寸出图；更长的可以拆成几张拼起来）；确实要这么大，就在 ui/assets/${name}/package.xml 的 </resources> 后面写 <publish name="${name}" maxAtlasSize="8192"/>（多数手机支持到 4096，再大先确认目标设备）。`;

/** 没写 maxAtlasSize 的包用 LGUI 的默认上限（在调用处设，不改生成器）；再逐张查图片尺寸。 */
export async function prepareAtlas(document, assets) {
  const root = document.getRoot();
  const settings = root.getSettings?.() ?? {};
  root.setSettings({...settings, publish: {...settings.publish, atlasSetting: {...settings.publish?.atlasSetting, maxSize: ATLAS_MAX_SIZE}}});
  const errors = [];
  for (const pkg of root.listPackages()) {
    const own = pkg.getSourceAtlasSettings();
    const limit = own.useGlobal ? ATLAS_MAX_SIZE : own.maxSize;
    const name = pkg.getName();
    for (const image of pkg.listImageResources()) {
      const rel = `${image.getPath().replace(/^\/+/, '')}${image.getFileName()}`;
      let size;
      try {
        size = await sharp()(path.join(assets, name, rel)).metadata();
      } catch {
        continue; // 文件不在、读不了：生成时报 LGUI-CLI-021
      }
      if (size.width > limit || size.height > limit) {
        errors.push(new LgCliError('LGUI-CLI-113', `包 ${name} 的图片 ${rel}（${size.width}×${size.height}）比图集上限 ${limit}×${limit} 大，打不进图集。`, {file: `ui/assets/${name}/package.xml`, fix: fix(name)}));
      }
    }
  }
  if (errors.length) throw new LgCliErrors(errors);
}

/** OpenFairyGUI 打图集失败（比如一个包的图多到超过图集页数上限）：换成 LGUI-CLI-113。别的错误原样抛出。 */
export function atlasError(error) {
  const m = /^atlas: Could not pack every input for (?:package )?"?([^".]+)"?\.?$/.exec(error?.message ?? '');
  if (!m) return error;
  return new LgCliError('LGUI-CLI-113', `包 ${m[1]} 的图片打不进图集（OpenFairyGUI：${error.message}）。`, {file: `ui/assets/${m[1]}/package.xml`, fix: `一个包的图太多或太大：把用不到的图删掉、大图缩小，或者拆成两个包；${fix(m[1])}`});
}
