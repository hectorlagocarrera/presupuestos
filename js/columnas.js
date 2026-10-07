// Lector de presupuestos con tabla de columnas «Cantidad · Código · Artículo · Precio · (Dto.) · (IVA) · Subtotal»,
// como los que genera el programa de gestión de la empresa (un PDF puede contener cientos de presupuestos).
// Trabaja con las posiciones (x, y) del texto de cada página, no con líneas sueltas, para no mezclar columnas.
import { parseNum, round, calcPartida } from './util.js';
import { classify, parseMeasures } from './search.js';

// pages: [{ rows: [{ y, cells: [{ x, w, s }] }] }]  (y crece hacia arriba, como en PDF; filas ordenadas de arriba abajo)

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isNum = (s) => /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s.trim());
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CIF = /^([A-Z]-?\d{7,8}-?[A-Z0-9]?|\d{8}\s?-?[A-Z]|[A-Z]\d{7}-?[A-Z0-9])$/i;

function findCell(rows, re) {
  for (const r of rows) for (const c of r.cells) if (re.test(norm(c.s))) return { row: r, cell: c };
  return null;
}

export function looksLikeColumns(pages) {
  return pages.some((p) => headerOf(p));
}

function headerOf(page) {
  for (const r of page.rows) {
    const names = r.cells.map((c) => norm(c.s));
    if (names.includes('cantidad') && names.includes('articulo') && names.includes('precio')) {
      const col = {};
      for (const c of r.cells) {
        const n = norm(c.s);
        if (n === 'cantidad') col.cantidad = c;
        else if (n === 'codigo') col.codigo = c;
        else if (n === 'articulo') col.articulo = c;
        else if (n === 'precio') col.precio = c;
        else if (n === 'dto.' || n === 'dto' || n === '% dto') col.dto = c;
        else if (n === 'iva') col.iva = c;
        else if (n === 'subtotal' || n === 'importe') col.subtotal = c;
      }
      if (col.subtotal) return { row: r, col };
    }
  }
  return null;
}

function pageInfo(page) {
  const pg = findCell(page.rows, /^pagina$/);
  let n = 1; let total = 1;
  if (pg) {
    const txt = pg.row.cells.filter((c) => c.x > pg.cell.x).map((c) => c.s).join(' ');
    const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) { n = +m[1]; total = +m[2]; }
  }
  return { n, total };
}

// Tipo de documento según el título grande de la página (PRESUPUESTO, FACTURA, ALBARÁN).
export function tipoTitulo(page) {
  for (const r of page.rows.slice(0, 12)) {
    for (const c of r.cells) {
      const t = norm(c.s);
      // Solo el título exacto (no un cliente que se llame «Facturas S.L.»).
      if (/^factura( simplificada| rectificativa)?$/.test(t)) return 'factura';
      if (/^albaran( de entrega)?$/.test(t)) return 'albaran';
      if (/^(presupuesto|factura proforma)$/.test(t)) return 'presupuesto';
    }
  }
  return 'presupuesto';
}

