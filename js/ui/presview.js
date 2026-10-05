// Vista rápida de un presupuesto (sin salir de la pantalla actual) y acceso al archivo original.
import { $, esc, fmtEur, fmtNum, fmtDate } from '../util.js';
import { getPresupuesto, partidasDe, getArchivo } from '../store.js';
import { medidasTxt, toast } from './common.js';
import { go } from './nav.js';
import { editor } from './editor.js';

export async function abrirOriginal(archivoId) {
  const a = await getArchivo(archivoId);
  if (!a) { toast('No se guardó el archivo original.'); return; }
  const url = URL.createObjectURL(a.blob);
  // Los PDF se abren en otra pestaña; el resto se descarga.
  if (/pdf/.test(a.tipo)) window.open(url, '_blank', 'noopener');
  else {
    const link = document.createElement('a');
    link.href = url; link.download = a.nombre; link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function verPresupuesto(id) {
  const p = getPresupuesto(id);
  if (!p) return;
  const partidas = partidasDe(id);
  const dlg = $('#modal');
  $('#modalBody').innerHTML = `
    <div class="pane-head"><h2>Presupuesto ${esc(p.numero || '')}</h2><button class="btn ghost small" data-cerrar>Cerrar</button></div>
    <p>${fmtDate(p.fecha)} · <strong>${esc(p.clienteNombre || 'sin cliente')}</strong>${p.archivoNombre ? ` · original: ${esc(p.archivoNombre)}` : ''}</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Artículo</th><th>Medidas</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
      <tbody>${partidas.map((l) => `<tr><td><strong>${esc(l.articulo)}</strong>${l.descripcion ? `<div class="muted small">${esc(l.descripcion)}</div>` : ''}</td>
        <td>${medidasTxt(l)}</td><td class="num">${fmtNum(l.cantidad)}</td><td class="num">${fmtEur(l.precioUnitario)}</td><td class="num">${fmtEur(l.precioTotal)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="right-text">Base ${fmtEur(p.base)} · <strong>Total ${fmtEur(p.total)}</strong> (IVA ${fmtNum(p.iva)} %)</p>
    <div class="btns actions">
      ${p.archivoId ? '<button class="btn ghost" data-orig>Ver original</button>' : ''}
      <button class="btn ghost" data-dup>Duplicar como nuevo</button>
      <button class="btn" data-edit>Abrir para editar</button>
    </div>`;
  dlg.showModal();
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-cerrar]')) dlg.close();
    if (e.target.closest('[data-orig]')) abrirOriginal(p.archivoId);
    if (e.target.closest('[data-edit]')) { dlg.close(); if (editor.abrir(id)) go('nuevo'); }
    if (e.target.closest('[data-dup]')) { dlg.close(); if (editor.duplicar(id)) go('nuevo'); }
  };
}
