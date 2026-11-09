// 文字样式的检查：描边 + 投影偏移不超过字号的 7.5%（LGUI-UI-081），不写斜体（LGUI-UI-082）。网页和 Unity 拒绝同样的写法。
// 上限的来历见 references/ui-spec.md 第 8 节：Unity 用 TextMesh Pro 的 SDF 画项目字体，64pt 采样、图集留边 6 像素，
// 字形外只有 6 × (1 - 0.75 / 4) ≈ 4.9 个图集像素能画描边和投影，折成设计像素约是字号的 7.6%，取 7.5%。
import path from 'node:path';
import {finding} from './program.mjs';

export const EFFECT_RATIO = 0.075;
const DEFAULT_FONT = 12; // XML 里不写 fontSize 时 FairyGUI 用 12 号
const TEXTS = ['text', 'richtext', 'inputtext'];
const UBB_ITALIC = /\[i\]/i;

/** 文字控件的描边和投影偏移（设计像素）：写了 strokeColor 才有描边（不写 strokeSize 是 1），写了 shadowColor 才有投影（不写 shadowOffset 是 1,1）。 */
export function textEffects(attrs) {
  const stroke = attrs.strokeColor ? Number(attrs.strokeSize ?? 1) : 0;
  const [x, y] = (attrs.shadowOffset ?? '1,1').split(',').map(Number);
  const shadow = attrs.shadowColor ? Math.max(Math.abs(x || 0), Math.abs(y || 0)) : 0;
  return {stroke, shadow, fontSize: Number(attrs.fontSize ?? DEFAULT_FONT)};
}

const round = n => Math.round(n * 100) / 100;

export function textStyleRules({root, model, tables}) {
  const out = [];
  const rel = file => path.relative(root, file).split(path.sep).join('/');
  const italicFix = '删掉斜体：去掉 italic="true" 和富文本里的 [i]…[/i]。要强调就换颜色、加粗（bold="true"），或者放一个斜体的字体文件当另一个字体（ui/fonts/）。';
  for (const pkg of model.packages) {
    for (const component of pkg.components) {
      // 控件和它里面的节点（按钮实例的 <Button>、齿轮等）：行号用控件的
      const visit = (node, owner) => {
        const at = {file: rel(component.file), line: owner.line, col: 1};
        const label = `组件 ${component.fullName} 的 ${owner.name ?? owner.id}`;
        if (TEXTS.includes(node.tag)) {
          const {stroke, shadow, fontSize} = textEffects(node.attrs ?? {});
          const limit = fontSize * EFFECT_RATIO;
          if (stroke + shadow > limit + 1e-9) {
            const parts = [stroke ? `描边 ${stroke}` : '', shadow ? `投影偏移 ${shadow}` : ''].filter(Boolean).join(' + ');
            out.push(finding('LGUI-UI-081', `${label}：${parts} = ${round(stroke + shadow)} 像素，超过了 ${fontSize} 号字的上限 ${round(limit)}（字号的 7.5%）。Unity 上画不出这么粗的描边、这么远的投影。`, `改小 strokeSize、shadowOffset（投影按 x、y 里绝对值大的算），或者把字号加大到 ${Math.ceil((stroke + shadow) / EFFECT_RATIO)} 以上（UI 开发规范第 8 节）。`, at));
          }
          if (node.attrs?.italic === 'true') out.push(finding('LGUI-UI-082', `${label} 写了 italic="true"：不支持斜体，Unity 上斜体的字显示不出来。`, italicFix, at));
        }
        for (const value of Object.values(node.attrs ?? {})) {
          if (UBB_ITALIC.test(String(value))) out.push(finding('LGUI-UI-082', `${label} 的文字里写了 [i]：不支持斜体，Unity 上斜体的字显示不出来。`, italicFix, at));
        }
        for (const child of node.children ?? []) visit(child, owner);
      };
      for (const child of component.children) visit(child, child);
    }
  }
  for (const [language, table] of Object.entries(tables)) {
    for (const [key, value] of Object.entries(table)) {
      const texts = typeof value === 'string' ? [value] : Object.values(value ?? {});
      if (texts.some(text => UBB_ITALIC.test(String(text)))) out.push(finding('LGUI-UI-082', `文本表 i18n/${language}.json 的 ${key} 里写了 [i]：不支持斜体，Unity 上斜体的字显示不出来。`, italicFix, {file: `i18n/${language}.json`}));
    }
  }
  return out;
}
