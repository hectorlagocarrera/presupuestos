// Pantalla «Tarifa»: tarifa de precios sacada de todos los presupuestos, editable, en Excel o impresa.
import { $, esc, fmtEur, fmtNum, fmtDate, debounce, numOrNull, today } from '../util.js';
import { tokenize } from '../search.js';
import { generarTarifa, precioTarifa } from '../tarifa.js';
import { data, saveAjustes, onChange } from '../store.js';
import { fillSelect, toast, loadScript } from './common.js';
import { verPresupuesto } from './presview.js';
import { onShow, go } from './nav.js';
import { editor } from './editor.js';

let tarifa = null;      // se recalcula cuando cambian los datos
const abiertos = new Set(); // artículos con los ejemplos desplegados

const manuales = () => data.ajustes.tarifa || {};
const ajuste = () => Number(data.ajustes.tarifaAjuste) || 0;
const ocultos = () => data.ajustes.tarifaOcultos || [];

function calcular() {
  if (!tarifa) tarifa = generarTarifa(data.partidas);
  return tarifa;
}

// Todas las palabras buscadas deben aparecer (al principio de alguna palabra del artículo).
function coincide(texto, q) {
  const palabras = tokenize(texto);
  return tokenize(q).every((w) => palabras.some((p) => p.startsWith(w)));
}

function filtrada() {
  const q = $('#tQ').value.trim();
  const cat = $('#tCat').value;
  const rep = $('#tRepetidos').checked;
  const verOcultos = $('#tOcultos').checked;
  const ocu = new Set(ocultos());
  return calcular().filter((a) => (verOcultos ? ocu.has(a.clave) : !ocu.has(a.clave)) && (!rep || a.veces >= 2) && (!cat || a.categoria === cat) && (!q || coincide(a.nombre + ' ' + a.categoria, q)));
}

function render() {
  const todos = calcular();
  fillSelect($('#tCat'), [...new Set(todos.map((a) => a.categoria))], 'Todas las categorías');
  const lista = filtrada();
  const fijados = Object.keys(manuales()).length;
  const nOcultos = ocultos().length;
  $('#tInfo').textContent = $('#tOcultos').checked
    ? `${lista.length} artículos quitados de la tarifa. Pulsa ↺ para volver a incluirlos.`
    : `${lista.length} artículos (de ${todos.length} distintos en el histórico)${fijados ? ` · ${fijados} con precio fijado a mano` : ''}${nOcultos ? ` · ${nOcultos} quitados` : ''}`;
  let html = '';
  let cat = null;
  for (const a of lista.slice(0, 1500)) {
    if (a.categoria !== cat) { cat = a.categoria; html += `<tr class="cat"><td colspan="8">${esc(cat)}</td></tr>`; }
    const m = manuales()[a.clave];
    const fijado = m != null && m !== '';
    html += `
      <tr data-k="${esc(a.clave)}">
        <td class="nombre" title="Ver los trabajos de los que sale">${abiertos.has(a.clave) ? '▾' : '▸'} ${esc(a.nombre)}</td>
        <td>${a.unidad === 'm²' ? '€/m²' : 'unidad'}</td>
        <td class="num">${fmtEur(a.sugerido)}</td>
        <td class="num muted">${a.min === a.max ? '' : `${fmtEur(a.min)} – ${fmtEur(a.max)}`}</td>
        <td class="num">${a.veces}</td>
        <td class="small">${fmtDate(a.ultimaFecha)} · ${fmtEur(a.ultimoPrecio)}</td>
        <td class="num"><input data-precio inputmode="decimal" class="${fijado ? 'fijado' : ''}" value="${fijado ? fmtNum(m) : ''}" placeholder="${fmtNum(precioTarifa(a, {}, ajuste()))}"></td>
        <td class="nowrap acciones"><button class="btn small" data-anadir title="Añadir al presupuesto que estás haciendo">Añadir</button>
          <button class="icon" data-ocultar title="${$('#tOcultos').checked ? 'Volver a incluir en la tarifa' : 'Quitar de la tarifa'}">${$('#tOcultos').checked ? '↺' : '✕'}</button></td>
      </tr>`;
    if (abiertos.has(a.clave)) {
      html += a.ejemplos.map((p) => `
        <tr class="ej"><td colspan="5">${fmtDate(p.fecha)} · <a href="#" data-ver="${esc(p.presupuestoId)}">nº ${esc(p.numero || '—')}</a> · ${esc(p.cliente || '')} — ${esc(p.articulo)}</td>
        <td class="num">${fmtNum(p.cantidad)} × ${fmtEur(p.precioUnitario)}</td><td class="num">${p.precioM2 ? fmtEur(p.precioM2) + '/m²' : ''}</td><td></td></tr>`).join('');
    }
  }
  $('#tTabla').innerHTML = html || '<tr><td colspan="8" class="muted">No hay artículos. Importa presupuestos para generar la tarifa.</td></tr>';
}

// Lista final (lo que se exporta e imprime): lo filtrado, con el precio de tarifa.
const final = () => filtrada().map((a) => ({ ...a, precio: precioTarifa(a, manuales(), ajuste()) }));

