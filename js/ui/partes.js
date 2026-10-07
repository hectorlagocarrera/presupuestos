// Partes de trabajo: los albaranes, para buscarlos rápido (por cliente, número o trabajo) y que el cliente firme.
// Es la pantalla de los operarios; pensada para el móvil.
import { $, esc, fmtDate, fmtNum, tipoDe } from '../util.js';
import { normalize } from '../search.js';
import { data, partidasDe, onChange } from '../store.js';
import { firmarAhora, enviarParaFirmar, etiquetaFirma } from './firmas.js';
import { verPresupuesto } from './presview.js';
import { onShow, go } from './nav.js';
import { editor } from './editor.js';

const ESTADOS = [
  ['porfirmar', 'Por firmar', (p) => p.estadoFirma !== 'firmado'],
  ['pendiente', 'Enviados, pendientes', (p) => p.estadoFirma === 'pendiente'],
  ['firmado', 'Firmados', (p) => p.estadoFirma === 'firmado'],
  ['rechazado', 'No conformes', (p) => p.estadoFirma === 'rechazado'],
  ['todos', 'Todos', () => true],
];
let estadoSel = 'porfirmar';
try { estadoSel = localStorage.getItem('partesEstado') || 'porfirmar'; } catch { /* sin almacenamiento */ }

function texto(p) {
  const lineas = partidasDe(p.id).map((l) => l.articulo).join(' ');
  return normalize(`${p.numero} ${p.clienteNombre} ${lineas}`);
}

function tarjeta(p) {
  const lineas = partidasDe(p.id);
  const firmado = p.estadoFirma === 'firmado';
  return `
    <article class="parte ${p.estadoFirma || 'sin'}">
      <div class="parte-cab"><span class="parte-num">${esc(p.numero || 'sin número')}</span><span class="muted">${fmtDate(p.fecha)}</span>${etiquetaFirma(p, { corta: true })}</div>
      <div class="parte-cliente">${esc(p.clienteNombre || 'Sin cliente')}</div>
      <ul class="parte-lineas">${lineas.slice(0, 3).map((l) => `<li>${l.cantidad != null && l.cantidad !== 1 ? `<b>${fmtNum(l.cantidad)} ×</b> ` : ''}${esc(l.articulo)}</li>`).join('')}
        ${lineas.length > 3 ? `<li class="muted">y ${lineas.length - 3} más…</li>` : ''}</ul>
      <div class="btns">
        ${firmado ? '' : `<button class="btn" data-pt-firmar="${esc(p.id)}">✍ Firmar</button><button class="btn ghost" data-pt-enviar="${esc(p.id)}">Enviar para firmar</button>`}
        <button class="btn ghost" data-pt-ver="${esc(p.id)}">${firmado ? 'Ver firma' : 'Ver'}</button>
      </div>
    </article>`;
}

export function initPartes() {
  const run = () => {
    const albaranes = data.presupuestos.filter((p) => tipoDe(p) === 'albaran');
    $('#ptEstados').innerHTML = ESTADOS.map(([k, nombre, f]) => `<button class="chip ${k === estadoSel ? 'on' : ''}" data-e="${k}">${nombre} <small>${albaranes.filter(f).length}</small></button>`).join('');
    const q = normalize($('#ptQ').value.trim());
    const palabras = q.split(/\s+/).filter(Boolean);
    const filtro = ESTADOS.find(([k]) => k === estadoSel)?.[2] || (() => true);
    const lista = albaranes.filter(filtro).filter((p) => !palabras.length || palabras.every((w) => texto(p).includes(w)))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || String(b.numero || '').localeCompare(String(a.numero || ''), 'es', { numeric: true }));
    $('#ptInfo').textContent = lista.length ? `${lista.length} ${lista.length === 1 ? 'parte' : 'partes'}${lista.length > 60 ? ' (se muestran los 60 más recientes; busca para encontrar otros)' : ''}`
      : (albaranes.length ? 'Ningún parte con ese filtro.' : 'Todavía no hay albaranes.');
    $('#ptLista').innerHTML = lista.slice(0, 60).map(tarjeta).join('');
  };
  $('#ptQ').addEventListener('input', run);
  $('#ptEstados').addEventListener('click', (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    estadoSel = b.dataset.e;
    try { localStorage.setItem('partesEstado', estadoSel); } catch { /* sin almacenamiento */ }
    run();
  });
  $('#ptLista').addEventListener('click', (e) => {
    const f = e.target.closest('[data-pt-firmar]'); if (f) firmarAhora(f.dataset.ptFirmar);
    const en = e.target.closest('[data-pt-enviar]'); if (en) enviarParaFirmar(en.dataset.ptEnviar);
    const v = e.target.closest('[data-pt-ver]'); if (v) verPresupuesto(v.dataset.ptVer);
  });
  $('#ptNuevo').addEventListener('click', () => { if (editor.nuevo()) go('nuevo'); });
  onShow('partes', run);
  onChange(() => { if (!$('#s-partes').classList.contains('hidden')) run(); });
}
