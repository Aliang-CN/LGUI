import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Resolve actual shader float precedence without treating an unset block value (0) as an override. */
export function effectiveFloat(row, name) {
  const p = row.floats?.find(p => p.name === name);
  if (!p || typeof row.indexBlockEmpty !== 'boolean' ||
      !['materialHasProperty', 'rendererHasProperty', 'indexHasProperty'].every(key => typeof p[key] === 'boolean'))
    throw new Error(`${name}: missing material/property-block presence evidence`);
  const index = !row.indexBlockEmpty;
  const present = index ? p.indexHasProperty : p.rendererHasProperty;
  const value = present ? (index ? p.indexBlock : p.rendererBlock) : p.material;
  if (!present && !p.materialHasProperty) throw new Error(`${name}: no actual shader value`);
  if (!Number.isFinite(value)) throw new Error(`${name}: non-finite shader value`);
  return {value, source: present ? (index ? 'material-index-property-block' : 'renderer-property-block') : 'shared-material'};
}

/** Requires actual main/fallback draw inputs; does not generate glyphs or infer correctness from source text. */
export function checkAtlasResult(result, {owner = 'shadow', expected = [4, 4], tolerance = 0.01, checkDimensions = true, checkShadow = true} = {}) {
  const errors = [], checks = [];
  const rows = (result?.renderers ?? []).filter(row => row.ownerName === owner && row.enabled && row.active && row.vertexCount > 0);
  if (!result?.sampled) errors.push('Missing completed runtime sample');
  if (!rows.some(row => row.relation === 'main')) errors.push(`${owner}: missing actual main renderer`);
  if (!rows.some(row => row.relation === 'submesh')) errors.push(`${owner}: missing actual fallback submesh`);
  for (const row of rows) {
    const label = `${owner}/${row.relation}/${row.fontAssetName}`;
    try {
      if (!row.text?.includes('齉')) errors.push(`${label}: runtime binding has not set the fallback character`);
      if (!row.underlayOn) errors.push(`${label}: UNDERLAY_ON is disabled`);
      const native = row.texture?.native;
      if (!native || !(native.width > 0 && native.height > 0)) throw new Error('missing native atlas dimensions');
      if (!row.texture.nativeIsFontAtlas) errors.push(`${label}: renderer NTexture is not the recorded font atlas`);
      if (row.materialMainTexture?.id !== native.id) errors.push(`${label}: shared material and NTexture use different native textures`);
      const values = Object.fromEntries(['_TextureWidth', '_TextureHeight', '_UnderlayOffsetX', '_UnderlayOffsetY', '_ScaleRatioC', '_GradientScale'].map(name => [name, effectiveFloat(row, name)]));
      const v = name => values[name].value;
      if (checkDimensions && v('_TextureWidth') !== native.width) errors.push(`${label}: effective _TextureWidth ${v('_TextureWidth')} != native width ${native.width}`);
      if (checkDimensions && v('_TextureHeight') !== native.height) errors.push(`${label}: effective _TextureHeight ${v('_TextureHeight')} != native height ${native.height}`);
      if (!(v('_ScaleRatioC') > 0 && v('_GradientScale') > 0)) errors.push(`${label}: underlay ratio/gradient must be nonzero`);
      if (expected.some((n, i) => n !== 0 && v(i ? '_UnderlayOffsetY' : '_UnderlayOffsetX') === 0)) errors.push(`${label}: underlay offset must be nonzero`);
      const actualSize = row.originalFormat?.size * row.originalFormat?.fontSizeScale;
      const k = row.actualFont?.pointSize / (actualSize * row.actualFont?.faceScale);
      if (!(k > 0 && Number.isFinite(k))) throw new Error('missing actual font-size/face-scale evidence');
      const uv = [-v('_UnderlayOffsetX') * v('_ScaleRatioC') * v('_GradientScale') / v('_TextureWidth'),
        -v('_UnderlayOffsetY') * v('_ScaleRatioC') * v('_GradientScale') / v('_TextureHeight')];
      const designPixels = [-uv[0] * native.width / k, uv[1] * native.height / k];
      for (let axis = 0; checkShadow && axis < 2; axis++) if (!Number.isFinite(designPixels[axis]) || Math.abs(designPixels[axis] - expected[axis]) > tolerance)
        errors.push(`${label}: shader-derived ${axis ? 'y' : 'x'} shadow ${designPixels[axis]} design px != expected ${expected[axis]}`);
      checks.push({label, text: row.text, native, cachedSize: [row.texture.cachedWidth, row.texture.cachedHeight], values, texelsPerDesignPixel: k, uvOffset: uv, designPixels, expected});
    } catch (error) { errors.push(`${label}: ${error.message}`); }
  }
  return {ok: errors.length === 0, mode: checkDimensions && checkShadow ? 'dimensions-and-shadow' : checkDimensions ? 'dimensions' : 'shadow', scope: 'Actual runtime renderer inputs and shadow geometry only; independent PNG acceptance is still required.', owner, errors, checks};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const flags = new Set(), options = {};
  for (let i = 3; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flags.has(flag)) throw new Error('Duplicate option ' + flag);
    flags.add(flag);
    if (flag === '--owner') {options.owner = process.argv[++i]; if (!options.owner || options.owner.startsWith('--')) throw new Error('--owner requires a field name');}
    else if (flag === '--expected') {options.expected = (process.argv[++i] ?? '').split(',').map(Number); if (options.expected.length !== 2 || !options.expected.every(Number.isFinite)) throw new Error('--expected requires x,y design pixels');}
    else if (!['--check-dimensions', '--check-shadow'].includes(flag)) throw new Error('Unknown option ' + flag);
  }
  if (!file) throw new Error('Usage: node checker.mjs <runtime-result.json> [--check-dimensions] [--check-shadow] [--owner shadow] [--expected 4,4]');
  const modeChosen = flags.has('--check-dimensions') || flags.has('--check-shadow');
  const value = checkAtlasResult(JSON.parse(fs.readFileSync(file, 'utf8')), {...options, checkDimensions: !modeChosen || flags.has('--check-dimensions'), checkShadow: !modeChosen || flags.has('--check-shadow')});
  console.log(JSON.stringify(value, null, 2));
  process.exitCode = value.ok ? 0 : 1;
}
