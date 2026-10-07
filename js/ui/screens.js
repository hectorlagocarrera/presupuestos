// Pantallas de consulta: buscador histórico, artículos, presupuestos anteriores y clientes.
import { $, esc, fmtEur, fmtNum, fmtDate, debounce, year, tipoDe, TIPOS } from '../util.js';
import { search, similares, priceStats, parseQuery, classify } from '../search.js';
import { data, searchDocs, anios, partidasDe, savePartida, deletePresupuesto, saveCliente, deleteCliente, onChange, recalcularCategorias } from '../store.js';
import { resultCard, statsHtml, mountFiltros, fillSelect, modalForm, medidasTxt, categorias, toast } from './common.js';
import { verPresupuesto, abrirOriginal } from './presview.js';
import { editor } from './editor.js';
import { go, onShow } from './nav.js';

const visible = (id) => !$('#' + id).classList.contains('hidden');

// ---------- 2. Buscador histórico ----------

export function initBuscador() {
  const readF = mountFiltros($('#bFiltros'), () => run());
  const run = () => {
    const q = $('#bQ').value.trim();
    const f = readF();
    const filtrado = q || f.categoria || f.anio || f.min != null || f.max != null;
    if (!filtrado) {
      $('#bStats').innerHTML = '';
      $('#bInfo').textContent = data.partidas.length
        ? `${data.partidas.length} trabajos en el histórico. Escribe lo que buscas: material, medidas, tipo de trabajo…`
        : 'El histórico está vacío. Importa los presupuestos, albaranes o facturas en la pestaña «Importar».';
      $('#bList').innerHTML = '';
      return;
    }
    const res = search(q, searchDocs(), f);
    const stats = priceStats(q ? similares(res) : res, parseQuery(q).dims);
    $('#bStats').innerHTML = statsHtml(stats, res.length);
    $('#bInfo').textContent = res.length ? `${res.length} resultados${res.length > 100 ? ' (se muestran los 100 más parecidos)' : ''}` : 'Sin resultados. Prueba con menos palabras o con otro sinónimo.';
    $('#bList').innerHTML = res.slice(0, 100).map((r) => resultCard(r, { score: !!q })).join('');
  };
  $('#bQ').addEventListener('input', debounce(run, 120));
  $('#bList').addEventListener('click', (e) => {
    const use = e.target.closest('[data-use]');
    if (use) { editor.usar(use.dataset.use); go('nuevo'); }
    const ver = e.target.closest('[data-ver]');
    if (ver) verPresupuesto(ver.dataset.ver);
  });
  onShow('buscar', () => { readF.refresh(); run(); $('#bQ').focus(); });
  onChange(() => { if (visible('s-buscar')) { readF.refresh(); run(); } });
}

// ---------- 3. Artículos / trabajos ----------

async function editarPartida(p) {
  const r = await modalForm('Editar partida', [
    { k: 'articulo', label: 'Artículo / trabajo', value: p.articulo, wide: true },
    { k: 'descripcion', label: 'Descripción', value: p.descripcion, type: 'textarea', wide: true },
    { k: 'categoria', label: 'Categoría', value: p.categoria, list: 'dlCategorias' },
    { k: 'material', label: 'Material', value: p.material, list: 'dlMateriales' },
    { k: 'ancho', label: 'Ancho (m)', value: fmtNum(p.ancho), num: true },
    { k: 'alto', label: 'Alto (m)', value: fmtNum(p.alto), num: true },
    { k: 'cantidad', label: 'Cantidad', value: fmtNum(p.cantidad), num: true },
    { k: 'precioUnitario', label: 'Precio unitario (€)', value: fmtNum(p.precioUnitario), num: true },
    { k: 'acabados', label: 'Acabados', value: p.acabados },
    { k: 'montaje', label: 'Montaje', value: p.montaje },
    { k: 'observaciones', label: 'Observaciones', value: p.observaciones, wide: true },
  ], { okText: 'Guardar (marcar como revisada)' });
  if (!r) return;
  await savePartida({ ...p, ...r, m2: null, precioTotal: null, revisar: false });
  toast('Partida guardada');
}

