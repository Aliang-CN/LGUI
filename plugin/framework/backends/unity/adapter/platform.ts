// Unity 平台服务：原始输入来自 FairyGUI Stage，其余能力调用 LGUI.Platform。
import type {Insets, KeyInput, LogLevel, Logger, NetResponse, Platform, PointerInput, Rect, Unsubscribe, WheelInput} from '../../../core/index';
import {LgRuntimeError, isIconUrl, notImplemented, unityIconError} from '../../../core/index';
import type {NativeEventContext, NativeLoader} from './native-ui';
import type {NativePlatformHost, UnityPlatformOptions} from './native-platform';

class Handlers<T> {
  private readonly handlers = new Set<(value: T) => void>();
  add(handler: (value: T) => void): Unsubscribe { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  emit(value: T, onError?: (error: unknown) => void): void {
    for (const handler of [...this.handlers]) {
      if (!onError) { handler(value); continue; }
      try { handler(value); } catch (error) { onError(error); }
    }
  }
  clear(): void { this.handlers.clear(); }
}

const keyNames: Record<number, string> = {
  8: 'Backspace', 9: 'Tab', 12: 'Clear', 13: 'Enter', 19: 'Pause', 27: 'Escape', 32: ' ', 127: 'Delete',
  256: '0', 257: '1', 258: '2', 259: '3', 260: '4', 261: '5', 262: '6', 263: '7', 264: '8', 265: '9',
  266: '.', 267: '/', 268: '*', 269: '-', 270: '+', 271: 'Enter', 272: '=',
  273: 'ArrowUp', 274: 'ArrowDown', 275: 'ArrowRight', 276: 'ArrowLeft', 277: 'Insert', 278: 'Home', 279: 'End', 280: 'PageUp', 281: 'PageDown',
  300: 'NumLock', 301: 'CapsLock', 302: 'ScrollLock', 303: 'Shift', 304: 'Shift', 305: 'Control', 306: 'Control',
  307: 'Alt', 308: 'Alt', 309: 'Meta', 310: 'Meta', 311: 'Meta', 312: 'Meta', 313: 'AltGraph', 315: 'Help', 316: 'PrintScreen', 317: 'PrintScreen', 318: 'Cancel', 319: 'ContextMenu'
};

function keyName(context: NativeEventContext): string | null {
  const input = context.inputEvent;
  if (!input) return null;
  const code = input.keyCode;
  if (keyNames[code] !== undefined) return keyNames[code];
  if (code >= 282 && code <= 296) return `F${code - 281}`;
  const character = typeof input.character === 'number' ? String.fromCharCode(input.character) : input.character;
  if (character && character.length === 1 && character.charCodeAt(0) >= 32) return character;
  if (code >= 33 && code <= 126) return String.fromCharCode(code);
  return code === 0 ? null : `KeyCode${code}`;
}

// 写成 Unity 控制台里的一行：[分类] 事件名  错误码  说明  → 怎么改  数据  上下文；错误带堆栈。
function text(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try { return JSON.stringify(value, (_key, item: unknown) => item instanceof Error ? `${item.name}: ${item.message}` : item) ?? String(value); }
  catch { return String(value); }
}

/** Unity 的默认日志出口：写到 Unity 控制台（debug、info 用 Debug.Log，warn 用 LogWarning，error 用 LogError）。 */
export function unityLogger(host: NativePlatformHost, alive: () => void, category = 'game', context: object = {}): Logger {
  const write = (level: LogLevel, event: string, data: unknown, error: unknown): void => {
    alive();
    const value = typeof data === 'function' ? (data as () => unknown)() : data;
    const framework = value as {code?: unknown; message?: unknown; fix?: unknown} | undefined;
    const head = framework && typeof framework.message === 'string' ? `  ${String(framework.code ?? '')}  ${framework.message}${framework.fix ? `  → ${String(framework.fix)}` : ''}` : '';
    const extra = [value, Object.keys(context).length ? context : undefined, error].filter(x => x !== undefined).map(text);
    host.Log(level, [`[${category}] ${event}${head}`, ...extra].join('  '));
  };
  return {
    enabled: () => true,
    debug: (event, data) => write('debug', event, data, undefined),
    info: (event, data) => write('info', event, data, undefined),
    warn: (event, data, error) => write('warn', event, data, error),
    error: (event, error, data) => write('error', event, data, error),
    child: (extra, sub) => unityLogger(host, alive, sub ? `${category}.${sub}` : category, {...context, ...extra})
  };
}

const unregistered = (url: string): LgRuntimeError => new LgRuntimeError('LGUI-RT-170', `声音 ${url} 没有登记在 ui/ 的包里。`, '把 mp3 放进包目录，在 package.xml 里登记成 <sound … exported="true"/>，地址写成 ui://包名/声音名。');
const imageError = (url: string, detail = ''): LgRuntimeError => new LgRuntimeError('LGUI-RT-025', `图片 ${url} 加载失败。${detail}`, '确认地址对、资源存在；远程图片需要可访问的 HTTP(S) 地址。');
const requestError = (url: string, detail: string): LgRuntimeError => new LgRuntimeError('LGUI-RT-101', `HTTP 请求 ${url} 失败：${detail}`, '确认服务器地址、网络连接和请求参数。');
const clipboardError = (what: string, detail: string): LgRuntimeError => new LgRuntimeError('LGUI-RT-241', `剪贴板${what}失败：${detail}`, 'Unity 由 LGUI.Platform.ClipboardGet / ClipboardSet 读写系统剪贴板（GUIUtility.systemCopyBuffer）；确认 Unity 包是这一版的 LGUI，目标平台支持系统剪贴板。');

/** 创建一个独立的 Unity 平台；Boot 通过返回的 tick / visibility 驱动它。 */
export function createUnityPlatform(options: UnityPlatformOptions): {platform: Platform; tick(deltaMs: number): void; visibility(visible: boolean): void; dispose(): void} {
  const {projectName, uiBase, host, fgui, objects, createLoader, scale} = options;
  // 剪贴板走 LGUI.Platform 的 ClipboardGet / ClipboardSet。旧版的 Unity 包里没有这两个方法：报 LGUI-RT-241，不静默。
  const clipboardCall = <T>(what: string, name: 'ClipboardGet' | 'ClipboardSet', call: () => T): T => {
    alive();
    if (typeof (host as unknown as Record<string, unknown>)[name] !== 'function') throw clipboardError(what, `LGUI.Platform 没有 ${name}（Unity 包不是这一版的 LGUI）。`);
    // C# 的报错经 PuerTS 变成 JS 的 Error：只取它的 message（C# 那边只写出了什么错），建议用剪贴板自己的。
    try { return call(); } catch (error) { throw clipboardError(what, error instanceof Error ? error.message : String(error)); }
  };
  const frame = new Handlers<number>();
  const visible = new Handlers<boolean>();
  const pointers = new Handlers<PointerInput>();
  const keys = new Handlers<KeyInput>();
  const wheels = new Handlers<WheelInput>();
  const resizes = new Handlers<{width: number; height: number}>();
  const pressed = new Map<number, string>();
  const activePointers = new Map<number, PointerInput>();
  const pending = new Set<() => void>();
  const off: Unsubscribe[] = [];
  let disposed = false;
  const size = (): {width: number; height: number} => ({width: host.ScreenWidth, height: host.ScreenHeight});
  const safeArea = (): Insets => {
    const injected = (globalThis as {__lguiSafeArea?: Insets}).__lguiSafeArea;
    return injected ? {...injected} : {top: host.SafeAreaTop, right: host.SafeAreaRight, bottom: host.SafeAreaBottom, left: host.SafeAreaLeft};
  };
  let previousSize = size();
  let previousSafeArea = safeArea();
  const alive = (): void => { if (disposed) throw new LgRuntimeError('LGUI-RT-027', 'Unity 后端已停止。', '重新创建并启动后端后再调用平台服务。'); };

  const stage = fgui.Stage.inst;
  const capture = (name: string, handler: (context: NativeEventContext) => void): void => {
    stage.AddCapture(name, handler);
    off.push(() => stage.RemoveCapture(name, handler));
  };
  for (const [event, type] of [['onTouchBegin', 'down'], ['onTouchMove', 'move'], ['onTouchEnd', 'up']] as const) {
    capture(event, context => {
      if (!context.inputEvent) return;
      if (type === 'move' && !fgui.Stage.touchScreen) {
        // Stage 先收到 move，GObject 的 monitor 随后才收到；先转发命中对象的 hover，
        // 使对象和舞台使用同一份原始事件，而不是在每次移动时误判一次离开。
        let target = stage.touchTarget;
        while (target && !target.gOwner) target = target.parent;
        objects.dispatchHover(target?.gOwner ?? null, context);
      }
      const pointer = objects.toPointerInput(type, context);
      if (type === 'up') activePointers.delete(pointer.pointerId); else if (type === 'down' || activePointers.has(pointer.pointerId)) activePointers.set(pointer.pointerId, pointer);
      pointers.emit(pointer);
    });
  }
  for (const [event, type] of [['onKeyDown', 'down'], ['onKeyUp', 'up']] as const) {
    capture(event, context => {
      if (!context.inputEvent) return;
      const code = context.inputEvent.keyCode;
      const key = (type === 'up' ? pressed.get(code) : undefined) ?? keyName(context);
      if (!key) return;
      const repeat = type === 'down' && pressed.has(code);
      if (type === 'down') pressed.set(code, key); else pressed.delete(code);
      if (!host.IsComposing) keys.emit({type, key, repeat});
    });
  }
  capture('onMouseWheel', context => {
    const input = context.inputEvent;
    // h5/headless 的滚动量都是输入像素；只有落点坐标随设计尺寸转换。
    if (input) wheels.emit({x: input.x / scale.value, y: input.y / scale.value, deltaX: host.WheelDeltaX, deltaY: input.mouseWheelDelta});
  });

  const platform: Platform = {
    time: {now: () => host.Now, onFrame: h => { alive(); return frame.add(h); }, onVisibilityChange: h => { alive(); return visible.add(h); }},
    storage: {
      get: key => { alive(); return host.StorageGet(projectName, key); },
      set: (key, value) => { alive(); host.StorageSet(projectName, key, value); },
      remove: key => { alive(); host.StorageRemove(projectName, key); }
    },
    resource: {
      async loadPackage(name) {
        alive();
        const resourcePath = `${uiBase}/${name}`;
        try {
          if (fgui.UIPackage.GetByName(name)) return;
          if (!fgui.UIPackage.AddPackage(resourcePath)) throw new Error('FairyGUI 没有返回界面包。');
        } catch (error) {
          throw new LgRuntimeError('LGUI-RT-011', `Unity 界面包 ${resourcePath} 加载失败：${String(error)}`, '重新导出，确认界面包在 Assets/LGUI/Resources/UI/。');
        }
      },
      releasePackage(name) { alive(); if (fgui.UIPackage.GetByName(name)) fgui.UIPackage.RemovePackage(name); },
      hasPackage(name) { alive(); return fgui.UIPackage.GetByName(name) !== null; },
      async loadImage(url) {
        alive();
        if (isIconUrl(url)) throw unityIconError(url);
        if (url.startsWith('ui://')) {
          try { if (!fgui.UIPackage.GetItemAssetByURL(url)) throw imageError(url); }
          catch (error) { throw error instanceof LgRuntimeError ? error : imageError(url, String(error)); }
          return;
        }
        if (!/^https?:\/\//i.test(url)) throw imageError(url, '只支持 ui:// 或 HTTP(S) 地址。');
        let loader: NativeLoader;
        try { loader = createLoader(); } catch (error) { throw imageError(url, String(error)); }
        return new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = (): void => {
            loader.onLoaded.Remove(loaded);
            loader.onLoadError.Remove(failed);
            pending.delete(cancel);
            loader.Dispose();
          };
          const finish = (error?: LgRuntimeError): void => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error); else resolve();
          };
          const loaded = (context: NativeEventContext): void => { if (typeof context.data !== 'string' || context.data === url) finish(); };
          const failed = (context: NativeEventContext): void => { if (typeof context.data !== 'string' || context.data === url) finish(imageError(url)); };
          const cancel = (): void => finish(imageError(url, 'Unity 后端已停止。'));
          pending.add(cancel);
          loader.onLoaded.Add(loaded);
          loader.onLoadError.Add(failed);
          try { loader.url = url; } catch (error) { finish(imageError(url, String(error))); }
        });
      }
    },
    input: {
      onPointer: h => { alive(); return pointers.add(h); }, onKey: h => { alive(); return keys.add(h); }, onWheel: h => { alive(); return wheels.add(h); },
      setInputMode(mode) { alive(); host.SetInputMode(mode); }
    },
    textInput: {isComposing: () => host.IsComposing},
    screen: {
      size,
      safeArea,
      onResize: h => { alive(); return resizes.add(h); },
      applyDesignSize(design): Rect {
        alive();
        const screen = size();
        scale.value = Math.min(screen.width / design.width, screen.height / design.height);
        fgui.GRoot.inst.SetContentScaleFactor(scale.value);
        const rect = {x: 0, y: 0, width: screen.width / scale.value, height: screen.height / scale.value};
        fgui.GRoot.inst.SetSize(rect.width, rect.height);
        return rect;
      }
    },
    // 声音由 LGUI.Platform 自己的 AudioSource 放；没登记的 ui:// 地址先在这里报 LGUI-RT-170（和 h5 一样），网络声音下载失败由 C# 记 warn。
    audio: {
      play(url, volume, onError) {
        alive();
        if (url.startsWith('ui://') && !fgui.UIPackage.GetItemByURL(url)) { onError(unregistered(url)); return; }
        try { host.PlayAudio(url, volume); } catch (error) { onError(error); }
      },
      music(url, volume, fadeMs, onError) {
        alive();
        const missing = url !== null && url.startsWith('ui://') && !fgui.UIPackage.GetItemByURL(url);
        try { host.PlayMusic(url === null || missing ? '' : url, volume, fadeMs); } catch (error) { onError(error); return; }
        if (missing) onError(unregistered(url));
      },
      setPaused(paused) { alive(); host.SetAudioPaused(paused); }
    },
    locale: {systemLanguages: () => [host.SystemLanguage]},
    log: unityLogger(host, alive),
    net: {
      fetch(url, init = {}): Promise<NetResponse> {
        alive();
        return new Promise((resolve, reject) => {
          let settled = false;
          const cancel = (): void => {
            if (!settled) { settled = true; pending.delete(cancel); reject(requestError(url, 'Unity 后端已停止。')); }
          };
          pending.add(cancel);
          const complete = (json: string): void => {
            if (settled) return;
            settled = true;
            pending.delete(cancel);
            try {
              const response: unknown = JSON.parse(json);
              if (!response || typeof response !== 'object' || !('status' in response) || !('text' in response) || !('error' in response) ||
                  typeof response.status !== 'number' || typeof response.text !== 'string' || typeof response.error !== 'string') {
                throw requestError(url, '原生响应格式不对。');
              }
              if (response.error) throw requestError(url, response.error);
              const body = response.text;
              resolve({status: response.status, ok: response.status >= 200 && response.status < 300, text: async () => body, json: async () => JSON.parse(body) as unknown});
            } catch (error) { reject(error instanceof LgRuntimeError ? error : requestError(url, String(error))); }
          };
          const headers = JSON.stringify({items: Object.entries(init.headers ?? {}).map(([name, value]) => ({name, value}))});
          try { host.Fetch(url, init.method ?? 'GET', headers, init.body ?? '', complete); }
          catch (error) { settled = true; pending.delete(cancel); reject(requestError(url, String(error))); }
        });
      },
      webSocket() { throw notImplemented('WebSocket', 'unity'); }
    },
    clipboard: {
      async writeText(text) { clipboardCall('写入', 'ClipboardSet', () => host.ClipboardSet(text)); },
      async readText() {
        const text = clipboardCall('读取', 'ClipboardGet', () => host.ClipboardGet());
        if (typeof text !== 'string') throw clipboardError('读取', `ClipboardGet 返回的不是文字（${String(text)}）。`);
        return text;
      }
    }
  };

  return {
    platform,
    tick(deltaMs) {
      if (disposed) return;
      const next = size();
      const nextSafeArea = safeArea();
      if (next.width !== previousSize.width || next.height !== previousSize.height ||
          nextSafeArea.top !== previousSafeArea.top || nextSafeArea.right !== previousSafeArea.right ||
          nextSafeArea.bottom !== previousSafeArea.bottom || nextSafeArea.left !== previousSafeArea.left) {
        previousSize = next; previousSafeArea = nextSafeArea; resizes.emit(next);
      }
      // 与 h5 相同：错误照常报告，但一个界面的回调不能终止其余回调或下一帧。
      // 异常不能越过 PuerTS 的帧桥，否则 LGUIBoot 会按宿主启动失败关闭整个环境。
      frame.emit(deltaMs, error => platform.log.error('lgui_rt_160', error, {code: 'LGUI-RT-160', message: 'Unity 每帧回调出错。', fix: '按堆栈修正该回调；其他每帧回调继续运行。'}));
    },
    visibility(value) {
      if (disposed) return;
      if (!value) {
        pressed.clear();
        for (const pointer of activePointers.values()) pointers.emit({...pointer, type: 'cancel', time: host.Now});
        activePointers.clear();
      }
      visible.emit(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of off) stop();
      for (const cancel of [...pending]) cancel();
      pressed.clear();
      activePointers.clear();
      frame.clear(); visible.clear(); pointers.clear(); keys.clear(); wheels.clear(); resizes.clear();
    }
  };
}
