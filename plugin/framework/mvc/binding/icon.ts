// icon：加载器的地址，或按钮、标签的图标。网络图片先显示占位图，加载好了再换上；加载失败（外部失败）留着占位图并记 warn。
import type {UIButton, UILabel, UILoader} from '../../core/index';
import {LgRuntimeError, hasIcon, isIconUrl, missingIconError, unityIconError} from '../../core/index';
import {runtime} from '../runtime';
import {failure, fault} from '../log';
import {currentLanguage} from '../i18n';
import type {BindContext} from './index';

const tokens = new WeakMap<object, number>();

/** 带字的图片：有当前语言的版本（名字加 @<语言>）就用它，没有就用默认版本。 */
export function localized(url: string): string {
  if (!url.startsWith('ui://')) return url;
  const candidate = `${url}@${currentLanguage()}`;
  return runtime().backend.imageSize(candidate) ? candidate : url;
}

export function applyIcon(target: UILoader | UIButton | UILabel, url: string, placeholder: string | null | undefined, ctx: BindContext): void {
  const {backend, config} = runtime();
  if (isIconUrl(url)) {
    if (backend.name === 'unity') {
      fault(unityIconError(url), {url, where: ctx.where});
      if ('title' in target) target.icon = ''; else target.url = '';
      return;
    }
    if (!hasIcon(url)) {
      fault(missingIconError(url, ctx.where), {url, where: ctx.where});
      if ('title' in target) target.icon = ''; else target.url = '';
      return;
    }
    if ('title' in target) { target.icon = url; return; }
    tokens.set(target, (tokens.get(target) ?? 0) + 1);
    target.url = url;
    return;
  }
  if ('title' in target) { target.icon = localized(url); return; }
  const loader = target;
  const token = (tokens.get(loader) ?? 0) + 1;
  tokens.set(loader, token);
  if (!url || url.startsWith('ui://')) {
    // 别的包里的图片：那个包要已经加载（是这个界面依赖的包），否则显示不出来——这是写错了（LGUI-RT-071），不默默留空。
    const pkg = /^ui:\/\/([^/]+)\//.exec(url)?.[1];
    if (pkg && !backend.platform.resource.hasPackage(pkg)) fault(new LgRuntimeError('LGUI-RT-071', `${ctx.where} 的图片 ${url} 所在的包 ${pkg} 没有加载，显示不出来。`, `让这个界面依赖 ${pkg} 包：在组件里引用一次 ${pkg} 包的组件（比如列表的 defaultItem 用 ${pkg} 包里的组件）。`), {url, where: ctx.where});
    loader.url = localized(url);
    return;
  }
  const fallback = placeholder !== undefined ? placeholder : config.placeholder;
  if (fallback && isIconUrl(fallback)) {
    if (backend.name === 'unity') {
      fault(unityIconError(fallback), {url: fallback, where: ctx.where});
      loader.url = '';
    } else if (!hasIcon(fallback)) {
      fault(missingIconError(fallback, ctx.where), {url: fallback, where: ctx.where});
      loader.url = '';
    } else {
      loader.url = fallback;
    }
  } else {
    loader.url = fallback ?? '';
  }
  backend.platform.resource.loadImage(url).then(
    () => { if (tokens.get(loader) === token && !ctx.scope.isClosed) loader.url = url; },
    () => { if (tokens.get(loader) === token) failure(new LgRuntimeError('LGUI-RT-070', `${ctx.where} 的图片 ${url} 加载失败，显示占位图。`, '确认图片地址对、能访问。'), {url, where: ctx.where}); }
  );
}
