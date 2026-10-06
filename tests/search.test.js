import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDoc, search, parseMeasures, priceStats, similares, classify, tokenize } from '../js/search.js';
import { calcPartida } from '../js/util.js';

const P = (articulo, fecha, precioUnitario, extra = {}) => calcPartida({ articulo, fecha, precioUnitario, cantidad: 1, ...extra });
const historico = [
  P('Panel composite 300x200 cm impreso', '2024-04-10', 480),
  P('Cartel Dibond 3 x 2 m con vinilo laminado', '2025-02-01', 520),
  P('Cartelería en aluminio 3000 x 2000 mm', '2026-01-15', 545),
  P('Cartel de aluminio 1,5 x 1', '2025-06-01', 150),
  P('Lona frontlit 3x2 con ojales', '2025-05-05', 90),
  P('Vinilo de corte escaparate', '2024-09-09', 60),
  P('Rotulación furgoneta Citroën Berlingo', '2025-03-03', 650),
  P('PVC Forex 5 mm 100x70', '2024-11-11', 45),
].map(buildDoc);

test('medidas en distintas unidades', () => {
  assert.deepEqual(parseMeasures('3x2'), { ancho: 3, alto: 2, texto: '3x2' });
  assert.equal(parseMeasures('300 x 200 cm').ancho, 3);
  assert.equal(parseMeasures('3000x2000 mm').alto, 2);
  assert.equal(parseMeasures('1,5 x 0,8 m').ancho, 1.5);
  assert.equal(parseMeasures('100x70').ancho, 1);
  assert.equal(parseMeasures('sin medidas'), null);
});

test('Alupanel 3x2 encuentra sinónimos y prioriza la medida', () => {
  const r = search('Alupanel 3x2', historico);
  const top = r.slice(0, 3).map((x) => x.doc.p.articulo);
  assert.ok(top.includes('Panel composite 300x200 cm impreso'));
  assert.ok(top.includes('Cartel Dibond 3 x 2 m con vinilo laminado'));
  assert.ok(top.includes('Cartelería en aluminio 3000 x 2000 mm'));
  const small = r.findIndex((x) => x.doc.p.articulo.startsWith('Cartel de aluminio 1,5'));
  assert.ok(small > 2, 'el de 1,5x1 va detrás');
  assert.ok(!r.slice(0, 4).some((x) => x.doc.p.articulo.startsWith('Lona')), 'la lona no está entre los primeros');
});

test('erratas y plurales', () => {
  assert.equal(search('alupanell', historico)[0].doc.p.articulo.includes('Lona'), false);
  assert.ok(search('furgonetas', historico)[0].doc.p.articulo.startsWith('Rotulación'));
  assert.ok(search('forex', historico)[0].doc.p.articulo.startsWith('PVC'));
});

test('año en la búsqueda filtra', () => {
  const r = search('alupanel 2025', historico);
  assert.ok(r.length && r.every((x) => x.doc.year === 2025));
});

test('estadísticas de precio', () => {
  const r = similares(search('Alupanel 3x2', historico));
  const s = priceStats(r, parseMeasures('3x2'));
  assert.equal(s.ultimo.precioUnitario, 545);
  assert.equal(s.min, 480);
  assert.equal(s.max, 545);
  assert.deepEqual(s.evolucion.map((e) => e.anio), [2024, 2025, 2026]);
  assert.equal(s.m2.mediana, 86.67);
  assert.ok(s.orientativo.precio > 480 && s.orientativo.precio < 545);
});

test('clasificación automática', () => {
  assert.deepEqual(classify('Cartel dibond 3mm'), { categoria: 'Alupanel', material: 'Alupanel' });
  assert.equal(classify('Rotulación furgoneta').categoria, 'Rotulación de vehículos');
  assert.deepEqual(tokenize('Carteles de PVC'), ['cartel', 'pvc']);
});

test('tarifa: agrupa trabajos parecidos y da precio por m² o por unidad', async () => {
  const { generarTarifa, precioTarifa } = await import('../js/tarifa.js');
  const L = (articulo, fecha, precioUnitario, ancho, alto, categoria, cantidad = 1) => calcPartida({ articulo, fecha, precioUnitario, ancho, alto, categoria, cantidad });
  const t = generarTarifa([
    L('Lona microperforada reforzada con ojales 300x100', '2026-01-01', 90, 3, 1, 'Lona'),
    L('LONA MICROPERFORADA REFORZADA 2x1', '2025-01-01', 56, 2, 1, 'Lona'),
    L('Lona microperforada reforzada color blanco 4x1', '2024-01-01', 100, 4, 1, 'Lona'),
    L('Camiseta Dogo premium negra', '2026-02-01', 6, null, null, 'Textil', 100),
    L('Camiseta Dogo premium blanca', '2025-02-01', 5, null, null, 'Textil', 50),
    L('Pegatina vinilo 5x5 cm', '2025-02-01', 30, 0.05, 0.05, 'Vinilo', 1),
  ]);
  const lona = t.find((a) => a.categoria === 'Lona');
  assert.equal(lona.veces, 3);
  assert.equal(lona.unidad, 'm²');
  assert.equal(lona.sugerido, 28);
  const cam = t.find((a) => a.categoria === 'Textil');
  assert.equal(cam.unidad, 'ud');
  assert.equal(cam.sugerido, 5.5);
  assert.equal(t.find((a) => a.categoria === 'Vinilo').unidad, 'ud', 'piezas pequeñas por unidad');
  assert.equal(precioTarifa(lona, {}, 10), 30.8);
  assert.equal(precioTarifa(lona, { [lona.clave]: 32 }, 10), 32);
});
