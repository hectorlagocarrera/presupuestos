// Pantalla «Nuevo presupuesto»: presupuesto a la izquierda, referencias del histórico a la derecha.
import { $, esc, fmtEur, fmtNum, fmtDate, numOrNull, today, debounce, calcPartida, round, piezasTexto } from '../util.js';
import { search, similares, priceStats, parseQuery, classify, normalize } from '../search.js';
import { data, searchDocs, savePresupuesto, getPresupuesto, partidasDe, nextNumber, clientePorNombre, onChange } from '../store.js';
import { resultCard, statsHtml, mountFiltros, toast } from './common.js';
import { verPresupuesto } from './presview.js';
import { imprimir } from './print.js';
import { onShow } from './nav.js';

const CAMPOS_TEXTO = ['articulo', 'categoria', 'material', 'descripcion', 'acabados', 'montaje', 'observaciones'];
const CAMPOS_NUM = ['ancho', 'alto', 'cantidad', 'precioUnitario'];

let draft = null;   // datos del presupuesto
let lines = [];     // partidas
let active = 0;     // partida activa (la que alimenta el buscador de referencias)
let dirty = false;
let readFiltros;

const emptyLine = () => ({ articulo: '', categoria: '', material: '', descripcion: '', acabados: '', montaje: '', observaciones: '', ancho: null, alto: null, cantidad: 1, precioUnitario: null });
const isEmpty = (l) => !l.articulo && !l.descripcion && !(l.precioUnitario > 0);

function nuevo(base = {}) {
  draft = {
    id: null, numero: nextNumber(base.fecha), autoNumero: true, fecha: today(), clienteNombre: '', iva: data.ajustes.iva,
    notas: data.ajustes.condiciones || '', ...base,
  };
  lines = base.lines || [emptyLine()];
  delete draft.lines;
  active = 0;
  dirty = false;
  render();
}

function confirmarSalida() {
  return !dirty || confirm('Hay cambios sin guardar en el presupuesto actual. ¿Continuar y perderlos?');
}

const copiaPartida = (p) => {
  const l = emptyLine();
  for (const k of [...CAMPOS_TEXTO, ...CAMPOS_NUM]) if (p[k] != null) l[k] = p[k];
  return l;
};

export const editor = {
  nuevo() { if (!confirmarSalida()) return false; nuevo(); return true; },
  abrir(id) {
    if (!confirmarSalida()) return false;
    const p = getPresupuesto(id);
    draft = { ...p };
    lines = partidasDe(id).map((x) => ({ ...x }));
    if (!lines.length) lines = [emptyLine()];
    active = 0; dirty = false;
    render();
    return true;
  },
  duplicar(id) {
    if (!confirmarSalida()) return false;
    const p = getPresupuesto(id);
    nuevo({ clienteNombre: p.clienteNombre, iva: p.iva, notas: p.notas, lines: partidasDe(id).map(copiaPartida) });
    dirty = true;
    toast(`Copia del presupuesto ${p.numero || ''}. Revisa y guarda.`);
    return true;
  },
  // Añade una partida del histórico como referencia. Si la partida activa aún no tiene precio, la sustituye.
  usar(pid) {
    const p = data.partidas.find((x) => x.id === pid);
    if (!p) return;
    const l = copiaPartida(p);
    l.observaciones = ''; // las notas del presupuesto antiguo eran para aquel cliente
    l.ref = { numero: p.numero, fecha: p.fecha, precio: p.precioUnitario, cliente: p.cliente };
    if (lines[active] && !(lines[active].precioUnitario > 0)) lines[active] = l;
    else { lines.push(l); active = lines.length - 1; }
    dirty = true;
    renderLines();
    toast('Partida añadida. Ajusta medidas, cantidad y precio.');
    const card = $(`#edLineas .line[data-i="${active}"]`);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
  // Añade un artículo de la tarifa. Si va por m², el precio se calcula al poner las medidas.
  desdeTarifa(art, precio) {
    const l = emptyLine();
    // Sin las medidas del trabajo antiguo («MEDIDA: 300x100CM»): se ponen las nuevas en ancho y alto.
    l.articulo = art.nombre
      .replace(/\s*(?:medidas?|tama[nñ]o|formato)?\s*:?\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|mts?|m)?\s*[x×*]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|mts?|m)?\b/gi, ' ')
      .replace(/\s+([.,;:])/g, '$1').replace(/[\s:,-]+…?$/, '').replace(/\s+/g, ' ').trim() || art.nombre;
    l.categoria = art.categoria;
    if (art.unidad === 'm²') l.tarifaM2 = precio;
    else l.precioUnitario = precio;
    l.ref = { tarifa: true, precio, unidad: art.unidad };
    if (lines[active] && isEmpty(lines[active])) lines[active] = l;
    else { lines.push(l); active = lines.length - 1; }
    dirty = true;
    renderLines();
    $(`#edLineas .line[data-i="${active}"] [data-f=${art.unidad === 'm²' ? 'ancho' : 'cantidad'}]`)?.focus();
  },
};

