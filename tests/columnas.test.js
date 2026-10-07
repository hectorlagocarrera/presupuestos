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

test('tipo de documento por el título de la página', async () => {
  const { tipoTitulo } = await import('../js/columnas.js');
  const pag = (t) => ({ rows: [{ y: 805, cells: [{ x: 434, w: 100, s: t }] }, { y: 719, cells: [{ x: 315, w: 100, s: 'FACTURAS Y GESTIÓN S.L.' }] }] });
  assert.equal(tipoTitulo(pag('PRESUPUESTO')), 'presupuesto');
  assert.equal(tipoTitulo(pag('FACTURA')), 'factura');
  assert.equal(tipoTitulo(pag('ALBARÁN')), 'albaran');
  assert.equal(tipoTitulo(pag('FACTURA PROFORMA')), 'presupuesto');
  const { tipoTexto } = await import('../js/parse.js');
  assert.equal(tipoTexto('EMPRESA\nFACTURA Nº 2026/015\nFecha 01/02/2026'), 'factura');
  assert.equal(tipoTexto('EMPRESA\nPRESUPUESTO Nº 12\nCliente: Facturas SL'), 'presupuesto');
});

// Factura sintética con la disposición de las facturas del programa de gestión (datos inventados):
// «Nº Factura · Fecha · Fecha Valor · Referencia», total en su propia fila y, a veces, retención o sin IVA.
function factura({ numero, fecha, referencia = '', filas, base, total, retencion, conIva = true }) {
  return {
    rows: [
      { y: 802, cells: [cell(430, 'FACTURA')] },
      { y: 758, cells: [cell(27, 'EMPRESA DEMO S.L.U.')] },
      { y: 747, cells: [cell(27, 'N.I.F. B00000000')] },
      { y: 732, cells: [cell(317, 'CLIENTE FICTICIO S.L.')] },
      { y: 710, cells: [cell(27, 'Tel. 900000000'), cell(317, 'AVDA. INVENTADA, 1')] },
      { y: 697, cells: [cell(317, '36000 CIUDAD')] },
      { y: 673, cells: [cell(317, 'B-00.000.000')] },
      { y: 634, cells: [cell(27, 'Nº Factura', 45), cell(106, 'Fecha'), cell(179, 'Fecha Valor', 50), cell(252, 'Referencia', 48)] },
      { y: 620, cells: [cell(80, numero), cell(105, fecha), cell(176, fecha), ...(referencia ? [cell(252, referencia)] : [])] },
      { y: 602, cells: [cell(22, 'Descripción')] },
      { y: 569, cells: [cell(27, 'Cantidad'), cell(74, 'Código'), cell(141, 'Artículo'), cell(381, 'Precio'), cell(458, 'IVA'), cell(504, 'Subtotal')] },
      { y: 552, cells: [cell(24, 'Nº Albarán 1. Fecha Albarán 03/03/2026. Referencia Albarán . P. Entrega /')] },
      ...filas,
      { y: 175, cells: [cell(62, '1'), cell(437, 'Subtotal'), cell(513, base)] },
      { y: 151, cells: [...(retencion ? [cell(39, 'Retención', 40)] : []), cell(87, 'Descuento'), cell(186, 'Dto P.Pago'), cell(295, 'IVA'), cell(324, 'Base Imponible', 66), cell(404, 'Importe IVA', 50), cell(483, 'Importe R.E.', 50)] },
      { y: 137, cells: [...(retencion ? [cell(68, retencion)] : []), cell(164, '%'), cell(268, '%'), ...(conIva ? [cell(291, '21,00%'), cell(363, base), cell(435, '1,00')] : [])] },
      ...(conIva ? [] : [{ y: 104, cells: [cell(367, base)] }]),
      { y: 80, cells: [cell(459, 'TOTAL FACTURA', 60)] },
      { y: 63, cells: [cell(21, 'Vencimientos :'), cell(496, total + ' €')] },
      { y: 23, cells: [cell(504, 'Página'), cell(527, '1 /'), cell(540, '1')] },
    ],
  };
}

test('facturas: número «A/1», fecha, cliente sin colarse la referencia, totales en su fila', () => {
  const linea = (precio) => [{ y: 511, cells: [cell(61, '1'), cell(141, 'ALQUILER ANUAL VALLA'), cell(388, precio), cell(453, '21,00'), cell(514, precio)] }];
  const pages = [
    factura({ numero: 'A/1', fecha: '04/03/2026', referencia: 'PEDIDO 9', base: '200,00', total: '242,00', filas: linea('200,00') }),
    factura({ numero: 'A/2', fecha: '05/03/2026', base: '30,00', total: '27,90', retencion: '2,10', conIva: false, filas: linea('30,00') }),
  ];
  assert.ok(looksLikeColumns(pages));
  const [f1, f2] = columnsToBudgets(pages);
  assert.equal(f1.tipo, 'factura');
  assert.equal(f1.numero, 'A/1');
  assert.equal(f1.fecha, '2026-03-04');
  assert.equal(f1.cliente, 'CLIENTE FICTICIO S.L.');
  assert.equal(f1.clienteDatos.cif, 'B-00.000.000');
  assert.ok(!/PEDIDO|Referencia/.test(f1.clienteDatos.direccion), 'la referencia no es parte de la dirección');
  assert.equal(f1.base, 200);
  assert.equal(f1.total, 242, 'TOTAL FACTURA en su propia fila');
  assert.equal(f1.partidas.length, 1);
  assert.equal(f1.partidas[0].precioUnitario, 200);
  assert.equal(f2.numero, 'A/2');
  assert.equal(f2.base, 30, 'sin IVA la base está más abajo, y la retención no se confunde con la base');
  assert.equal(f2.total, 27.9);
});
