import test from 'node:test';
import assert from 'node:assert/strict';
import { leerPrecio, esTarifaPdf, leerTarifaPdf, esTarifaFilas, leerTarifaFilas } from '../js/catalogo.js';

test('leerPrecio: precios, suplementos, ajustes, + IVA y consultar', () => {
  assert.deepEqual(leerPrecio('20,00 €'), { precio: 20, tipo: 'precio', masIva: false, texto: '20,00 €' });
  assert.equal(leerPrecio('1.250,50 €').precio, 1250.5);
  assert.equal(leerPrecio(12.5).precio, 12.5);
  assert.equal(leerPrecio('1.250').precio, 1250);
  assert.equal(leerPrecio('+5,00 €').tipo, 'suplemento');
  assert.equal(leerPrecio('+5,00 €').precio, 5);
  assert.equal(leerPrecio('-1,00 €').precio, -1);
  assert.equal(leerPrecio('-1,00 €').tipo, 'ajuste');
  assert.equal(leerPrecio('60,00 € + IVA').masIva, true);
  assert.equal(leerPrecio('Consultar').tipo, 'consultar');
  assert.equal(leerPrecio('Consultar').precio, null);
});

// Página sintética con la disposición de una tarifa (datos inventados).
const cell = (x, s) => ({ x, w: s.length * 4.5, s });
const pagina = {
  rows: [
    { y: 800, cells: [cell(40, 'TARIFA DEMO')] },
    { y: 770, cells: [cell(40, 'Código'), cell(100, 'Descripción'), cell(330, 'Precio'), cell(400, 'Unidad'), cell(450, 'Observaciones')] },
    { y: 750, cells: [cell(40, 'Rótulos de prueba')] },
    { y: 735, cells: [cell(40, 'RP-01'), cell(100, 'Panel de prueba impreso'), cell(330, '20,00 €'), cell(400, 'm²'), cell(450, 'Mínimo 1 m²')] },
    { y: 724, cells: [cell(100, 'con laminado mate')] },
    { y: 710, cells: [cell(40, 'RP-02'), cell(100, 'Suplemento ficticio'), cell(330, '+5,00 €'), cell(400, 'ud')] },
    { y: 690, cells: [cell(40, 'Montajes inventados')] },
    { y: 675, cells: [cell(40, 'MI-01'), cell(100, 'Montaje de ejemplo'), cell(330, 'Consultar'), cell(400, 'ud')] },
    { y: 20, cells: [cell(280, 'Página 1')] },
  ],
};

test('tarifa en PDF: secciones, líneas que continúan y m²', () => {
  assert.equal(esTarifaPdf([pagina]), true);
  const arts = leerTarifaPdf([pagina]);
  assert.equal(arts.length, 3);
  assert.deepEqual(arts.map((a) => a.seccion), ['Rótulos de prueba', 'Rótulos de prueba', 'Montajes inventados']);
  assert.equal(arts[0].descripcion, 'Panel de prueba impreso con laminado mate');
  assert.equal(arts[0].precio, 20);
  assert.equal(arts[0].porM2, 1);
  assert.equal(arts[0].observaciones, 'Mínimo 1 m²');
  assert.equal(arts[1].tipo, 'suplemento');
  assert.equal(arts[2].precio, null);
});

test('tarifa en Excel, con columna de sección o con filas de título', () => {
  const conTitulos = [['Código', 'Descripción', 'Precio', 'Unidad'], ['Vinilos demo'], ['VD-1', 'Vinilo inventado', '12,5', 'm²'], ['VD-2', 'Corte de prueba', '3', 'ud']];
  assert.equal(esTarifaFilas(conTitulos), true);
  const a = leerTarifaFilas(conTitulos);
  assert.equal(a.length, 2);
  assert.equal(a[0].seccion, 'Vinilos demo');
  assert.equal(a[0].precio, 12.5);
  const conColumna = [['Sección', 'Código', 'Descripción', 'Precio', 'Unidad'], ['Lonas demo', 'LD-1', 'Lona inventada', '9', 'm²']];
  assert.equal(leerTarifaFilas(conColumna)[0].seccion, 'Lonas demo');
});
