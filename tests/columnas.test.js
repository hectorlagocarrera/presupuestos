import test from 'node:test';
import assert from 'node:assert/strict';
import { columnsToBudgets, looksLikeColumns } from '../js/columnas.js';

// Página sintética con la disposición del programa de gestión (datos inventados).
const cell = (x, s, w = s.length * 4.5) => ({ x, w, s });
function pagina({ numero, fecha, pag = '1 / 1', filas, base, total }) {
  return {
    rows: [
      { y: 805, cells: [cell(434, 'PRESUPUESTO')] },
      { y: 788, cells: [cell(505, 'Página'), cell(540, pag.split(' / ')[0] + ' /'), cell(558, pag.split(' / ')[1])] },
      { y: 757, cells: [cell(38, 'EMPRESA DEMO S.L.')] },
      { y: 738, cells: [cell(39, 'N.I.F. B00000000')] },
      { y: 719, cells: [cell(315, 'CLIENTE INVENTADO S.L.')] },
      { y: 691, cells: [cell(39, 'email: demo@example.com'), cell(316, 'CALLE FALSA 1')] },
      { y: 663, cells: [cell(39, 'Número'), cell(116, 'Fecha'), cell(190, 'Válido hasta', 53), cell(316, 'PONTEVEDRA')] },
      { y: 650, cells: [cell(89, numero), cell(116, fecha)] },
      { y: 647, cells: [cell(316, 'B11111111')] },
      { y: 588, cells: [cell(47, 'Cantidad'), cell(93, 'Código'), cell(162, 'Artículo'), cell(384, 'Precio'), cell(457, 'IVA'), cell(510, 'Subtotal')] },
      ...filas,
      { y: 176, cells: [cell(378, '1'), cell(442, 'Subtotal'), cell(522, base || '0,00')] },
      { y: 154, cells: [cell(39, 'Descuento'), cell(237, 'Base Imponible', 66), cell(321, 'Importe IVA', 50), cell(452, 'TOTAL PRESUPUESTO', 100)] },
      { y: 137, cells: [cell(269, base || ''), cell(504, total ? total + ' €' : '€')] },
    ],
  };
}

test('presupuestos en columnas: partidas, descripción, notas y varias páginas', () => {
  const pages = [
    pagina({ numero: '12', fecha: '04/01/2024', base: '220,80', total: '267,17', filas: [
      { y: 573, cells: [cell(76, '1'), cell(161, 'ROTULACIÓN DE VALLA EN IMPRESIÓN DIGITAL'), cell(390, '220,80'), cell(456, '21,00'), cell(524, '220,80')] },
      { y: 560, cells: [cell(161, 'LAMINADA MATE DE MEDIDA: 2400x1780mm')] },
      { y: 520, cells: [cell(161, 'PROYECTO INVENTADO')] },
    ] }),
    pagina({ numero: '13', fecha: '05/01/2024', pag: '1 / 2', filas: [
      { y: 573, cells: [cell(76, '2'), cell(161, 'CARTEL DIBOND 3MM 300x200 cm'), cell(390, '500,00'), cell(456, '21,00'), cell(524, '1.000,00')] },
    ] }),
    pagina({ numero: '13', fecha: '05/01/2024', pag: '2 / 2', base: '1.120,00', total: '1.355,20', filas: [
      { y: 573, cells: [cell(161, 'IMPRESO EN UV')] },
      { y: 546, cells: [cell(161, 'MONTAJE EN FACHADA'), cell(390, '120,00'), cell(456, '21,00'), cell(524, '120,00')] },
    ] }),
    pagina({ numero: '14', fecha: '06/01/2024', base: '590,00', total: '713,90', filas: [
      { y: 573, cells: [cell(161, 'LETRERO EN ALUCABOND')] },
      { y: 560, cells: [cell(161, 'MEDIDAS: 600x2000mm')] },
      { y: 303, cells: [cell(76, '1'), cell(161, 'SUBTOTAL'), cell(385, '590,00'), cell(456, '21,00'), cell(519, '590,00')] },
    ] }),
  ];
  assert.ok(looksLikeColumns(pages));
  const bs = columnsToBudgets(pages, 'demo.pdf');
  assert.equal(bs.length, 3);

  const [a, b, c] = bs;
  assert.equal(a.numero, '12');
  assert.equal(a.fecha, '2024-01-04');
  assert.equal(a.cliente, 'CLIENTE INVENTADO S.L.');
  assert.equal(a.clienteDatos.cif, 'B11111111');
  assert.equal(a.base, 220.8);
  assert.equal(a.total, 267.17);
  assert.equal(a.partidas.length, 1);
  assert.equal(a.partidas[0].articulo, 'ROTULACIÓN DE VALLA EN IMPRESIÓN DIGITAL LAMINADA MATE DE MEDIDA: 2400x1780mm');
  assert.equal(a.partidas[0].observaciones, 'PROYECTO INVENTADO');
  assert.equal(a.partidas[0].ancho, 2.4);
  assert.equal(a.partidas[0].alto, 1.78);
  assert.equal(a.partidas[0].revisar, false);
  assert.equal(a.empresa[0], 'EMPRESA DEMO S.L.');

  assert.equal(b.numero, '13');
  assert.equal(b.partidas.length, 2, 'las dos páginas forman un presupuesto');
  assert.match(b.partidas[0].articulo, /IMPRESO EN UV$/);
  assert.equal(b.partidas[0].categoria, 'Alupanel');
  assert.equal(b.partidas[0].precioUnitario, 500);
  assert.equal(b.partidas[1].cantidad, 1, 'sin cantidad se toma 1');
  assert.equal(b.base, 1120);

  assert.equal(c.partidas.length, 1);
  assert.equal(c.partidas[0].articulo, 'LETRERO EN ALUCABOND MEDIDAS: 600x2000mm', 'la descripción estaba encima del precio');
  assert.equal(c.partidas[0].precioUnitario, 590);
});
