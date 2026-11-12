// h5 后端的平台服务：浏览器 API。
import * as fgui from '../vendor/fairygui.module.js';
import type {
  Platform, KeyInput, WheelInput, NetResponse, NetSocket, Insets, PointerInput, Rect, Unsubscribe
} from '../../../core/index';
import {LgRuntimeError, hasIcon, isIconUrl, missingIconError} from '../../../core/index';
import {fitDesign, stage, toDesign} from '../scale';
import {pointerEventTypes, toPointerInput} from '../pointer';
import {createH5Audio} from './audio';
import {consoleLogger} from './log';
import {createH5Clipboard} from './clipboard';

// 一组回调，返回取消函数。传了 onError 时，一个回调出错交给 onError，其余回调照常调用。
export class Handlers<T> {
  private set = new Set<(value: T) => void>();
  add(handler: (value: T) => void): Unsubscribe { this.set.add(handler); return () => { this.set.delete(handler); }; }
  emit(value: T, onError?: (error: unknown) => void): void {
    for (const handler of [...this.set]) {
      if (!onError) { handler(value); continue; }
      try { handler(value); } catch (error) { onError(error); }
    }
  }
}

// 统一按键名：安卓返回键当 Back。
export function keyName(event: KeyboardEvent): string {
  if (event.key === 'GoBack' || event.key === 'BrowserBack') return 'Back';
  if (event.key === 'Esc') return 'Escape';
  return event.key;
}

type InputModeValue = 'ui' | 'game' | 'all';
const h5InputModes = new WeakMap<Platform, {mode: () => InputModeValue; onChange: (h: (mode: InputModeValue) => void) => Unsubscribe}>();

/** 内部用（web-stage.ts）：读取并订阅 H5 平台当前的 inputMode。 */
export function h5InputModeState(platform: Platform): {mode: () => InputModeValue; onChange: (h: (mode: InputModeValue) => void) => Unsubscribe} {
  const found = h5InputModes.get(platform);
  if (!found) return {mode: () => 'game', onChange: () => () => {}};
  return found;
}

// 安全区：设置了 globalThis.__lguiSafeArea 时用它（lgui verify 用它模拟刘海），否则用一个放了 env(safe-area-inset-*) 的探测元素读出来。
function readSafeArea(): Insets {
  const injected = (globalThis as {__lguiSafeArea?: Insets}).__lguiSafeArea;
  if (injected) return {top: injected.top, right: injected.right, bottom: injected.bottom, left: injected.left};
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0, bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0};
  probe.remove();
  return insets;
}

export function createH5Platform(projectName: string, uiBase: string): Platform {
  const frame = new Handlers<number>();
  const visibility = new Handlers<boolean>();
  const pointer = new Handlers<PointerInput>();
  const keys = new Handlers<KeyInput>();
  const wheels = new Handlers<WheelInput>();
  const resizes = new Handlers<{width: number; height: number}>();
  const inputModes = new Handlers<InputModeValue>();
  let currentInputMode: InputModeValue = 'game';
  let composing = false;
  const audio = createH5Audio(uiBase);
  const unlockAudio = (): void => audio.unlock(); // 第一次点击或按键时解锁声音

  // 每帧：先排好下一帧，再逐个调用回调。一个回调出错，错误照常报到页面上（未捕获的错误），
  // 但不影响别的回调，也不会让以后的帧停掉（定时器、lgui.time.wait、请求超时、旋转换版都靠它）。
  let last = performance.now();
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const dt = now - last;
    last = now;
    frame.emit(dt, reportError);
  };
  requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => visibility.emit(document.visibilityState === 'visible'));

  // 原始输入（舞台上的全部指针，支持多点）
  for (const type of pointerEventTypes) {
    window.addEventListener(type, event => {
      pointer.emit(toPointerInput(event as PointerEvent));
      unlockAudio();
    });
  }
  window.addEventListener('keydown', e => { if (!composing) keys.emit({type: 'down', key: keyName(e), repeat: e.repeat}); unlockAudio(); });
  window.addEventListener('keyup', e => { if (!composing) keys.emit({type: 'up', key: keyName(e), repeat: false}); });
  window.addEventListener('wheel', e => { const {x, y} = toDesign(e.clientX, e.clientY); wheels.emit({x, y, deltaX: e.deltaX, deltaY: e.deltaY}); }, {passive: true});
  window.addEventListener('compositionstart', () => { composing = true; });
  window.addEventListener('compositionend', () => { composing = false; });

  // 屏幕
  const size = (): {width: number; height: number} => ({width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight});
  const onResize = (): void => resizes.emit(size());
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  const prefix = `lgui:${projectName}:`;

  const platform: Platform = {
    time: {now: () => performance.now(), onFrame: h => frame.add(h), onVisibilityChange: h => visibility.add(h)},
    storage: {
      get: key => localStorage.getItem(prefix + key),
      set: (key, value) => localStorage.setItem(prefix + key, value),
      remove: key => localStorage.removeItem(prefix + key)
    },
    resource: {
      loadPackage: async name => { if (!fgui.UIPackage.getByName(name)) await fgui.UIPackage.loadPackage(`${uiBase}/${name}`); },
      releasePackage: name => { if (fgui.UIPackage.getByName(name)) fgui.UIPackage.removePackage(name); },
      hasPackage: name => fgui.UIPackage.getByName(name) !== undefined,
      loadImage: url => {
        if (isIconUrl(url)) return hasIcon(url) ? Promise.resolve() : Promise.reject(missingIconError(url));
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new LgRuntimeError('LGUI-RT-025', `图片 ${url} 加载失败。`, '确认地址对、文件存在。'));
          image.src = url;
        });
      }
    },
    input: {
      onPointer: h => pointer.add(h),
      onKey: h => keys.add(h),
      onWheel: h => wheels.add(h),
      setInputMode: mode => {
        if (mode === currentInputMode) return;
        currentInputMode = mode;
        inputModes.emit(mode, reportError);
      }
    },
    textInput: {isComposing: () => composing},
    screen: {
      size,
      safeArea: readSafeArea,
      onResize: h => resizes.add(h),
      applyDesignSize(design): Rect {
        const {scale, visible} = fitDesign(size(), design);
        stage.scale = scale;
        const root = fgui.GRoot.inst;
        root.element.style.transformOrigin = '0 0';
        root.element.style.transform = `scale(${scale})`;
        root.setSize(visible.width, visible.height);
        return visible;
      }
    },
    audio: audio.service,
    locale: {systemLanguages: () => navigator.languages.length ? [...navigator.languages] : [navigator.language]},
    log: consoleLogger(),
    clipboard: createH5Clipboard(),
    net: {
      async fetch(url, init = {}): Promise<NetResponse> {
        const response = await fetch(url, init);
        return {status: response.status, ok: response.ok, text: () => response.text(), json: () => response.json() as Promise<unknown>};
      },
      webSocket(url): NetSocket {
        const socket = new WebSocket(url);
        const on = <K extends keyof WebSocketEventMap>(type: K, handler: (event: WebSocketEventMap[K]) => void): Unsubscribe => {
          socket.addEventListener(type, handler);
          return () => socket.removeEventListener(type, handler);
        };
        return {
          send: data => socket.send(data),
          close: () => socket.close(),
          onMessage: h => on('message', e => h(String(e.data))),
          onClose: h => on('close', e => h(e.code)),
          onOpen: h => on('open', () => h())
        };
      }
    }
  };
  h5InputModes.set(platform, {mode: () => currentInputMode, onChange: h => inputModes.add(h)});
  return platform;
}
