// 给 FairyGUI-dom 挂钩子的小工具：先调上游原方法，再补我们的改动；不整段替换。
// 装的时候检查要挂的方法、属性、字段还在不在，不在就报 LGUI-RT-230，写清上游哪里改了、哪个补丁要重看。
import {LgRuntimeError} from '../../../core/index';

const ledger = (patch: number): string => `plugin/framework/backends/h5/vendor/PATCHES.md 第 ${patch} 条`;

/** 上游没有要挂钩子的东西了。 */
export function missing(patch: number, target: string): LgRuntimeError {
  return new LgRuntimeError('LGUI-RT-230', `FairyGUI-dom 补丁 ${patch} 装不上：上游没有 ${target} 了（上游代码改过）。`, `对照 ${ledger(patch)} 重看这个补丁：找到上游现在的写法，改 fairygui-patches/ 里的钩子。`);
}

type Method<Self> = (this: Self, ...args: unknown[]) => unknown;

function methodOf<Self>(patch: number, owner: object, label: string, name: string): Method<Self> {
  const value: unknown = Reflect.get(owner, name);
  if (typeof value !== 'function') throw missing(patch, `${label}.${name}()`);
  return value as Method<Self>;
}

/** 方法 name 之后补一段：先调上游原方法，再调 extra（拿到参数和原方法的返回值）。 */
export function after<Self>(patch: number, owner: object, label: string, name: string, extra: (self: Self, args: unknown[], result: unknown) => void): void {
  const original = methodOf<Self>(patch, owner, label, name);
  Reflect.set(owner, name, function (this: Self, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    extra(this, args, result);
    return result;
  });
}

/** 方法 name 之前先做一段，before 的返回值交给 then（在原方法之后调用）。原方法照常调用。 */
export function around<Self, Saved>(patch: number, owner: object, label: string, name: string, before: (self: Self, args: unknown[]) => Saved, then: (self: Self, saved: Saved) => void): void {
  const original = methodOf<Self>(patch, owner, label, name);
  Reflect.set(owner, name, function (this: Self, ...args: unknown[]): unknown {
    const saved = before(this, args);
    const result = original.apply(this, args);
    then(this, saved);
    return result;
  });
}

/** 属性的 setter 之后补一段（先调上游 setter）；getter 给了就换成我们的（上游的是空实现时用）。 */
export function accessor<Self>(patch: number, proto: object, label: string, name: string, hooks: {get?: (self: Self) => unknown; set?: (self: Self, value: unknown) => void}): void {
  let descriptor: PropertyDescriptor | undefined;
  for (let o: object | null = proto; o && !descriptor; o = Object.getPrototypeOf(o) as object | null) descriptor = Object.getOwnPropertyDescriptor(o, name);
  const get = descriptor?.get, set = descriptor?.set;
  if (!get || !set) throw missing(patch, `${label}.${name} 属性`);
  Object.defineProperty(proto, name, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    get: hooks.get ? function (this: Self): unknown { return hooks.get?.(this); } : get,
    set(this: Self, value: unknown): void {
      set.call(this, value);
      hooks.set?.(this, value);
    }
  });
}

/** 加一个上游没有的方法。上游已经有同名的就报 LGUI-RT-231（上游可能已经实现了，补丁要重看）。 */
export function add(patch: number, owner: object, label: string, name: string, value: unknown): void {
  if (name in owner) throw new LgRuntimeError('LGUI-RT-231', `FairyGUI-dom 补丁 ${patch} 要加的 ${label}.${name} 上游已经有了。`, `上游可能已经实现了同样的功能：对照 ${ledger(patch)} 决定改用上游的，还是去掉这个补丁。`);
  Object.defineProperty(owner, name, {value, writable: true, configurable: true});
}

/** 检查对象上有这些字段（装钩子时拿一个新建的对象来查）。 */
export function fields(patch: number, object: object, label: string, names: readonly string[]): void {
  for (const name of names) if (!(name in object)) throw missing(patch, `${label} 的字段 ${name}`);
}

/** 字段不是构造函数里设的（新建的对象上还没有，fields 查不到）：查上游设它的那个 setter 或方法里还写着 `this.字段 =`。
 * 只查访问器在不在不够——访问器还在、背后的字段改了名，钩子读到的就一直是 undefined。要在装钩子之前查：有的 setter 装上钩子就换成我们的了。 */
export function assigned(patch: number, proto: object, label: string, member: string, name: string): void {
  let descriptor: PropertyDescriptor | undefined;
  for (let o: object | null = proto; o && !descriptor; o = Object.getPrototypeOf(o) as object | null) descriptor = Object.getOwnPropertyDescriptor(o, member);
  const code: unknown = descriptor?.set ?? descriptor?.value;
  const writes = typeof code === 'function' && new RegExp(`\\bthis\\.${name}\\s*=(?!=)`).test(Function.prototype.toString.call(code));
  if (!writes) throw missing(patch, `${label}.${member} 里设的字段 ${name}`);
}

/** 只装一次。装不上（抛了 LGUI-RT-230 / 231）以后再调用，原样再抛同一个错、不再装：已经挂上的钩子不会被包第二层。 */
export function once(install: () => void): () => void {
  let state: {error: unknown} | 'done' | null = null;
  return () => {
    if (state === 'done') return;
    if (state) throw state.error;
    try {
      install();
      state = 'done';
    } catch (error) {
      state = {error};
      throw error;
    }
  };
}

/** 读一个字段（钩子里用；装的时候已经查过它在）。 */
export function field<T>(object: object, name: string): T { return Reflect.get(object, name) as T; }
