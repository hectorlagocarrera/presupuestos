import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, NOVEDADES } from '../js/version.js';

test('el número de versión es el mismo en package.json y en las novedades', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, VERSION);
  const vs = NOVEDADES.map((n) => n.version);
  assert.equal(new Set(vs).size, vs.length, 'versiones repetidas en las novedades');
  for (const n of NOVEDADES) { assert.match(n.fecha, /^\d{4}-\d{2}-\d{2}$/); assert.ok(n.cambios.length); }
});
