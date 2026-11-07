// node:test 的浏览器版（lgui test --browser 打包测试文件时换上它）。测试文件在页面里加载时只登记测试；
// lgui test 读出测试清单（window.__lguiTesting.list()），再每个测试开一个新页面调用 window.__lguiTesting.run(序号)。
// 支持 test / it、describe / suite（同步的回调）、skip / todo、before / after / beforeEach / afterEach 和测试上下文的
// name、passed、error、skip()、todo()、diagnostic()；用到不支持的写法（子测试、mock、done 回调……）当场报 LGUI-RT-263，不会悄悄跳过。
// 每个测试一个页面，所以 before、after 在每个测试的页面里各跑一次。

const unsupported = what => {
  const error = new Error(`LGUI-RT-263  lgui test --browser 不支持 ${what}。  → 浏览器里的测试只用 test / describe、before / after / beforeEach / afterEach 和 node:assert/strict；需要 ${what} 的测试不加 --browser，在 headless 里跑。`);
  error.code = 'LGUI-RT-263';
  return error;
};

const newSuite = (name, parent, options = {}) => ({name, parent, skip: options.skip ?? parent?.skip ?? false, todo: options.todo ?? parent?.todo ?? false, before: [], after: [], beforeEach: [], afterEach: []});
const root = newSuite('', null);
let current = root;
const tests = [];

// test([名字][, 选项][, 函数]) 的几种写法。
function parse(args) {
  let name, options = {}, fn;
  for (const a of args) {
    if (typeof a === 'string') name = a;
    else if (typeof a === 'function') fn = a;
    else if (a && typeof a === 'object') options = a;
  }
  return {name: name ?? fn?.name ?? '<anonymous>', options, fn};
}

const suitesOf = suite => { const chain = []; for (let s = suite; s && s !== root; s = s.parent) chain.unshift(s); return chain; };

function add(args, extra) {
  const {name, options, fn} = parse(args);
  const o = {...options, ...extra};
  if (o.concurrency !== undefined || o.timeout !== undefined || o.plan !== undefined) {
    // 这些选项浏览器里不生效：直接报错，别让人以为生效了
    for (const key of ['concurrency', 'timeout', 'plan']) if (o[key] !== undefined) throw unsupported(`测试选项 ${key}`);
  }
  const chain = suitesOf(current);
  tests.push({
    name, fullName: [...chain.map(s => s.name), name].join(' > '), suite: current, fn,
    skip: o.skip ?? current.skip, todo: o.todo ?? current.todo
  });
}

export function test(...args) { add(args, {}); }
test.skip = (...args) => add(args, {skip: true});
test.todo = (...args) => add(args, {todo: true});
test.only = (...args) => add(args, {}); // 和不加 --test-only 的 node --test 一样：only 不起作用
export const it = test;

export function describe(...args) {
  const {name, options, fn} = parse(args);
  const suite = newSuite(name, current, options);
  const previous = current;
  current = suite;
  try {
    const result = fn?.();
    if (result && typeof result.then === 'function') throw unsupported('async 的 describe 回调');
  } finally {
    current = previous;
  }
}
describe.skip = (...args) => { const {name, options, fn} = parse(args); describe(name, {...options, skip: true}, fn); };
describe.todo = (...args) => { const {name, options, fn} = parse(args); describe(name, {...options, todo: true}, fn); };
describe.only = describe;
export const suite = describe;

export const before = fn => { current.before.push(fn); };
export const after = fn => { current.after.push(fn); };
export const beforeEach = fn => { current.beforeEach.push(fn); };
export const afterEach = fn => { current.afterEach.push(fn); };
export const mock = new Proxy({}, {get: () => { throw unsupported('mock'); }});
export const run = () => { throw unsupported('run()'); };

Object.assign(test, {test, it, describe, suite, before, after, beforeEach, afterEach, mock, run});
export default test;

const describeError = error => ({
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack ?? error.message : String(error),
  code: error?.code
});

// 测试上下文（第一个参数 t）。
function context(entry, notes) {
  const state = {skipped: null, todo: null, after: []};
  const ctx = {
    name: entry.name,
    fullName: entry.fullName,
    signal: new AbortController().signal,
    passed: undefined,
    error: undefined,
    skip(message) { state.skipped = message ?? ''; },
    todo(message) { state.todo = message ?? ''; },
    diagnostic(message) { notes.push(String(message)); },
    after(fn) { state.after.push(fn); },
    test() { throw unsupported('子测试（t.test）'); },
    plan() { throw unsupported('t.plan'); },
    waitFor() { throw unsupported('t.waitFor'); },
    runOnly() { throw unsupported('t.runOnly'); }
  };
  Object.defineProperty(ctx, 'mock', {get: () => { throw unsupported('t.mock'); }});
  Object.defineProperty(ctx, 'assert', {get: () => { throw unsupported('t.assert（改用 import assert from \'node:assert/strict\'）'); }});
  return {ctx, state};
}

/** 跑第 index 个测试：before（这个页面里第一次）→ beforeEach（外层到里层）→ 测试 → afterEach（里层到外层）→ t.after → after。 */
async function runTest(index) {
  const entry = tests[index];
  if (!entry) throw new Error(`没有第 ${index} 个测试`);
  const notes = [];
  if (entry.skip) return {status: 'skip', reason: entry.skip === true ? '' : String(entry.skip), notes};
  const chain = [root, ...suitesOf(entry.suite)];
  const {ctx, state} = context(entry, notes);
  let error = null;
  try {
    for (const s of chain) for (const hook of s.before) await hook(ctx);
    for (const s of chain) for (const hook of s.beforeEach) await hook(ctx);
    if (entry.fn) {
      if (entry.fn.length >= 2) throw unsupported('done 回调（测试函数的第二个参数）');
      await entry.fn(ctx);
    }
  } catch (e) {
    error = e;
  }
  ctx.passed = !error;
  ctx.error = error ?? undefined;
  const later = [...[...chain].reverse().flatMap(s => s.afterEach), ...state.after, ...[...chain].reverse().flatMap(s => s.after)];
  for (const hook of later) {
    try { await hook(ctx); } catch (e) { error ??= e; }
  }
  const todo = entry.todo || state.todo !== null;
  if (todo) return {status: 'todo', reason: state.todo ?? (entry.todo === true ? '' : String(entry.todo)), error: error ? describeError(error) : null, notes};
  if (state.skipped !== null && !error) return {status: 'skip', reason: state.skipped, notes};
  return error ? {status: 'fail', error: describeError(error), notes} : {status: 'pass', notes};
}

globalThis.__lguiTesting = {
  list: () => tests.map((t, index) => ({index, name: t.name, fullName: t.fullName, skip: Boolean(t.skip), todo: Boolean(t.todo)})),
  run: runTest
};