// Nº, fecha, cliente y datos del emisor (cabecera de la página).
function cabecera(page) {
  const out = { numero: '', fecha: '', cliente: '', clienteDatos: {}, empresa: [], tipo: tipoTitulo(page) };
  // «Número» en presupuestos; «Nº Factura», «Nº Albarán»… en los demás documentos.
  const num = findCell(page.rows, /^(numero|n[ºo°.]*\s*(de\s*)?(factura|albaran|presupuesto)|numero (de )?(factura|albaran|presupuesto))$/);
  const fec = findCell(page.rows, /^fecha$/);
  const val = findCell(page.rows, /^valido hasta$/);
  if (!num || !fec) return out;
  const yNum = num.row.y;
  const below = page.rows.filter((r) => r.y < yNum - 4 && r.y > yNum - 30);
  for (const r of below) {
    for (const c of r.cells) {
      if (!out.numero && c.x < fec.cell.x - 2 && /^[\w/-]+$/.test(c.s.trim()) && /\d/.test(c.s)) out.numero = c.s.trim();
      const d = c.s.trim().match(DATE);
      if (d && !out.fecha && Math.abs(c.x - fec.cell.x) < 40) out.fecha = `${d[3]}-${d[2]}-${d[1]}`;
    }
  }
  // Cliente: bloque de la derecha. Empieza donde empieza el texto de la derecha por encima de la fila de números
  // (así no se cuelan otras columnas de la cabecera, como «Referencia» en las facturas).
  const TITULOS = /^(presupuesto|factura|albaran|factura proforma|pagina|\d+\s*\/?|\/)$/;
  const head = headerOf(page);
  const yMin = yNum - 30;
  const xsDerecha = page.rows.filter((r) => r.y > yNum + 4 && (!head || r.y > head.row.y))
    .flatMap((r) => r.cells).filter((c) => c.x >= 280 && !TITULOS.test(norm(c.s))).map((c) => c.x);
  const rightX = xsDerecha.length ? Math.min(...xsDerecha) - 6 : (val ? val.cell.x + val.cell.w + 25 : fec.cell.x + 120);
  const lines = page.rows
    .filter((r) => r.y > yMin && (!head || r.y > head.row.y))
    .map((r) => ({ y: r.y, s: r.cells.filter((c) => c.x >= rightX && !TITULOS.test(norm(c.s))).map((c) => c.s).join(' ').trim() }))
    .filter((l) => l.s);
  if (lines.length) {
    const last = lines[lines.length - 1];
    if (CIF.test(last.s.replace(/[\s.]/g, '')) && lines.length > 1) { out.clienteDatos.cif = last.s; lines.pop(); }
    out.cliente = lines[0].s;
    out.clienteDatos.direccion = lines.slice(1).map((l) => l.s).join(', ');
  }
  // Emisor: bloque de la izquierda (para rellenar los datos de la empresa la primera vez).
  out.empresa = page.rows
    .filter((r) => r.y > yNum + 4 && (!head || r.y > head.row.y))
    .map((r) => r.cells.filter((c) => c.x < (val ? val.cell.x : rightX - 100)).map((c) => c.s).join(' ').trim())
    .filter(Boolean);
  return out;
}

// Totales del pie (base imponible, IVA, total).
function pie(page) {
  const b = findCell(page.rows, /^base imponible$/);
  if (!b) return null;
  // Importes debajo del rótulo (en facturas sin IVA quedan dos filas más abajo, tras la fila del «%»).
  // Solo cuenta un importe en la columna de la base (no la retención u otros importes de la misma fila).
  const r = page.rows.find((x) => x.y < b.row.y - 3 && x.y > b.row.y - 60
    && x.cells.some((c) => isNum(c.s.replace('€', '').trim()) && Math.abs(c.x - (b.cell.x + 20)) < 70));
  if (!r) return null;
  const nums = r.cells.filter((c) => isNum(c.s.replace('€', '').trim())).map((c) => ({ x: c.x, v: parseNum(c.s) }));
  const near = (x) => nums.reduce((best, n) => (Math.abs(n.x - x) < Math.abs((best?.x ?? 1e9) - x) ? n : best), null);
  const t = findCell(page.rows, /^total (presupuesto|factura|albaran)$/);
  let total = null;
  if (t && Math.abs(t.row.y - b.row.y) < 5) total = near(t.cell.x + 40)?.v ?? null; // en la misma fila que la base (presupuestos)
  else if (t) {
    // En su propia fila, más abajo (facturas): el importe está justo debajo del rótulo.
    const fila = page.rows.find((x) => x.y < t.row.y && x.y > t.row.y - 30 && x.cells.some((c) => c.x > t.cell.x - 40 && isNum(c.s.replace('€', '').trim())));
    const v = fila?.cells.filter((c) => c.x > t.cell.x - 40 && isNum(c.s.replace('€', '').trim())).pop();
    total = v ? parseNum(v.s) : null;
  }
  return { base: near(b.cell.x + 20)?.v ?? null, total };
}

