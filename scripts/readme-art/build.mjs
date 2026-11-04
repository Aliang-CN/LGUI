// 生成 README 用的图片，输出到 .github/readme/（中英文各一套）。图片都由这个脚本生成，不手改。
// 用法：node scripts/readme-art/build.mjs <截图目录>
//
// 截图目录里要有背包示例的截图（先运行 node scripts/sync-examples.mjs，再在 examples/inventory/ 里截）：
//   lgui verify --view BagView --size desktop            → desktop-landscape.png、desktop-portrait.png
//                                                           另存为 BagView-land.png、BagView-port-hd.png
//   lgui verify --view BagView --size desktop --lang en  → desktop-landscape-en.png、desktop-portrait-en.png
//                                                           另存为 BagView-land.en.png、BagView-port-hd.en.png
// src/ 里是拿不到第二份的素材：两个群的二维码（来自 LumioGames/.github 的 profile/assets）、
// 原型图和 Unity 实机录屏的一帧。录屏转成的 demo.gif 不归这个脚本管，是用 ffmpeg 从原视频转的：
//   ffmpeg -i demo.mp4 -filter_complex "[0:v]trim=1.0:6.0,setpts=PTS-STARTPTS,crop=2940:1750:0:0,scale=640:380,fps=8[a];
//     [0:v]trim=6.6:11.6,setpts=PTS-STARTPTS,crop=940:1660:1640:100,scale=-2:380,pad=640:380:(ow-iw)/2:0:color=0x12152B,fps=8[b];
//     [a][b]concat=n=2:v=1:a=0,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];
//     [s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -an .github/readme/demo.gif
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const src = path.join(here, 'src');
const shotsDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(path.join(shotsDir, 'BagView-land.png'))) {
  console.error('要传截图目录，里面要有 BagView-land.png 等四张截图，见文件开头的说明。');
  process.exit(1);
}
const out = path.join(root, '.github/readme');
fs.mkdirSync(out, {recursive: true});
const require = createRequire(path.join(root, 'plugin/tools/vendor/package.json'));
const sharp = require('sharp');

// Lumio brand colors (LumioPlatformNext apps/shared/styles/tokens.css): primary #6659db, mint #5de2c6, amber #ffb86b, rose #ff7ea6, stage #171c34.
const C = {
  ink: '#12152B', ink2: '#1D2148', panel: '#171C34', slot: '#232A52',
  text: '#F6F7FD', muted: '#AEB5D6', dim: '#7480A8',
  teal: '#5DE2C6', amber: '#FFB86B', coral: '#FF7EA6', violet: '#9AA6FF', blue: '#8C98FF',
  primary: '#6659DB', primary2: '#9AA6FF',
};
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif`;
// Official mark (apps/shared/public/lumio/brand/lumio-mark.svg), drawn at x,y with size s.
function lumioMark(x, y, s, id) {
  const k = s / 100;
  return `<g transform="translate(${x} ${y}) scale(${k})">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6659db"/><stop offset="1" stop-color="#9aa6ff"/></linearGradient></defs>
  <rect width="100" height="100" rx="29" fill="url(#${id})"/><rect x="25" y="22" width="16" height="16" rx="4" fill="#fff"/><rect x="25" y="42" width="16" height="16" rx="4" fill="#fff"/><rect x="25" y="62" width="16" height="16" rx="4" fill="#fff"/><rect x="45" y="62" width="16" height="16" rx="4" fill="#fff" fill-opacity=".6"/><rect x="65" y="62" width="16" height="16" rx="4" fill="#5de2c6"/><path d="M70 19C71.56 28.1 73.9 30.44 83 32C73.9 33.56 71.56 35.9 70 45C68.44 35.9 66.1 33.56 57 32C66.1 30.44 68.44 28.1 70 19Z" fill="#fff"/></g>`;
}
// "Lumio / GAMES" lockup as on the site header; returns svg and its width.
function lockup(x, y, s, id) {
  return `${lumioMark(x, y, s, id)}
  <text x="${x + s * 1.27}" y="${y + s * .56}" font-family="${SANS}" font-size="${s * .52}" font-weight="800" fill="${C.text}">Lumio</text>
  <text x="${x + s * 1.29}" y="${y + s * .86}" font-family="${SANS}" font-size="${s * .23}" font-weight="700" letter-spacing="${s * .23 * .25}" fill="${C.text}">GAMES</text>`;
}
const MONO = `'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;
const write = (name, svg) => fs.writeFileSync(path.join(out, name), svg.trim() + '\n');

