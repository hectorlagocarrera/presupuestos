// Pantalla Tarifa → «Tarifa oficial»: los artículos de la tarifa importada (PDF o Excel), por secciones,
// con su precio comparado con lo que se ha cobrado en el histórico, y botón para añadirlos al albarán.
import { $, esc, fmtEur, fmtDate } from '../util.js';
import { search, similares, priceStats, classify, normalize } from '../search.js';
import { data, searchDocs, borrarCatalogo, onChange } from '../store.js';
import { comoArticuloEditor } from '../catalogo.js';
import { toast, loadScript } from './common.js';
import { editor } from './editor.js';
import { go, onShow } from './nav.js';

let vista = null; // 'oficial' | 'historico'
try { vista = localStorage.getItem('tarifaVista'); } catch { /* sin almacenamiento */ }
const abiertas = new Set();

const unidadCorta = (a) => (a.porM2 ? '/m²' : '');
const coincide = (a, q) => normalize(`${a.codigo} ${a.descripcion} ${a.seccion} ${a.observaciones}`).includes(normalize(q))
  || normalize(q).split(/\s+/).filter(Boolean).every((w) => normalize(`${a.codigo} ${a.descripcion} ${a.seccion}`).includes(w));

// Lo cobrado en el histórico por trabajos parecidos (€/m² si va por m²).
function historico(a) {
  if (a.precio == null || a.tipo.startsWith('ajuste') || a.tipo.startsWith('suplemento')) return null;
  const res = search(a.descripcion, searchDocs());
  const s = priceStats(similares(res));
  if (!s) return null;
  const valor = a.porM2 ? s.m2?.mediana : s.medio;
  if (!valor) return null;
  return { valor, n: s.n, distinto: Math.abs(valor - a.precio) / a.precio > 0.25 };
}

function filaHtml(a, conHist) {
  const h = conHist ? historico(a) : null;
  return `<tr>
    <td data-l="Código" class="mono">${esc(a.codigo)}</td>
    <td data-l="Descripción"><strong>${esc(a.descripcion)}</strong>${a.observaciones ? `<div class="muted small">${esc(a.observaciones)}</div>` : ''}</td>
    <td data-l="Precio" class="num to-precio">${a.precio == null ? '<span class="tag warn">Consultar</span>' : `${esc(a.precioTexto)}`}</td>
    <td data-l="Unidad" class="small">${esc(a.unidad)}</td>
    <td data-l="En el histórico" class="num">${h ? `<span class="to-hist ${h.distinto ? 'distinto' : ''}" title="Lo habitual en ${h.n} trabajos parecidos del histórico${h.distinto ? ' (más de un 25 % de diferencia)' : ''}">≈ ${fmtEur(h.valor)}${unidadCorta(a)}</span>` : '<span class="muted small">—</span>'}</td>
    <td class="acciones"><button class="btn small" data-to-anadir="${esc(a.id)}" title="Añadir al albarán que estás haciendo">Añadir</button></td>
  </tr>`;
}

