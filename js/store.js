// Base de datos local (IndexedDB) con copia en memoria para búsquedas instantáneas.
// Los datos solo existen en este navegador: no se envían a ningún servidor.
import { uid, today, calcPartida, round } from './util.js';
import { buildDoc, setSinonimos, DEFAULT_SINONIMOS, normalize } from './search.js';

const DB_NAME = 'presupuestos';
const STORES = ['presupuestos', 'partidas', 'clientes', 'archivos', 'ajustes'];

export const DEFAULT_AJUSTES = {
  nombre: '', cif: '', direccion: '', contacto: '', iva: 21, validez: '30 días', condiciones: '',
  sinonimos: DEFAULT_SINONIMOS, ultimaCopia: '', logo: '',
};

export const data = { presupuestos: [], partidas: [], clientes: [], ajustes: { ...DEFAULT_AJUSTES } };
let idb = null;
let docs = null;
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
function changed() { docs = null; listeners.forEach((fn) => fn()); }
export const notify = changed;

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function tx(stores, mode = 'readonly') { return idb.transaction(stores, mode); }
function done(t) {
  return new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
}

export async function open() {
  if (!('indexedDB' in window)) throw new Error('Este navegador no permite guardar datos.');
  idb = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) {
        const os = db.createObjectStore(s, { keyPath: 'id' });
        if (s === 'partidas') os.createIndex('presupuestoId', 'presupuestoId');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const t = tx(['presupuestos', 'partidas', 'clientes', 'ajustes']);
  const [p, pa, c, a] = await Promise.all(['presupuestos', 'partidas', 'clientes', 'ajustes'].map((s) => req(t.objectStore(s).getAll())));
  data.presupuestos = p;
  data.partidas = pa;
  data.clientes = c;
  data.ajustes = { ...DEFAULT_AJUSTES, ...((a.find((x) => x.id === 'ajustes') || {}).valor || {}) };
  setSinonimos(data.ajustes.sinonimos);
  // Pedir al navegador que no borre los datos para liberar espacio.
  try { await navigator.storage?.persist?.(); } catch { /* no disponible */ }
  changed();
}

// ---------- Lectura ----------

export const getPresupuesto = (id) => data.presupuestos.find((p) => p.id === id);
export const partidasDe = (id) => data.partidas.filter((p) => p.presupuestoId === id).sort((a, b) => a.orden - b.orden);
export const getCliente = (id) => data.clientes.find((c) => c.id === id);
export const clientePorNombre = (nombre) => data.clientes.find((c) => normalize(c.nombre) === normalize(nombre));

// Fichas de búsqueda (se rehacen solo cuando cambian los datos).
export function searchDocs() {
  if (!docs) docs = data.partidas.map(buildDoc);
  return docs;
}