// ---------- small UI-wireframe helpers ----------
const rarity = [C.amber, C.blue, C.violet, C.teal, C.amber, C.teal, C.blue, C.violet, C.coral, C.teal, C.violet, C.amber];
function gem(cx, cy, r, color) {
  return `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z" fill="${color}"/>` +
    `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy}Z" fill="#fff" opacity=".35"/>`;
}
function grid(x0, y0, cols, rows, s, g) {
  let o = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, x = x0 + c * (s + g), y = y0 + r * (s + g), col = rarity[i % rarity.length];
    o += `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * .16}" fill="${i === 0 ? '#2A3466' : C.slot}" stroke="${col}" stroke-opacity=".75" stroke-width="1.2"/>`;
    o += gem(x + s / 2, y + s / 2, s * .26, col);
  }
  return o;
}
function selection(x, y, w, h, hs) {
  const handles = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]
    .map(([a, b]) => `<rect x="${a - hs / 2}" y="${b - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="${C.teal}" stroke-width="1.2"/>`).join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${C.teal}" stroke-width="1.4" stroke-dasharray="4 3"/>${handles}`;
}
function tabs(x0, y, n, w, h, g) {
  let o = '';
  for (let i = 0; i < n; i++) o += `<rect x="${x0 + i * (w + g)}" y="${y}" width="${w}" height="${h}" rx="${h * .3}" fill="${i === 0 ? C.teal : 'none'}" fill-opacity="${i === 0 ? .9 : 0}" stroke="${C.blue}" stroke-opacity=".7" stroke-width="1"/>`;
  return o;
}
function bar(x, y, w, h, color, op = 1) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}" opacity="${op}"/>`;
}

// Landscape bag screen, local 400x225.
function landscapeScreen() {
  return `
  <rect width="400" height="225" rx="8" fill="#131B3C"/>
  ${bar(14, 12, 58, 10, C.amber, .95)}
  <rect x="290" y="9" width="70" height="16" rx="4" fill="none" stroke="${C.amber}" stroke-opacity=".7"/>
  <circle cx="299" cy="17" r="4.5" fill="${C.amber}"/>${bar(318, 15, 34, 4, C.text, .8)}
  <rect x="366" y="9" width="22" height="16" rx="3" fill="none" stroke="${C.blue}" stroke-opacity=".8"/>
  ${tabs(14, 34, 4, 38, 11, 5)}
  ${grid(14, 54, 4, 3, 36, 6)}
  ${selection(12, 52, 40, 40, 5)}
  <rect x="190" y="34" width="196" height="150" rx="6" fill="#fff" fill-opacity=".03" stroke="${C.amber}" stroke-opacity=".45"/>
  ${gem(222, 72, 20, C.amber)}
  ${bar(254, 56, 74, 9, C.text, .85)}${bar(254, 72, 42, 6, C.blue, .9)}
  ${bar(204, 104, 54, 5, C.amber, .8)}${bar(204, 114, 46, 5, C.amber, .8)}${bar(204, 124, 50, 5, C.amber, .8)}
  ${bar(204, 138, 150, 4, C.muted, .5)}
  <rect x="204" y="150" width="84" height="13" rx="3" fill="#1D2A5C" stroke="${C.blue}" stroke-opacity=".8"/>
  <rect x="294" y="150" width="84" height="13" rx="3" fill="#1D2A5C" stroke="${C.blue}" stroke-opacity=".8"/>
  <rect x="204" y="167" width="84" height="13" rx="3" fill="#1D2A5C" stroke="${C.coral}" stroke-opacity=".9"/>
  ${bar(208, 176, 52, 2, C.teal)}
  <rect x="294" y="167" width="84" height="13" rx="3" fill="#1D2A5C" stroke="${C.blue}" stroke-opacity=".8"/>
  ${bar(14, 190, 22, 5, C.text, .7)}${bar(44, 191, 74, 3, C.blue, .9)}
  <rect x="0" y="203" width="400" height="22" fill="#000" opacity=".28"/>
  ${bar(14, 212, 14, 4, C.blue, .9)}${bar(32, 212, 18, 4, C.text, .7)}${bar(66, 212, 20, 4, C.blue, .9)}${bar(90, 212, 18, 4, C.text, .7)}`;
}
// Portrait bag screen, local 126x270.
function portraitScreen() {
  return `
  <rect width="126" height="270" rx="12" fill="#131B3C"/>
  ${bar(9, 22, 36, 7, C.amber, .95)}
  <rect x="64" y="20" width="36" height="11" rx="3" fill="none" stroke="${C.amber}" stroke-opacity=".7"/>
  <circle cx="69.5" cy="25.5" r="3" fill="${C.amber}"/>
  <rect x="104" y="20" width="13" height="11" rx="2" fill="none" stroke="${C.blue}" stroke-opacity=".8"/>
  ${tabs(9, 38, 4, 24, 8, 3.6)}
  ${grid(9, 52, 4, 3, 24, 4.6)}
  ${selection(7.5, 50.5, 27, 27, 4)}
  <rect x="9" y="140" width="108" height="86" rx="5" fill="#fff" fill-opacity=".03" stroke="${C.amber}" stroke-opacity=".45"/>
  ${gem(28, 160, 11, C.amber)}
  ${bar(46, 152, 44, 6, C.text, .85)}${bar(46, 163, 26, 4, C.blue, .9)}
  ${bar(16, 180, 34, 3.5, C.amber, .8)}${bar(16, 187, 30, 3.5, C.amber, .8)}
  <rect x="16" y="198" width="44" height="10" rx="2" fill="#1D2A5C" stroke="${C.blue}" stroke-opacity=".8"/>
  <rect x="66" y="198" width="44" height="10" rx="2" fill="#1D2A5C" stroke="${C.blue}" stroke-opacity=".8"/>
  <rect x="16" y="211" width="44" height="10" rx="2" fill="#1D2A5C" stroke="${C.coral}" stroke-opacity=".9"/>
  <rect x="66" y="211" width="44" height="10" rx="2" fill="#1D2A5C" stroke="${C.blue}" stroke-opacity=".8"/>
  ${bar(9, 234, 16, 4, C.text, .7)}${bar(30, 235, 46, 2.5, C.blue, .9)}
  <rect x="0" y="250" width="126" height="20" fill="#000" opacity=".28"/>
  ${bar(9, 258, 10, 3.5, C.blue, .9)}${bar(22, 258, 14, 3.5, C.text, .7)}`;
}
function sparkle(x, y, s, color, op = 1) {
  return `<path d="M${x} ${y - s}C${x + s * .12} ${y - s * .12} ${x + s * .12} ${y - s * .12} ${x + s} ${y}C${x + s * .12} ${y + s * .12} ${x + s * .12} ${y + s * .12} ${x} ${y + s}C${x - s * .12} ${y + s * .12} ${x - s * .12} ${y + s * .12} ${x - s} ${y}C${x - s * .12} ${y - s * .12} ${x - s * .12} ${y - s * .12} ${x} ${y - s}Z" fill="${color}" opacity="${op}"/>`;
}
function chip(x, y, w, label, dashed = false) {
  return `<rect x="${x}" y="${y}" width="${w}" height="34" rx="10" fill="#fff" fill-opacity="${dashed ? 0 : .06}" stroke="${dashed ? C.teal : '#fff'}" stroke-opacity="${dashed ? .8 : .14}" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>` +
    `<text x="${x + w / 2}" y="${y + 22.5}" text-anchor="middle" font-family="${SANS}" font-size="15" font-weight="600" fill="${dashed ? C.teal : '#D5DAEE'}">${label}</text>`;
}