export function initArticulos() {
  const run = () => {
    fillSelect($('#aCat'), categorias(), 'Todas las categorías');
    fillSelect($('#aAnio'), anios().map(String), 'Todos los años');
    const q = $('#aQ').value.trim();
    const f = { categoria: $('#aCat').value, anio: $('#aAnio').value };
    let rows = search(q, searchDocs(), f).map((r) => r.doc.p);
    if (!q) rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const porRevisar = data.partidas.filter((p) => p.revisar).length;
    if ($('#aRevisar').checked) rows = rows.filter((p) => p.revisar);
    $('#aInfo').textContent = `${rows.length} de ${data.partidas.length} partidas${porRevisar ? ` · ${porRevisar} por revisar` : ''}`;
    $('#aTabla').innerHTML = rows.slice(0, 400).map((p) => `
      <tr class="${p.revisar ? 'flag' : ''}">
        <td>${fmtDate(p.fecha)}</td>
        <td><strong>${esc(p.articulo)}</strong>${p.descripcion ? `<div class="muted small clamp">${esc(p.descripcion)}</div>` : ''}</td>
        <td>${esc(p.categoria)}</td>
        <td>${esc(p.material)}</td>
        <td class="nowrap">${medidasTxt(p)}</td>
        <td class="num">${fmtNum(p.cantidad)}</td>
        <td class="num"><strong>${fmtEur(p.precioUnitario)}</strong></td>
        <td class="num">${p.precioM2 ? fmtEur(p.precioM2) : ''}</td>
        <td class="num">${fmtEur(p.precioTotal)}</td>
        <td class="small">${esc(p.numero || '')}<div class="muted">${esc(p.cliente || '')}</div></td>
        <td class="nowrap acciones"><button class="btn small ghost" data-edit="${esc(p.id)}">${p.revisar ? 'Revisar' : 'Editar'}</button>
          <button class="btn small ghost" data-use="${esc(p.id)}" title="Usar como referencia en el albarán que estás haciendo">Usar</button></td>
      </tr>`).join('') || '<tr><td colspan="11" class="muted">No hay partidas.</td></tr>';
  };
  $('#aQ').addEventListener('input', debounce(run, 150));
  ['#aCat', '#aAnio', '#aRevisar'].forEach((s) => $(s).addEventListener('change', run));
  $('#aTabla').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) editarPartida(data.partidas.find((p) => p.id === ed.dataset.edit));
    const use = e.target.closest('[data-use]');
    if (use) { editor.usar(use.dataset.use); go('nuevo'); }
  });
  $('#aRecalcular').addEventListener('click', async () => {
    if (!confirm('Se volverán a calcular la categoría y el material de todas las partidas con los sinónimos actuales. Los que hayas cambiado a mano también se recalculan. ¿Continuar?')) return;
    const n = await recalcularCategorias(classify);
    toast(n ? `${n} partidas actualizadas` : 'Todas las categorías estaban al día');
  });
  onShow('articulos', run);
  onChange(() => { if (visible('s-articulos')) run(); });
}

// ---------- 4. Presupuestos anteriores ----------

let anioSel = '';
let clienteSel = '';
let tipoSel = '';
export function filtrarPorCliente(nombre) { clienteSel = nombre; anioSel = ''; go('presupuestos'); }

// Orden de la lista. Al pulsar una columna nueva: fechas, números e importes de mayor a menor; textos de la A a la Z.
const ORDEN_INICIAL = { fecha: 'desc', numero: 'desc', tipo: 'asc', cliente: 'asc', partidas: 'desc', base: 'desc', total: 'desc' };
let orden = { campo: 'fecha', dir: 'desc' };
try { const o = JSON.parse(localStorage.getItem('ordenAlbaranes')); if (o && ORDEN_INICIAL[o.campo]) orden = o; } catch { /* orden por defecto */ }

