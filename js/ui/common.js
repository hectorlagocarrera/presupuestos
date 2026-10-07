// Piezas de interfaz compartidas: resultados del histórico, comparación de precios, filtros, avisos y ventana modal.
import { $, esc, fmtEur, fmtNum, fmtM2, fmtDate, numOrNull } from '../util.js';
import { CATEGORIAS } from '../search.js';
import { data, anios } from '../store.js';

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}

export function medidasTxt(p) {
  if (p.ancho > 0 && p.alto > 0) return `${fmtNum(p.ancho)} × ${fmtNum(p.alto)} m`;
  return '';
}

export function categorias() {
  const extra = data.partidas.map((p) => p.categoria).filter((c) => c && !CATEGORIAS.includes(c));
  return [...CATEGORIAS, ...new Set(extra)];
}

// Tarjeta de un trabajo histórico (arrastrable).
export function resultCard({ doc, score }, opts = {}) {
  const p = doc.p;
  const med = medidasTxt(p) || (doc.dims?.ancho ? `${fmtNum(doc.dims.ancho)} × ${fmtNum(doc.dims.alto)} m` : '');
  const m2 = p.m2 || doc.dims?.m2;
  const pm2 = p.precioM2;
  return `
    <article class="res" draggable="true" data-pid="${esc(p.id)}">
      <div class="res-main">
        <div class="res-title">${esc(p.articulo || '(sin nombre)')}</div>
        ${p.descripcion ? `<div class="res-desc">${esc(p.descripcion.slice(0, 180))}${p.descripcion.length > 180 ? '…' : ''}</div>` : ''}
        <div class="tags">
          ${p.categoria ? `<span class="tag">${esc(p.categoria)}</span>` : ''}
          ${p.material && p.material !== p.categoria ? `<span class="tag soft">${esc(p.material)}</span>` : ''}
          ${med ? `<span class="tag soft">${esc(med)}${m2 ? ' · ' + fmtM2(m2) : ''}</span>` : ''}
          ${p.revisar ? '<span class="tag warn">revisar</span>' : ''}
        </div>
        <div class="res-meta">${p.tipo === 'factura' ? '<span class="tag fact">facturado</span> ' : ''}${fmtDate(p.fecha)}${p.numero ? ` · ${p.tipo === 'factura' ? 'factura' : p.tipo === 'albaran' ? 'albarán' : 'nº'} ${esc(p.numero)}` : ''}${p.cliente ? ' · ' + esc(p.cliente) : ''}</div>
      </div>
      <div class="res-side">
        <div class="price">${fmtEur(p.precioUnitario)}</div>
        <div class="muted small">${p.cantidad && p.cantidad !== 1 ? `× ${fmtNum(p.cantidad)} = ${fmtEur(p.precioTotal)}` : 'por unidad'}</div>
        ${pm2 ? `<div class="pm2">${fmtEur(pm2)}/m²</div>` : ''}
        ${score != null && opts.score !== false ? `<div class="sim" data-ayuda="Cuánto se parece a lo que buscas, por el material, las palabras y las medidas. 100 % es casi igual." data-ayuda-fin>${Math.round(score)}% parecido</div>` : ''}
        <div class="btns">
          <button class="btn small" data-use="${esc(p.id)}">Usar como referencia</button>
          <button class="btn small ghost" data-ver="${esc(p.presupuestoId)}" title="Abrir el presupuesto original">Ver</button>
        </div>
      </div>
    </article>`;
}

// Panel de comparación de precios.
export function statsHtml(s, n) {
  if (!s) return '';
  const u = s.ultimo;
  const evo = s.evolucion.length ? `
    <div class="evo">
      ${s.evolucion.map((e) => `<div><span class="y">${e.anio}</span><strong>${fmtEur(e.medio)}</strong>${e.m2 ? `<small>${fmtEur(e.m2)}/m²</small>` : ''}<small>${e.n} ${e.n === 1 ? 'trabajo' : 'trabajos'}</small></div>`).join('<span class="arrow">→</span>')}
      ${s.variacion ? `<div class="var ${s.variacion.pct >= 0 ? 'up' : 'down'}">${s.variacion.pct >= 0 ? '+' : ''}${fmtNum(s.variacion.pct)} %<small>${s.variacion.en} ${s.variacion.desde}–${s.variacion.hasta}</small></div>` : ''}
    </div>` : '';
  return `
    <div class="stats">
      <div class="stats-head">Comparación de precios · ${s.n} ${s.n === 1 ? 'trabajo parecido' : 'trabajos parecidos'}${n > s.n ? ` <span class="muted">(de ${n} encontrados)</span>` : ''}</div>
      <div class="kpis">
        <div><span data-ayuda="Precio de la vez más reciente que se hizo un trabajo parecido (presupuesto, albarán o factura).">Último</span><strong>${fmtEur(u.precioUnitario)}</strong><small>${fmtDate(u.fecha)}${u.cliente ? ' · ' + esc(u.cliente) : ''}</small></div>
        <div><span data-ayuda="Media de los precios de los trabajos parecidos.">Medio</span><strong>${fmtEur(s.medio)}</strong></div>
        <div><span>Mínimo</span><strong>${fmtEur(s.min)}</strong></div>
        <div><span>Máximo</span><strong>${fmtEur(s.max)}</strong></div>
        ${s.m2 ? `<div title="La mitad de los trabajos está por encima y la otra mitad por debajo"><span data-ayuda="El precio por m² más típico (la mediana): la mitad de los trabajos parecidos está por encima y la otra mitad por debajo. Un caso raro no lo desvía.">€/m² habitual</span><strong>${fmtEur(s.m2.mediana)}</strong><small>${fmtEur(s.m2.min)} – ${fmtEur(s.m2.max)}</small></div>` : ''}
        ${s.orientativo ? `<div class="ref"><span data-ayuda="Lo que costaría tu medida con el €/m² habitual. Es solo una referencia: el precio lo decides tú.">Orientativo ${fmtM2(s.orientativo.area)}</span><strong>${fmtEur(s.orientativo.precio)}</strong><small>con el €/m² habitual</small></div>` : ''}
      </div>
      ${evo}
      <p class="muted small">Es solo una referencia: el precio lo decides tú.</p>
    </div>`;
}

