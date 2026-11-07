// format.compact：数字缩写，按当前语言（中文 1.6万、英文 16.3K）。有 Intl 时用它，没有时用内置规则，两边结果一样。
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFramework} from '../../helpers/framework.mjs';

const samples = [0, 999, 1234, 9999, 16300, 16349, 99999, 999950, 1234567, 123456789, 1.5e9, -16300, 0.5];
const expected = {
  'zh-CN': ['0', '999', '1234', '9999', '1.6万', '1.6万', '10万', '100万', '123.5万', '1.2亿', '15亿', '-1.6万', '0.5'],
  en: ['0', '999', '1.2K', '10K', '16.3K', '16.3K', '100K', '1M', '1.2M', '123.5M', '1.5B', '-16.3K', '0.5']
};

async function withIntl(present, run) {
  const saved = globalThis.Intl;
  if (!present) globalThis.Intl = undefined;
  try { return await run(); } finally { globalThis.Intl = saved; }
}

test('有 Intl：中文按万、亿，英文按 K、M、B，最多一位小数', async () => {
  const {format, setTexts} = await loadFramework();
  for (const language of ['zh-CN', 'en']) {
    setTexts({}, language);
    assert.deepEqual(samples.map(n => format.compact(n)), expected[language], language);
  }
});

test('没有 Intl（比如 Unity 的脚本环境）：内置规则和 Intl 的结果一样', async () => {
  const {format, setTexts} = await loadFramework();
  await withIntl(false, () => {
    for (const language of ['zh-CN', 'en']) {
      setTexts({}, language);
      assert.deepEqual(samples.map(n => format.compact(n)), expected[language], language);
    }
    setTexts({}, 'ja');
    assert.deepEqual([format.compact(16300), format.compact(1.2e8)], ['1.6万', '1.2億']);
    setTexts({}, 'zh-TW');
    assert.equal(format.compact(16300), '1.6萬');
  });
});
