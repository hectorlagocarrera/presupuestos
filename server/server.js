// Servidor de la aplicación de presupuestos: API con usuario y contraseña + base de datos SQLite.
// También sirve los archivos de la web (útil sin nginx); en el VPS nginx los sirve y reenvía /api aquí.
//   PRESUPUESTOS_DB=/var/lib/presupuestos/datos.db  PORT=3000  node server/server.js
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as DB from './db.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_DB = process.env.PRESUPUESTOS_DB || join(RAIZ, 'datos', 'datos.db');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_JSON = 60 * 1024 * 1024;   // importaciones grandes
const MAX_ARCHIVO = 60 * 1024 * 1024; // PDF con cientos de páginas

const db = DB.abrir(RUTA_DB);

// ---------- Utilidades ----------

function json(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function cuerpo(req, max) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > max) { reject(Object.assign(new Error('Archivo demasiado grande'), { code: 413 })); req.destroy(); return; }
      trozos.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const esHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const ip = (req) => req.headers['x-real-ip'] || req.socket.remoteAddress;

// Freno a los intentos de contraseña: 8 fallos por IP en 15 minutos.
const fallos = new Map();
function bloqueado(dir) {
  const f = fallos.get(dir);
  if (!f) return false;
  if (Date.now() - f.desde > 15 * 60000) { fallos.delete(dir); return false; }
  return f.n >= 8;
}
function fallo(dir) {
  const f = fallos.get(dir) || { n: 0, desde: Date.now() };
  f.n++;
  fallos.set(dir, f);
}

// ---------- API ----------

async function api(req, res, ruta) {
  // Protección CSRF: las peticiones de la app llevan esta cabecera (otra web no puede ponerla sin permiso).
  if (req.method !== 'GET' && req.headers['x-presupuestos'] !== '1') return json(res, 403, { error: 'Petición no permitida' });

  if (ruta === 'entrar' && req.method === 'POST') {
    const dir = ip(req);
    if (bloqueado(dir)) return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    let datos;
    try { datos = JSON.parse((await cuerpo(req, 10000)).toString() || '{}'); } catch { return json(res, 400, { error: 'Datos no válidos' }); }
    const usuario = String(datos.usuario || '').trim();
    if (!DB.comprobarClave(db, usuario, String(datos.clave || ''))) { fallo(dir); return json(res, 401, { error: 'Usuario o contraseña incorrectos' }); }
    fallos.delete(dir);
    const s = DB.crearSesion(db, usuario);
    const cookie = `sid=${s.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${s.maxAge}${esHttps(req) ? '; Secure' : ''}`;
    return json(res, 200, { usuario }, { 'Set-Cookie': cookie });
  }

  const token = cookies(req).sid;
  const usuario = DB.usuarioDeSesion(db, token);
  if (!usuario) return json(res, 401, { error: 'Hay que entrar con usuario y contraseña' });

  if (ruta === 'yo' && req.method === 'GET') return json(res, 200, { usuario });
  if (ruta === 'salir' && req.method === 'POST') {
    DB.cerrarSesion(db, token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
  }
  if (ruta === 'datos' && req.method === 'GET') return json(res, 200, DB.leerTodo(db));
  if (ruta === 'escribir' && req.method === 'POST') {
    let ops;
    try { ops = JSON.parse((await cuerpo(req, MAX_JSON)).toString()); } catch { return json(res, 400, { error: 'Datos no válidos' }); }
    DB.escribir(db, ops);
    return json(res, 200, { ok: true });
  }
  if (ruta === 'archivos' && req.method === 'GET') return json(res, 200, DB.listaArchivos(db));

  const m = ruta.match(/^archivos\/([\w-]{1,64})$/);
  if (m && req.method === 'PUT') {
    const u = new URL(req.url, 'http://x');
    DB.guardarArchivo(db, { id: m[1], nombre: u.searchParams.get('nombre'), tipo: u.searchParams.get('tipo'), datos: await cuerpo(req, MAX_ARCHIVO) });
    return json(res, 200, { ok: true });
  }
  if (m && req.method === 'GET') {
    const a = DB.leerArchivo(db, m[1]);
    if (!a) return json(res, 404, { error: 'No existe' });
    res.writeHead(200, {
      'Content-Type': a.tipo && a.tipo.includes('/') ? a.tipo : 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre || a.id)}`,
      'Cache-Control': 'private, no-store',
    });
    return res.end(Buffer.from(a.datos));
  }
  return json(res, 404, { error: 'No existe' });
}

// ---------- Archivos de la web ----------

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const PROHIBIDO = /^\/(server|deploy|tests|docs|datos|node_modules)(\/|$)|\/\.|^\/package(-lock)?\.json$/;

async function estatico(req, res, ruta) {
  if (PROHIBIDO.test(ruta)) { res.writeHead(404); return res.end(); }
  let f = normalize(join(RAIZ, ruta));
  if (!f.startsWith(RAIZ)) { res.writeHead(404); return res.end(); }
  try {
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    const datos = await readFile(f);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(datos);
  } catch {
    res.writeHead(404); res.end();
  }
}

// ---------- Arranque ----------

const servidor = http.createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const m = ruta.match(/\/api\/(.*)$/);
    if (m) await api(req, res, m[1]);
    else if (req.method === 'GET' || req.method === 'HEAD') await estatico(req, res, ruta);
    else { res.writeHead(405); res.end(); }
  } catch (err) {
    console.error(new Date().toISOString(), req.method, ruta, err);
    if (!res.headersSent) json(res, err.code === 413 ? 413 : 500, { error: err.code === 413 ? err.message : 'Error del servidor: ' + err.message });
    else res.end();
  }
});

servidor.listen(PORT, HOST, () => {
  console.log(`Presupuestos en http://${HOST}:${PORT} · base de datos ${RUTA_DB}`);
  if (!DB.listaUsuarios(db).length) console.log('Aún no hay usuarios. Crea uno con:  node server/usuarios.js nuevo <usuario>');
});

for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { servidor.close(); db.close(); process.exit(0); });