// Filtros de categoría, año y precio. Devuelve una función que lee los valores.
export function mountFiltros(el, onChange) {
  el.innerHTML = `
    <select data-f="categoria"></select>
    <select data-f="anio"></select>
    <input data-f="min" inputmode="decimal" placeholder="Precio desde">
    <input data-f="max" inputmode="decimal" placeholder="hasta">
    <select data-f="tipo" title="Facturado: lo que se cobró de verdad (facturas). Presupuestado: presupuestos y albaranes.">
      <option value="">Presupuestado y facturado</option><option value="facturado">Solo facturado</option><option value="presupuestado">Solo presupuestado</option>
    </select>`;
  const fill = () => {
    const cat = el.querySelector('[data-f=categoria]');
    const an = el.querySelector('[data-f=anio]');
    const cv = cat.value; const av = an.value;
    cat.innerHTML = '<option value="">Todas las categorías</option>' + categorias().map((c) => `<option>${esc(c)}</option>`).join('');
    an.innerHTML = '<option value="">Todos los años</option>' + anios().map((y) => `<option>${y}</option>`).join('');
    cat.value = cv; an.value = av;
  };
  fill();
  el.addEventListener('input', onChange);
  el.addEventListener('change', onChange);
  const read = () => ({
    categoria: el.querySelector('[data-f=categoria]').value,
    anio: el.querySelector('[data-f=anio]').value,
    min: numOrNull(el.querySelector('[data-f=min]').value),
    max: numOrNull(el.querySelector('[data-f=max]').value),
    tipo: el.querySelector('[data-f=tipo]').value,
  });
  read.refresh = fill;
  return read;
}

export function fillSelect(sel, values, all) {
  const v = sel.value;
  sel.innerHTML = `<option value="">${esc(all)}</option>` + values.map((x) => `<option>${esc(x)}</option>`).join('');
  sel.value = v;
}

// Ventana modal con un formulario sencillo. fields: [{ k, label, type, value, wide }]
export function modalForm(title, fields, { okText = 'Guardar', extra = '' } = {}) {
  const dlg = $('#modal');
  $('#modalBody').innerHTML = `
    <h2>${esc(title)}</h2>
    <div class="grid g2">
      ${fields.map((f) => `<label class="${f.wide ? 's2' : ''}">${esc(f.label)}
        ${f.type === 'textarea' ? `<textarea data-k="${f.k}" rows="3">${esc(f.value ?? '')}</textarea>`
          : `<input data-k="${f.k}" value="${esc(f.value ?? '')}" ${f.list ? `list="${f.list}"` : ''} ${f.type === 'date' ? 'type="date"' : ''} ${f.num ? 'inputmode="decimal"' : ''}>`}
      </label>`).join('')}
    </div>
    ${extra}
    <div class="btns actions"><button class="btn" data-ok>${esc(okText)}</button><button class="btn ghost" data-cancel>Cancelar</button></div>`;
  dlg.showModal();
  return new Promise((resolve) => {
    const close = (val) => { dlg.close(); dlg.onclick = null; resolve(val); };
    dlg.onclick = (e) => {
      if (e.target.closest('[data-cancel]') || e.target === dlg) close(null);
      if (e.target.closest('[data-ok]')) {
        const out = {};
        for (const f of fields) {
          const v = $(`[data-k="${f.k}"]`, dlg).value;
          out[f.k] = f.num ? numOrNull(v) : v;
        }
        close(out);
      }
    };
    dlg.oncancel = () => resolve(null);
  });
}

export function refreshDatalists() {
  $('#dlClientes').innerHTML = [...data.clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((c) => `<option value="${esc(c.nombre)}">`).join('');
  $('#dlCategorias').innerHTML = categorias().map((c) => `<option value="${esc(c)}">`).join('');
  const mats = [...new Set(data.partidas.map((p) => p.material).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#dlMateriales').innerHTML = mats.map((m) => `<option value="${esc(m)}">`).join('');
}

// Carga (una sola vez) una librería de vendor/.
const cargadas = {};
export function loadScript(src) {
  if (!cargadas[src]) {
    cargadas[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete cargadas[src]; reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return cargadas[src];
}

// En el móvil las tablas se ven como tarjetas: cada celda lleva el nombre de su columna (data-l).
export function etiquetarTablas() {
  const etiquetar = (tbody) => {
    // Solo el texto de la cabecera (sin el «?» de la ayuda).
    const nombres = [...tbody.closest('table').querySelectorAll('thead th')]
      .map((th) => [...th.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim());
    for (const tr of tbody.rows) {
      if (tr.cells.length < 2) continue; // filas de título (categoría) o de aviso
      [...tr.cells].forEach((td, i) => { if (nombres[i] && !td.dataset.l) td.dataset.l = nombres[i]; });
    }
  };
  document.querySelectorAll('table.data.cards tbody').forEach((tb) => {
    etiquetar(tb);
    new MutationObserver(() => etiquetar(tb)).observe(tb, { childList: true });
  });
}