// ---------- hero ----------
function hero(t) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 560" width="1280" height="560" role="img" aria-label="${t.aria}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset="1" stop-color="${C.ink2}"/></linearGradient>
  <radialGradient id="gTeal" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.primary}" stop-opacity=".55"/><stop offset="1" stop-color="${C.primary}" stop-opacity="0"/></radialGradient>
  <radialGradient id="gAmber" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.amber}" stop-opacity=".20"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient>
  <radialGradient id="gViolet" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.teal}" stop-opacity=".14"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.1" fill="#8CA0FF" fill-opacity=".16"/></pattern>
  <clipPath id="round"><rect width="1280" height="560" rx="28"/></clipPath>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity=".45"/></filter>
</defs>
<g clip-path="url(#round)">
  <rect width="1280" height="560" fill="url(#bg)"/>
  <rect width="1280" height="560" fill="url(#dots)"/>
  <circle cx="980" cy="150" r="380" fill="url(#gTeal)"/>
  <circle cx="1220" cy="560" r="320" fill="url(#gAmber)"/>
  <circle cx="120" cy="620" r="360" fill="url(#gViolet)"/>

  <!-- left: LumioGames presents -->
  ${lockup(64, 40, 60, 'heroMark')}
  <path d="M250 46V94" stroke="#fff" stroke-opacity=".25" stroke-width="1.5"/>
  <text font-family="${SANS}">
    <tspan x="270" y="66" font-size="19" font-weight="800" fill="${C.text}">${t.presents}</tspan>
    <tspan x="270" y="90" font-size="15" font-weight="500" fill="${C.muted}">${t.presents2}</tspan>
  </text>

  <g transform="translate(0 30)">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="24">
    <path d="M76 132V214H130" stroke="${C.text}"/>
    <path d="M233.3 145.7A40 40 0 1 0 245 174H210" stroke="${C.text}"/>
    <path d="M282 132V180A30 30 0 0 0 342 180V132" stroke="${C.text}"/>
    <path d="M386 132V214" stroke="${C.teal}"/>
  </g>
  </g>

  <text font-family="${SANS}" font-size="${t.hSize ?? 40}" font-weight="800" fill="${C.text}">
    <tspan x="64" y="326">${t.h1}</tspan>
    <tspan x="64" y="380">${t.h2}</tspan>
  </text>
  <text font-family="${SANS}" font-size="19" fill="${C.muted}">
    <tspan x="64" y="428">${t.s1}</tspan>
    <tspan x="64" y="457">${t.s2}</tspan>
  </text>
  ${t.chips.map(([x, w, l, d]) => chip(x, 488, w, l, d)).join('')}

  <!-- right: canvas with the same screen in two orientations -->
  <text x="1058" y="98" text-anchor="end" font-family="${MONO}" font-size="13" fill="${C.dim}">1920 × 1080</text>
  <g filter="url(#shadow)">
    <rect x="636" y="108" width="424" height="249" rx="16" fill="${C.panel}" stroke="#fff" stroke-opacity=".16" stroke-width="1.5"/>
    <g transform="translate(648 120)">${landscapeScreen()}</g>
  </g>
  <text x="1220" y="70" text-anchor="end" font-family="${MONO}" font-size="13" fill="${C.dim}">1080 × 1920</text>
  <g filter="url(#shadow)">
    <rect x="1084" y="80" width="146" height="300" rx="24" fill="${C.panel}" stroke="#fff" stroke-opacity=".16" stroke-width="1.5"/>
    <g transform="translate(1094 95)">${portraitScreen()}</g>
    <rect x="1137" y="88" width="40" height="7" rx="3.5" fill="#000" opacity=".6"/>
  </g>
  <!-- rotate badge -->
  <g transform="translate(1072 232)">
    <circle r="23" fill="${C.ink}" stroke="${C.teal}" stroke-width="2"/>
    <path d="M-10 -3A11 11 0 0 1 9 -7M10 3A11 11 0 0 1 -9 7" fill="none" stroke="${C.teal}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M9 -13V-6H2M-9 13V6H-2" fill="none" stroke="${C.teal}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <!-- cursor on the selected slot -->
  <path d="M690 196l0 24 6.5-6 4.5 10 4-2-4.5-9.5 8.5-.5z" fill="#fff" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/>
  <!-- code chip -->
  <g filter="url(#shadow)">
    <rect x="610" y="392" width="350" height="78" rx="14" fill="#0A0F1E" fill-opacity=".94" stroke="#fff" stroke-opacity=".14"/>
    <circle cx="630" cy="410" r="4" fill="${C.coral}"/><circle cx="644" cy="410" r="4" fill="${C.amber}"/><circle cx="658" cy="410" r="4" fill="${C.teal}"/>
    <text font-family="${MONO}" font-size="16" fill="${C.text}">
      <tspan x="628" y="440"><tspan fill="${C.teal}">lgui</tspan>.ui.open(<tspan fill="${C.amber}">BagView</tspan>)</tspan>
      <tspan x="628" y="460" font-size="13" fill="${C.dim}">${t.code}</tspan>
    </text>
  </g>
  ${sparkle(1180, 440, 10, C.amber, .9)}${sparkle(1210, 470, 5, C.teal, .8)}${sparkle(600, 120, 6, C.teal, .7)}${sparkle(1110, 500, 4, C.violet, .9)}
