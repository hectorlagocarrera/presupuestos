// Tarifa oficial (catálogo de artículos): PDF o Excel con columnas «Código · Descripción · Precio · Unidad ·
// Observaciones», agrupadas por secciones. Se guarda aparte del histórico de documentos.
import { parseNum } from './util.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const COLUMNAS = { seccion: /^(seccion|familia|grupo)$/, codigo: /^(cod|codigo|ref|referencia)\.?$/, descripcion: /^(descripcion|articulo|concepto)$/, precio: /^(precio|pvp|importe|tarifa)( \(.*\))?$/, unidad: /^(unidad|ud|uds|unidades)$/, observaciones: /^(observaciones|notas|obs\.?)$/ };
const esCodigo = (s) => /^[A-Z0-9][A-Z0-9._/-]{1,40}$/.test(String(s).trim()) && /[A-Z]/.test(s) && !/\s/.test(String(s).trim());
export const idCatalogo = (codigo) => 'cat-' + norm(codigo).replace(/[^a-z0-9]+/g, '-');

// «20,00 €», «+5,00 €» (suplemento), «-1,00 €» (descuento), «60,00 € + IVA», «0,50 €/ud», «2,00 € (4,00 €)», «Consultar».
export function leerPrecio(txt) {
  const t = String(txt ?? '').trim();
  const m = t.match(/([+\-−]?)\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*€?/);
  if (!m || /^consultar/i.test(t)) return { precio: null, tipo: 'consultar', masIva: false, texto: t };
  const signo = m[1] === '+' ? 'suplemento' : (m[1] === '-' || m[1] === '−') ? 'ajuste' : 'precio';
  const v = parseNum(m[2]);
  return { precio: signo === 'ajuste' ? -Math.abs(v) : v, tipo: signo, masIva: /\+\s*iva/i.test(t), texto: t };
}

const porM2 = (unidad) => /m²|m2|metro cuadrado/i.test(unidad || '');

function articulo({ codigo, descripcion, precio, unidad, observaciones }, seccion, orden) {
  const p = leerPrecio(precio);
  return {
    id: idCatalogo(codigo), codigo: String(codigo).trim(), seccion: seccion || '', descripcion: String(descripcion || '').trim(),
    precio: p.precio, precioTexto: p.texto, tipo: p.tipo + (p.masIva ? '+iva' : ''), unidad: String(unidad || '').trim(),
    porM2: porM2(unidad) ? 1 : 0, observaciones: String(observaciones || '').trim(), orden,
  };
}

// ---------- PDF ----------

function cabeceraTabla(row) {
  const col = {};
  for (const c of row.cells) for (const [k, re] of Object.entries(COLUMNAS)) if (!col[k] && re.test(norm(c.s))) col[k] = c.x;
  return col.codigo != null && col.descripcion != null && col.precio != null ? col : null;
}

export function esTarifaPdf(pages) {
  return pages.some((p) => p.rows.some((r) => { const c = cabeceraTabla(r); return c && c.unidad != null; }));
}

export function leerTarifaPdf(pages) {
  const out = [];
  let seccion = '';
  for (const page of pages) {
    let col = null;
    let ultimo = null;
    for (const r of page.rows) {
      const cab = cabeceraTabla(r);
      if (cab) { col = cab; ultimo = null; continue; }
      if (r.y < 40 || r.cells.some((c) => /^p[aá]gina$/i.test(c.s.trim()) || /^p[aá]gina \d+/i.test(c.s.trim()))) continue; // pie de página
      const primera = r.cells[0];
      // Título de sección: una sola celda a la izquierda, que no es un código ni una viñeta.
      if (r.cells.length === 1 && !esCodigo(primera.s) && !/^[•·-]/.test(primera.s.trim()) && (!col || primera.x < col.codigo + 15)) {
        seccion = primera.s.trim(); ultimo = null;
        continue;
      }
      if (!col) continue;
      // Cada celda va a la columna que empieza justo a su izquierda.
      const xs = Object.entries(col).sort((a, b) => a[1] - b[1]);
      const fila = {};
      for (const c of r.cells) {
        const k = [...xs].reverse().find(([, x]) => c.x >= x - 6)?.[0] || 'codigo';
        fila[k] = fila[k] ? `${fila[k]} ${c.s.trim()}` : c.s.trim();
      }
      if (fila.codigo && esCodigo(fila.codigo)) {
        ultimo = articulo(fila, seccion, out.length);
        out.push(ultimo);
      } else if (ultimo && !fila.codigo) {
        // Línea que continúa la anterior (descripción u observaciones largas).
        if (fila.descripcion) ultimo.descripcion += ' ' + fila.descripcion;
        if (fila.observaciones) ultimo.observaciones = `${ultimo.observaciones} ${fila.observaciones}`.trim();
      }
    }
  }
  return quitarRepetidos(out);
}

// ---------- Excel / CSV ----------

export function esTarifaFilas(rows) {
  return rows.slice(0, 15).some((r) => { const n = r.map(norm); return n.some((x) => COLUMNAS.codigo.test(x)) && n.some((x) => COLUMNAS.precio.test(x)) && n.some((x) => COLUMNAS.descripcion.test(x)); });
}

export function leerTarifaFilas(rows) {
  const i = rows.findIndex((r) => { const n = r.map(norm); return n.some((x) => COLUMNAS.codigo.test(x)) && n.some((x) => COLUMNAS.precio.test(x)); });
  if (i < 0) return [];
  const idx = {};
  rows[i].forEach((c, j) => { for (const [k, re] of Object.entries(COLUMNAS)) if (idx[k] == null && re.test(norm(c))) idx[k] = j; });
  const out = [];
  let seccion = '';
  for (const r of rows.slice(i + 1)) {
    const v = (k) => (idx[k] == null ? '' : String(r[idx[k]] ?? '').trim());
    const llenas = r.filter((x) => String(x ?? '').trim());
    if (llenas.length === 1 && !v('precio')) { seccion = String(llenas[0]).trim(); continue; }
    if (!v('codigo') || !v('descripcion')) continue;
    out.push(articulo({ codigo: v('codigo'), descripcion: v('descripcion'), precio: v('precio'), unidad: v('unidad'), observaciones: v('observaciones') }, idx.seccion != null ? v('seccion') : seccion, out.length));
  }
  return quitarRepetidos(out);
}

// Si un código sale dos veces, se queda el último.
function quitarRepetidos(lista) {
  const m = new Map();
  for (const a of lista) m.set(a.id, a);
  return [...m.values()];
}

// Datos para añadir un artículo de la tarifa oficial al albarán (como los de la tarifa sacada del histórico).
export const comoArticuloEditor = (a, categoria) => ({ nombre: a.descripcion, categoria: categoria || a.seccion, unidad: a.porM2 ? 'm²' : 'ud', codigo: a.codigo });
