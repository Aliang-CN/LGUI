// 网页端三维画布舞台实现：由框架创建 <canvas class="lgui-canvas"> 垫在 <fgui-stage> 底下，
// 同步视口尺寸、DPR、安全区，并按激活界面的 inputMode（'ui' | 'game' | 'all'）分流多指触控、滚轮和键盘事件。
import * as fgui from './vendor/fairygui.module.js';
import type {Backend, KeyInput} from '../../core/index';
import type {UIManager} from '../../mvc/ui/manager';
import type {WebPointerInput, WebStage, WebStageSize, WebWheelInput} from '../../host';
import {Handlers, h5InputModeState, keyName} from './platform/index';

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function hitUi(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  const stageEl = fgui.GRoot.inst.element;
  return target !== stageEl && stageEl.contains(target);
}

function toWebPointer(ev: PointerEvent, type: WebPointerInput['type']): WebPointerInput {
  const pointerType = ev.pointerType === 'touch' || ev.pointerType === 'pen' ? ev.pointerType : 'mouse';
  return {
    type,
    pointerId: ev.pointerId,
    pointerType,
    x: ev.clientX,
    y: ev.clientY,
    button: ev.button,
    buttons: ev.buttons,
    time: ev.timeStamp
  };
}

function sameSize(a: WebStageSize, b: WebStageSize): boolean {
  return a.width === b.width
    && a.height === b.height
    && a.pixelRatio === b.pixelRatio
    && a.safeArea.top === b.safeArea.top
    && a.safeArea.right === b.safeArea.right
    && a.safeArea.bottom === b.safeArea.bottom
    && a.safeArea.left === b.safeArea.left;
}

/** 创建底层画布并挂接输入分流，返回交给 host.mount(stage) 的 WebStage。 */
export function attachWebStage(backend: Backend, ui: UIManager): WebStage {
  const existing = document.querySelector('canvas.lgui-canvas');
  const canvas = existing instanceof HTMLCanvasElement ? existing : document.createElement('canvas');
  canvas.className = 'lgui-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none;';
  if (!canvas.parentNode) document.body.insertBefore(canvas, document.body.firstChild);

  const modeState = h5InputModeState(backend.platform);
  const resizes = new Handlers<WebStageSize>();
  const pointers = new Handlers<WebPointerInput>();
  const wheels = new Handlers<WebWheelInput>();
  const keys = new Handlers<KeyInput>();

  const readSize = (): WebStageSize => {
    const s = backend.platform.screen.size();
    return {
      width: s.width,
      height: s.height,
      pixelRatio: window.devicePixelRatio || 1,
      safeArea: backend.platform.screen.safeArea()
    };
  };

  let lastSize = readSize();
  const emitResize = (): void => {
    const next = readSize();
    if (sameSize(lastSize, next)) return;
    lastSize = next;
    resizes.emit(next, reportError);
  };
  backend.platform.screen.onResize(() => emitResize());

  const watchDpr = (): void => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => {
      emitResize();
      watchDpr();
    }, {once: true});
  };
  watchDpr();

  const activePointers = new Map<number, WebPointerInput>();
  const uiPointers = new Set<number>();
  const activeKeys = new Set<string>();

  const cancelSceneInputs = (): void => {
    const now = performance.now();
    for (const [id, prev] of [...activePointers]) {
      activePointers.delete(id);
      pointers.emit({...prev, type: 'cancel', buttons: 0, time: now}, reportError);
    }
    for (const k of [...activeKeys]) {
      activeKeys.delete(k);
      keys.emit({type: 'up', key: k, repeat: false}, reportError);
    }
  };

  const syncCanvasPointerEvents = (mode: 'ui' | 'game' | 'all'): void => {
    canvas.style.pointerEvents = mode === 'ui' ? 'none' : 'auto';
    if (mode === 'ui') cancelSceneInputs();
  };
  syncCanvasPointerEvents(modeState.mode());
  modeState.onChange(mode => syncCanvasPointerEvents(mode));
  window.addEventListener('blur', () => {
    uiPointers.clear();
    cancelSceneInputs();
  });

  window.addEventListener('pointerdown', ev => {
    const mode = modeState.mode();
    if (mode === 'ui') return;
    if (mode === 'game' && hitUi(ev.target)) {
      uiPointers.add(ev.pointerId);
      return;
    }
    const input = toWebPointer(ev, 'down');
    activePointers.set(ev.pointerId, input);
    pointers.emit(input, reportError);
  });

  window.addEventListener('pointermove', ev => {
    if (uiPointers.has(ev.pointerId)) return;
    if (activePointers.has(ev.pointerId)) {
      const input = toWebPointer(ev, 'move');
      activePointers.set(ev.pointerId, input);
      pointers.emit(input, reportError);
      return;
    }
    const mode = modeState.mode();
    if (mode === 'ui') return;
    if (mode === 'game' && hitUi(ev.target)) return;
    pointers.emit(toWebPointer(ev, 'move'), reportError);
  });

  const endPointer = (ev: PointerEvent, kind: 'up' | 'cancel'): void => {
    if (uiPointers.delete(ev.pointerId)) return;
    if (!activePointers.delete(ev.pointerId)) return;
    pointers.emit(toWebPointer(ev, kind), reportError);
  };
  window.addEventListener('pointerup', ev => endPointer(ev, 'up'));
  window.addEventListener('pointercancel', ev => endPointer(ev, 'cancel'));

  window.addEventListener('wheel', ev => {
    const mode = modeState.mode();
    if (mode === 'ui') return;
    if (mode === 'game' && hitUi(ev.target)) return;
    wheels.emit({x: ev.clientX, y: ev.clientY, deltaX: ev.deltaX, deltaY: ev.deltaY}, reportError);
  }, {passive: true});

  let modeBeforeKey: 'ui' | 'game' | 'all' = modeState.mode();
  window.addEventListener('keydown', () => { modeBeforeKey = modeState.mode(); }, true);
  window.addEventListener('keydown', ev => {
    if (backend.platform.textInput.isComposing() || isTextInputFocused()) return;
    if (modeBeforeKey === 'ui') return;
    if (modeBeforeKey === 'game' && !ev.repeat && ui.lastKeyConsumed) return;
    const k = keyName(ev);
    activeKeys.add(k);
    keys.emit({type: 'down', key: k, repeat: ev.repeat}, reportError);
  });
  window.addEventListener('keyup', ev => {
    const k = keyName(ev);
    if (!activeKeys.delete(k)) return;
    keys.emit({type: 'up', key: k, repeat: false}, reportError);
  });

  return {
    canvas,
    size: () => {
      const next = readSize();
      lastSize = next;
      return next;
    },
    safeArea: () => backend.platform.screen.safeArea(),
    onResize: h => resizes.add(h),
    onFrame: h => backend.platform.time.onFrame(h),
    input: {
      mode: () => modeState.mode(),
      onModeChange: h => modeState.onChange(h),
      onPointer: h => pointers.add(h),
      onWheel: h => wheels.add(h),
      onKey: h => keys.add(h)
    }
  };
}