</g>
<rect x=".75" y=".75" width="1278.5" height="558.5" rx="27.5" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.5"/>
</svg>`;
}

// ---------- QR cards and buttons ----------
function qrPath(file) {
  const svg = fs.readFileSync(path.join(src, file), 'utf8');
  return svg.match(/<path d="(M30\.000 30\.000[^"]+)"/)[1];
}
function qrCard({title, sub, accent, qr, aria, btn}) {
  const L = 22; // corner bracket length
  const corners = [[30 - 8, 64 - 8, 1, 1], [250 + 8, 64 - 8, -1, 1], [30 - 8, 284 + 8, 1, -1], [250 + 8, 284 + 8, -1, -1]]
    .map(([x, y, dx, dy]) => `<path d="M${x} ${y + dy * L}V${y}H${x + dx * L}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`).join('');
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 0 304 412" width="304" height="412" role="img" aria-label="${aria}">
<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${btn.fill[0]}"/><stop offset="1" stop-color="${btn.fill[1]}"/></linearGradient></defs>
<rect x="1" y="1" width="278" height="410" rx="24" fill="${C.panel}" stroke="${accent}" stroke-opacity=".4" stroke-width="2"/>
<circle cx="34" cy="33" r="5" fill="${accent}"/>
<text x="48" y="39" font-family="${SANS}" font-size="18" font-weight="800" fill="${C.text}">${title}</text>
${corners}
<rect x="30" y="64" width="220" height="220" rx="12" fill="#fff"/>
<path transform="translate(10 44)" d="${qr}" fill="${C.ink}"/>
<text x="140" y="318" text-anchor="middle" font-family="${SANS}" font-size="15" font-weight="600" fill="${C.muted}">${sub}</text>
<rect x="22" y="340" width="236" height="50" rx="14" fill="url(#b)"/>
<rect x="23" y="341" width="234" height="24" rx="13" fill="#fff" opacity=".12"/>
<text x="${btn.cx ?? 130}" y="371.5" text-anchor="middle" font-family="${SANS}" font-size="18" font-weight="800" fill="${btn.ink}">${btn.label}</text>
<g transform="translate(${btn.arrowX ?? 192} 359)" fill="none" stroke="${btn.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L12 2M5 2H12V9"/></g>
</svg>`;
}
// ---------- LumioGames brand card ----------
function brandCard(t) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 260" width="1280" height="260" role="img" aria-label="${t.aria}">
<defs>
  <linearGradient id="bbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5546C4"/><stop offset=".55" stop-color="#6659DB"/><stop offset="1" stop-color="#8A93F5"/></linearGradient>
  <radialGradient id="bglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#5DE2C6" stop-opacity=".35"/><stop offset="1" stop-color="#5DE2C6" stop-opacity="0"/></radialGradient>
  <pattern id="bdots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.1" fill="#fff" fill-opacity=".14"/></pattern>
  <clipPath id="bclip"><rect width="1280" height="260" rx="28"/></clipPath>
</defs>
<g clip-path="url(#bclip)">
  <rect width="1280" height="260" fill="url(#bbg)"/>
  <rect width="1280" height="260" fill="url(#bdots)"/>
  <circle cx="1180" cy="40" r="260" fill="url(#bglow)"/>
  ${[[90, 58, 22], [1000, 210, 14], [1230, 150, 9], [560, 40, 8]].map(([x, y, r]) => sparkle(x, y, r, '#fff', .5)).join('')}
  <rect x="64" y="56" width="148" height="148" rx="40" fill="#fff" fill-opacity=".14"/>
  ${lumioMark(78, 70, 120, 'brandMark')}
  <text x="252" y="128" font-family="${SANS}" font-size="64" font-weight="800" fill="#fff">Lumio</text>
  <text x="256" y="168" font-family="${SANS}" font-size="22" font-weight="800" letter-spacing="9" fill="#fff">GAMES</text>
  <path d="M488 70V190" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>
  <text font-family="${SANS}" fill="#fff">
    <tspan x="528" y="112" font-size="30" font-weight="800">${t.l1}</tspan>
    <tspan x="528" y="152" font-size="19" fill-opacity=".85">${t.l2}</tspan>
  </text>
  <g transform="translate(528 172)">
    <rect width="262" height="44" rx="22" fill="#fff"/>
    <text x="22" y="29" font-family="${SANS}" font-size="17" font-weight="800" fill="#5546C4">${t.cta}</text>
    <g transform="translate(228 15)" fill="none" stroke="#5546C4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L12 2M5 2H12V9"/></g>
  </g>
</g>
</svg>`;
}

