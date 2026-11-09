import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAtlasResult, effectiveFloat} from './checker.mjs';

function row(relation = 'main') {
  const values = {_TextureWidth: 2048, _TextureHeight: 2048, _UnderlayOffsetX: 4 / 7, _UnderlayOffsetY: -4 / 7, _ScaleRatioC: 1, _GradientScale: 7};
  return {ownerName: 'shadow', enabled: true, active: true, vertexCount: 12, relation, fontAssetName: relation === 'main' ? 'project' : 'fallback', text: 'Il齉', underlayOn: true, indexBlockEmpty: true,
    texture: {native: {id: 1, width: 2048, height: 2048}, cachedWidth: 2048, cachedHeight: 2048, nativeIsFontAtlas: true}, materialMainTexture: {id: 1},
    originalFormat: {size: 64, fontSizeScale: 1}, actualFont: {pointSize: 64, faceScale: 1},
    floats: Object.entries(values).map(([name, material]) => ({name, material, materialHasProperty: true, rendererHasProperty: false, indexHasProperty: false, rendererBlock: 0, indexBlock: 0}))};
}
const result = () => ({sampled: true, renderers: [row(), row('submesh')]});

test('checks real main/fallback dimensions and independently derives four design pixels', () => assert.equal(checkAtlasResult(result()).ok, true));
test('rejects stale 1x1 shader dimensions against a resized 2048 atlas', () => {
  const input = result(); for (const p of input.renderers[0].floats) if (p.name === '_TextureWidth' || p.name === '_TextureHeight') p.material = 1;
  const verdict = checkAtlasResult(input); assert.equal(verdict.ok, false); assert.ok(verdict.errors.some(e => e.includes('_TextureWidth 1 != native width 2048')));
});
test('missing draw and presence evidence cannot pass', () => {
  assert.equal(checkAtlasResult({sampled: true, renderers: []}).ok, false);
  const sample = row(); delete sample.floats[0].rendererHasProperty;
  assert.throws(() => effectiveFloat(sample, '_TextureWidth'), /presence/);
});
test('unset block zero falls back to the shared material', () => assert.deepEqual(effectiveFloat(row(), '_TextureWidth'), {value: 2048, source: 'shared-material'}));
test('present renderer block overrides shared material', () => {
  const sample = row(), p = sample.floats[0]; p.rendererHasProperty = true; p.rendererBlock = 1024;
  assert.deepEqual(effectiveFloat(sample, '_TextureWidth'), {value: 1024, source: 'renderer-property-block'});
});
test('per-material block replaces renderer block; an unset field then falls back to material', () => {
  const sample = row(), p = sample.floats[0]; sample.indexBlockEmpty = false; p.rendererHasProperty = true; p.rendererBlock = 1;
  assert.deepEqual(effectiveFloat(sample, '_TextureWidth'), {value: 2048, source: 'shared-material'});
  p.indexHasProperty = true; p.indexBlock = 512;
  assert.deepEqual(effectiveFloat(sample, '_TextureWidth'), {value: 512, source: 'material-index-property-block'});
});
test('fallback offset of six pixels fails even when atlas dimensions match', () => {
  const input = result(); for (const p of input.renderers[1].floats) if (p.name === '_GradientScale') p.material = 10.5;
  const verdict = checkAtlasResult(input); assert.equal(verdict.ok, false); assert.ok(verdict.errors.some(e => e.includes('shadow 6 design px')));
});
test('dimension and shadow verdicts stay independent for staged fixes', () => {
  const input = result(); input.renderers[1].floats.find(p => p.name === '_GradientScale').material = 10.5;
  assert.equal(checkAtlasResult(input, {checkDimensions: true, checkShadow: false}).ok, true);
  assert.equal(checkAtlasResult(input, {checkDimensions: false, checkShadow: true}).ok, false);
});
test('combined effects can independently require a zero-x, two-y design-pixel shadow', () => {
  const input = result();
  for (const sample of input.renderers) {
    sample.ownerName = 'combined';
    sample.floats.find(p => p.name === '_UnderlayOffsetX').material = 0;
    sample.floats.find(p => p.name === '_UnderlayOffsetY').material = -2 / 7;
  }
  assert.equal(checkAtlasResult(input, {owner: 'combined', expected: [0, 2]}).ok, true);
});
test('enabled keyword with zero underlay does not pass', () => {
  const input = result(); input.renderers[0].floats.find(p => p.name === '_UnderlayOffsetX').material = 0;
  assert.equal(checkAtlasResult(input).ok, false);
});
