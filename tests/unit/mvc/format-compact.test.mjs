// format.compact：数字缩写，按当前语言（中文 1.6万、英文 16.3K）。三端都只用内置规则（不用 Intl），同一个数各端显示一样。
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFramework} from '../../helpers/framework.mjs';

const samples = [0, 999, 1234, 9999, 16300, 16349, 99999, 999950, 1234567, 123456789, 1.5e9, -16300, 0.5, 999.95, 9999.95, 999999.95, -999.95, 99999.95];
const expected = {
  // 最后 5 个是临界值：四舍五入到一位小数后够到下一个单位就进位（999.95 → 1K，中文 9999.95 → 1万）。
  'zh-CN': ['0', '999', '1234', '9999', '1.6万', '1.6万', '10万', '100万', '123.5万', '1.2亿', '15亿', '-1.6万', '0.5', '1000', '1万', '100万', '-1000', '10万'],
  en: ['0', '999', '1.2K', '10K', '16.3K', '16.3K', '100K', '1M', '1.2M', '123.5M', '1.5B', '-16.3K', '0.5', '1K', '10K', '1M', '-1K', '100K']
};

async function withIntl(present, run) {
  const saved = globalThis.Intl;
  if (!present) globalThis.Intl = undefined;
  try { return await run(); } finally { globalThis.Intl = saved; }
}

test('有没有 Intl 结果都一样（不用 Intl）：中文按万、亿，英文按 K、M、B，最多一位小数，临界值进位', async () => {
  const {format, setTexts} = await loadFramework();
  for (const present of [true, false]) {
    await withIntl(present, () => {
      for (const language of ['zh-CN', 'en']) {
        setTexts({}, language);
        assert.deepEqual(samples.map(n => format.compact(n)), expected[language], `${language}，${present ? '有' : '没有'} Intl`);
      }
      setTexts({}, 'ja');
      assert.deepEqual([format.compact(16300), format.compact(1.2e8)], ['1.6万', '1.2億']);
      setTexts({}, 'zh-TW');
      assert.equal(format.compact(16300), '1.6萬');
      setTexts({}, 'de');
      assert.equal(format.compact(16300), '16.3K', '其余语言按 K、M、B（不随 Intl 变成 16.300）');
    });
  }
});
