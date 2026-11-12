import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('inventory acceptance uses one real application module graph and isolated project storage', async () => {
  const api = await import('../../unity/acceptance/context.mjs').catch(() => ({}));
  assert.equal(typeof api.createInventoryContext, 'function', 'The two backends must bundle the same actual inventory app and actions');
  const context = await api.createInventoryContext();
  const entry = fs.readFileSync(path.join(context.root, 'src/main.ts'), 'utf8');
  assert.match(entry, /examples\/inventory\/src\/main\.ts/);
  assert.equal(fs.existsSync(path.join(context.root, 'src/modules')), false, 'Duplicating Model source would create different singleton state');
  assert.equal(context.project.name, 'inventory-stage3-acceptance');
  assert.ok(context.packages.some(pkg => pkg.package === 'Bag'));
  assert.ok(fs.existsSync(path.join(context.root, 'conformance/cases/inventory.ts')));
  assert.ok(fs.existsSync(path.join(context.root, 'conformance/cases/memory.ts')));
  assert.ok(fs.existsSync(path.join(context.root, 'conformance/cases/format.ts')));
  assert.ok(fs.existsSync(path.join(context.root, '.lgui/build/web/ui/Bag/package.json')));
});