// ---------- feature icons ----------
function icon(inner, accent, aria) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72" role="img" aria-label="${aria}">
<rect width="72" height="72" rx="18" fill="${C.panel}"/>
<rect x="1" y="1" width="70" height="70" rx="17" fill="none" stroke="${accent}" stroke-opacity=".45" stroke-width="2"/>
${inner}
</svg>`;
}
const iconBrowser = icon(`
<rect x="14" y="17" width="44" height="38" rx="6" fill="none" stroke="${C.teal}" stroke-width="2.6"/>
<path d="M14 27H58" stroke="${C.teal}" stroke-width="2.6"/>
<circle cx="20" cy="22" r="1.8" fill="${C.teal}"/><circle cx="26" cy="22" r="1.8" fill="${C.teal}"/>
<rect x="20" y="33" width="9" height="9" rx="2" fill="${C.teal}"/><rect x="31.5" y="33" width="9" height="9" rx="2" fill="${C.teal}" opacity=".55"/><rect x="43" y="33" width="9" height="9" rx="2" fill="${C.teal}" opacity=".55"/>
<rect x="20" y="44.5" width="32" height="4" rx="2" fill="${C.teal}" opacity=".55"/>`, C.teal, 'browser');
const iconAdapter = icon(`
<rect x="27" y="27" width="18" height="18" rx="4" fill="${C.amber}"/>
<path d="M36 27V18M27 36H18M45 36H54" stroke="${C.amber}" stroke-width="2.6" stroke-linecap="round"/>
<rect x="30" y="10" width="12" height="9" rx="2.5" fill="none" stroke="${C.amber}" stroke-width="2.4"/>
<rect x="10" y="31" width="9" height="10" rx="2.5" fill="none" stroke="${C.amber}" stroke-width="2.4"/>
<rect x="53" y="31" width="9" height="10" rx="2.5" fill="none" stroke="${C.amber}" stroke-width="2.4" stroke-dasharray="3 2.4"/>
<path d="M36 45V54" stroke="${C.amber}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="3 3.5"/>
<rect x="30" y="53" width="12" height="9" rx="2.5" fill="none" stroke="${C.amber}" stroke-width="2.4" stroke-dasharray="3 2.4"/>`, C.amber, 'adapter');
const iconAgent = icon(`
<rect x="13" y="17" width="46" height="38" rx="6" fill="none" stroke="${C.violet}" stroke-width="2.6"/>
<path d="M21 29L27 34L21 39" fill="none" stroke="${C.violet}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M31 40H38" stroke="${C.violet}" stroke-width="2.6" stroke-linecap="round"/>
<circle cx="50" cy="47" r="9" fill="${C.violet}"/>
<path d="M45.8 47.2L48.8 50L54.2 44.4" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`, C.violet, 'agent');

// ---------- showcase (real screenshots) ----------
async function showcase(t, land, port, file) {
  const W = 1600, H = 860;
  const LS = {x: 64, y: 70, w: 1104, h: 621}, PS = {x: 1214, y: 150, w: 324, h: 576};
  const bg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset="1" stop-color="${C.ink2}"/></linearGradient>
  <radialGradient id="g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.primary}" stop-opacity=".45"/><stop offset="1" stop-color="${C.primary}" stop-opacity="0"/></radialGradient>
  <radialGradient id="g2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.violet}" stop-opacity=".20"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="1.3" fill="#8CA0FF" fill-opacity=".16"/></pattern>
  <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000" flood-opacity=".55"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#dots)"/>
<circle cx="1380" cy="160" r="480" fill="url(#g1)"/><circle cx="160" cy="860" r="520" fill="url(#g2)"/>
<rect filter="url(#sh)" x="${LS.x - 14}" y="${LS.y - 14}" width="${LS.w + 28}" height="${LS.h + 28}" rx="22" fill="${C.panel}" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
<rect filter="url(#sh)" x="${PS.x - 14}" y="${PS.y - 40}" width="${PS.w + 28}" height="${PS.h + 80}" rx="44" fill="${C.panel}" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
<rect x="${PS.x + PS.w / 2 - 36}" y="${PS.y - 26}" width="72" height="10" rx="5" fill="#000" opacity=".6"/>
<g transform="translate(1191 420)">
  <circle r="30" fill="${C.ink}" stroke="${C.teal}" stroke-width="2.5"/>
  <path d="M-13 -4A14.5 14.5 0 0 1 12 -9M13 4A14.5 14.5 0 0 1 -12 9" fill="none" stroke="${C.teal}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M12 -17V-8H3M-12 17V8H-3" fill="none" stroke="${C.teal}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<text x="${LS.x}" y="${LS.y + LS.h + 70}" font-family="${SANS}" font-size="24" font-weight="700" fill="${C.text}">${t.land}<tspan dx="14" font-family="${MONO}" font-size="20" font-weight="400" fill="${C.teal}">1920 × 1080</tspan></text>
<text x="${PS.x + PS.w / 2}" y="${PS.y + PS.h + 86}" text-anchor="middle" font-family="${SANS}" font-size="24" font-weight="700" fill="${C.text}">${t.port}<tspan dx="12" font-family="${MONO}" font-size="20" font-weight="400" fill="${C.teal}">1080 × 1920</tspan></text>
<text x="${LS.x + LS.w}" y="${LS.y + LS.h + 70}" text-anchor="end" font-family="${SANS}" font-size="18" fill="${C.muted}">${t.note}</text>
</svg>`;
  const rounded = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  const fit = async (src, w, h, r) => sharp(src).resize(w, h).composite([{input: rounded(w, h, r), blend: 'dest-in'}]).png().toBuffer();
  const img = await sharp(Buffer.from(bg)).composite([
    {input: await fit(land, LS.w, LS.h, 10), left: LS.x, top: LS.y},
    {input: await fit(port, PS.w, PS.h, 18), left: PS.x, top: PS.y},
  ]).flatten({background: C.ink}).jpeg({quality: 86, mozjpeg: true}).toBuffer();
  fs.writeFileSync(path.join(out, file), img);
}

