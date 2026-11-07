// Unity 后端：用 PuerTS 调用 FairyGUI-unity；游戏代码只通过 core/MVC 接口使用它。
import type {Backend, BackendConfig, Platform, UIComponent} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';
import {createObjectAdapter} from './objects';
import {createUnityPlatform} from './platform';
import type {NativeBridge, UnityGlobals} from './native-backend';

/** 由 Unity 导出的启动代码选择，游戏源码不直接 import Unity 后端。 */
export function createUnityBackend(bridge?: NativeBridge): Backend {
  const globals = globalThis as UnityGlobals;
  let api: NativeBridge | null = null;
  let nativePlatform: ReturnType<typeof createUnityPlatform> | null = null;
  let objects: ReturnType<typeof createObjectAdapter> | null = null;
  let root: UIComponent | null = null;
  let config: BackendConfig | null = null;
  const loaded = new Set<string>();
  const containers = new Set<UIComponent>();
  const scale = {value: 1};
  let frameHook: ((deltaMs: number) => void) | null = null;
  let visibilityHook: ((visible: boolean) => void) | null = null;
  let disposeHook: (() => void) | null = null;

  const ready = (): NativeBridge => {
    if (!api || !nativePlatform || !objects || !root || !config) {
      throw new LgRuntimeError('LGUI-RT-027', 'Unity 后端还没有启动。', '先调用 backend.init(config)。');
    }
    return api;
  };

  const dispose = (): void => {
    for (const container of containers) container.dispose();
    containers.clear();
    objects?.dispose();
    nativePlatform?.dispose();
    if (api) for (const name of loaded) if (api.FairyGUI.UIPackage.GetByName(name)) api.FairyGUI.UIPackage.RemovePackage(name);
    loaded.clear();
    if (globals.__lguiFrame === frameHook) delete globals.__lguiFrame;
    if (globals.__lguiVisibility === visibilityHook) delete globals.__lguiVisibility;
    if (globals.__lguiDispose === disposeHook) delete globals.__lguiDispose;
    nativePlatform = null;
    objects = null;
    root = null;
    config = null;
    api = null;
  };

  return {
    name: 'unity',
    async init(options) {
      const found = bridge ?? globals.CS;
      if (!found?.FairyGUI || !found.UnityEngine?.Rect || !found.LGUI?.Platform || !found.LGUI.LGUIResourceLoader) {
        throw new LgRuntimeError('LGUI-RT-001', '当前运行环境没有 Unity、FairyGUI 和 LGUI 的 PuerTS 类型。', '在 Unity 6000.6 中安装 LGUI 与 PuerTS 3.0.3 本地包，用 LGUIBoot 场景启动。');
      }
      globals.__lguiDispose?.();
      api = found;
      config = options;
      const fgui = found.FairyGUI;
      if (options.defaultFont) fgui.UIConfig.defaultFont = options.defaultFont;
      // FairyGUI-unity 的按钮、动效会自己放声音（网页版的 FairyGUI 不放）。LGUI 的声音都由框架经 platform.audio 放，所以关掉 FairyGUI 自己的。
      fgui.Stage.inst.soundVolume = 0;
      const host = found.LGUI.Platform;
      objects = createObjectAdapter(fgui, () => host.Now, (x, y) => ({x: x / scale.value, y: y / scale.value}),
        (x, y, width, height) => new found.UnityEngine.Rect(x, y, width, height), {
          wheelDeltaX: () => host.WheelDeltaX,
          hitTest(x, y) {
            // 舞台坐标 = 设计坐标 × 缩放比；没有命中控件时 FairyGUI 返回舞台自己（它不属于任何 GObject）。
            let display = fgui.Stage.inst.HitTest(new found.UnityEngine.Vector2(x * scale.value, y * scale.value), true);
            while (display && !display.gOwner) display = display.parent;
            return display?.gOwner ?? null;
          },
          buttonSound: button => host.ButtonSoundUrl(button),
          transitionSettings: transition => ({autoPlay: host.TransitionAutoPlay(transition), times: host.TransitionAutoPlayTimes(transition), delay: Math.round(host.TransitionAutoPlayDelay(transition) * 1000)})
        }, component => { containers.delete(component); });
      nativePlatform = createUnityPlatform({
        projectName: options.projectName, uiBase: options.uiBase, host: found.LGUI.Platform,
        fgui, objects, createLoader: () => new found.LGUI.LGUIResourceLoader(), scale
      });
      objects.setComponentName(fgui.GRoot.inst, 'root');
      root = objects.wrapComponent(fgui.GRoot.inst);
      frameHook = deltaMs => { objects?.clearPointerCache(); nativePlatform?.tick(deltaMs); };
      visibilityHook = visible => nativePlatform?.visibility(visible);
      disposeHook = dispose;
      globals.__lguiFrame = frameHook;
      globals.__lguiVisibility = visibilityHook;
      globals.__lguiDispose = disposeHook;
    },
    get root(): UIComponent { ready(); return root!; },
    get platform(): Platform { ready(); return nativePlatform!.platform; },
    async loadPackage(name) {
      ready();
      await nativePlatform!.platform.resource.loadPackage(name);
      loaded.add(name);
    },
    releasePackage(name) {
      ready();
      loaded.delete(name);
      nativePlatform!.platform.resource.releasePackage(name);
    },
    create<Name extends string>(packageName: string, componentName: string): UIComponent<Name> {
      const fgui = ready().FairyGUI;
      if (!fgui.UIPackage.GetByName(packageName)) throw new LgRuntimeError('LGUI-RT-002', `界面包 ${packageName} 还没加载。`, '先加载这个包（UIManager 打开界面时会自动加载）。');
      const native = fgui.UIPackage.CreateObject(packageName, componentName);
      if (!native) throw new LgRuntimeError('LGUI-RT-003', `界面包 ${packageName} 里没有组件 ${componentName}。`, '用 lgui ui list 查看组件名，并重新导出。');
      objects!.setComponentName(native, `${packageName}/${componentName}`);
      return objects!.wrapComponent(native) as UIComponent<Name>;
    },
    async setLanguage(language) {
      const cs = ready();
      if (!config!.i18nBase) return;
      const resourcePath = `${config!.i18nBase}/${language}`;
      try {
        cs.FairyGUI.UIPackage.SetStringsSource(new cs.FairyGUI.Utils.XML(cs.LGUI.Platform.LoadText(resourcePath)));
      } catch (error) {
        throw new LgRuntimeError('LGUI-RT-141', `读不了 Unity 翻译资源 ${resourcePath}：${String(error)}`, '重新导出工程，确认 Assets/LGUI/Resources/UI/i18n/ 下有这种语言的 XML。');
      }
      // 翻译写进包的组件数据，切语言必须重新读取原始包，不能重复翻译同一份已修改的数据。
      const names = [...loaded];
      for (const name of names) nativePlatform!.platform.resource.releasePackage(name);
      for (const name of names) await nativePlatform!.platform.resource.loadPackage(name);
    },
    has(packageName, componentName) {
      const pkg = ready().FairyGUI.UIPackage.GetByName(packageName);
      return pkg !== null && pkg.GetItemByName(componentName) !== null;
    },
    imageSize(url) {
      const item = ready().FairyGUI.UIPackage.GetItemByURL(url);
      return item ? {width: item.width, height: item.height} : null;
    },
    createImage(url) {
      const cs = ready();
      const loader = new cs.LGUI.LGUIResourceLoader();
      loader.url = url;
      const size = this.imageSize(url);
      if (size) loader.SetSize(size.width, size.height);
      return objects!.wrap(loader);
    },
    createContainer(name) {
      const native = new (ready().FairyGUI.GComponent)();
      native.name = name;
      objects!.setComponentName(native, '');
      const container = objects!.wrapComponent(native);
      containers.add(container);
      return container;
    }
  };
}
