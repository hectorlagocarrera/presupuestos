// Tarifa de precios: agrupa las partidas de todos los presupuestos en artículos y calcula un precio sugerido.
import { tokenize, CATEGORIAS } from './search.js';
import { round } from './util.js';

// Palabras que no distinguen un artículo de otro (colores, tallas, medidas…).
const RUIDO = new Set(tokenize(`color colores blanco blanca negro negra rojo roja azul verde gris amarillo naranja rosa
  marino ebano oro plata granate burdeos beige crema talla tallas xs xxl xxxl medida tamano ref referencia aprox
  aproximadamente modelo mod segun cliente logo logos dos tres cuatro cara caras una uno pieza piezas incluido
  incluida nuestra nuestras suministro`));

// Categorías que se cobran por unidad aunque lleven medidas (una camiseta, una tarjeta…).
const MIN_AREA = 0.25;
const POR_UNIDAD = new Set(['Textil', 'Imprenta', 'Merchandising', 'Sellos', 'Diseño', 'Montaje', 'Instalación']);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Clave del artículo: categoría + las 3 primeras palabras que lo describen.
// «LONA MICROPERFORADA REFORZADA CON OJALES 300x100» y «Lona microperforada reforzada 2x1» → mismo artículo.
export function claveArticulo(p) {
  const nucleo = tokenize(p.articulo || p.descripcion || '').filter((w) => w.length > 2 && !/\d/.test(w) && !RUIDO.has(w)).slice(0, 3);
  if (!nucleo.length) return null;
  return [p.categoria || 'Otros', ...nucleo].join('|');
}

function nombreCorto(t) {
  // Sin la cantidad del principio: «17 ALUCABONES DE…» → «ALUCABONES DE…».
  const s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^[-–·*\s]+/, '')
    .replace(/^\d[\d.,]*\s+(?:uds?\.?\s+|unidades\s+)?(?:de\s+)?(?=[a-záéíóúñ])/i, '');
  return s.length > 80 ? s.slice(0, 77).replace(/\s+\S*$/, '') + '…' : s;
}

// partidas → artículos de tarifa ordenados por categoría y nombre.
// precio sugerido = mediana de los 10 usos más recientes (en €/m² si se cobra por superficie).
export function generarTarifa(partidas) {
  const grupos = new Map();
  for (const p of partidas) {
    if (!(p.precioUnitario > 0) || !(p.cantidad > 0) || p.revisar) continue;
    const k = claveArticulo(p);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const orden = (c) => { const i = CATEGORIAS.indexOf(c); return i < 0 ? 99 : i; };
  const out = [];
  for (const [clave, items] of grupos) {
    items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const categoria = items[0].categoria || 'Otros';
    // Por m² solo si la mayoría lleva medidas y las piezas son grandes (de media ≥ 0,25 m²);
    // pegatinas, foam A3 o trofeos se cobran por unidad.
    const conM2 = items.filter((p) => p.precioM2 > 0);
    const area = median(conM2.map((p) => p.precioUnitario / p.precioM2));
    const porM2 = !POR_UNIDAD.has(categoria) && conM2.length >= Math.max(1, Math.ceil(items.length / 2)) && area >= MIN_AREA;
    const valor = (p) => (porM2 ? p.precioM2 : p.precioUnitario);
    const validos = items.filter((p) => valor(p) > 0);
    // Rango de los usos recientes (los mismos que dan el precio sugerido).
    const todos = validos.slice(0, 10).map(valor);
    out.push({
      clave,
      categoria,
      nombre: nombreCorto(items[0].articulo),
      unidad: porM2 ? 'm²' : 'ud',
      sugerido: round(median(validos.slice(0, 10).map(valor)), 2),
      min: round(Math.min(...todos), 2),
      max: round(Math.max(...todos), 2),
      veces: items.length,
      facturadas: items.filter((p) => p.tipo === 'factura').length,
      ultimaFecha: items[0].fecha || '',
      ultimoPrecio: round(valor(validos[0] || items[0]), 2),
      ejemplos: items.slice(0, 8),
    });
  }
  return out.sort((a, b) => orden(a.categoria) - orden(b.categoria) || a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

// Precio final: el escrito a mano o el sugerido con el ajuste general (%).
export function precioTarifa(art, manuales = {}, ajuste = 0) {
  const m = manuales[art.clave];
  if (m != null && m !== '') return Number(m);
  return round(art.sugerido * (1 + (Number(ajuste) || 0) / 100), 2);
}