// ---------- online demo button ----------
function playButton(t) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 76" width="400" height="76" role="img" aria-label="${t.aria}">
<defs><linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5546C4"/><stop offset="1" stop-color="#8A93F5"/></linearGradient></defs>
<rect x="2" y="2" width="396" height="72" rx="36" fill="url(#pb)"/>
<rect x="3" y="3" width="394" height="34" rx="17" fill="#fff" opacity=".12"/>
<circle cx="40" cy="38" r="22" fill="#fff"/>
<path d="M34 27.5L50 38L34 48.5Z" fill="#5546C4"/>
<text font-family="${SANS}" fill="#fff">
  <tspan x="76" y="35" font-size="21" font-weight="800">${t.l1}</tspan>
  <tspan x="76" y="56" font-size="13" font-weight="600" fill-opacity=".85">${t.l2}</tspan>
</text>
<g transform="translate(352 30)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14L14 2M5 2H14V11"/></g>
</svg>`;
}

// ---------- prototype → Unity comparison ----------
async function demoCompare(t, proto, unity, file) {
  const H = 400, W = 1662, top = 96;
  const P = {w: Math.round(964 / 604 * H), h: H}, U = {w: Math.round(2940 / 1750 * H), h: H};
  const px = 56, ux = W - 56 - U.w, mid = (px + P.w + ux) / 2;
  const bg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${top + H + 64}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset="1" stop-color="${C.ink2}"/></linearGradient>
  <radialGradient id="g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.primary}" stop-opacity=".45"/><stop offset="1" stop-color="${C.primary}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="1.3" fill="#8CA0FF" fill-opacity=".16"/></pattern>
  <linearGradient id="ar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient>
</defs>
<rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#dots)"/>
<circle cx="${mid}" cy="${top + H / 2}" r="420" fill="url(#g1)"/>
<text x="${px}" y="${top - 26}" font-family="${SANS}" font-size="26" font-weight="800" fill="${C.text}">${t.left}</text>
<text x="${ux}" y="${top - 26}" font-family="${SANS}" font-size="26" font-weight="800" fill="${C.text}">${t.right}</text>
<rect x="${px - 8}" y="${top - 8}" width="${P.w + 16}" height="${H + 16}" rx="18" fill="${C.panel}" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
<rect x="${ux - 8}" y="${top - 8}" width="${U.w + 16}" height="${H + 16}" rx="18" fill="${C.panel}" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
<path d="M${px + P.w + 22} ${top + H / 2}H${ux - 34}" stroke="${C.teal}" stroke-opacity=".75" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12"/>
<path d="M${ux - 46} ${top + H / 2 - 12}L${ux - 30} ${top + H / 2}L${ux - 46} ${top + H / 2 + 12}" fill="none" stroke="${C.teal}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${mid}" y="${top + H / 2 - 22}" text-anchor="middle" font-family="${SANS}" font-size="30" font-weight="800" fill="${C.teal}">${t.time}</text>
<text x="${mid}" y="${top + H / 2 + 44}" text-anchor="middle" font-family="${SANS}" font-size="15" font-weight="600" fill="${C.muted}">${t.tool}</text>
</svg>`;
  const rounded = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  const fit = async (src, crop, w, h) => sharp(src).extract(crop).resize(w, h).composite([{input: rounded(w, h, 10), blend: 'dest-in'}]).png().toBuffer();
  const img = await sharp(Buffer.from(bg)).composite([
    {input: await fit(proto, {left: 0, top: 0, width: 964, height: 604}, P.w, P.h), left: px, top},
    {input: await fit(unity, {left: 0, top: 0, width: 1470, height: 875}, U.w, U.h), left: ux, top},
  ]).flatten({background: C.ink}).jpeg({quality: 72, mozjpeg: true}).toBuffer();
  fs.writeFileSync(path.join(out, file), img);
}

