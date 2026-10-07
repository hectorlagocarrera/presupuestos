// Datos de la aplicación: copia en memoria para búsquedas instantáneas + almacenamiento permanente,
// que puede ser la base de datos del servidor o, sin servidor, el propio navegador (ver backend.js).
import { uid, today, calcPartida, round, tipoDe } from './util.js';
import { buildDoc, setSinonimos, DEFAULT_SINONIMOS, normalize } from './search.js';
import { navegador } from './backend.js';

export const DEFAULT_AJUSTES = {
  nombre: '', cif: '', direccion: '', contacto: '', iva: 21, validez: '30 días', condiciones: '',
  sinonimos: DEFAULT_SINONIMOS, ultimaCopia: '', logo: '',
};

export const data = { presupuestos: [], partidas: [], clientes: [], ajustes: { ...DEFAULT_AJUSTES } };
let backend = navegador;
let docs = null;
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
function changed() { docs = null; listeners.forEach((fn) => fn()); }
export const notify = changed;
export const modo = () => backend.nombre;

// ---------- Escrituras (de una en una o en bloque) ----------

let lote = null;
function juntar(destino, ops) {
  for (const tipo of ['put', 'del']) {
    for (const [tabla, filas] of Object.entries(ops[tipo] || {})) {
      destino[tipo] = destino[tipo] || {};
      (destino[tipo][tabla] = destino[tipo][tabla] || []).push(...filas);
    }
  }
}
async function escribir(ops) {
  if (lote) { juntar(lote.ops, ops); return; }
  await backend.escribir(ops);
}

// Ejecuta fn acumulando todas las escrituras y las envía juntas al final (para importaciones grandes).
export async function enBloque(fn) {
  lote = { ops: {} };
  try {
    await fn();
    const { ops } = lote;
    lote = null;
    // Por partes, para no mandar peticiones gigantes.
    const trozos = [];
    const MAX = 3000;
    for (const tipo of ['del', 'put']) {
      for (const [tabla, filas] of Object.entries(ops[tipo] || {})) {
        for (let i = 0; i < filas.length; i += MAX) trozos.push({ [tipo]: { [tabla]: filas.slice(i, i + MAX) } });
      }
    }
    // Primero clientes y presupuestos, luego partidas.
    const orden = { clientes: 0, presupuestos: 1, partidas: 2, ajustes: 3, archivos: 4 };
    trozos.sort((a, b) => orden[Object.keys(Object.values(a)[0])[0]] - orden[Object.keys(Object.values(b)[0])[0]]);
    for (const t of trozos) await backend.escribir(t);
  } finally {
    lote = null;
    changed();
  }
}

export async function open(be) {
  if (be) backend = be;
  const d = await backend.cargar();
  data.presupuestos = d.presupuestos || [];
  data.partidas = (d.partidas || []).map((p) => ({ ...p, revisar: !!p.revisar }));
  // Las partidas guardadas antes de existir el tipo llevan el de su documento.
  const tipos = new Map((d.presupuestos || []).map((p) => [p.id, tipoDe(p)]));
  for (const p of data.partidas) if (!p.tipo) p.tipo = tipos.get(p.presupuestoId) || 'presupuesto';
  data.clientes = d.clientes || [];
  data.ajustes = { ...DEFAULT_AJUSTES, ...(d.ajustes || {}) };
  setSinonimos(data.ajustes.sinonimos);
  changed();
}

// Vuelve a leer los datos (para ver lo que han guardado otros ordenadores).
export const recargar = () => open();

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

// Siguiente nº del año para ese tipo de documento: continúa la numeración existente (335, 336… o 2026-001, 2026-002…).
export function nextNumber(fecha, tipo = 'albaran') {
  const y = (fecha || today()).slice(0, 4);
  let maxPlano = 0;
  let maxAnio = 0;
  for (const p of data.presupuestos) {
    if (tipoDe(p) !== tipo) continue; // cada tipo de documento lleva su propia numeración
    const n = String(p.numero || '').trim();
    const m = n.match(new RegExp(`^${y}[-/](\\d+)$`));
    if (m) maxAnio = Math.max(maxAnio, +m[1]);
    else if (/^\d+$/.test(n) && String(p.fecha || '').startsWith(y)) maxPlano = Math.max(maxPlano, +n);
  }
  if (maxPlano > maxAnio) return String(maxPlano + 1);
  return `${y}-${String(maxAnio + 1).padStart(3, '0')}`;
}

