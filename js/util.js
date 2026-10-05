// Utilidades comunes (sin dependencias). Se usan en la web y en las pruebas con Node.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Fecha de hoy en hora local, AAAA-MM-DD.
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Números en formato español: "1.234,56" -> 1234.56 · "4,5" -> 4.5 · "4.50" -> 4.5 · "1.234" -> 1234
export function parseNum(text) {
  if (typeof text === 'number') return text;
  if (text == null) return NaN;
  let s = String(text).replace(/[€\s]/g, '').replace(/^\+/, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

// Número o null (para campos opcionales).
export function numOrNull(v) {
  const n = parseNum(v);
  return Number.isFinite(n) ? n : null;
}

export const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 });
const num2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
export const fmtEur = (n) => (n == null || !Number.isFinite(n) ? '—' : eur.format(n));
export const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '' : num.format(n));
export const fmtM2 = (n) => (n == null || !Number.isFinite(n) || n <= 0 ? '' : num2.format(n) + ' m²');
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
export const year = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Piezas indicadas al principio del texto cuando la cantidad es 1: «17 ALUCABONES DE 1800x400» → 17.
export function piezasTexto(texto) {
  const m = String(texto || '').match(/^\s*(\d{1,3}(?:\.\d{3})*|\d+)\s+(?:uds?\.?\s+|unidades\s+)?(?:de\s+)?[a-záéíóúñ]/i);
  const n = m ? parseNum(m[1]) : 1;
  return n > 1 && n < 100000 ? n : 1;
}

// Superficie y precio por m² de una partida (por unidad).
// El €/m² solo tiene sentido en piezas de cierto tamaño (no en tarjetas o pegatinas de pocos cm).
export const MIN_M2 = 0.05;
export function calcPartida(p) {
  const m2 = p.ancho > 0 && p.alto > 0 ? round(p.ancho * p.alto, 4) : (p.m2 > 0 ? p.m2 : null);
  const precioTotal = p.precioUnitario != null && p.cantidad != null ? round(p.precioUnitario * p.cantidad) : (p.precioTotal ?? null);
  const piezas = p.cantidad === 1 || p.cantidad == null ? piezasTexto(p.articulo) : 1;
  const area = m2 ? m2 * piezas : null;
  const precioM2 = area && area >= MIN_M2 && p.precioUnitario > 0 ? round(p.precioUnitario / area) : null;
  return { ...p, m2, precioTotal, precioM2 };
}
