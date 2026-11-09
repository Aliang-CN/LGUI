// lgui.Model：数据加规则。内部用 zustand vanilla；游戏代码看不到 zustand。
import {createStore} from './vendor/zustand-vanilla';
import type {Readable} from './types';
import {ErrorList} from './errors';

/** Model：数据加规则。 */
export type Model<State extends object, Rules extends object> = Readable<State> & Rules & {
  /** 只改给出的字段。 */
  set(partial: Partial<State>): void;
};

const counts = new WeakMap<object, () => number>();

/** 内部用：一个 Model（或请求对象）当前有几个订阅。 */
export function listenerCount(source: object): number {
  return counts.get(source)?.() ?? 0;
}

export function createModel<State extends object, Rules extends object>(initial: State, rules?: (set: (partial: Partial<State>) => void, get: () => State) => Rules): Model<State, Rules> {
  const store = createStore<State>(() => ({...initial}));
  const listeners = new Set<() => void>();
  const set = (partial: Partial<State>): void => store.setState(partial);
  const get = (): State => store.getState();
  // 一个订阅者（比如某个界面的绑定）出错不影响其他订阅者，全部通知完再抛出第一个错误。
  store.subscribe(() => {
    const errors = new ErrorList();
    for (const listener of [...listeners]) errors.run(listener);
    errors.throwFirst();
  });
  const base = {
    get,
    set,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
  const model = Object.assign(base, rules ? rules(set, get) : {}) as Model<State, Rules>;
  counts.set(model, () => listeners.size);
  return model;
}
