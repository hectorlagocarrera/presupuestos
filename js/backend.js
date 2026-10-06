// Dónde se guardan los datos:
//  - «servidor»: base de datos SQLite en el servidor de la empresa (VPS), con usuario y contraseña.
//  - «navegador»: IndexedDB de este navegador (cuando la app se abre sin servidor, p. ej. en GitHub Pages).
// Las dos opciones ofrecen las mismas operaciones:
//   cargar() → { presupuestos, partidas, clientes, ajustes }
//   escribir({ put: { tabla: [filas] }, del: { tabla: [ids] } })   (todo o nada)
//   guardarArchivo({ id, nombre, tipo, blob }) · leerArchivo(id) · listaArchivos()

export const TABLAS = ['presupuestos', 'partidas', 'clientes', 'ajustes', 'archivos'];

// ---------- Servidor ----------

export class NoAutorizado extends Error {}

async function api(ruta, opciones = {}) {
  const res = await fetch('api/' + ruta, {
    credentials: 'same-origin',
    ...opciones,
    headers: { 'X-Presupuestos': '1', ...(opciones.body && !(opciones.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(opciones.headers || {}) },
  });
  if (res.status === 401) throw new NoAutorizado('Sesión caducada');
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* sin detalle */ }
    throw new Error(msg);
  }
  return res;
}

export const servidor = {
  nombre: 'servidor',
  async cargar() { return (await api('datos')).json(); },
  async escribir(ops) { await api('escribir', { method: 'POST', body: JSON.stringify(ops) }); },
  async guardarArchivo(a) {
    const q = new URLSearchParams({ nombre: a.nombre || '', tipo: a.tipo || '' });
    await api(`archivos/${encodeURIComponent(a.id)}?${q}`, { method: 'PUT', body: a.blob, headers: { 'Content-Type': 'application/octet-stream' } });
  },
  async leerArchivo(id) {
    const res = await api('archivos/' + encodeURIComponent(id));
    const nombre = decodeURIComponent((res.headers.get('Content-Disposition') || '').split("filename*=UTF-8''")[1] || id);
    return { id, nombre, tipo: res.headers.get('Content-Type') || '', blob: await res.blob() };
  },
  async listaArchivos() { return (await api('archivos')).json(); },
  async usuario() { return (await api('yo')).json(); },
  async salir() { await api('salir', { method: 'POST' }); },
};

// ¿Hay servidor? 'si' (con sesión), 'login' (hay que entrar) o 'no' (modo navegador).
export async function detectarServidor() {
  try {
    const res = await fetch('api/yo', { credentials: 'same-origin', headers: { 'X-Presupuestos': '1' } });
    if (res.status === 401) return 'login';
    if (res.ok && (res.headers.get('Content-Type') || '').includes('json')) return 'si';
  } catch { /* sin servidor */ }
  return 'no';
}

async function post(ruta, cuerpo) {
  const res = await fetch('api/' + ruta, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Presupuestos': '1' },
    body: JSON.stringify(cuerpo || {}),
  });
  let datos = {};
  try { datos = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw Object.assign(new Error(datos.error || `Error ${res.status}`), { datos });
  return datos;
}

// Paso 1: devuelve { usuario } (ya dentro) o { mfa: true, reto } (falta el código).
export const entrar = (usuario, clave) => post('entrar', { usuario, clave });
// Paso 2: código de 6 cifras o código de recuperación.
export const entrarMfa = (reto, codigo) => post('entrar-mfa', { reto, codigo });

// Verificación en dos pasos del usuario conectado.
export const mfa = {
  iniciar: () => post('mfa/iniciar'),
  activar: (codigo) => post('mfa/activar', { codigo }),
  desactivar: (clave, codigo) => post('mfa/desactivar', { clave, codigo }),
  recuperacion: (codigo) => post('mfa/recuperacion', { codigo }),
  politica: (obligatorio) => post('mfa/politica', { obligatorio }),
};

// ---------- Navegador (IndexedDB) ----------

let idb = null;
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (t) => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });

async function abrirIdb() {
  if (idb) return idb;
  if (!('indexedDB' in window)) throw new Error('Este navegador no permite guardar datos.');
  idb = await new Promise((resolve, reject) => {
    const r = indexedDB.open('presupuestos', 1);
    r.onupgradeneeded = () => {
      for (const s of TABLAS) if (!r.result.objectStoreNames.contains(s)) {
        const os = r.result.createObjectStore(s, { keyPath: 'id' });
        if (s === 'partidas') os.createIndex('presupuestoId', 'presupuestoId');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try { await navigator.storage?.persist?.(); } catch { /* no disponible */ }
  return idb;
}

export const navegador = {
  nombre: 'navegador',
  async cargar() {
    const db = await abrirIdb();
    const t = db.transaction(['presupuestos', 'partidas', 'clientes', 'ajustes']);
    const [presupuestos, partidas, clientes, aj] = await Promise.all(['presupuestos', 'partidas', 'clientes', 'ajustes'].map((s) => req(t.objectStore(s).getAll())));
    return { presupuestos, partidas, clientes, ajustes: (aj.find((x) => x.id === 'ajustes') || {}).valor || {} };
  },
  async escribir({ put = {}, del = {} }) {
    const db = await abrirIdb();
    const tablas = [...new Set([...Object.keys(put), ...Object.keys(del)])];
    if (!tablas.length) return;
    const t = db.transaction(tablas, 'readwrite');
    for (const [tabla, ids] of Object.entries(del)) for (const id of ids) t.objectStore(tabla).delete(id);
    for (const [tabla, filas] of Object.entries(put)) {
      for (const f of filas) t.objectStore(tabla).put(tabla === 'ajustes' ? { id: 'ajustes', valor: f } : f);
    }
    await done(t);
  },
  async guardarArchivo(a) {
    const db = await abrirIdb();
    const t = db.transaction(['archivos'], 'readwrite');
    t.objectStore('archivos').put(a);
    await done(t);
  },
  async leerArchivo(id) { return req((await abrirIdb()).transaction(['archivos']).objectStore('archivos').get(id)); },
  async listaArchivos() {
    const all = await req((await abrirIdb()).transaction(['archivos']).objectStore('archivos').getAll());
    return all.map(({ id, nombre, tipo }) => ({ id, nombre, tipo }));
  },
};
