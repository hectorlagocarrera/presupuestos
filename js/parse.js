// Detección de presupuestos y partidas a partir de texto (PDF, texto pegado) o filas (Excel, CSV, ODS).
import { parseNum, round, calcPartida } from './util.js';
import { normalize, classify, parseMeasures } from './search.js';

const NUM = String.raw`-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?`;
const SKIP = /\b(sub)?total\b|\biva\b|\bi\.v\.a\b|base imponible|forma de pago|\bvencimiento\b|\bp[aá]gina\b|\btel[eé]fono\b|\bc\.?i\.?f\b|\bn\.?i\.?f\b|\biban\b|\bportes\b|\bvalidez\b|\bimporte neto\b|\bsuma\b/i;
const END = /base imponible|\bsubtotal\b|^\s*total\b|forma de pago|\bobservaciones\b|condiciones/i;
const HEADER = /(descrip|concepto|art[ií]culo|detalle|trabajo).*(cant|uds|unid|precio|importe)|(cant|uds).*(descrip|concepto)/i;

const close = (a, b) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.02);

// Una línea de tabla → { texto, cantidad, precio, total, seguro } o null.
// Formatos: «Concepto 2 240,00 480,00», «2 Concepto 240,00 480,00», «Concepto 2 240,00 10% 432,00», «Concepto 480,00».
export function parseItemLine(line) {
  const clean = line.replace(/€/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || SKIP.test(clean)) return null;
  const m = clean.match(new RegExp(String.raw`(?:\s+(?:${NUM})%?)+$`));
  if (!m) return null;
  const tail = m[0].trim().split(' ');
  const pctTok = tail.find((t) => t.endsWith('%'));
  const dto = pctTok ? parseNum(pctTok.slice(0, -1)) || 0 : 0;
  const numTok = tail.filter((t) => !t.endsWith('%'));
  const nums = numTok.map(parseNum);
  if (!nums.length || nums.some(Number.isNaN)) return null;
  let head = clean.slice(0, m.index).trim();
  const lead = head.match(new RegExp(String.raw`^(${NUM})\s+(?:uds?\.?\s+)?(.*)$`, 'i'));
  const fits = (q, p, t) => close(q * p * (1 - dto / 100), t) || close(q * p, t);
  const n = nums.length;

  // r = { cantidad, precio, total, used (números del final usados), fromLead, seguro }
  let r = null;
  if (n >= 3 && fits(nums[n - 3], nums[n - 2], nums[n - 1])) r = { cantidad: nums[n - 3], precio: nums[n - 2], total: nums[n - 1], used: 3, seguro: true };
  if (!r && lead && n >= 2 && fits(parseNum(lead[1]), nums[n - 2], nums[n - 1])) r = { cantidad: parseNum(lead[1]), precio: nums[n - 2], total: nums[n - 1], used: 2, fromLead: true, seguro: true };
  if (!r && n >= 3 && nums[n - 3] > 0 && nums[n - 2] > 0) r = { cantidad: nums[n - 3], precio: nums[n - 2], total: nums[n - 1], used: 3 };
  if (!r && n === 2 && Number.isInteger(nums[0]) && nums[0] > 0 && nums[0] < 10000 && nums[1] > 0) r = { cantidad: nums[0], precio: nums[1], total: nums[0] * nums[1], used: 2 };
  if (!r && n === 1 && nums[0] > 0 && /[a-záéíóúñ]{4}/i.test(head)) r = { cantidad: 1, precio: nums[0], total: nums[0], used: 1 }; // solo importe
  if (!r) return null;

  if (r.fromLead) head = lead[2];
  // Números del final que no se usaron (p. ej. el «2» de «3 x 2») vuelven al texto.
  if (n > r.used) head = (head + ' ' + numTok.slice(0, n - r.used).join(' ')).trim();
  if (!/[a-záéíóúñ]{3}/i.test(head)) return null;
  // Quitar una referencia o código inicial («REF-0012»).
  const texto = head.replace(/^(?=\S*\d)[A-Z0-9.\-/]{3,}\s+(?=\S)/, '').trim();
  const precio = dto ? r.precio * (1 - dto / 100) : r.precio;
  return { texto, cantidad: r.cantidad, precio: round(precio, 4), total: round(r.total), seguro: !!r.seguro };
}