// Documento ya guardado que es el mismo que doc (para no importarlo o numerarlo dos veces).
// Con número: mismo tipo, mismo número (sin contar espacios, mayúsculas ni ceros a la izquierda) y mismo año,
// porque la numeración vuelve a empezar cada año. Sin número: mismo tipo, fecha, cliente y total.
const claveNumero = (n) => String(n || '').toLowerCase().replace(/\s+/g, '').replace(/(^|[^\d])0+(?=\d)/g, '$1');
export function buscarDuplicado(doc, excluirId = null) {
  const tipo = tipoDe(doc);
  const n = claveNumero(doc.numero);
  const anio = String(doc.fecha || '').slice(0, 4);
  return data.presupuestos.find((p) => {
    if (p.id === excluirId || tipoDe(p) !== tipo) return false;
    if (n) return claveNumero(p.numero) === n && (!anio || !p.fecha || p.fecha.slice(0, 4) === anio);
    return !p.numero && doc.fecha && p.fecha === doc.fecha
      && (p.clienteNombre || '').trim().toLowerCase() === (doc.clienteNombre || '').trim().toLowerCase()
      && doc.total != null && Math.abs((p.total || 0) - doc.total) < 0.01;
  }) || null;
}

// ---------- Escritura ----------

export async function saveAjustes(cambios) {
  Object.assign(data.ajustes, cambios);
  if ('sinonimos' in cambios) setSinonimos(data.ajustes.sinonimos);
  await escribir({ put: { ajustes: [data.ajustes] } });
  if ('sinonimos' in cambios) changed();
}

export async function saveCliente(c) {
  const cliente = { id: c.id || uid(), nombre: (c.nombre || '').trim(), cif: c.cif || '', direccion: c.direccion || '', telefono: c.telefono || '', email: c.email || '', notas: c.notas || '' };
  await escribir({ put: { clientes: [cliente] } });
  const i = data.clientes.findIndex((x) => x.id === cliente.id);
  if (i >= 0) data.clientes[i] = cliente; else data.clientes.push(cliente);
  if (!lote) changed();
  return cliente;
}

export async function deleteCliente(id) {
  await escribir({ del: { clientes: [id] } });
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
  if (!cliente && nombre) cliente = await saveCliente({ nombre, ...(pres.clienteDatos || {}) });

  const now = new Date().toISOString();
  const p = {
    id: pres.id || uid(),
    tipo: tipoDe(pres),
    numero: pres.numero || '',
    fecha: pres.fecha || today(),
    clienteId: cliente ? cliente.id : null,
    clienteNombre: cliente ? cliente.nombre : (pres.clienteNombre || ''),
    iva: pres.iva == null ? data.ajustes.iva : Number(pres.iva),
    notas: pres.notas || '',
    origen: pres.origen || 'app',
    archivoId: pres.archivoId || null,
    archivoNombre: pres.archivoNombre || '',
    paginas: pres.paginas || '',
    creado: pres.creado || now,
    modificado: now,
  };
  if (opts.archivo) {
    p.archivoId = p.archivoId || uid();
    p.archivoNombre = opts.archivo.nombre;
    await backend.guardarArchivo({ id: p.archivoId, ...opts.archivo });
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
      fecha: p.fecha, cliente: p.clienteNombre, numero: p.numero, tipo: p.tipo,
    }));
  // Al importar se respetan los totales del PDF (puede haber partidas opcionales o descuentos globales).
  Object.assign(p, opts.totalesPdf ? { base: opts.totalesPdf.base, total: opts.totalesPdf.total ?? totales(lista, p.iva).total } : totales(lista, p.iva));
  const viejas = partidasDe(p.id).map((x) => x.id).filter((id) => !lista.some((x) => x.id === id));
  await escribir({ put: { presupuestos: [p], partidas: lista }, del: viejas.length ? { partidas: viejas } : {} });

  const i = data.presupuestos.findIndex((x) => x.id === p.id);
  if (i >= 0) data.presupuestos[i] = p; else data.presupuestos.push(p);
  data.partidas = data.partidas.filter((x) => x.presupuestoId !== p.id).concat(lista);
  docs = null;
  if (!opts.silencioso && !lote) changed();
  return p;
}

// Cambia una partida suelta (desde la pantalla de artículos).
export async function savePartida(partida) {
  const p = calcPartida(partida);
  const i = data.partidas.findIndex((x) => x.id === p.id);
  if (i >= 0) data.partidas[i] = p;
  const pres = getPresupuesto(p.presupuestoId);
  if (pres) Object.assign(pres, totales(partidasDe(pres.id), pres.iva));
  await escribir({ put: { partidas: [p], ...(pres ? { presupuestos: [pres] } : {}) } });
  changed();
}

