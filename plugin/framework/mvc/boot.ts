// 启动（后端已经 init 过）：设置运行时（换上 app.platform 给的日志、声音出口）、建 UIManager、注册服务，然后调用 app.start()。lgui dev、lgui test、Unity 导出都走这里。
import type {Backend} from '../core/index';
import {LgRuntimeError, hasRegisteredIcons, setAppIcons, setIconFaultReporter, unityIconError} from '../core/index';
import type {AppDefinition} from './lgui';
import {runtime, setRuntime} from './runtime';
import type {PlatformOverrides, RuntimeConfig} from './runtime';
import {UIManager} from './ui/manager';
import {setupCommonViews} from './common-views';
import {pickLanguage, setTexts} from './i18n';
import {setServices} from './service';
import type {TextTable} from './i18n';
import {fault} from './log';
import {startSound} from './sound';

/** 内部用：让后端换界面上固定文字的语言。没配翻译文件地址（LGUI-RT-173）是写错了：正式构建里只记 error，固定文字留在原来的语言。 */
export async function switchBackendLanguage(backend: Backend, language: string): Promise<void> {
  try {
    await backend.setLanguage(language);
  } catch (error) {
    if (!(error instanceof LgRuntimeError) || error.code !== 'LGUI-RT-173') throw error;
    fault(error, {language});
  }
}

/** platform：换掉哪些平台服务（不写就用 app.platform；lgui test 传 {}，日志和声音总是记进 headless）。 */
export async function boot(backend: Backend, app: AppDefinition, config: RuntimeConfig, deps: Record<string, string[]>, options: {wallBase?: number; start?: boolean; texts?: Record<string, TextTable>; language?: string; services?: Record<string, () => object>; platform?: PlatformOverrides} = {}): Promise<UIManager> {
  setRuntime(backend, config, options.wallBase ?? Date.now(), deps, options.platform ?? app.platform ?? {});
  setIconFaultReporter((error, data) => fault(error, data));
  setAppIcons(app.icons);
  if (backend.name === 'unity' && hasRegisteredIcons()) fault(unityIconError());
  const language = options.language ?? pickLanguage(backend.platform.locale.systemLanguages(), config.languages, config.defaultLanguage);
  setTexts(options.texts ?? {}, language);
  // 界面包里本来就是默认语言的文字，默认语言不用加载翻译。
  if (language !== config.defaultLanguage) await switchBackendLanguage(backend, language);
  setServices({...(app.services ?? {}), ...(options.services ?? {})});
  const ui = new UIManager(backend, deps, config);
  runtime().ui = ui;
  setupCommonViews(ui);
  startSound(ui);
  await ui.startHintBar();
  if (options.start !== false) await app.start();
  return ui;
}