// ---------- Render ----------

function render() {
  $('#edTitulo').textContent = draft.id ? `Presupuesto ${draft.numero || ''}` : 'Nuevo presupuesto';
  $('#edCliente').value = draft.clienteNombre || '';
  $('#edNumero').value = draft.numero || '';
  $('#edFecha').value = draft.fecha || '';
  $('#edNotas').value = draft.notas || '';
  $('#edIva').value = fmtNum(draft.iva);
  $('#edMsg').textContent = '';
  clienteInfo();
  renderLines();
  autoRefs();
}

function clienteInfo() {
  const c = clientePorNombre(draft.clienteNombre || '');
  $('#edClienteInfo').textContent = c ? [c.cif, c.direccion, c.telefono, c.email].filter(Boolean).join(' · ') || 'Cliente guardado' : (draft.clienteNombre ? 'Cliente nuevo: se guardará al guardar el presupuesto' : '');
}

const num = (v) => (v == null ? '' : fmtNum(v));

function lineHtml(l, i) {
  const c = calcPartida(l);
  return `
  <div class="line ${i === active ? 'active' : ''}" data-i="${i}">
    <div class="line-head">
      <span class="n">${i + 1}</span>
      <input data-f="articulo" class="art" value="${esc(l.articulo)}" placeholder="Artículo o trabajo (p. ej. Cartel Alupanel 3 mm)">
      <input data-f="categoria" class="cat" list="dlCategorias" value="${esc(l.categoria)}" placeholder="Categoría">
      <span class="tools">
        <button class="icon" data-act="up" title="Subir">↑</button>
        <button class="icon" data-act="down" title="Bajar">↓</button>
        <button class="icon" data-act="del" title="Quitar">✕</button>
      </span>
    </div>
    <div class="line-grid">
      <label class="w2">Material <input data-f="material" list="dlMateriales" value="${esc(l.material)}"></label>
      <label data-ayuda="En metros: 1,5 = 150 cm.">Ancho m <input data-f="ancho" inputmode="decimal" value="${num(l.ancho)}"></label>
      <label>Alto m <input data-f="alto" inputmode="decimal" value="${num(l.alto)}"></label>
      <label data-ayuda="Superficie de una pieza: ancho × alto. Se calcula sola.">m² <output data-o="m2">${c.m2 ? fmtNum(round(c.m2, 2)) : '—'}</output></label>
      <label>Cantidad <input data-f="cantidad" inputmode="decimal" value="${num(l.cantidad)}"></label>
      <label data-ayuda="Precio de una unidad, sin IVA. El total de la línea es precio × cantidad.">Precio ud. <input data-f="precioUnitario" inputmode="decimal" value="${num(l.precioUnitario)}"></label>
      <label data-ayuda="Precio por metro cuadrado. Si lo escribes, el precio por unidad se calcula solo (€/m² × m²). Sirve para comparar trabajos de medidas distintas.">€/m² <input data-f="precioM2" inputmode="decimal" value="${num(c.precioM2)}" ${c.m2 ? '' : 'disabled'} title="Si escribes el precio por m², se calcula el precio por unidad"></label>
      <label>Total <output data-o="total">${fmtEur(c.precioTotal)}</output></label>
    </div>
    <textarea data-f="descripcion" rows="2" placeholder="Descripción">${esc(l.descripcion)}</textarea>
    <button class="btn small ghost solo-movil ver-refs" data-act="refs">Ver trabajos parecidos y precios ↓</button>
    <details ${l.acabados || l.montaje || l.observaciones ? 'open' : ''}>
      <summary>Acabados, montaje y observaciones</summary>
      <div class="line-grid g3">
        <label>Acabados <input data-f="acabados" value="${esc(l.acabados)}"></label>
        <label>Montaje <input data-f="montaje" value="${esc(l.montaje)}"></label>
        <label>Observaciones <input data-f="observaciones" value="${esc(l.observaciones)}"></label>
      </div>
    </details>
    ${l.ref?.tarifa ? `<div class="refnote">De la tarifa: ${fmtEur(l.ref.precio)}${l.ref.unidad === 'm²' ? '/m² · escribe ancho y alto y el precio se calcula solo' : ' por unidad'}</div>` : ''}
    ${l.ref && !l.ref.tarifa ? `<div class="refnote">Referencia: ${fmtEur(l.ref.precio)} · ${fmtDate(l.ref.fecha)}${l.ref.numero ? ' · nº ' + esc(l.ref.numero) : ''}${l.ref.cliente ? ' · ' + esc(l.ref.cliente) : ''}</div>` : ''}
  </div>`;
}