// Partidas de una página. Devuelve las nuevas partidas y las líneas de texto anteriores a la primera.
function partidasPagina(page, continuacion = false) {
  const head = headerOf(page);
  if (!head) return { items: [], antes: [] };
  const { col } = head;
  // Pie de la tabla: «Subtotal» a la derecha (no confundir con una partida llamada «SUBTOTAL»).
  const footer = page.rows.find((r) => r.y < head.row.y && r.cells.some((c) => norm(c.s) === 'subtotal' && c.x > col.precio.x - 90) && !r.cells.some((c) => norm(c.s) === 'cantidad'));
  const yEnd = footer ? footer.y : -Infinity;
  const xArt = col.articulo.x - 8;
  const xPrecio = col.precio.x - 35;
  const numCols = ['precio', 'dto', 'iva', 'subtotal'].filter((k) => col[k]).map((k) => ({ k, x: col[k].x + col[k].w / 2 }));
  const items = [];
  const antes = [];
  let cur = null;
  let lastY = null;
  const valores = (r) => {
    const vals = {};
    for (const c of r.cells) {
      if (c.x < xPrecio || !isNum(c.s)) continue;
      const cx = c.x + c.w / 2;
      const best = numCols.reduce((a, b) => (Math.abs(b.x - cx) < Math.abs(a.x - cx) ? b : a));
      vals[best.k] = parseNum(c.s);
    }
    return vals;
  };
  for (const r of page.rows) {
    if (r.y >= head.row.y - 2 || r.y <= yEnd + 2) continue;
    const qty = r.cells.find((c) => c.x + c.w <= xArt + 4 && (!col.codigo || c.x < col.codigo.x - 2) && isNum(c.s));
    const text = r.cells.filter((c) => c.x >= xArt && c.x < xPrecio).map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim();
    const gap = lastY != null && lastY - r.y > 22; // línea en blanco por medio
    lastY = r.y;
    const vals = valores(r);
    // Fila de partida: tiene cantidad, o al menos precio (se toma 1 unidad).
    if (qty || vals.precio != null) {
      const codigo = col.codigo ? r.cells.filter((c) => c.x >= col.codigo.x - 6 && c.x < xArt && c !== qty).map((c) => c.s).join(' ').trim() : '';
      const generico = !text || /^(sub)?total|^importe|^precio$/i.test(text);
      const nuevo = { cantidad: qty ? parseNum(qty.s) : 1, codigo, lineas: generico ? [] : [text], notas: [], post: [], modo: 'desc', ...vals };
      if (generico) {
        // La descripción va encima de la fila con el precio: se toman las líneas anteriores.
        if (!items.length) nuevo.lineas.push(...antes.splice(0));
        else {
          const prev = items[items.length - 1];
          const robadas = prev.post.filter((x) => x.modo === 'notas');
          prev.notas = prev.notas.slice(0, prev.notas.length - robadas.length);
          nuevo.lineas.push(...robadas.map((x) => x.t));
          // «SUBTOTAL» que suma varias partidas sin precio: se juntan en una sola con ese precio.
          if (!nuevo.lineas.length) {
            let k = items.length;
            while (k > 0 && items[k - 1].precio == null) k--;
            const sinPrecio = items.splice(k);
            for (const x of sinPrecio) nuevo.lineas.push(...x.lineas, ...x.notas);
          }
        }
      } else if (antes.length && !items.length && !continuacion) nuevo.notas.push(...antes.splice(0));
      cur = nuevo;
      items.push(cur);
      continue;
    }
    if (!text) continue;
    if (!cur) { antes.push(text); continue; }
    if (gap) cur.modo = 'notas';
    (cur.modo === 'desc' ? cur.lineas : cur.notas).push(text);
    cur.post.push({ t: text, modo: cur.modo });
  }
  return { items, antes };
}

