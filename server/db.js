// Base de datos SQLite (incluida en Node.js 22+, sin dependencias externas).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Columnas de cada tabla (el resto de campos que lleguen se ignoran).
export const COLUMNAS = {
  presupuestos: ['id', 'numero', 'fecha', 'clienteId', 'clienteNombre', 'iva', 'notas', 'origen', 'archivoId',
    'archivoNombre', 'base', 'total', 'creado', 'modificado'],
  partidas: ['id', 'presupuestoId', 'orden', 'articulo', 'categoria', 'descripcion', 'material', 'acabados', 'montaje',
    'observaciones', 'ancho', 'alto', 'm2', 'cantidad', 'precioUnitario', 'precioTotal', 'precioM2', 'revisar',
    'fecha', 'cliente', 'numero'],
  clientes: ['id', 'nombre', 'cif', 'direccion', 'telefono', 'email', 'notas'],
};
const NUMERICAS = new Set(['iva', 'base', 'total', 'orden', 'ancho', 'alto', 'm2', 'cantidad', 'precioUnitario', 'precioTotal', 'precioM2']);

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS presupuestos (
  id TEXT PRIMARY KEY, numero TEXT, fecha TEXT, clienteId TEXT, clienteNombre TEXT, iva REAL, notas TEXT,
  origen TEXT, archivoId TEXT, archivoNombre TEXT, base REAL, total REAL, creado TEXT, modificado TEXT
);
CREATE INDEX IF NOT EXISTS presupuestos_fecha ON presupuestos(fecha);
CREATE TABLE IF NOT EXISTS partidas (
  id TEXT PRIMARY KEY, presupuestoId TEXT NOT NULL, orden INTEGER, articulo TEXT, categoria TEXT, descripcion TEXT,
  material TEXT, acabados TEXT, montaje TEXT, observaciones TEXT, ancho REAL, alto REAL, m2 REAL, cantidad REAL,
  precioUnitario REAL, precioTotal REAL, precioM2 REAL, revisar INTEGER, fecha TEXT, cliente TEXT, numero TEXT
);
CREATE INDEX IF NOT EXISTS partidas_presupuesto ON partidas(presupuestoId);
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY, nombre TEXT, cif TEXT, direccion TEXT, telefono TEXT, email TEXT, notas TEXT
);
CREATE TABLE IF NOT EXISTS ajustes (id TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS archivos (id TEXT PRIMARY KEY, nombre TEXT, tipo TEXT, datos BLOB, creado TEXT);
CREATE TABLE IF NOT EXISTS usuarios (usuario TEXT PRIMARY KEY, hash TEXT NOT NULL, creado TEXT);
CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, usuario TEXT NOT NULL, expira INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
`;

// Columnas añadidas después (bases de datos ya creadas se actualizan solas).
const MIGRACIONES = {
  usuarios: { mfa_secreto: 'TEXT', mfa_pendiente: 'TEXT', mfa_ultimo_paso: 'INTEGER', mfa_recuperacion: 'TEXT' },
};

export function abrir(ruta) {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(ESQUEMA);
  for (const [tabla, cols] of Object.entries(MIGRACIONES)) {
    const hay = new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
    for (const [c, tipo] of Object.entries(cols)) if (!hay.has(c)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${c} ${tipo}`);
  }
  return db;
}

// ---------- Configuración del servidor (no la pueden cambiar los datos de la app) ----------

export const leerConfig = (db, clave) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor ?? null;
export const guardarConfig = (db, clave, valor) => db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(clave, String(valor));

// ---------- Verificación en dos pasos ----------

export const datosMfa = (db, usuario) => db.prepare('SELECT mfa_secreto, mfa_pendiente, mfa_ultimo_paso, mfa_recuperacion FROM usuarios WHERE usuario = ?').get(String(usuario));
export function guardarMfa(db, usuario, cambios) {
  const cols = Object.keys(cambios);
  db.prepare(`UPDATE usuarios SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE usuario = ?`).run(...cols.map((c) => cambios[c]), String(usuario));
}
export const quitarMfa = (db, usuario) => db.prepare('UPDATE usuarios SET mfa_secreto = NULL, mfa_pendiente = NULL, mfa_ultimo_paso = NULL, mfa_recuperacion = NULL WHERE usuario = ?').run(String(usuario)).changes > 0;

function valor(col, v) {
  if (v === undefined || v === null || v === '') return NUMERICAS.has(col) ? null : (v === '' ? '' : null);
  if (col === 'revisar') return v ? 1 : 0;
  if (NUMERICAS.has(col)) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return String(v);
}