function renderLines() {
  $('#edLineas').innerHTML = lines.map(lineHtml).join('');
  renderTotals();
}

function renderTotals() {
  const base = round(lines.map(calcPartida).reduce((s, l) => s + (l.precioTotal || 0), 0));
  const iva = round(base * (Number(draft.iva) || 0) / 100);
  $('#edBase').textContent = fmtEur(base);
  $('#edCuota').textContent = fmtEur(iva);
  $('#edTotal').textContent = fmtEur(base + iva);
}

function updateOutputs(card, l, skip) {
  const c = calcPartida(l);
  card.querySelector('[data-o=m2]').textContent = c.m2 ? fmtNum(round(c.m2, 2)) : '—';
  card.querySelector('[data-o=total]').textContent = fmtEur(c.precioTotal);
  const pm2 = card.querySelector('[data-f=precioM2]');
  pm2.disabled = !c.m2;
  if (skip !== 'precioM2') pm2.value = num(c.precioM2);
  if (skip !== 'precioUnitario') card.querySelector('[data-f=precioUnitario]').value = num(l.precioUnitario);
}

// Número automático: se recalcula (p. ej. tras importar) mientras no se haya escrito a mano.
function numeroAuto() {
  if (draft.id || !draft.autoNumero) return;
  draft.numero = nextNumber(draft.fecha);
  $('#edNumero').value = draft.numero;
}

// ---------- Referencias ----------

function lineQuery(l) {
  if (!l) return '';
  const med = l.ancho > 0 && l.alto > 0 ? ` ${l.ancho}x${l.alto}` : '';
  const mat = l.material && !normalize(l.articulo).includes(normalize(l.material)) ? l.material : '';
  return [l.articulo, mat].filter(Boolean).join(' ').trim() + med;
}

function autoRefs() {
  $('#refQ').value = lineQuery(lines[active]).trim();
  runRefs();
}

function runRefs() {
  const q = $('#refQ').value.trim();
  const docs = searchDocs().filter((d) => !draft.id || d.p.presupuestoId !== draft.id);
  if (!q) {
    $('#refStats').innerHTML = '';
    $('#refList').innerHTML = data.partidas.length ? '' : '<p class="muted">Todavía no hay histórico. Impórtalo en la pestaña «Importar».</p>';
    $('#refAyuda').classList.remove('hidden');
    return;
  }
  $('#refAyuda').classList.add('hidden');
  const res = search(q, docs, readFiltros());
  const stats = priceStats(similares(res), parseQuery(q).dims);
  $('#refStats').innerHTML = statsHtml(stats, res.length);
  $('#refList').innerHTML = res.slice(0, 40).map((r) => resultCard(r)).join('') || '<p class="muted">Sin trabajos parecidos.</p>';
}
const runRefsSoon = debounce(runRefs, 120);
const autoRefsSoon = debounce(autoRefs, 250);

// ---------- Eventos ----------