function toPartida(it) {
  const texto = it.lineas.join(' ').replace(/\s+/g, ' ').trim();
  const articulo = texto.length > 110 ? texto.slice(0, 100).replace(/\s+\S*$/, '') + '…' : texto;
  const dto = it.dto || 0;
  const precio = it.precio != null ? round(it.precio * (1 - dto / 100), 4) : null;
  const notas = it.notas.join(' ').replace(/\s+/g, ' ').trim();
  const obs = [dto ? `Precio de tarifa ${String(it.precio).replace('.', ',')} € con ${String(dto).replace('.', ',')} % de dto.` : '',
    it.codigo && it.codigo !== '0' ? `Código ${it.codigo}` : '', notas].filter(Boolean).join(' · ');
  const auto = classify(texto);
  const med = parseMeasures(texto);
  // «PRECIO 1m2», «precio por m2»: el precio es por metro cuadrado.
  const porM2 = !med && /precio\s*(por\s*)?(1\s*)?m2|€\s*\/\s*m2|\bel m2\b/i.test(texto + ' ' + notas);
  const p = calcPartida({
    articulo: articulo || notas.slice(0, 100) || '(sin descripción)',
    descripcion: articulo !== texto ? texto : '',
    categoria: auto.categoria,
    material: auto.material,
    acabados: '', montaje: '',
    observaciones: obs,
    ancho: med ? med.ancho : null,
    alto: med ? med.alto : null,
    m2: porM2 ? 1 : null,
    cantidad: it.cantidad,
    precioUnitario: precio,
    precioTotal: it.subtotal ?? null,
  });
  if (it.subtotal != null) p.precioTotal = it.subtotal;
  const cuadra = precio != null && it.subtotal != null && Math.abs(precio * it.cantidad - it.subtotal) <= Math.max(0.05, Math.abs(it.subtotal) * 0.01);
  p.revisar = !(precio > 0) || !texto || (it.subtotal != null && !cuadra);
  return p;
}

// Todas las páginas → lista de presupuestos (une las páginas «2 / 3», «3 / 3»… con su presupuesto).
export function columnsToBudgets(pages, nombre = '') {
  const out = [];
  let cur = null;
  for (const page of pages) {
    const info = pageInfo(page);
    const cab = cabecera(page);
    const sigue = cur && info.n > 1 && (!cab.numero || cab.numero === cur.numero);
    const { items, antes } = partidasPagina(page, sigue);
    if (!sigue) {
      cur = { tipo: cab.tipo, numero: cab.numero, fecha: cab.fecha, cliente: cab.cliente, clienteDatos: cab.clienteDatos, empresa: cab.empresa, raw: [], nombre };
      out.push(cur);
    } else if (antes.length && cur.raw.length) {
      // Texto al principio de una página de continuación: sigue la partida anterior.
      const last = cur.raw[cur.raw.length - 1];
      (last.modo === 'desc' ? last.lineas : last.notas).push(...antes);
    }
    cur.raw.push(...items);
    const t = pie(page);
    if (t) { cur.base = t.base; cur.total = t.total; }
  }
  // Filas sueltas sin texto ni precio (una cantidad perdida) no son partidas.
  const util = (it) => it.lineas.length || it.notas.length || it.precio != null;
  return out.map(({ raw, ...b }) => ({ ...b, partidas: raw.filter(util).map(toPartida) }));
}

// Items de texto de pdf.js de una página → filas con celdas.
export function itemsToRows(items) {
  const rows = [];
  for (const it of items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) { row = { y, cells: [] }; rows.push(row); }
    row.cells.push({ x, w: it.width, s: s.trim() });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  return rows;
}

// Filas → líneas de texto (para el lector genérico), separando columnas con espacios.
export function rowsToLines(rows) {
  return rows.map((r) => r.cells.map((c) => c.s).join('  '));
}