// Vuelve a calcular categoría y material de todas las partidas (por ejemplo, tras cambiar los sinónimos).
// clasificar(texto) → { categoria, material }. Devuelve cuántas cambiaron.
export async function recalcularCategorias(clasificar) {
  const cambiadas = [];
  for (const p of data.partidas) {
    const c = clasificar([p.articulo, p.descripcion].filter(Boolean).join(' '));
    if (c.categoria !== (p.categoria || '') || (c.material && c.material !== p.material)) {
      p.categoria = c.categoria;
      if (c.material) p.material = c.material;
      cambiadas.push(p);
    }
  }
  for (let i = 0; i < cambiadas.length; i += 3000) await backend.escribir({ put: { partidas: cambiadas.slice(i, i + 3000) } });
  changed();
  return cambiadas.length;
}

export async function deletePresupuesto(id) {
  const p = getPresupuesto(id);
  // El original puede ser compartido (un Excel con varios presupuestos).
  const borrarArchivo = p?.archivoId && !data.presupuestos.some((x) => x.id !== id && x.archivoId === p.archivoId);
  await escribir({ del: { presupuestos: [id], partidas: partidasDe(id).map((x) => x.id), ...(borrarArchivo ? { archivos: [p.archivoId] } : {}) } });
  data.presupuestos = data.presupuestos.filter((x) => x.id !== id);
  data.partidas = data.partidas.filter((x) => x.presupuestoId !== id);
  changed();
}

export const getArchivo = (id) => backend.leerArchivo(id);

// Apunta en qué páginas del PDF original está cada documento ({ id: '12-13' }). Si el usuario no tiene permiso
// para modificar documentos, solo se recuerda en esta sesión.
export async function guardarPaginas(asignacion) {
  const cambiados = data.presupuestos.filter((p) => asignacion[p.id] && p.paginas !== asignacion[p.id]);
  for (const p of cambiados) p.paginas = asignacion[p.id];
  if (!cambiados.length) return;
  try {
    for (let i = 0; i < cambiados.length; i += 1000) await escribir({ put: { presupuestos: cambiados.slice(i, i + 1000) } });
  } catch { /* sin permiso: no pasa nada */ }
}

// Sustituye los documentos importados de un archivo por los que se acaban de volver a leer de él (el original
// se conserva). Se salta los que ya existan por otro lado. Devuelve { borrados, guardados, saltados }.
export async function sustituirDeArchivo(archivoId, archivoNombre, leidos) {
  const viejos = data.presupuestos.filter((p) => p.archivoId === archivoId);
  const ids = new Set(viejos.map((p) => p.id));
  let guardados = 0; let saltados = 0;
  await enBloque(async () => {
    await escribir({ del: { presupuestos: [...ids], partidas: data.partidas.filter((x) => ids.has(x.presupuestoId)).map((x) => x.id) } });
    data.presupuestos = data.presupuestos.filter((p) => !ids.has(p.id));
    data.partidas = data.partidas.filter((x) => !ids.has(x.presupuestoId));
    for (const b of leidos) {
      const doc = { tipo: tipoDe(b), numero: b.numero, fecha: b.fecha || '', clienteNombre: b.cliente, clienteDatos: b.clienteDatos,
        origen: 'importado', archivoId, archivoNombre, paginas: b.paginas || '', notas: '', total: b.total };
      if (b.numero && buscarDuplicado({ ...doc, clienteNombre: b.cliente })) { saltados++; continue; }
      await savePresupuesto(doc, b.partidas, { silencioso: true, totalesPdf: b.base != null ? { base: b.base, total: b.total } : null });
      guardados++;
    }
  });
  changed();
  return { borrados: viejos.length, guardados, saltados };
}

// ---------- Copia de seguridad ----------

const blobToDataUrl = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });

export async function exportar(conOriginales) {
  const out = { app: 'presupuestos', version: 1, fecha: new Date().toISOString(), ...data, archivos: [] };
  if (conOriginales) {
    for (const meta of await backend.listaArchivos()) {
      const a = await backend.leerArchivo(meta.id);
      if (a) out.archivos.push({ id: a.id, nombre: a.nombre, tipo: a.tipo, data: await blobToDataUrl(a.blob) });
    }
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
  for (const a of blobs) await backend.guardarArchivo(a);
  await enBloque(async () => { await escribir({ put: { clientes, presupuestos: nuevos, partidas } }); });
  data.presupuestos.push(...nuevos);
  data.partidas.push(...partidas);
  data.clientes.push(...clientes);
  if (!data.ajustes.nombre && json.ajustes) await saveAjustes({ ...json.ajustes, ultimaCopia: data.ajustes.ultimaCopia });
  changed();
  return nuevos.length;
}