// ---------- 中英文两套 ----------
const QQ = {accent: C.violet, qr: qrPath('qr-qq.svg'), fill: [C.primary, '#8A93F5'], ink: '#fff'};
const FEISHU = {accent: C.amber, qr: qrPath('qr-feishu.svg'), fill: [C.amber, '#FFCF94'], ink: '#2A1D0E'};
const sets = {
  'zh-CN': {
    hero: {
      aria: 'LumioGames 出品 · LGUI：不依赖游戏引擎，在浏览器里把游戏界面做完 · lumio.games',
      presents: 'LumioGames 出品', presents2: '给 AI Agent 用的游戏 UI 框架 · 源码公开',
      h1: '不依赖游戏引擎，',
      h2: `在<tspan fill="${C.teal}">浏览器</tspan>里把游戏界面做完`,
      s1: '界面、逻辑、测试都在网页上跑通。',
      s2: '要上 Unity，一条命令导出，游戏代码不用改。',
      chips: [[64, 84, '浏览器'], [158, 104, 'Node 测试'], [272, 78, 'Unity'], [360, 128, '+ 你的引擎', true]],
      code: '// 横竖两版，同一份代码',
    },
    qq: {title: 'QQ 交流群', sub: '群号 972220164 · 什么都能聊', aria: '扫码或点击加入 QQ 交流群 972220164', label: '加入 QQ 群'},
    feishu: {title: 'LumioGame 开发者社区', sub: '飞书话题群 · 玩法、内容、发布', aria: '扫码或点击加入飞书话题群 LumioGame 开发者社区', label: '加入飞书群'},
    brand: {aria: 'LumioGames 出品 · Lumio，游戏创造快乐 · lumio.games', l1: 'LGUI 由 LumioGames 出品', l2: 'Lumio · 游戏创造快乐', cta: '访问官网 lumio.games'},
    play: {aria: '在线试玩背包示例', l1: '在线试玩背包示例', l2: '浏览器打开就能玩 · lumiogames.github.io/LGUI'},
    showcase: {land: '横屏', port: '竖屏', note: '同一份 ui/ 和代码，转屏时自动换版'},
    compare: {left: '原型图', right: 'Unity 打包后实机运行', time: '30 分钟', tool: 'Codex 6.1-sol + LGUI'},
    shots: ['BagView-land.png', 'BagView-port-hd.png'],
  },
  en: {
    hero: {
      aria: 'Made by LumioGames · LGUI: no game engine needed, build game UI in a browser · lumio.games',
      presents: 'Made by LumioGames', presents2: 'Game UI framework for AI agents · source-available',
      hSize: 38,
      h1: 'No game engine needed.',
      h2: `Build game UI in a <tspan fill="${C.teal}">browser</tspan>.`,
      s1: 'UI, logic and tests all run on the web.',
      s2: 'One command ships it to Unity, code unchanged.',
      chips: [[64, 92, 'Browser'], [166, 116, 'Node tests'], [292, 78, 'Unity'], [380, 140, '+ your engine', true]],
      code: '// landscape + portrait, one codebase',
    },
    qq: {title: 'QQ group', sub: 'Group 972220164 · anything goes', aria: 'Scan or click to join QQ group 972220164', label: 'Join QQ group', cx: 124, arrowX: 214},
    feishu: {title: 'LumioGame community', sub: 'Feishu group · games &amp; publishing', aria: 'Scan or click to join the LumioGame community on Feishu', label: 'Join Feishu group', cx: 122, arrowX: 222},
    brand: {aria: 'Made by LumioGames · Lumio, games bring joy · lumio.games', l1: 'LGUI is made by LumioGames', l2: 'Lumio · Games bring joy', cta: 'Visit lumio.games'},
    play: {aria: 'Try the inventory demo online', l1: 'Try the live demo', l2: 'Runs in your browser, nothing to install'},
    showcase: {land: 'Landscape', port: 'Portrait', note: 'Same ui/ and code; the layout switches when the screen turns'},
    compare: {left: 'Prototype', right: 'Unity build, running on Windows', time: '30 minutes', tool: 'Codex 6.1-sol + LGUI'},
    shots: ['BagView-land.en.png', 'BagView-port-hd.en.png'],
  },
};
function studioCard(lang) {
  const zh = lang === 'zh-CN';
  const accent = C.teal;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 0 304 412" width="304" height="412" role="img" aria-label="${zh ? '前往 Lumio 官网与开发者中心 lumio.games/studio' : 'Open Lumio Studio lumio.games/studio'}">
<defs>
  <linearGradient id="sb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5DE2C6"/><stop offset="1" stop-color="#8CF0DA"/></linearGradient>
  <linearGradient id="scard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E2552"/><stop offset="1" stop-color="#131836"/></linearGradient>
</defs>
<rect x="1" y="1" width="278" height="410" rx="24" fill="${C.panel}" stroke="${accent}" stroke-opacity=".55" stroke-width="2"/>
<circle cx="34" cy="33" r="5" fill="${accent}"/>
<text x="48" y="39" font-family="${SANS}" font-size="18" font-weight="800" fill="${C.text}">${zh ? 'Lumio 开发者中心' : 'Lumio Studio'}</text>

<rect x="30" y="64" width="220" height="220" rx="14" fill="url(#scard)" stroke="#fff" stroke-opacity=".12"/>
${lumioMark(50, 84, 52, 'scMark')}
<text x="114" y="108" font-family="${SANS}" font-size="24" font-weight="800" fill="#fff">Lumio</text>
<text x="115" y="128" font-family="${SANS}" font-size="11" font-weight="700" letter-spacing="3.5" fill="${C.teal}">STUDIO</text>

<rect x="46" y="150" width="188" height="32" rx="8" fill="#fff" fill-opacity=".06"/>
<circle cx="62" cy="166" r="4" fill="${C.teal}"/>
<text x="74" y="171" font-family="${SANS}" font-size="13" font-weight="600" fill="${C.text}">${zh ? '上传 ZIP 即可发布游戏' : 'Upload ZIP to publish'}</text>

<rect x="46" y="190" width="188" height="32" rx="8" fill="#fff" fill-opacity=".06"/>
<circle cx="62" cy="206" r="4" fill="${C.amber}"/>
<text x="74" y="211" font-family="${SANS}" font-size="13" font-weight="600" fill="${C.text}">${zh ? '云存档 · 排行榜 · 成就' : 'Cloud Save · Leaderboard'}</text>

<rect x="46" y="230" width="188" height="32" rx="8" fill="#fff" fill-opacity=".06"/>
<circle cx="62" cy="246" r="4" fill="${C.violet}"/>
<text x="74" y="251" font-family="${SANS}" font-size="13" font-weight="600" fill="${C.text}">${zh ? 'SDK 文档与作者 API 密钥' : 'SDK Docs &amp; Author API Keys'}</text>

<text x="140" y="318" text-anchor="middle" font-family="${MONO}" font-size="14.5" font-weight="700" fill="${C.teal}">lumio.games/studio</text>
<rect x="22" y="340" width="236" height="50" rx="14" fill="url(#sb)"/>
<rect x="23" y="341" width="234" height="24" rx="13" fill="#fff" opacity=".2"/>
<text x="122" y="371.5" text-anchor="middle" font-family="${SANS}" font-size="18" font-weight="800" fill="#0E1726">${zh ? '打开开发者中心' : 'Open Studio'}</text>
<g transform="translate(198 359)" fill="none" stroke="#0E1726" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L12 2M5 2H12V9"/></g>
</svg>`;
}

for (const [lang, t] of Object.entries(sets)) {
  write(`hero.${lang}.svg`, hero(t.hero));
  write(`qr-qq.${lang}.svg`, qrCard({...t.qq, accent: QQ.accent, qr: QQ.qr, btn: {label: t.qq.label, fill: QQ.fill, ink: QQ.ink, cx: t.qq.cx, arrowX: t.qq.arrowX}}));
  write(`qr-feishu.${lang}.svg`, qrCard({...t.feishu, accent: FEISHU.accent, qr: FEISHU.qr, btn: {label: t.feishu.label, fill: FEISHU.fill, ink: FEISHU.ink, cx: t.feishu.cx, arrowX: t.feishu.arrowX}}));
  write(`studio-card.${lang}.svg`, studioCard(lang));
  write(`brand.${lang}.svg`, brandCard(t.brand));
  write(`play.${lang}.svg`, playButton(t.play));
  await showcase(t.showcase, path.join(shotsDir, t.shots[0]), path.join(shotsDir, t.shots[1]), `showcase.${lang}.jpg`);
  await demoCompare(t.compare, path.join(src, 'prototype.jpg'), path.join(src, 'unity-frame.jpg'), `demo-compare.${lang}.jpg`);
}
write('icon-browser.svg', iconBrowser);
write('icon-adapter.svg', iconAdapter);
write('icon-agent.svg', iconAgent);
console.log(fs.readdirSync(out).map(f => `${f} ${fs.statSync(path.join(out, f)).size}`).join('\n'));
