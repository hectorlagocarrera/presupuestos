// Presupuesto para imprimir o guardar como PDF (desde el diálogo de impresión del navegador).
import { $, esc, fmtEur, fmtNum, fmtDate, calcPartida, round } from '../util.js';
import { data, clientePorNombre } from '../store.js';
import { medidasTxt } from './common.js';

export function imprimir(pres, partidas) {
  const a = data.ajustes;
  const lineas = partidas.map(calcPartida).filter((l) => l.articulo || l.descripcion || l.precioUnitario);
  const base = round(lineas.reduce((s, l) => s + (l.precioTotal || 0), 0));
  const iva = round(base * (Number(pres.iva) || 0) / 100);
  const c = clientePorNombre(pres.clienteNombre || '') || {};
  const detalle = (l) => [
    l.descripcion,
    [l.material, medidasTxt(l)].filter(Boolean).join(' · '),
    l.acabados && 'Acabados: ' + l.acabados,
    l.montaje && 'Montaje: ' + l.montaje,
    l.observaciones,
  ].filter(Boolean).map(esc).join('<br>');
  $('#print').innerHTML = `
    <header class="p-head">
      <div><img class="p-logo" src="${esc(a.logo || 'logo.png')}" alt=""><h1>${esc(a.nombre || '')}</h1><p>${[a.cif && 'NIF ' + a.cif, a.direccion, a.contacto].filter(Boolean).map(esc).join('<br>')}</p></div>
      <div class="p-meta"><h2>PRESUPUESTO</h2><p>Nº <strong>${esc(pres.numero || '')}</strong><br>Fecha: ${fmtDate(pres.fecha)}</p></div>
    </header>
    <div class="p-client"><span>Cliente</span><strong>${esc(pres.clienteNombre || '')}</strong>
      ${[c.cif, c.direccion, c.telefono, c.email].filter(Boolean).map(esc).join(' · ')}</div>
    <table class="p-table">
      <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
      <tbody>${lineas.map((l) => `<tr><td><strong>${esc(l.articulo)}</strong>${detalle(l) ? `<div class="p-det">${detalle(l)}</div>` : ''}</td>
        <td class="num">${fmtNum(l.cantidad)}</td><td class="num">${fmtEur(l.precioUnitario)}</td><td class="num">${fmtEur(l.precioTotal)}</td></tr>`).join('')}</tbody>
    </table>
    <table class="p-totals">
      <tr><td>Base imponible</td><td class="num">${fmtEur(base)}</td></tr>
      <tr><td>IVA ${fmtNum(pres.iva)} %</td><td class="num">${fmtEur(iva)}</td></tr>
      <tr class="grand"><td>TOTAL</td><td class="num">${fmtEur(base + iva)}</td></tr>
    </table>
    ${pres.notas ? `<p class="p-notes">${esc(pres.notas).replace(/\n/g, '<br>')}</p>` : ''}
    ${a.validez ? `<p class="p-notes">Validez del presupuesto: ${esc(a.validez)}.</p>` : ''}`;
  const old = document.title;
  document.title = `Presupuesto ${pres.numero || ''} ${pres.clienteNombre || ''}`.trim();
  window.print();
  document.title = old;
}