const natural = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
const CLAVES = {
  fecha: (p) => p.fecha || '',
  numero: (p) => p.numero || '',
  tipo: (p) => TIPOS[tipoDe(p)].nombre,
  cliente: (p) => (p.clienteNombre || '').trim(),
  partidas: (p) => partidasDe(p.id).length,
  base: (p) => p.base || 0,
  total: (p) => p.total || 0,
};
function ordenar(a, b) {
  const k = CLAVES[orden.campo];
  const va = k(a); const vb = k(b);
  // Lo que no tiene número o cliente va siempre al final.
  if (va === '' && vb !== '') return 1;
  if (vb === '' && va !== '') return -1;
  const c = typeof va === 'number' ? va - vb : natural(va, vb);
  // Empate: por fecha y número, de lo más reciente a lo más antiguo.
  return (orden.dir === 'asc' ? c : -c) || natural(b.fecha || '', a.fecha || '') || natural(b.numero || '', a.numero || '');
}
function pintarOrden() {
  $('#pCab').querySelectorAll('th[data-orden]').forEach((th) => {
    if (th.dataset.orden === orden.campo) th.setAttribute('aria-sort', orden.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    th.title = 'Ordenar por ' + th.textContent.trim().toLowerCase();
  });
  const sel = $('#pOrden');
  const v = `${orden.campo}:${orden.dir}`;
  if (![...sel.options].some((o) => o.value === v)) sel.add(new Option(`${$(`#pCab th[data-orden=${orden.campo}]`).textContent.trim()} (${orden.dir === 'asc' ? 'de menor a mayor' : 'de mayor a menor'})`, v));
  sel.value = v;
}

export function initPresupuestos() {
  const run = () => {
    const ys = anios();
    const n = (t) => data.presupuestos.filter((p) => !t || tipoDe(p) === t).length;
    $('#pTipos').innerHTML = [['', 'Todos'], ['albaran', 'Albaranes'], ['presupuesto', 'Presupuestos'], ['factura', 'Facturas']]
      .map(([t, nombre]) => `<button class="chip ${t === tipoSel ? 'on' : ''}" data-t="${t}">${nombre} <small>${n(t)}</small></button>`).join('');
    $('#pAnios').innerHTML = ['', ...ys].map((y) => `<button class="chip ${String(y) === String(anioSel) ? 'on' : ''}" data-y="${y}">${y || 'Todos'} <small>${data.presupuestos.filter((p) => !y || year(p.fecha) === y).length}</small></button>`).join('')
      + (clienteSel ? `<button class="chip on" data-quitar>Cliente: ${esc(clienteSel)} ✕</button>` : '');
    const q = $('#pQ').value.trim();
    const conceptos = q ? new Set(search(q, searchDocs()).filter((r) => r.score >= 60).map((r) => r.doc.p.presupuestoId)) : null;
    const nq = q.toLowerCase();
    const rows = data.presupuestos
      .filter((p) => !tipoSel || tipoDe(p) === tipoSel)
      .filter((p) => !anioSel || year(p.fecha) === Number(anioSel))
      .filter((p) => !clienteSel || p.clienteNombre === clienteSel)
      .filter((p) => !q || (p.numero || '').toLowerCase().includes(nq) || (p.clienteNombre || '').toLowerCase().includes(nq) || conceptos.has(p.id))
      .sort(ordenar);
    pintarOrden();
    $('#pTabla').innerHTML = rows.slice(0, 500).map((p) => `
      <tr>
        <td>${fmtDate(p.fecha)}</td>
        <td><a href="#" data-ver="${esc(p.id)}">${p.numero ? esc(p.numero) : '<span class="muted">sin número</span>'}</a></td>
        <td><span class="tag ${tipoDe(p) === 'factura' ? 'fact' : 'soft'}">${TIPOS[tipoDe(p)].nombre}</span></td>
        <td>${esc(p.clienteNombre)}</td>
        <td class="num">${partidasDe(p.id).length}</td>
        <td class="num">${fmtEur(p.base)}</td>
        <td class="num"><strong>${fmtEur(p.total)}</strong></td>
        <td class="small">${p.origen === 'importado' ? 'Importado' : 'Creado aquí'}${p.archivoId ? ` · <a href="#" data-orig="${esc(p.archivoId)}" title="${esc(p.archivoNombre)}">original</a>` : ''}</td>
        <td class="nowrap acciones">
          <button class="btn small" data-abrir="${esc(p.id)}">Abrir</button>
          <button class="btn small ghost" data-dup="${esc(p.id)}">Duplicar</button>
          <button class="btn small ghost" data-del="${esc(p.id)}" title="Borrar">✕</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">No hay documentos con ese filtro.</td></tr>';
  };
  $('#pQ').addEventListener('input', debounce(run, 150));
  // Ordenar pulsando el título de la columna (otra vez: al revés) o, en el móvil, con el desplegable.
  const cambiarOrden = (campo, dir) => {
    orden = { campo, dir: dir || (orden.campo === campo ? (orden.dir === 'asc' ? 'desc' : 'asc') : ORDEN_INICIAL[campo]) };
    try { localStorage.setItem('ordenAlbaranes', JSON.stringify(orden)); } catch { /* sin almacenamiento: no pasa nada */ }
    run();
  };
  $('#pCab').querySelectorAll('th[data-orden]').forEach((th) => { th.tabIndex = 0; });
  $('#pCab').addEventListener('click', (e) => { const th = e.target.closest('th[data-orden]'); if (th && !e.target.closest('.ayuda')) cambiarOrden(th.dataset.orden); });
  $('#pCab').addEventListener('keydown', (e) => {
    const th = e.target.closest('th[data-orden]');
    if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cambiarOrden(th.dataset.orden); }
  });
  $('#pOrden').addEventListener('change', (e) => { const [c, d] = e.target.value.split(':'); cambiarOrden(c, d); });
  $('#pTipos').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) { tipoSel = b.dataset.t; run(); }
  });
  $('#pAnios').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.hasAttribute('data-quitar')) clienteSel = '';
    else anioSel = b.dataset.y;
    run();
  });
  $('#pTabla').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-ver],[data-orig],[data-abrir],[data-dup],[data-del]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.ver) verPresupuesto(t.dataset.ver);
    if (t.dataset.orig) abrirOriginal(t.dataset.orig);
    if (t.dataset.abrir && editor.abrir(t.dataset.abrir)) go('nuevo');
    if (t.dataset.dup && editor.duplicar(t.dataset.dup)) go('nuevo');
    if (t.dataset.del) {
      const p = data.presupuestos.find((x) => x.id === t.dataset.del);
      if (!confirm(`¿Borrar ${tipoDe(p) === 'factura' ? 'la' : 'el'} ${TIPOS[tipoDe(p)].nombre.toLowerCase()} ${p.numero || ''} de ${p.clienteNombre || 'sin cliente'}? Sus partidas dejarán de salir en el histórico.`)) return;
      await deletePresupuesto(p.id);
      toast(`${TIPOS[tipoDe(p)].nombre} borrad${tipoDe(p) === 'factura' ? 'a' : 'o'}`);
    }
  });
  onShow('presupuestos', run);
  onChange(() => { if (visible('s-presupuestos')) run(); });
}

// ---------- Facturas ----------

export function initFacturas() {
  const run = () => {
    const facturas = data.presupuestos.filter((p) => p.tipo === 'factura');
    fillSelect($('#fCat'), categorias(), 'Todas las categorías');
    fillSelect($('#fAnio'), [...new Set(facturas.map((p) => year(p.fecha)).filter(Boolean))].sort((a, b) => b - a).map(String), 'Todos los años');
    // Resumen por año (base imponible).
    const porAnio = new Map();
    for (const f of facturas) { const y = year(f.fecha); porAnio.set(y, (porAnio.get(y) || 0) + (f.base || 0)); }
    $('#fResumen').innerHTML = facturas.length
      ? `<div><span>Facturas</span><strong>${facturas.length}</strong></div>`
        + `<div><span>Partidas facturadas</span><strong>${data.partidas.filter((p) => p.tipo === 'factura').length}</strong></div>`
        + [...porAnio].sort((a, b) => b[0] - a[0]).map(([y, t]) => `<div><span>Facturado ${y} (base)</span><strong>${fmtEur(t)}</strong></div>`).join('')
      : '';
    const q = $('#fQ').value.trim();
    const cli = $('#fCliente').value.trim().toLowerCase();
    let rows = search(q, searchDocs(), { categoria: $('#fCat').value, anio: $('#fAnio').value, tipo: 'facturado' }).map((r) => r.doc.p);
    if (cli) rows = rows.filter((p) => (p.cliente || '').toLowerCase().includes(cli));
    if (!q) rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    $('#fInfo').textContent = facturas.length ? `${rows.length} partidas` : '';
    $('#fTabla').innerHTML = rows.slice(0, 400).map((p) => `
      <tr>
        <td>${fmtDate(p.fecha)}</td>
        <td><a href="#" data-ver="${esc(p.presupuestoId)}">${p.numero ? esc(p.numero) : '<span class="muted">sin número</span>'}</a></td>
        <td>${esc(p.cliente || '')}</td>
        <td><strong>${esc(p.articulo)}</strong>${p.descripcion ? `<div class="muted small clamp">${esc(p.descripcion)}</div>` : ''}</td>
        <td class="nowrap">${medidasTxt(p)}</td>
        <td class="num">${fmtNum(p.cantidad)}</td>
        <td class="num"><strong>${fmtEur(p.precioUnitario)}</strong></td>
        <td class="num">${p.precioM2 ? fmtEur(p.precioM2) : ''}</td>
        <td class="num">${fmtEur(p.precioTotal)}</td>
        <td class="nowrap acciones"><button class="btn small ghost" data-use="${esc(p.id)}" title="Usar como referencia en el albarán que estás haciendo">Usar</button></td>
      </tr>`).join('') || `<tr><td colspan="10" class="muted">${facturas.length ? 'No hay partidas con ese filtro.' : 'Todavía no hay facturas. Impórtalas en «Importar» (se reconocen por el título «FACTURA»).'}</td></tr>`;
  };
  $('#fQ').addEventListener('input', debounce(run, 150));
  $('#fCliente').addEventListener('input', debounce(run, 200));
  ['#fCat', '#fAnio'].forEach((s) => $(s).addEventListener('change', run));
  $('#fTabla').addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]');
    if (ver) { e.preventDefault(); verPresupuesto(ver.dataset.ver); }
    const use = e.target.closest('[data-use]');
    if (use) { editor.usar(use.dataset.use); go('nuevo'); }
  });
  onShow('facturas', run);
  onChange(() => { if (visible('s-facturas')) run(); });
}

// ---------- 5. Clientes ----------

async function editarCliente(c = {}) {
  const r = await modalForm(c.id ? 'Editar cliente' : 'Nuevo cliente', [
    { k: 'nombre', label: 'Nombre', value: c.nombre, wide: true },
    { k: 'cif', label: 'CIF / NIF', value: c.cif },
    { k: 'telefono', label: 'Teléfono', value: c.telefono },
    { k: 'email', label: 'Email', value: c.email },
    { k: 'direccion', label: 'Dirección', value: c.direccion },
    { k: 'notas', label: 'Notas', value: c.notas, type: 'textarea', wide: true },
  ]);
  if (!r || !r.nombre.trim()) return;
  await saveCliente({ ...c, ...r });
  toast('Cliente guardado');
}

export function initClientes() {
  const run = () => {
    const q = $('#cQ').value.trim().toLowerCase();
    const info = new Map();
    for (const p of data.presupuestos) {
      const k = p.clienteNombre;
      const i = info.get(k) || { n: 0, ultimo: '' };
      i.n++; if ((p.fecha || '') > i.ultimo) i.ultimo = p.fecha;
      info.set(k, i);
    }
    const rows = data.clientes.filter((c) => !q || c.nombre.toLowerCase().includes(q) || (c.cif || '').toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('#cTabla').innerHTML = rows.slice(0, 500).map((c) => {
      const i = info.get(c.nombre) || { n: 0, ultimo: '' };
      return `<tr>
        <td><strong>${esc(c.nombre)}</strong></td>
        <td>${esc(c.cif)}</td>
        <td class="small">${[c.telefono, c.email].filter(Boolean).map(esc).join('<br>')}</td>
        <td class="num">${i.n}</td>
        <td>${fmtDate(i.ultimo)}</td>
        <td class="nowrap acciones">
          <button class="btn small ghost" data-edit="${esc(c.id)}">Editar</button>
          <button class="btn small ghost" data-pres="${esc(c.nombre)}" ${i.n ? '' : 'disabled'}>Documentos</button>
          <button class="btn small" data-nuevo="${esc(c.nombre)}">Nuevo albarán</button>
          ${i.n ? '' : `<button class="btn small ghost" data-del="${esc(c.id)}" title="Borrar">✕</button>`}
        </td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No hay clientes. Se crean solos al guardar albaranes o importar documentos.</td></tr>';
  };
  $('#cQ').addEventListener('input', debounce(run, 150));
  $('#cNuevo').addEventListener('click', () => editarCliente());
  $('#cTabla').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.edit) editarCliente(data.clientes.find((c) => c.id === t.dataset.edit));
    if (t.dataset.pres) filtrarPorCliente(t.dataset.pres);
    if (t.dataset.nuevo) {
      if (!editor.nuevo()) return;
      const input = $('#edCliente');
      input.value = t.dataset.nuevo;
      input.dispatchEvent(new Event('input'));
      go('nuevo');
    }
    if (t.dataset.del && confirm('¿Borrar este cliente?')) await deleteCliente(t.dataset.del);
  });
  onShow('clientes', run);
  onChange(() => { if (visible('s-clientes')) run(); });
}

