// lgui test --name：给 node:test 包一层（只在写了 --name 时换上）。名字里不含 --name 的测试照样登记，但标成跳过并写明原因，
// lgui test 才数得出按名字筛掉了几个（node 自己的 --test-name-pattern 筛掉的测试不出现在结果里）。
// 测试的名字连同所在 describe 的名字一起比：describe 的名字含 --name 时，里面的测试都跑。
const real = process.getBuiltinModule('node:test');
const pattern = process.env.LGUI_TEST_NAME ?? '';

/** 被 --name 筛掉的测试的跳过原因（lgui test 按这个前缀认出来）。 */
export const FILTERED = '不匹配 --name';

const suites = [];
const matches = name => [...suites, name].some(n => typeof n === 'string' && n.includes(pattern));

// test([名字][, 选项][, 函数]) 的几种写法。
function parse(args) {
  let name, options = {}, fn;
  for (const a of args) {
    if (typeof a === 'string') name = a;
    else if (typeof a === 'function') fn = a;
    else if (a && typeof a === 'object') options = a;
  }
  return {name: name ?? fn?.name, options, fn};
}

function wrapTest(register) {
  const call = (args, extra) => {
    const {name, options, fn} = parse(args);
    const o = {...options, ...extra};
    if (pattern && !matches(name)) o.skip = `${FILTERED} ${pattern}`;
    return name === undefined ? register(o, fn) : register(name, o, fn);
  };
  const wrapped = (...args) => call(args, {});
  wrapped.skip = (...args) => call(args, {skip: true});
  wrapped.todo = (...args) => call(args, {todo: true});
  wrapped.only = (...args) => call(args, {only: true});
  return wrapped;
}

// describe 的回调是同步登记的：登记期间记着 describe 的名字，里面的测试一起比。
function wrapSuite(register) {
  const call = (args, extra) => {
    const {name, options, fn} = parse(args);
    const body = function (...a) { suites.push(name); try { return fn?.apply(this, a); } finally { suites.pop(); } };
    return name === undefined ? register({...options, ...extra}, body) : register(name, {...options, ...extra}, body);
  };
  const wrapped = (...args) => call(args, {});
  wrapped.skip = (...args) => call(args, {skip: true});
  wrapped.todo = (...args) => call(args, {todo: true});
  wrapped.only = (...args) => call(args, {only: true});
  return wrapped;
}

export const test = wrapTest(real.test);
export const it = wrapTest(real.it);
export const describe = wrapSuite(real.describe);
export const suite = wrapSuite(real.suite);
export const {before, after, beforeEach, afterEach, mock, run, snapshot} = real;
Object.assign(test, {test, it, describe, suite, before, after, beforeEach, afterEach, mock, run, snapshot});
export default test;