// Todos los datos de la aplicación (se cargan enteros en el navegador para buscar al instante).
export function leerTodo(db) {
  const out = {};
  for (const t of Object.keys(COLUMNAS)) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  for (const p of out.partidas) p.revisar = !!p.revisar;
  const aj = db.prepare("SELECT valor FROM ajustes WHERE id = 'ajustes'").get();
  out.ajustes = aj ? JSON.parse(aj.valor) : {};
  return out;
}

// Escribe un conjunto de cambios en una sola transacción: { put: { tabla: [filas] }, del: { tabla: [ids] } }.
export function escribir(db, { put = {}, del = {} }) {
  db.exec('BEGIN');
  try {
    for (const [tabla, ids] of Object.entries(del)) {
      if (!COLUMNAS[tabla] && tabla !== 'archivos') throw new Error('Tabla desconocida: ' + tabla);
      const st = db.prepare(`DELETE FROM ${tabla} WHERE id = ?`);
      for (const id of ids) st.run(String(id));
    }
    for (const [tabla, filas] of Object.entries(put)) {
      if (tabla === 'ajustes') {
        const st = db.prepare("INSERT OR REPLACE INTO ajustes (id, valor) VALUES ('ajustes', ?)");
        for (const f of filas) st.run(JSON.stringify(f || {}));
        continue;
      }
      const cols = COLUMNAS[tabla];
      if (!cols) throw new Error('Tabla desconocida: ' + tabla);
      const st = db.prepare(`INSERT OR REPLACE INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const f of filas) {
        if (!f || !f.id) throw new Error('Fila sin id en ' + tabla);
        st.run(...cols.map((c) => valor(c, f[c])));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- Archivos originales (PDF, Excel…) ----------

export function guardarArchivo(db, { id, nombre, tipo, datos }) {
  db.prepare('INSERT OR REPLACE INTO archivos (id, nombre, tipo, datos, creado) VALUES (?, ?, ?, ?, ?)')
    .run(String(id), String(nombre || ''), String(tipo || ''), datos, new Date().toISOString());
}
export const leerArchivo = (db, id) => db.prepare('SELECT id, nombre, tipo, datos FROM archivos WHERE id = ?').get(String(id));
export const listaArchivos = (db) => db.prepare('SELECT id, nombre, tipo FROM archivos').all();

// ---------- Usuarios y sesiones ----------

function hashClave(clave, sal = randomBytes(16).toString('hex')) {
  return `scrypt:${sal}:${scryptSync(clave, sal, 64).toString('hex')}`;
}

export function crearUsuario(db, usuario, clave) {
  if (!/^[\w.@-]{2,40}$/.test(usuario)) throw new Error('Usuario no válido (letras, números, . - _ @).');
  if (String(clave).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  db.prepare('INSERT OR REPLACE INTO usuarios (usuario, hash, creado) VALUES (?, ?, ?)').run(usuario, hashClave(clave), new Date().toISOString());
  db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(usuario); // cierra sesiones con la contraseña anterior
}
export const borrarUsuario = (db, usuario) => {
  db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(usuario);
  return db.prepare('DELETE FROM usuarios WHERE usuario = ?').run(usuario).changes > 0;
};
export const listaUsuarios = (db) => db.prepare('SELECT usuario, creado, mfa_secreto IS NOT NULL AS mfa FROM usuarios ORDER BY usuario').all();

export function comprobarClave(db, usuario, clave) {
  const u = db.prepare('SELECT hash FROM usuarios WHERE usuario = ?').get(String(usuario));
  // Se calcula el hash aunque el usuario no exista, para no dar pistas por el tiempo de respuesta.
  const [, sal, h] = (u?.hash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const calc = scryptSync(String(clave), sal, 64);
  return !!u && timingSafeEqual(calc, Buffer.from(h, 'hex'));
}

const DIAS_SESION = 30;
export function crearSesion(db, usuario) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario, expira) VALUES (?, ?, ?)').run(token, usuario, Date.now() + DIAS_SESION * 86400000);
  db.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now());
  return { token, maxAge: DIAS_SESION * 86400 };
}
export function usuarioDeSesion(db, token) {
  if (!token) return null;
  const s = db.prepare('SELECT usuario, expira FROM sesiones WHERE token = ?').get(token);
  return s && s.expira > Date.now() ? s.usuario : null;
}
export const cerrarOtrasSesiones = (db, usuario, token) => db.prepare('DELETE FROM sesiones WHERE usuario = ? AND token <> ?').run(String(usuario), String(token || ''));
export const cerrarSesion = (db, token) => db.prepare('DELETE FROM sesiones WHERE token = ?').run(String(token || ''));
