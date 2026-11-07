// node:assert/strict 的浏览器版（lgui test --browser 打包测试文件时换上它）：和 Node 的 strict 模式一样比较（Object.is、深比较时原型也要一样）。
// 只有常用的那些；用到没有的方法时打包报错（import 不到），不会悄悄当成通过。

export class AssertionError extends Error {
  constructor({message, actual, expected, operator}) {
    super(message);
    this.name = 'AssertionError';
    this.code = 'ERR_ASSERTION';
    this.actual = actual;
    this.expected = expected;
    this.operator = operator;
  }
}

// 把值写成一行字，报错时给人看。
function show(value, depth = 0) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[Function ${value.name || '(anonymous)'}]`;
  if (typeof value === 'symbol' || value === undefined || value === null || typeof value !== 'object') return String(value);
  if (depth > 3) return Array.isArray(value) ? '[Array]' : '[Object]';
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (Array.isArray(value)) return `[${value.map(v => show(v, depth + 1)).join(', ')}]`;
  if (value instanceof Map) return `Map(${value.size}) {${[...value].map(([k, v]) => `${show(k, depth + 1)} => ${show(v, depth + 1)}`).join(', ')}}`;
  if (value instanceof Set) return `Set(${value.size}) {${[...value].map(v => show(v, depth + 1)).join(', ')}}`;
  const keys = Object.keys(value);
  return `{${keys.map(k => `${k}: ${show(value[k], depth + 1)}`).join(', ')}}`;
}

function raise(message, actual, expected, operator, fallback) {
  if (message instanceof Error) throw message;
  throw new AssertionError({message: message ?? fallback, actual, expected, operator});
}

// 和 Node 的 isDeepStrictEqual 一样的规则：基本类型用 Object.is；对象要原型一样、自己的可枚举键一样、每个值深相等。
function isDeepEqual(a, b, seen = new Map()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
  if (a instanceof RegExp) return String(a) === String(b) && a.lastIndex === b.lastIndex;
  if (a instanceof Error && (a.message !== b.message || a.name !== b.name)) return false;
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) if (!b.has(key) || !isDeepEqual(value, b.get(key), seen)) return false;
    return true;
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    const rest = [...b];
    for (const value of a) {
      const i = rest.findIndex(other => isDeepEqual(value, other, seen));
      if (i < 0) return false;
      rest.splice(i, 1);
    }
    return true;
  }
  if (ArrayBuffer.isView(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const keysA = [...Object.keys(a), ...Object.getOwnPropertySymbols(a).filter(s => Object.prototype.propertyIsEnumerable.call(a, s))];
  const keysB = [...Object.keys(b), ...Object.getOwnPropertySymbols(b).filter(s => Object.prototype.propertyIsEnumerable.call(b, s))];
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) if (!Object.prototype.propertyIsEnumerable.call(b, key) || !isDeepEqual(a[key], b[key], seen)) return false;
  return true;
}

// throws、rejects 的第二个参数：错误类、正则（比对错误信息）、校验函数，或者一个对象（每个键都要对上，值可以是正则）。
function matchError(error, expected, message, operator) {
  if (expected === undefined) return;
  if (expected instanceof RegExp) {
    if (!expected.test(String(error?.message ?? error)) && !expected.test(String(error))) raise(message, error, expected, operator, `错误信息 ${show(String(error?.message ?? error))} 不匹配 ${expected}`);
    return;
  }
  if (typeof expected === 'function') {
    if (expected.prototype !== undefined && error instanceof expected) return;
    if (Error.isPrototypeOf(expected) || expected === Error) raise(message, error, expected, operator, `抛出的错误不是 ${expected.name}：${show(error)}`);
    if (expected.call({}, error) !== true) raise(message, error, expected, operator, `校验函数没有返回 true：${show(error)}`);
    return;
  }
  if (typeof expected === 'object' && expected !== null) {
    for (const key of Object.keys(expected)) {
      const want = expected[key], got = error?.[key];
      const ok = want instanceof RegExp && typeof got === 'string' ? want.test(got) : isDeepEqual(got, want);
      if (!ok) raise(message, error, expected, operator, `错误的 ${key} 是 ${show(got)}，期望 ${show(want)}`);
    }
  }
}

function ok(value, message) {
  if (!value) raise(message, value, true, '==', `期望是真值，实际是 ${show(value)}`);
}

const assert = (value, message) => ok(value, message);

Object.assign(assert, {
  AssertionError,
  ok,
  equal(actual, expected, message) { if (!Object.is(actual, expected)) raise(message, actual, expected, 'strictEqual', `期望严格相等：\n  实际 ${show(actual)}\n  期望 ${show(expected)}`); },
  notEqual(actual, expected, message) { if (Object.is(actual, expected)) raise(message, actual, expected, 'notStrictEqual', `期望不相等，实际都是 ${show(actual)}`); },
  deepEqual(actual, expected, message) { if (!isDeepEqual(actual, expected)) raise(message, actual, expected, 'deepStrictEqual', `期望深相等：\n  实际 ${show(actual)}\n  期望 ${show(expected)}`); },
  notDeepEqual(actual, expected, message) { if (isDeepEqual(actual, expected)) raise(message, actual, expected, 'notDeepStrictEqual', `期望不深相等，实际都是 ${show(actual)}`); },
  match(string, regexp, message) {
    if (typeof string !== 'string' || !regexp.test(string)) raise(message, string, regexp, 'match', `${show(string)} 不匹配 ${regexp}`);
  },
  doesNotMatch(string, regexp, message) {
    if (typeof string !== 'string' || regexp.test(string)) raise(message, string, regexp, 'doesNotMatch', `${show(string)} 不该匹配 ${regexp}`);
  },
  throws(fn, expected, message) {
    if (typeof expected === 'string') { message = expected; expected = undefined; }
    try { fn(); } catch (error) { matchError(error, expected, message, 'throws'); return; }
    raise(message, undefined, expected, 'throws', '期望抛错，但没有抛错');
  },
  doesNotThrow(fn, message) {
    try { fn(); } catch (error) { raise(typeof message === 'string' ? message : undefined, error, undefined, 'doesNotThrow', `不该抛错，却抛了：${show(error)}`); }
  },
  async rejects(promiseOrFn, expected, message) {
    if (typeof expected === 'string') { message = expected; expected = undefined; }
    try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn); } catch (error) { matchError(error, expected, message, 'rejects'); return; }
    raise(message, undefined, expected, 'rejects', '期望失败（reject），但成功了');
  },
  async doesNotReject(promiseOrFn, message) {
    try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn); } catch (error) { raise(typeof message === 'string' ? message : undefined, error, undefined, 'doesNotReject', `不该失败，却失败了：${show(error)}`); }
  },
  fail(message = '失败') { raise(message, undefined, undefined, 'fail', message); },
  ifError(value) { if (value !== null && value !== undefined) throw value instanceof Error ? value : new AssertionError({message: `ifError 收到 ${show(value)}`, actual: value, expected: null, operator: 'ifError'}); }
});
assert.strictEqual = assert.equal;
assert.notStrictEqual = assert.notEqual;
assert.deepStrictEqual = assert.deepEqual;
assert.notDeepStrictEqual = assert.notDeepEqual;
assert.strict = assert;

export default assert;
export {ok};
export const equal = assert.equal, notEqual = assert.notEqual, strictEqual = assert.strictEqual, notStrictEqual = assert.notStrictEqual;
export const deepEqual = assert.deepEqual, notDeepEqual = assert.notDeepEqual, deepStrictEqual = assert.deepStrictEqual, notDeepStrictEqual = assert.notDeepStrictEqual;
export const match = assert.match, doesNotMatch = assert.doesNotMatch, throws = assert.throws, doesNotThrow = assert.doesNotThrow;
export const rejects = assert.rejects, doesNotReject = assert.doesNotReject, ifError = assert.ifError, fail = assert.fail, strict = assert;