function pintar() {
  const hay = data.catalogo.length > 0;
  const vistas = [['oficial', `Tarifa oficial${hay ? ` (${data.catalogo.length})` : ''}`], ['historico', 'Sacada del histórico']];
  if (!vista) vista = hay ? 'oficial' : 'historico';
  $('#tVistas').innerHTML = vistas.map(([k, t]) => `<button class="chip ${k === vista ? 'on' : ''}" data-v="${k}">${t}</button>`).join('');
  $('#tOficialPane').classList.toggle('hidden', vista !== 'oficial');
  $('#tHistPane').classList.toggle('hidden', vista !== 'historico');
  if (vista !== 'oficial') return;
  if (!hay) {
    $('#toInfo').innerHTML = 'Todavía no hay tarifa oficial. Sube tu tarifa en <strong>Importar</strong> (PDF o Excel con las columnas Código, Descripción, Precio y Unidad).';
    $('#toLista').innerHTML = '';
    $('#toBorrar').classList.add('hidden'); $('#toExcel').classList.add('hidden');
    return;
  }
  $('#toBorrar').classList.remove('hidden'); $('#toExcel').classList.remove('hidden');
  const a0 = data.catalogo[0];
  $('#toInfo').textContent = `${data.catalogo.length} artículos${a0.origen ? ` · de «${a0.origen}»` : ''}${a0.actualizado ? ` · ${fmtDate(a0.actualizado.slice(0, 10))}` : ''}. «En el histórico»: lo habitual en trabajos parecidos que ya habéis hecho (en naranja si difiere más de un 25 %).`;
  const q = $('#toQ').value.trim();
  const lista = q ? data.catalogo.filter((a) => coincide(a, q)) : data.catalogo;
  const secciones = [...new Set(lista.map((a) => a.seccion || 'Sin sección'))];
  $('#toLista').innerHTML = secciones.map((sec) => {
    const arts = lista.filter((a) => (a.seccion || 'Sin sección') === sec);
    const abierta = q || abiertas.has(sec);
    return `<details class="to-seccion" data-sec="${esc(sec)}" ${abierta ? 'open' : ''}>
      <summary>${esc(sec)} <small>${arts.length} artículo${arts.length === 1 ? '' : 's'}</small></summary>
      ${abierta ? `<div class="table-wrap"><table class="data cards"><thead><tr><th>Código</th><th>Descripción</th><th class="num">Precio</th><th>Unidad</th><th class="num">En el histórico</th><th></th></tr></thead>
        <tbody>${arts.map((a) => filaHtml(a, true)).join('')}</tbody></table></div>` : ''}
    </details>`;
  }).join('') || '<p class="muted">Ningún artículo coincide.</p>';
}

async function excel() {
  await loadScript('vendor/xlsx.full.min.js');
  const filas = [['Sección', 'Código', 'Descripción', 'Precio', 'Unidad', 'Observaciones', 'Importe (€)'],
    // «Precio» tal cual (con «+», «Consultar», «+ IVA») para poder volver a importar el Excel sin perder nada.
    ...data.catalogo.map((a) => [a.seccion, a.codigo, a.descripcion, a.precioTexto, a.unidad, a.observaciones, a.precio])];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(filas), 'Tarifa oficial');
  window.XLSX.writeFile(wb, 'tarifa-oficial.xlsx');
}

export function initCatalogo() {
  $('#tVistas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    vista = b.dataset.v;
    try { localStorage.setItem('tarifaVista', vista); } catch { /* sin almacenamiento */ }
    pintar();
  });
  $('#toQ').addEventListener('input', pintar);
  $('#toLista').addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details[data-sec]');
    if (!d) return;
    const sec = d.dataset.sec;
    if (d.open && !abiertas.has(sec)) { abiertas.add(sec); pintar(); } else if (!d.open) abiertas.delete(sec);
  }, true);
  $('#toLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-to-anadir]');
    if (!b) return;
    const a = data.catalogo.find((x) => x.id === b.dataset.toAnadir);
    if (!a) return;
    editor.desdeTarifa(comoArticuloEditor(a, classify(`${a.descripcion} ${a.seccion}`).categoria), a.precio);
    toast(a.porM2 ? 'Añadido. Escribe las medidas en el artículo (p. ej. 3x2): el precio se calcula con la tarifa.' : 'Añadido al albarán');
    go('nuevo');
  });
  $('#toExcel').addEventListener('click', () => excel().catch((err) => toast(err.message)));
  $('#toBorrar').addEventListener('click', async () => {
    if (!confirm(`¿Borrar la tarifa oficial (${data.catalogo.length} artículos)? Los albaranes no cambian. Puedes volver a importarla cuando quieras.`)) return;
    try { await borrarCatalogo(); toast('Tarifa oficial borrada'); } catch (err) { toast(err.message); }
  });
  onShow('tarifa', pintar);
  onChange(() => { if (!$('#s-tarifa').classList.contains('hidden')) pintar(); });
}