export function initEditor() {
  readFiltros = mountFiltros($('#refFiltros'), runRefsSoon);
  onChange(() => { readFiltros.refresh(); if (!$('#s-nuevo').classList.contains('hidden')) runRefsSoon(); });
  onShow('nuevo', () => { readFiltros.refresh(); numeroAuto(); runRefs(); });

  $('#edLineas').addEventListener('focusin', (e) => {
    const card = e.target.closest('.line');
    if (!card) return;
    const i = +card.dataset.i;
    if (i !== active) {
      active = i;
      $('#edLineas').querySelectorAll('.line').forEach((c) => c.classList.toggle('active', +c.dataset.i === i));
      autoRefs();
    }
  });

  $('#edLineas').addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const card = e.target.closest('.line');
    const l = lines[+card.dataset.i];
    dirty = true;
    if (f === 'precioM2') {
      const c = calcPartida(l);
      const v = numOrNull(e.target.value);
      const piezas = l.cantidad === 1 || l.cantidad == null ? piezasTexto(l.articulo) : 1;
      if (c.m2 && v != null) l.precioUnitario = round(v * c.m2 * piezas, 2);
    } else if (CAMPOS_NUM.includes(f)) l[f] = numOrNull(e.target.value);
    else l[f] = e.target.value;
    // Artículo de tarifa por m²: al cambiar las medidas se recalcula el precio (hasta que se escriba otro a mano).
    if (f === 'precioUnitario' || f === 'precioM2') delete l.tarifaM2;
    if (l.tarifaM2 && (f === 'ancho' || f === 'alto' || f === 'cantidad')) {
      const c = calcPartida(l);
      const piezas = l.cantidad === 1 || l.cantidad == null ? piezasTexto(l.articulo) : 1;
      l.precioUnitario = c.m2 ? round(l.tarifaM2 * c.m2 * piezas, 2) : null;
    }
    // Categoría y material automáticos según el artículo (si no se han escrito a mano).
    if (f === 'categoria' || f === 'material') l['auto_' + f] = false;
    if (f === 'articulo' || f === 'descripcion') {
      const c = classify([l.articulo, l.descripcion].join(' '));
      for (const k of ['categoria', 'material']) {
        if ((!l[k] || l['auto_' + k]) && c[k] !== l[k]) {
          l[k] = c[k]; l['auto_' + k] = true;
          card.querySelector(`[data-f=${k}]`).value = c[k];
        }
      }
    }
    updateOutputs(card, l, f);
    renderTotals();
    if (['articulo', 'material', 'ancho', 'alto'].includes(f)) autoRefsSoon();
  });

  $('#edLineas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = +b.closest('.line').dataset.i;
    if (b.dataset.act === 'refs') {
      if (i !== active) { active = i; renderLines(); autoRefs(); }
      $('#refPane').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (b.dataset.act === 'del') {
      if (!isEmpty(lines[i]) && !confirm('¿Quitar esta partida?')) return;
      lines.splice(i, 1);
      if (!lines.length) lines.push(emptyLine());
      active = Math.min(active, lines.length - 1);
    }
    if (b.dataset.act === 'up' && i > 0) { [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]]; active = i - 1; }
    if (b.dataset.act === 'down' && i < lines.length - 1) { [lines[i + 1], lines[i]] = [lines[i], lines[i + 1]]; active = i + 1; }
    dirty = true;
    renderLines();
  });

  $('#edAdd').addEventListener('click', () => {
    lines.push(emptyLine());
    active = lines.length - 1;
    renderLines();
    autoRefs();
    $(`#edLineas .line[data-i="${active}"] [data-f=articulo]`).focus();
  });

  $('#edCliente').addEventListener('input', (e) => { draft.clienteNombre = e.target.value; dirty = true; clienteInfo(); });
  $('#edNumero').addEventListener('input', (e) => { draft.numero = e.target.value; draft.autoNumero = false; dirty = true; });
  $('#edFecha').addEventListener('input', (e) => { draft.fecha = e.target.value; dirty = true; numeroAuto(); });
  $('#edNotas').addEventListener('input', (e) => { draft.notas = e.target.value; dirty = true; });
  $('#edIva').addEventListener('input', (e) => { draft.iva = numOrNull(e.target.value) ?? 0; dirty = true; renderTotals(); });

  $('#edNuevo').addEventListener('click', () => editor.nuevo());
  $('#edDuplicar').addEventListener('click', () => {
    const base = { clienteNombre: draft.clienteNombre, iva: draft.iva, notas: draft.notas, lines: lines.map(copiaPartida) };
    nuevo(base);
    dirty = true;
    toast('Copia creada con nueva fecha y número. Guarda cuando esté lista.');
  });

  $('#edGuardar').addEventListener('click', guardar);
  $('#edImprimir').addEventListener('click', () => imprimir(draft, lines));

  // Referencias: escribir, usar, ver y arrastrar.
  $('#refQ').addEventListener('input', runRefsSoon);
  $('#refVolver').addEventListener('click', () => $(`#edLineas .line[data-i="${active}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#refList').addEventListener('click', (e) => {
    const use = e.target.closest('[data-use]');
    if (use) editor.usar(use.dataset.use);
    const ver = e.target.closest('[data-ver]');
    if (ver) verPresupuesto(ver.dataset.ver);
  });
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.res[data-pid]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', 'partida:' + card.dataset.pid);
    e.dataTransfer.effectAllowed = 'copy';
    $('#edPane').classList.add('dropping');
  });
  document.addEventListener('dragend', () => $('#edPane').classList.remove('dropping'));
  const pane = $('#edPane');
  pane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  pane.addEventListener('drop', (e) => {
    e.preventDefault();
    pane.classList.remove('dropping');
    const v = e.dataTransfer.getData('text/plain');
    if (v.startsWith('partida:')) editor.usar(v.slice(8));
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  nuevo();
}

async function guardar() {
  if (!lines.some((l) => !isEmpty(l))) { $('#edMsg').textContent = 'Añade al menos una partida.'; return; }
  if (!draft.clienteNombre?.trim() && !confirm('El presupuesto no tiene cliente. ¿Guardarlo igualmente?')) return;
  numeroAuto();
  try {
    const saved = await savePresupuesto(draft, lines.map(calcPartida));
    draft = { ...saved };
    lines = partidasDe(saved.id).map((x) => ({ ...x }));
    if (!lines.length) lines = [emptyLine()];
    dirty = false;
    render();
    $('#edMsg').textContent = `Guardado ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}. Ya forma parte del histórico.`;
    toast('Presupuesto guardado');
  } catch (err) {
    $('#edMsg').textContent = 'No se pudo guardar: ' + err.message;
  }
}

