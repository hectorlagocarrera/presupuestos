// Motor de búsqueda: normalización, sinónimos (conceptos), medidas, puntuación y estadísticas de precio.
import { parseNum, round, year } from './util.js';

// ---------- Texto ----------

const STOP = new Set(('de del la las el los en con para por y o a al un una unos unas su sus sin que se segun ' +
  'incluye incluido incluida incl tipo medida medidas mm cm m mt mts metro metros ud uds unidad unidades x ' +
  'total precio ref n no num').split(' '));

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

// Singular aproximado: «carteles» → «cartel», «vinilos» → «vinilo», «letras» → «letra».
export function stem(w) {
  if (w.length > 5 && /(ones|eles|ales|ores|ares)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  return normalize(text).split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
}

// Distancia de edición con corte: devuelve max+1 si se pasa.
export function lev(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const fuzzyOk = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  return lev(a, b, n >= 8 ? 2 : 1) <= (n >= 8 ? 2 : 1);
};

// ---------- Conceptos y sinónimos ----------

// Formato editable en Ajustes:  Nombre [Categoría] = sinónimo, sinónimo, ...
export const DEFAULT_SINONIMOS = `Alupanel [Alupanel] = alupanel, dibond, panel composite, composite, aluminio compuesto, panel de aluminio, panel aluminio, placa de aluminio, chapa composite, cartel de aluminio, cartel aluminio, carteleria aluminio, sandwich de aluminio, alucobond, reynobond, aluminio composite
PVC [PVC] = pvc, forex, pvc espumado, pvc expandido, komatex, palight, sintra, foam pvc
Metacrilato [Cartelería] = metacrilato, plexiglas, plexi, acrilico, perspex, metacrilato transparente
Cartón pluma [Impresión] = carton pluma, foam, foamboard, kapa
Vinilo [Vinilo] = vinilo, vinil, adhesivo, pegatina, vinilo impreso, vinilo de corte, vinilo laminado, microperforado, vinilo microperforado, vinilo esmerilado, vinilo al acido, rotulacion adhesiva, vinilo ventana, escaparate
Lona [Lona] = lona, pancarta, banner, lona frontlit, lona microperforada, mesh, lona pvc, lona impresa, lona con ojales
Roll up [Impresión] = roll up, rollup, enrollable, expositor enrollable, display
Impresión [Impresión] = impresion, impresion digital, gran formato, poster, cartel papel, papel fotografico, flyer, folleto, tarjeta
Cartelería [Cartelería] = carteleria, cartel, rotulo, letrero, placa, valla, banderola, monoposte, totem
Luminoso [Cartelería] = luminoso, rotulo luminoso, caja de luz, retroiluminado, led, neon
Señalética [Señalética] = senaletica, senalizacion, senal, placa puerta, directorio, evacuacion, emergencia, braille, pictograma
Rotulación de vehículos [Rotulación de vehículos] = rotulacion vehiculo, vehiculo, furgoneta, coche, camion, flota, vinilado vehiculo, wrapping, rotulacion furgoneta, remolque, turismo
Letras corpóreas [Letras corpóreas] = letras corporeas, corporea, corporeo, letra corporea, letras 3d, letra 3d, letras recortadas, letras pvc, letras metacrilato, letras acero, letras aluminio
Diseño [Diseño] = diseno, diseno grafico, maquetacion, boceto, logotipo, logo, arte final, creatividad
Montaje [Montaje] = montaje, montado, colocacion, colocado, aplicacion, mano de obra
Instalación [Instalación] = instalacion, instalar, instalado, desplazamiento, grua, plataforma elevadora, anclaje, anclajes`;

export const CATEGORIAS = ['Alupanel', 'PVC', 'Vinilo', 'Lona', 'Impresión', 'Cartelería', 'Señalética',
  'Rotulación de vehículos', 'Letras corpóreas', 'Diseño', 'Montaje', 'Instalación', 'Otros'];

// Conceptos que son material (rellenan el campo «material»).
const MATERIALES = new Set(['alupanel', 'pvc', 'metacrilato', 'carton pluma', 'vinilo', 'lona']);

// Conceptos que mandan sobre el material al elegir categoría («letras corpóreas de PVC» → Letras corpóreas).
const TRABAJOS = new Set(['letras corporeas', 'rotulacion de vehiculos', 'senaletica', 'luminoso', 'roll up']);

let CONCEPTOS = [];

export function setSinonimos(text) {
  CONCEPTOS = String(text || DEFAULT_SINONIMOS).split('\n').map((line) => {
    const m = line.match(/^\s*([^[=]+?)\s*(?:\[([^\]]+)\])?\s*=\s*(.+)$/);
    if (!m) return null;
    const nombre = m[1].trim();
    const terms = [nombre, ...m[3].split(',')].map((t) => tokenize(t)).filter((t) => t.length);
    return { id: normalize(nombre), nombre, categoria: (m[2] || nombre).trim(), terms };
  }).filter(Boolean);
}
setSinonimos(DEFAULT_SINONIMOS);

function hasSeq(tokens, seq) {
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

// Conceptos presentes en una lista de palabras y qué palabras los activaron.
export function detectConcepts(tokens) {
  const found = new Map();
  for (const c of CONCEPTOS) {
    for (const t of c.terms) {
      let hit = hasSeq(tokens, t);
      if (!hit && t.length === 1) hit = tokens.some((w) => fuzzyOk(w, t[0]));
      if (hit) { found.set(c.id, c); break; }
    }
  }
  return found;
}

// Conceptos a los que pertenece una palabra suelta (para contar sinónimos como coincidencia).
function conceptsOfWord(w) {
  return CONCEPTOS.filter((c) => c.terms.some((t) => t.includes(w) || (t.length === 1 && fuzzyOk(w, t[0])))).map((c) => c.id);
}

// Categoría y material sugeridos para un texto.
export function classify(text) {
  const found = [...detectConcepts(tokenize(text)).values()];
  const mat = found.find((c) => MATERIALES.has(c.id));
  // Prioridad: trabajos muy concretos, después el material, después el resto (montaje, diseño… al final).
  const cat = found.find((c) => TRABAJOS.has(c.id)) || mat
    || found.find((c) => !['montaje', 'instalacion', 'diseno'].includes(c.id)) || found[0];
  return { categoria: cat ? cat.categoria : '', material: mat ? mat.nombre : '' };
}

// ---------- Medidas ----------

const UNIT = String.raw`(mm|cm|metros?|mts?|m)?`;
const NUMB = String.raw`(\d+(?:[.,]\d+)?)`;
const MEAS_RE = new RegExp(String.raw`(?<![\d.,])${NUMB}\s*${UNIT}\s*[x×*]\s*${NUMB}\s*${UNIT}(?![a-z0-9])`, 'i');

function toMeters(v, unit, other) {
  const u = (unit || '').toLowerCase();
  if (u === 'mm') return v / 1000;
  if (u === 'cm') return v / 100;
  if (u) return v;
  const big = Math.max(v, other);
  if (big >= 1000) return v / 1000;
  if (big > 20) return v / 100;
  return v;
}

// «3x2», «3 x 2 m», «300x200 cm», «1,5 m x 80 cm» → { ancho, alto } en metros.
export function parseMeasures(text) {
  const m = String(text || '').match(MEAS_RE);
  if (!m) return null;
  const a = parseNum(m[1]);
  const b = parseNum(m[3]);
  if (!(a > 0 && b > 0)) return null;
  const ua = m[2] || (m[4] && !m[2] ? m[4] : '');
  const ub = m[4] || m[2] || '';
  return { ancho: round(toMeters(a, ua, b), 4), alto: round(toMeters(b, ub, a), 4), texto: m[0] };
}

function dimSimilarity(q, d) {
  if (!q || !d) return 0;
  const [qa, qb] = [q.ancho, q.alto].sort((x, y) => y - x);
  if (d.ancho && d.alto) {
    const [da, db] = [d.ancho, d.alto].sort((x, y) => y - x);
    const r1 = Math.min(qa, da) / Math.max(qa, da);
    const r2 = Math.min(qb, db) / Math.max(qb, db);
    const ar = Math.min(qa * qb, da * db) / Math.max(qa * qb, da * db);
    return (r1 + r2) / 4 + ar / 2;
  }
  if (d.m2) {
    const qa2 = qa * qb;
    return (Math.min(qa2, d.m2) / Math.max(qa2, d.m2)) * 0.8;
  }
  return 0;
}

// ---------- Índice ----------

// Ficha de búsqueda de una partida.
export function buildDoc(p) {
  const text = [p.articulo, p.categoria, p.material, p.descripcion, p.acabados].filter(Boolean).join(' ');
  const tokens = tokenize(text);
  let dims = p.ancho > 0 && p.alto > 0 ? { ancho: p.ancho, alto: p.alto } : null;
  if (!dims) {
    const m = parseMeasures(text);
    if (m) dims = { ancho: m.ancho, alto: m.alto };
  }
  if (dims) dims.m2 = dims.ancho * dims.alto;
  else if (p.m2 > 0) dims = { m2: p.m2 };
  const concepts = new Set(detectConcepts(tokens).keys());
  if (p.categoria) {
    const c = CONCEPTOS.find((x) => x.categoria === p.categoria && x.id === normalize(p.categoria));
    if (c) concepts.add(c.id);
  }
  return { p, tokens, tokenSet: new Set(tokens), concepts, dims, year: year(p.fecha) };
}

// Interpreta la búsqueda: palabras, conceptos, medidas y años.
export function parseQuery(q) {
  let text = String(q || '');
  const dims = parseMeasures(text);
  if (dims) text = text.replace(dims.texto, ' ');
  const years = [];
  text = text.replace(/\b(20[1-3]\d)\b/g, (y) => { years.push(Number(y)); return ' '; });
  const tokens = tokenize(text);
  const concepts = new Set(detectConcepts(tokens).keys());
  const tokenConcepts = tokens.map((w) => conceptsOfWord(w));
  return { tokens, concepts, tokenConcepts, dims, years };
}

function wordScore(w, wConcepts, doc) {
  if (doc.tokenSet.has(w)) return 1;
  if (wConcepts.some((c) => doc.concepts.has(c))) return 0.9;
  let best = 0;
  for (const t of doc.tokens) {
    if (w.length >= 4 && t.length >= 4 && (t.startsWith(w) || w.startsWith(t))) best = Math.max(best, 0.85);
    else if (best < 0.7 && fuzzyOk(w, t)) best = 0.7;
    if (best >= 0.85) break;
  }
  return best;
}

// Devuelve [{ doc, score }] ordenado de más a menos parecido.
export function search(query, docs, filtros = {}) {
  const q = typeof query === 'string' ? parseQuery(query) : query;
  const years = filtros.anio ? [Number(filtros.anio)] : q.years;
  const hasWords = q.tokens.length > 0;
  const hasDims = !!q.dims;
  const newest = Math.max(0, ...docs.map((d) => d.year || 0));
  const out = [];
  for (const d of docs) {
    const p = d.p;
    if (years.length && !years.includes(d.year)) continue;
    if (filtros.categoria && p.categoria !== filtros.categoria) continue;
    if (filtros.min != null && !(p.precioUnitario >= filtros.min)) continue;
    if (filtros.max != null && !(p.precioUnitario <= filtros.max)) continue;

    let score;
    if (!hasWords && !hasDims) {
      score = 50;
    } else {
      let base = 0;
      if (hasWords) {
        const text = q.tokens.reduce((s, w, i) => s + wordScore(w, q.tokenConcepts[i], d), 0) / q.tokens.length;
        if (q.concepts.size) {
          const shared = [...q.concepts].filter((c) => d.concepts.has(c)).length / q.concepts.size;
          base = 0.45 * shared + 0.55 * text;
        } else base = text;
        if (base < 0.3) continue;
      }
      const dim = hasDims ? dimSimilarity(q.dims, d.dims) : 0;
      if (!hasWords && dim < 0.4) continue;
      score = hasWords && hasDims ? 70 * base + 30 * dim : hasWords ? 100 * base : 100 * dim;
    }
    if (d.year && newest) score += Math.max(0, 3 - (newest - d.year));
    out.push({ doc: d, score: Math.min(100, score), dim: hasDims ? dimSimilarity(q.dims, d.dims) : null });
  }
  return out.sort((a, b) => b.score - a.score || (b.doc.p.fecha || '').localeCompare(a.doc.p.fecha || ''));
}

// ---------- Estadísticas ----------

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Resultados que cuentan para la comparación de precios: los más parecidos.
export function similares(results, max = 40) {
  if (!results.length) return [];
  const best = results[0].score;
  const limit = Math.max(45, best * 0.75);
  const near = results.filter((r) => r.score >= limit);
  // Si se buscó una medida, para comparar precios cuentan los de medida parecida (si los hay).
  const sameSize = near.filter((r) => r.dim == null || r.dim >= 0.6);
  return (sameSize.length ? sameSize : near).slice(0, max);
}

export function priceStats(results, queryDims) {
  // €/m² también para partidas que solo llevan las medidas en el texto.
  const rows = results.filter((r) => r.doc.p.precioUnitario > 0).map((r) => {
    const p = r.doc.p;
    const m2 = p.m2 > 0 ? p.m2 : r.doc.dims?.m2;
    return { ...p, precioM2: p.precioM2 > 0 ? p.precioM2 : (m2 > 0 ? round(p.precioUnitario / m2) : null) };
  });
  if (!rows.length) return null;
  const prices = rows.map((p) => p.precioUnitario);
  const withM2 = rows.filter((p) => p.precioM2 > 0);
  const m2prices = withM2.map((p) => p.precioM2);
  const last = [...rows].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))[0];

  const byYear = new Map();
  for (const p of rows) {
    const y = year(p.fecha);
    if (!y) continue;
    if (!byYear.has(y)) byYear.set(y, { anio: y, precios: [], m2: [] });
    byYear.get(y).precios.push(p.precioUnitario);
    if (p.precioM2 > 0) byYear.get(y).m2.push(p.precioM2);
  }
  const evolucion = [...byYear.values()].sort((a, b) => a.anio - b.anio).map((y) => ({
    anio: y.anio, n: y.precios.length, medio: round(avg(y.precios)), m2: round(avg(y.m2)),
  }));
  // Variación: en €/m² si hay datos en el primer y último año (compara mejor medidas distintas).
  let variacion = null;
  if (evolucion.length > 1) {
    const a = evolucion[0];
    const b = evolucion[evolucion.length - 1];
    const [va, vb, en] = a.m2 && b.m2 ? [a.m2, b.m2, '€/m²'] : [a.medio, b.medio, 'precio'];
    if (va > 0) variacion = { pct: round(((vb - va) / va) * 100, 1), desde: a.anio, hasta: b.anio, en };
  }
  const area = queryDims && queryDims.ancho && queryDims.alto ? queryDims.ancho * queryDims.alto : null;
  const m2med = median(m2prices);
  return {
    n: rows.length,
    ultimo: last,
    medio: round(avg(prices)),
    min: Math.min(...prices),
    max: Math.max(...prices),
    m2: m2prices.length ? { medio: round(avg(m2prices)), mediana: round(m2med), min: Math.min(...m2prices), max: Math.max(...m2prices), n: m2prices.length } : null,
    evolucion,
    variacion,
    orientativo: area && m2med ? { area: round(area, 3), precio: round(m2med * area) } : null,
  };
}
