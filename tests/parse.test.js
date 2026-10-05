import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItemLine, textToBudget, rowsToBudgets } from '../js/parse.js';

test('líneas de tabla', () => {
  assert.deepEqual(parseItemLine('Cartel Alupanel 3 x 2 1 480,00 480,00 €'), { texto: 'Cartel Alupanel 3 x 2', cantidad: 1, precio: 480, total: 480, seguro: true });
  assert.equal(parseItemLine('50 Gorra bordada 6,20 310,00').cantidad, 50);
  assert.equal(parseItemLine('Polo 10 12,00 10% 108,00').precio, 10.8);
  assert.equal(parseItemLine('Montaje e instalación 120,00').precio, 120);
  assert.equal(parseItemLine('Base imponible 1.340,50'), null);
  assert.equal(parseItemLine('IVA 21% 281,51'), null);
});

test('presupuesto en texto con descripción en varias líneas', () => {
  const b = textToBudget([
    'ROTULOS EJEMPLO S.L.', 'PRESUPUESTO Nº 2025-031', 'Fecha: 14/02/2025', 'Cliente: Talleres Pérez',
    'Descripción Cantidad Precio Importe',
    'Cartel Dibond 3mm 300x200 cm 1 520,00 520,00',
    'impresión digital con laminado mate',
    'Montaje en fachada 1 90,00 90,00',
    'Base imponible 610,00', 'IVA 21% 128,10', 'TOTAL 738,10',
  ]);
  assert.equal(b.numero, '2025-031');
  assert.equal(b.fecha, '2025-02-14');
  assert.equal(b.cliente, 'Talleres Pérez');
  assert.equal(b.partidas.length, 2);
  const [a, m] = b.partidas;
  assert.equal(a.categoria, 'Alupanel');
  assert.equal(a.ancho, 3);
  assert.equal(a.alto, 2);
  assert.equal(a.m2, 6);
  assert.equal(a.precioM2, 86.67);
  assert.equal(a.descripcion, 'impresión digital con laminado mate');
  assert.equal(a.revisar, false);
  assert.equal(m.categoria, 'Montaje');
});

test('Excel con listado histórico de varias filas por presupuesto', () => {
  const rows = [
    ['Listado presupuestos'],
    ['Fecha', 'Nº Presupuesto', 'Cliente', 'Descripción', 'Ancho (cm)', 'Alto (cm)', 'Uds', 'Precio', 'Importe'],
    [new Date('2024-05-02T00:00:00'), 'P-24-010', 'Bar Sol', 'Lona microperforada', 300, 100, 1, 95, 95],
    ['', '', '', 'Vinilo escaparate', 120, 80, 2, 40, 80],
    ['2025-01-20', 'P-25-002', 'Óptica Luz', 'Letras corpóreas PVC 10 mm', '', '', 1, 380, 380],
  ];
  const bs = rowsToBudgets(rows, 'listado.xlsx');
  assert.equal(bs.length, 2);
  assert.equal(bs[0].numero, 'P-24-010');
  assert.equal(bs[0].cliente, 'Bar Sol');
  assert.equal(bs[0].partidas.length, 2);
  assert.equal(bs[0].partidas[0].ancho, 3);
  assert.equal(bs[0].partidas[1].precioTotal, 80);
  assert.equal(bs[1].partidas[0].categoria, 'Letras corpóreas');
});

test('números a media altura en una línea aparte (descripción de dos líneas)', () => {
  const b = textToBudget([
    'Descripción Cantidad Precio Importe',
    'Panel composite 300x200 cm impreso',
    '1 480,00 € 480,00 €',
    'con vinilo laminado mate',
    'Montaje en fachada 1 90,00 € 90,00 €',
    'Base imponible 570,00 €',
  ]);
  assert.equal(b.partidas.length, 2);
  assert.equal(b.partidas[0].articulo, 'Panel composite 300x200 cm impreso');
  assert.equal(b.partidas[0].descripcion, 'con vinilo laminado mate');
  assert.equal(b.partidas[0].precioUnitario, 480);
  assert.equal(b.partidas[1].articulo, 'Montaje en fachada');
});