export function anios() {
  return [...new Set(data.presupuestos.map((p) => Number(String(p.fecha).slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
}

export function nextNumber(fecha) {
  const y = (fecha || today()).slice(0, 4);
  let max = 0;
  for (const p of data.presupuestos) {
    const m = String(p.numero || '').match(new RegExp(`^${y}[-/](\\d+)$`));
    if (m) max = Math.max(max, +m[1]);
  }
  return `${y}-${String(max + 1).padStart(3, '0')}`;
}

// ---------- Escritura ----------

export async function saveAjustes(cambios) {
  Object.assign(data.ajustes, cambios);
  if ('sinonimos' in cambios) setSinonimos(data.ajustes.sinonimos);
  const t = tx(['ajustes'], 'readwrite');
  t.objectStore('ajustes').put({ id: 'ajustes', valor: data.ajustes });
  await done(t);
  if ('sinonimos' in cambios) changed();
}

export async function saveCliente(c) {
  const cliente = { id: c.id || uid(), nombre: (c.nombre || '').trim(), cif: c.cif || '', direccion: c.direccion || '', telefono: c.telefono || '', email: c.email || '', notas: c.notas || '' };
  const t = tx(['clientes'], 'readwrite');
  t.objectStore('clientes').put(cliente);
  await done(t);
  const i = data.clientes.findIndex((x) => x.id === cliente.id);
  if (i >= 0) data.clientes[i] = cliente; else data.clientes.push(cliente);
  changed();
  return cliente;
}

export async function deleteCliente(id) {
  const t = tx(['clientes'], 'readwrite');
  t.objectStore('clientes').delete(id);
  await done(t);
  data.clientes = data.clientes.filter((c) => c.id !== id);
  changed();
}

function totales(partidas, iva) {
  const base = round(partidas.reduce((s, p) => s + (p.precioTotal || 0), 0));
  return { base, total: round(base * (1 + (Number(iva) || 0) / 100)) };
}

// Guarda un presupuesto con sus partidas (sustituye las anteriores). Crea el cliente si no existe.
// opts.archivo: { nombre, tipo, blob } original importado.
export async function savePresupuesto(pres, partidas, opts = {}) {
  // El cliente se identifica por su nombre: si no existe, se crea.
  const nombre = (pres.clienteNombre || '').trim();
  let cliente = nombre ? clientePorNombre(nombre) : null;
  if (!cliente && nombre) cliente = await saveCliente({ nombre });

  const now = new Date().toISOString();
  const p = {
    id: pres.id || uid(),
    numero: pres.numero || '',
    fecha: pres.fecha || today(),
    clienteId: cliente ? cliente.id : null,
    clienteNombre: cliente ? cliente.nombre : (pres.clienteNombre || ''),
    iva: pres.iva == null ? data.ajustes.iva : Number(pres.iva),
    notas: pres.notas || '',
    origen: pres.origen || 'app',
    archivoId: pres.archivoId || null,
    archivoNombre: pres.archivoNombre || '',
    creado: pres.creado || now,
    modificado: now,
  };
  const t = tx(['presupuestos', 'partidas', 'archivos'], 'readwrite');
  if (opts.archivo) {
    p.archivoId = p.archivoId || uid();
    p.archivoNombre = opts.archivo.nombre;
    t.objectStore('archivos').put({ id: p.archivoId, ...opts.archivo });
  }
  const lista = partidas
    .filter((x) => x.articulo || x.descripcion || x.precioUnitario)
    .map((x, i) => calcPartida({
      id: x.id && x.presupuestoId === p.id ? x.id : uid(),
      presupuestoId: p.id,
      orden: i,
      articulo: x.articulo || '', categoria: x.categoria || '', descripcion: x.descripcion || '',
      material: x.material || '', acabados: x.acabados || '', montaje: x.montaje || '', observaciones: x.observaciones || '',
      ancho: x.ancho || null, alto: x.alto || null, m2: x.ancho && x.alto ? null : (x.m2 || null),
      cantidad: x.cantidad ?? 1, precioUnitario: x.precioUnitario ?? null, precioTotal: x.precioTotal ?? null,
      revisar: !!x.revisar,
      fecha: p.fecha, cliente: p.clienteNombre, numero: p.numero,
    }));
  Object.assign(p, totales(lista, p.iva));
  t.objectStore('presupuestos').put(p);
  const os = t.objectStore('partidas');
  for (const old of partidasDe(p.id)) os.delete(old.id);
  for (const x of lista) os.put(x);
  await done(t);

  const i = data.presupuestos.findIndex((x) => x.id === p.id);
  if (i >= 0) data.presupuestos[i] = p; else data.presupuestos.push(p);
  data.partidas = data.partidas.filter((x) => x.presupuestoId !== p.id).concat(lista);
  docs = null;
  if (!opts.silencioso) changed();
  return p;
}

// Cambia una partida suelta (desde la pantalla de artículos).
export async function savePartida(partida) {
  const p = calcPartida(partida);
  const t = tx(['partidas', 'presupuestos'], 'readwrite');
  t.objectStore('partidas').put(p);
  const i = data.partidas.findIndex((x) => x.id === p.id);
  if (i >= 0) data.partidas[i] = p;
  const pres = getPresupuesto(p.presupuestoId);
  if (pres) { Object.assign(pres, totales(partidasDe(pres.id), pres.iva)); t.objectStore('presupuestos').put(pres); }
  await done(t);
  changed();
}

export async function deletePresupuesto(id) {
  const p = getPresupuesto(id);
  const t = tx(['presupuestos', 'partidas', 'archivos'], 'readwrite');
  t.objectStore('presupuestos').delete(id);
  for (const x of partidasDe(id)) t.objectStore('partidas').delete(x.id);
  // El original puede ser compartido (un Excel con varios presupuestos).
  if (p?.archivoId && !data.presupuestos.some((x) => x.id !== id && x.archivoId === p.archivoId)) t.objectStore('archivos').delete(p.archivoId);
  await done(t);
  data.presupuestos = data.presupuestos.filter((x) => x.id !== id);
  data.partidas = data.partidas.filter((x) => x.presupuestoId !== id);
  changed();
}

export async function getArchivo(id) {
  return req(tx(['archivos']).objectStore('archivos').get(id));
}

// ---------- Copia de seguridad ----------

const blobToDataUrl = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });

export async function exportar(conOriginales) {
  const out = { app: 'presupuestos', version: 1, fecha: new Date().toISOString(), ...data, archivos: [] };
  if (conOriginales) {
    const all = await req(tx(['archivos']).objectStore('archivos').getAll());
    for (const a of all) out.archivos.push({ id: a.id, nombre: a.nombre, tipo: a.tipo, data: await blobToDataUrl(a.blob) });
  }
  await saveAjustes({ ultimaCopia: today() });
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

// Añade lo que no exista ya (por id). Devuelve cuántos presupuestos se añadieron.
export async function importar(json) {
  if (!json || !Array.isArray(json.presupuestos)) throw new Error('No es una copia de esta aplicación.');
  const have = new Set(data.presupuestos.map((p) => p.id));
  const nuevos = json.presupuestos.filter((p) => !have.has(p.id));
  const ids = new Set(nuevos.map((p) => p.id));
  const partidas = (json.partidas || []).filter((x) => ids.has(x.presupuestoId));
  const haveC = new Set(data.clientes.map((c) => c.id));
  const clientes = (json.clientes || []).filter((c) => !haveC.has(c.id));
  const archivos = (json.archivos || []).filter((a) => nuevos.some((p) => p.archivoId === a.id));
  const blobs = await Promise.all(archivos.map(async (a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo, blob: await (await fetch(a.data)).blob() })));
  const t = tx(['presupuestos', 'partidas', 'clientes', 'archivos'], 'readwrite');
  nuevos.forEach((p) => t.objectStore('presupuestos').put(p));
  partidas.forEach((p) => t.objectStore('partidas').put(p));
  clientes.forEach((c) => t.objectStore('clientes').put(c));
  blobs.forEach((a) => t.objectStore('archivos').put(a));
  await done(t);
  data.presupuestos.push(...nuevos);
  data.partidas.push(...partidas);
  data.clientes.push(...clientes);
  if (!data.ajustes.nombre && json.ajustes) await saveAjustes({ ...json.ajustes, ultimaCopia: data.ajustes.ultimaCopia });
  changed();
  return nuevos.length;
}
