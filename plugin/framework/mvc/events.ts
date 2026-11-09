// 广播站：通知「发生了一件事」。先声明事件名和参数类型，再广播；谁关心谁收听。
import type {EventDef, ViewEvent} from './lgui';
import type {InputMode, InputType, Orientation} from './types';
import {LgRuntimeError} from '../core/index';
import {ErrorList} from './errors';

const names = new Set<string>();

/** 声明一个事件。同名事件只能声明一次。 */
export function defineEvent<P>(name: string): EventDef<P> {
  if (names.has(name)) throw new LgRuntimeError('LGUI-RT-040', `事件 ${name} 已经声明过了。`, '换一个名字，或者 import 已经声明的那个。');
  names.add(name);
  return {name};
}

type Handler = (payload: never) => void;

/** 全局的广播站。 */
export class EventBus {
  private handlers = new Map<EventDef<unknown>, Set<Handler>>();

  /** 收听，返回取消函数。 */
  on<P>(event: EventDef<P>, handler: (payload: P) => void): () => void {
    let set = this.handlers.get(event as EventDef<unknown>);
    if (!set) { set = new Set(); this.handlers.set(event as EventDef<unknown>, set); }
    set.add(handler as Handler);
    return () => { set?.delete(handler as Handler); };
  }

  /** 广播。收听函数出错不影响其他收听者：错误交给 onError；不传 onError 时全部收听者调完再抛出第一个错误。 */
  emit<P>(event: EventDef<P>, payload: P, onError?: (error: unknown) => void): void {
    const set = this.handlers.get(event as EventDef<unknown>);
    if (!set) return;
    const errors = new ErrorList();
    for (const handler of [...set]) {
      try { (handler as (payload: P) => void)(payload); } catch (error) { (onError ?? errors.add)(error); }
    }
    errors.throwFirst();
  }

  /** 某个事件当前有几个收听者（给测试和调试用）。 */
  count(event: EventDef<unknown>): number { return this.handlers.get(event)?.size ?? 0; }
}

export const bus = new EventBus();

const builtin = <P>(name: string): EventDef<P> => defineEvent<P>(`lgui.${name}`);

/** 框架自己广播的事件（lgui.events）。 */
export const builtinEvents = {
  /** 界面打开了。 */
  viewOpened: builtin<ViewEvent>('viewOpened'),
  /** 界面关闭了。 */
  viewClosed: builtin<ViewEvent>('viewClosed'),
  /** 界面被全屏界面盖住了。 */
  viewCovered: builtin<ViewEvent>('viewCovered'),
  /** 界面重新露出来了。 */
  viewRevealed: builtin<ViewEvent>('viewRevealed'),
  /** 屏幕方向变了。 */
  orientationChange: builtin<{orientation: Orientation}>('orientationChange'),
  /** 语言变了。 */
  languageChange: builtin<{language: string}>('languageChange'),
  /** 输入设备类型变了。 */
  inputTypeChange: builtin<{inputType: InputType}>('inputTypeChange'),
  /** 激活界面的输入模式变了（游戏场景代码收听它）。 */
  inputModeChange: builtin<{inputMode: InputMode}>('inputModeChange')
};