export function findDate(text) {
  const m = String(text).match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  if (+mo > 12 || +d > 31 || +mo < 1 || +d < 1) return '';
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function findNumber(text) {
  const m = String(text).match(/presupuesto\s*(?:n[º°o.]*|num(?:ero)?\.?|número)?\s*[:#]?\s*([A-Z]{0,4}[-/]?\d[\w\-/]*)/i)
    || String(text).match(/\bn[º°]\s*(?:de\s+)?(?:presupuesto)?\s*[:#]?\s*([A-Z]{0,4}[-/]?\d[\w\-/]*)/i);
  return m ? m[1] : '';
}

export function findClient(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:cliente|sr\.?\/?a?\.?|señor(?:es)?|raz[oó]n social|a la atenci[oó]n de|att?\.?)\s*[:.]?\s*(.*)$/i);
    if (m) {
      const rest = m[1].replace(/\b(fecha|n[º°]|presupuesto)\b.*$/i, '').trim();
      if (rest.length > 1) return rest;
      if (lines[i + 1]) return lines[i + 1].trim();
    }
  }
  return '';
}

// Completa una partida detectada: artículo, descripción, medidas, categoría, material, m², €/m².
export function enrich(raw) {
  const descripcion = (raw.descripcion || raw.texto || '').replace(/\s+/g, ' ').trim();
  const articuloBase = raw.articulo || descripcion.split(/[.;\n]| - /)[0];
  const articulo = articuloBase.length > 90 ? articuloBase.slice(0, 87).trim() + '…' : articuloBase.trim();
  const all = [raw.articulo, descripcion, raw.material].filter(Boolean).join(' ');
  const auto = classify(all);
  let { ancho = null, alto = null } = raw;
  if (!(ancho > 0 && alto > 0)) {
    const m = parseMeasures(raw.medidas || all);
    if (m) { ancho = m.ancho; alto = m.alto; }
  }
  const cantidad = raw.cantidad > 0 ? raw.cantidad : 1;
  let precioUnitario = raw.precioUnitario ?? raw.precio ?? null;
  if (precioUnitario == null && raw.precioTotal > 0) precioUnitario = round(raw.precioTotal / cantidad, 4);
  const p = calcPartida({
    articulo,
    descripcion: descripcion === articulo ? '' : descripcion,
    categoria: raw.categoria || auto.categoria,
    material: raw.material || auto.material,
    acabados: raw.acabados || '',
    montaje: raw.montaje || '',
    observaciones: raw.observaciones || '',
    ancho, alto,
    m2: raw.m2 || null,
    cantidad,
    precioUnitario,
    precioTotal: raw.precioTotal ?? raw.total ?? null,
  });
  if (raw.precioTotal > 0) p.precioTotal = raw.precioTotal;
  p.revisar = !raw.seguro || !(p.precioUnitario > 0) || !articulo;
  return p;
}

const NUMS_ONLY = new RegExp(String.raw`^(?:(?:${NUM})%?\s*){2,}$`);

// Líneas de texto (de un PDF o pegado) → presupuesto con partidas.
// Soporta descripciones en varias líneas, con los números en la primera línea o a media altura en una línea aparte.
export function textToBudget(lines) {
  lines = lines.map((l) => l.replace(/€/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = lines.join('\n');
  let start = lines.findIndex((l) => HEADER.test(l));
  start = start >= 0 ? start + 1 : 0;
  const items = [];
  let pending = []; // texto sin números todavía sin asignar
  const flush = () => { if (pending.length && items.length) items[items.length - 1].extra.push(...pending); pending = []; };
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (END.test(l) && (items.length || pending.length)) break;
    if (NUMS_ONLY.test(l)) {
      // Solo números: la partida es el texto que venía justo encima.
      const it = parseItemLine('partida ' + l);
      if (it && pending.length) {
        const [first, ...rest] = pending;
        items.push({ ...it, texto: first, extra: rest });
        pending = [];
        continue;
      }
    }
    const it = parseItemLine(l);
    if (it) { flush(); items.push({ ...it, extra: [] }); continue; }
    if (/[a-záéíóúñ]{3}/i.test(l) && !SKIP.test(l) && l.length < 250) pending.push(l);
  }
  flush();
  return {
    numero: findNumber(text),
    fecha: findDate(text),
    cliente: findClient(lines),
    partidas: items.map((it) => enrich({ articulo: it.extra.length ? it.texto : '', descripcion: it.extra.length ? it.extra.join(' ') : it.texto, cantidad: it.cantidad, precio: it.precio, total: it.total, seguro: it.seguro })),
  };
}

// ---------- Excel / CSV ----------

const COLS = [
  ['precioUnitario', /^(precio( unitario| ud| unidad| u)?|p ?unit(ario)?|pvp|importe unitario|eur ud|precio venta)$/],
  ['precioTotal', /^(importe( total)?|total( linea)?|subtotal|neto|importe neto|base)$/],
  ['cantidad', /^(cantidad|cant|uds?|unidades|unid|n uds|qty)$/],
  ['articulo', /^(articulo|concepto|producto|trabajo|partida|denominacion|nombre)$/],
  ['descripcion', /^(descripcion|detalle|descripcion del trabajo|texto)$/],
  ['ancho', /^(ancho|anchura)( (m|cm|mm|mts))?$/],
  ['alto', /^(alto|altura)( (m|cm|mm|mts))?$/],
  ['medidas', /^(medidas?|dimensiones|tamano|formato)( (m|cm|mm))?$/],
  ['m2', /^(m2|superficie|metros cuadrados)$/],
  ['material', /^(material|soporte)$/],
  ['categoria', /^(categoria|familia|tipo|seccion)$/],
  ['acabados', /^(acabados?)$/],
  ['montaje', /^(montaje|instalacion)$/],
  ['observaciones', /^(observaciones|notas|comentarios)$/],
  ['fecha', /^(fecha|fecha presupuesto|dia)$/],
  ['cliente', /^(cliente|nombre cliente|razon social)$/],
  ['numero', /^(n|no|num|numero|presupuesto|n presupuesto|numero presupuesto|referencia|ref|documento)$/],
];

function mapHeader(row) {
  const map = {};
  row.forEach((cell, i) => {
    const h = normalize(cell);
    if (!h) return;
    for (const [field, re] of COLS) {
      if (map[field] == null && re.test(h)) {
        map[field] = i;
        if (/^(ancho|alto|medida)/.test(h)) map[field + 'Unidad'] = (h.match(/\b(cm|mm)\b/) || [])[1] || '';
        break;
      }
    }
  });
  if (map.articulo == null && map.descripcion != null) { map.articulo = map.descripcion; delete map.descripcion; }
  return map;
}

function excelDate(v) {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  return findDate(String(v || ''));
}

function lenToMeters(v, unidad) {
  const n = parseNum(v);
  if (!(n > 0)) return null;
  if (unidad === 'mm' || n >= 1000) return n / 1000;
  if (unidad === 'cm' || n > 20) return n / 100;
  return n;
}

// Filas (arrays de celdas) → lista de presupuestos.
export function rowsToBudgets(rows, nombre = '') {
  rows = rows.map((r) => (r || []).map((c) => (c == null ? '' : c)));
  let hi = -1; let map = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const m = mapHeader(rows[i]);
    if (m.articulo != null && (m.precioUnitario != null || m.precioTotal != null)) { hi = i; map = m; break; }
  }
  if (hi < 0) {
    const b = textToBudget(rows.map((r) => r.join(' ')));
    return b.partidas.length ? [b] : [];
  }
  const cell = (r, f) => (map[f] == null ? '' : r[map[f]]);
  const str = (r, f) => String(cell(r, f) ?? '').trim();
  const lista = map.numero != null || map.fecha != null || map.cliente != null;
  const meta = textToBudget(rows.slice(0, hi).map((r) => r.join(' ')));
  const groups = new Map();
  let last = { numero: '', fecha: '', cliente: '' };
  for (const r of rows.slice(hi + 1)) {
    const art = str(r, 'articulo');
    if (!art && !str(r, 'descripcion')) continue;
    if (SKIP.test(art) && !(parseNum(cell(r, 'cantidad')) > 0)) continue;
    let key = 'unico';
    if (lista) {
      // En listados, una fila sin nº/fecha/cliente pertenece al presupuesto de la fila anterior.
      const numero = str(r, 'numero') || (str(r, 'fecha') || str(r, 'cliente') ? '' : last.numero);
      const fecha = excelDate(cell(r, 'fecha')) || (numero === last.numero ? last.fecha : '');
      const cliente = str(r, 'cliente') || (numero === last.numero ? last.cliente : '');
      last = { numero, fecha, cliente };
      key = numero || `${fecha}|${cliente}`;
    }
    if (!groups.has(key)) groups.set(key, { numero: lista ? last.numero : meta.numero, fecha: lista ? last.fecha : meta.fecha, cliente: lista ? last.cliente : meta.cliente, partidas: [] });
    const cantidad = parseNum(cell(r, 'cantidad'));
    const pu = parseNum(cell(r, 'precioUnitario'));
    const pt = parseNum(cell(r, 'precioTotal'));
    const q = cantidad > 0 ? cantidad : 1;
    const raw = {
      articulo: map.descripcion != null ? art : '',
      descripcion: map.descripcion != null ? str(r, 'descripcion') : art,
      material: str(r, 'material'),
      categoria: str(r, 'categoria'),
      acabados: str(r, 'acabados'),
      montaje: str(r, 'montaje'),
      observaciones: str(r, 'observaciones'),
      medidas: str(r, 'medidas') ? str(r, 'medidas') + (map.medidasUnidad ? ' ' + map.medidasUnidad : '') : '',
      ancho: lenToMeters(cell(r, 'ancho'), map.anchoUnidad),
      alto: lenToMeters(cell(r, 'alto'), map.altoUnidad),
      m2: parseNum(cell(r, 'm2')) || null,
      cantidad: q,
      precioUnitario: pu > 0 ? pu : (pt > 0 ? round(pt / q, 4) : null),
      precioTotal: pt > 0 ? pt : null,
      seguro: (pu > 0 || pt > 0) && (!(pu > 0 && pt > 0) || close(pu * q, pt)),
    };
    if (!raw.articulo) delete raw.articulo;
    groups.get(key).partidas.push(enrich(raw));
  }
  return [...groups.values()].filter((g) => g.partidas.length).map((g) => ({ ...g, nombre }));
}