async function excel() {
  await loadScript('vendor/xlsx.full.min.js');
  const X = window.XLSX;
  const filas = [['Categoría', 'Artículo', 'Unidad', 'Precio tarifa (sin IVA)', 'Precio sugerido', 'Mínimo reciente', 'Máximo reciente', 'Veces', 'Último uso']];
  for (const a of final()) {
    filas.push([a.categoria, a.nombre, a.unidad === 'm²' ? '€/m²' : 'unidad', a.precio, a.sugerido, a.min, a.max, a.veces, a.ultimaFecha ? new Date(a.ultimaFecha) : '']);
  }
  const ws = X.utils.aoa_to_sheet(filas, { cellDates: true });
  ws['!cols'] = [{ wch: 20 }, { wch: 60 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 11 }];
  for (let r = 1; r < filas.length; r++) {
    for (const c of [3, 4, 5, 6]) { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell) cell.z = '#,##0.00 €'; }
    const d = ws[X.utils.encode_cell({ r, c: 8 })]; if (d) d.z = 'dd/mm/yyyy';
  }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Tarifa');
  X.writeFile(wb, `tarifa-precios-${today()}.xlsx`);
}

function imprimir() {
  const a = data.ajustes;
  const lista = final();
  let html = `
    <header class="p-head">
      <div><img class="p-logo" src="${esc(a.logo || 'logo.png')}" alt=""><h1>${esc(a.nombre || '')}</h1>
        <p>${[a.cif && 'NIF ' + a.cif, a.direccion, a.contacto].filter(Boolean).map(esc).join('<br>')}</p></div>
      <div class="p-meta"><h2>TARIFA DE PRECIOS</h2><p>${fmtDate(today())}<br>Precios sin IVA</p></div>
    </header>`;
  let cat = null;
  for (const x of lista) {
    if (x.categoria !== cat) {
      if (cat !== null) html += '</table>';
      cat = x.categoria;
      html += `<h3 class="t-cat">${esc(cat)}</h3><table class="t-table">`;
    }
    html += `<tr><td>${esc(x.nombre)}</td><td class="ud">${x.unidad === 'm²' ? '/ m²' : '/ ud'}</td><td class="num">${fmtEur(x.precio)}</td></tr>`;
  }
  if (cat !== null) html += '</table>';
  $('#print').innerHTML = html;
  const old = document.title;
  document.title = `Tarifa de precios ${today()}`;
  window.print();
  document.title = old;
}

export function initTarifa() {
  const visible = () => !$('#s-tarifa').classList.contains('hidden');
  $('#tAjuste').value = data.ajustes.tarifaAjuste ? fmtNum(data.ajustes.tarifaAjuste) : '';
  $('#tQ').addEventListener('input', debounce(render, 150));
  $('#tCat').addEventListener('change', render);
  $('#tRepetidos').addEventListener('change', render);
  $('#tOcultos').addEventListener('change', render);
  $('#tAjuste').addEventListener('input', debounce(async () => {
    await saveAjustes({ tarifaAjuste: numOrNull($('#tAjuste').value) ?? 0 });
    render();
  }, 400));

  // Precio fijado a mano (vacío = volver al sugerido).
  const guardar = debounce(() => saveAjustes({ tarifa: { ...manuales() } }).then(() => toast('Precio de tarifa guardado')), 600);
  $('#tTabla').addEventListener('input', (e) => {
    if (!e.target.hasAttribute('data-precio')) return;
    const k = e.target.closest('tr').dataset.k;
    const v = numOrNull(e.target.value);
    const m = { ...manuales() };
    if (v == null) delete m[k]; else m[k] = v;
    data.ajustes.tarifa = m;
    e.target.classList.toggle('fijado', v != null);
    guardar();
  });
  $('#tTabla').addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]');
    if (ver) { e.preventDefault(); verPresupuesto(ver.dataset.ver); return; }
    const an = e.target.closest('[data-anadir]');
    if (an) {
      const art = calcular().find((a) => a.clave === an.closest('tr').dataset.k);
      editor.desdeTarifa(art, precioTarifa(art, manuales(), ajuste()));
      toast(art.unidad === 'm²' ? 'Añadido. Escribe ancho y alto: el precio se calcula con la tarifa.' : 'Añadido al presupuesto');
      go('nuevo');
      return;
    }
        const oc = e.target.closest('[data-ocultar]');
    if (oc) {
      const k = oc.closest('tr').dataset.k;
      const lista = new Set(ocultos());
      if (lista.has(k)) lista.delete(k); else lista.add(k);
      data.ajustes.tarifaOcultos = [...lista];
      saveAjustes({ tarifaOcultos: [...lista] });
      render();
      return;
    }
    const n = e.target.closest('.nombre');
    if (!n) return;
    const k = n.closest('tr').dataset.k;
    if (abiertos.has(k)) abiertos.delete(k); else abiertos.add(k);
    render();
  });
  $('#tExcel').addEventListener('click', () => excel().catch((err) => toast('No se pudo crear el Excel: ' + err.message)));
  $('#tImprimir').addEventListener('click', imprimir);
  onShow('tarifa', render);
  onChange(() => { tarifa = null; if (visible()) render(); });
}
