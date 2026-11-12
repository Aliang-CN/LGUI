// 网页端宿主入口（import { defineWebHost } from 'lgui/host'）：供可选的 host/main.ts 挂载三维画布与网页专属平台服务。
// src/ 下的跨端游戏代码不引入本模块；画布由框架创建并通过 stage.canvas 交入，宿主和游戏代码都不必直接访问 document。
import type {AudioService, ClipboardService, Insets, KeyInput, Logger, Unsubscribe} from './core/index';
import type {InputMode} from './mvc/types';

export type {AudioService, ClipboardService, Insets, InputMode, KeyInput, Logger, Unsubscribe};

/** 网页画布当前的视口尺寸、设备像素比与安全区（单位均为 CSS 像素）。 */
export interface WebStageSize {
  /** 视口宽度（CSS 像素）。 */
  width: number;
  /** 视口高度（CSS 像素）。 */
  height: number;
  /** 当前设备像素比（devicePixelRatio）。 */
  pixelRatio: number;
  /** 四边安全区内边距（CSS 像素，上右下左）。 */
  safeArea: Insets;
}

/** 分流给三维场景的一次指针事件（坐标为视口 CSS 像素，与 stage.size() 一致）。 */
export interface WebPointerInput {
  /** 按下、移动、抬起或取消（切入 'ui' 模式时未抬起的场景指针会收到 'cancel'）。 */
  type: 'down' | 'move' | 'up' | 'cancel';
  /** 指针 ID（按触点独立分流，支持一指点界面控件、另一指拖三维场景）。 */
  pointerId: number;
  /** 输入设备类型。 */
  pointerType: 'mouse' | 'touch' | 'pen';
  /** 视口横坐标（clientX，CSS 像素）。 */
  x: number;
  /** 视口纵坐标（clientY，CSS 像素）。 */
  y: number;
  /** 触发事件的按键编号（鼠标左键 0、中键 1、右键 2）。 */
  button: number;
  /** 当前按住的按键位掩码。 */
  buttons: number;
  /** 事件发生时间戳（毫秒）。 */
  time: number;
}

/** 分流给三维场景的一次滚轮事件（坐标为视口 CSS 像素）。 */
export interface WebWheelInput {
  /** 视口横坐标（clientX，CSS 像素）。 */
  x: number;
  /** 视口纵坐标（clientY，CSS 像素）。 */
  y: number;
  /** 横向滚动量（像素）。 */
  deltaX: number;
  /** 纵向滚动量（像素）。 */
  deltaY: number;
}

/** 按当前激活界面的 inputMode 分流后的场景输入接口。 */
export interface WebStageInput {
  /** 当前输入分流模式（'ui' | 'game' | 'all'）。 */
  mode(): InputMode;
  /** 输入分流模式变化时调用，返回取消监听函数。 */
  onModeChange(handler: (mode: InputMode) => void): Unsubscribe;
  /** 场景指针事件（'ui' 模式不派发；'game' 模式只派发落在界面控件之外的触点；'all' 模式全部派发）。 */
  onPointer(handler: (event: WebPointerInput) => void): Unsubscribe;
  /** 场景滚轮事件（'ui' 模式不派发；'game' 模式落在界面控件上时不派发；'all' 模式全部派发）。 */
  onWheel(handler: (event: WebWheelInput) => void): Unsubscribe;
  /** 场景键盘事件（输入框聚焦或输入法组字时不派发；'ui' 模式不派发；'game' 模式跳过已被激活界面 keys 消费的按键）。 */
  onKey(handler: (event: KeyInput) => void): Unsubscribe;
}

/** 框架托管的网页舞台对象，传给 defineWebHost({ mount(stage) })。 */
export interface WebStage {
  /** 框架创建并垫在界面底下的全屏画布（<canvas class="lgui-canvas">，z-index: 0）。 */
  readonly canvas: HTMLCanvasElement;
  /** 读取当前视口尺寸、设备像素比与安全区（CSS 像素）。 */
  size(): WebStageSize;
  /** 读取当前四边安全区内边距（CSS 像素）。 */
  safeArea(): Insets;
  /** 视口尺寸、方向、设备像素比或安全区变化时调用，返回取消监听函数。 */
  onResize(handler: (size: WebStageSize) => void): Unsubscribe;
  /** 每帧调用一次，参数是距上一帧的毫秒数，返回取消监听函数。 */
  onFrame(handler: (deltaMs: number) => void): Unsubscribe;
  /** 按激活界面的 inputMode 分流后的场景输入。 */
  readonly input: WebStageInput;
}

/** host/main.ts 的网页宿主定义。 */
export interface WebHostDefinition {
  /** 网页端自定义声音出口（如 Web Audio 代码合成器）；在浏览器环境下覆盖默认声音出口。 */
  audio?: AudioService;
  /** 网页端自定义日志出口。 */
  log?: Logger;
  /** 网页端自定义剪贴板出口。 */
  clipboard?: ClipboardService;
  /** 网页端服务注册（如与三维场景联动的 Service 实现），与 app.services 合并（同名时 host 优先）。 */
  services?: Record<string, () => object>;
  /** 框架建好底层画布并初始化运行时后、调用 app.start() 前执行；可返回卸载清理函数。 */
  mount?(stage: WebStage): void | (() => void) | Promise<void | (() => void)>;
}

/** 定义网页端宿主（写在工程根目录的 host/main.ts 并作为默认导出）。 */
export function defineWebHost(definition: WebHostDefinition): WebHostDefinition {
  return definition;
}
