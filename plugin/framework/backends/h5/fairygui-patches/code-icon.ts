// 补丁 13：代码图标（icon://<名字>）。
// GLoader 原本只认识包里的 ui:// 资源和外部网络图片地址（<img src="...">）。
// 挂在 GLoader.loadContent 上：遇到 icon://<名字> 时先让原方法只清理旧内容（不发网络请求），
// 再从代码图标注册表里取出定义——shapes 矢量图元序列化为 SVG data URL，draw 绘制函数在按 DPR 缩放的离屏 Canvas 2D 上
// 光栅化为 PNG data URL（均按定义缓存）——设进 _content.src、sourceWidth、sourceHeight 并刷新布局，
// 按钮、标签、加载器、拖放跟手图标、填充裁剪、变灰染色都走同一条路。未注册时报 LGUI-RT-072。
import * as fgui from '../vendor/fairygui.module.js';
import type {RegisteredIcon} from '../../../core/index';
import {LgRuntimeError, iconSvgDataUrl, isIconUrl, lookupIcon, missingIconError, reportIconFault} from '../../../core/index';
import {around} from './hook';

const PATCH = 13;

type LoaderContent = HTMLElement & {
  src: string | null;
  scale9Grid: unknown;
  scaleByTile: boolean;
  textureScale: fgui.Vec2;
};

type RawLoader = fgui.GLoader & {
  _url: string;
  _content: LoaderContent;
  sourceWidth: number;
  sourceHeight: number;
  updateLayout(): void;
};

export const loaderFields = ['_url', '_content', 'sourceWidth', 'sourceHeight', 'updateLayout'] as const;

function renderIconUrl(icon: RegisteredIcon): string {
  if (icon.kind === 'shapes') return iconSvgDataUrl(icon);
  const dpr = Math.max(1, Math.min(4, typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1));
  const cached = icon.cachedPngUrls.get(dpr);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(icon.width * dpr));
  canvas.height = Math.max(1, Math.round(icon.height * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new LgRuntimeError('LGUI-RT-232', '浏览器拿不到 2D 画布上下文，画不了代码图标。', '确认运行在支持 Canvas 2D 的浏览器里，或者改用 shapes 矢量图元写法。');
  }
  ctx.scale(canvas.width / icon.width, canvas.height / icon.height);
  icon.draw(ctx, icon.width, icon.height);
  const url = canvas.toDataURL('image/png');
  icon.cachedPngUrls.set(dpr, url);
  return url;
}

export function installCodeIcons(): void {
  around<RawLoader, string | null>(
    PATCH,
    fgui.GLoader.prototype,
    'GLoader',
    'loadContent',
    self => {
      if (!isIconUrl(self._url)) return null;
      const saved = self._url;
      self._url = '';
      return saved;
    },
    (self, saved) => {
      if (saved === null) return;
      self._url = saved;
      const icon = lookupIcon(saved);
      if (!icon) {
        self.updateLayout();
        reportIconFault(missingIconError(saved), {url: saved});
        return;
      }
      self.sourceWidth = icon.width;
      self.sourceHeight = icon.height;
      self._content.scale9Grid = null;
      self._content.scaleByTile = false;
      self._content.textureScale = new fgui.Vec2(1, 1);
      self._content.src = renderIconUrl(icon);
      self.updateLayout();
    }
  );
}
