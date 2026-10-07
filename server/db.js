// Base de datos SQLite (incluida en Node.js 22+, sin dependencias externas).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// Columnas de cada tabla (el resto de campos que lleguen se ignoran).
export const COLUMNAS = {
  presupuestos: ['id', 'tipo', 'numero', 'fecha', 'clienteId', 'clienteNombre', 'iva', 'notas', 'origen', 'archivoId',
    'archivoNombre', 'paginas', 'base', 'total', 'creado', 'modificado', 'estadoFirma', 'firmaId', 'firmaFecha', 'firmaNombre'],
  partidas: ['id', 'presupuestoId', 'orden', 'articulo', 'categoria', 'descripcion', 'material', 'acabados', 'montaje',
    'observaciones', 'ancho', 'alto', 'm2', 'cantidad', 'precioUnitario', 'precioTotal', 'precioM2', 'revisar',
    'fecha', 'cliente', 'numero', 'tipo'],
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
-- Firmas de albaranes (partes de trabajo) y presupuestos. No se borran: una firma anulada queda como historial.
CREATE TABLE IF NOT EXISTS firmas (
  id TEXT PRIMARY KEY, presupuestoId TEXT NOT NULL, estado TEXT NOT NULL, nombre TEXT, dni TEXT, email TEXT,
  observaciones TEXT, motivo TEXT, imagen BLOB, fecha TEXT NOT NULL, ip TEXT, agente TEXT, modo TEXT, recogidaPor TEXT,
  geo TEXT, huella TEXT, contenido TEXT, mostrarImportes INTEGER, copia TEXT, imagenJpeg BLOB,
  anulada INTEGER DEFAULT 0, anuladaPor TEXT, anuladaFecha TEXT, anuladaMotivo TEXT
);
CREATE INDEX IF NOT EXISTS firmas_presupuesto ON firmas(presupuestoId);
-- Enlaces para firmar a distancia (y ver la copia firmada). Solo se guarda la huella del token.
CREATE TABLE IF NOT EXISTS enlaces_firma (
  token TEXT PRIMARY KEY, presupuestoId TEXT NOT NULL, creado TEXT, creadoPor TEXT, email TEXT,
  expira INTEGER NOT NULL, usado INTEGER DEFAULT 0, firmaId TEXT, mostrarImportes INTEGER, solover INTEGER DEFAULT 0
);
`;

// Columnas añadidas después (bases de datos ya creadas se actualizan solas).
const MIGRACIONES = {
  presupuestos: { tipo: 'TEXT', paginas: 'TEXT', estadoFirma: 'TEXT', firmaId: 'TEXT', firmaFecha: 'TEXT', firmaNombre: 'TEXT' },
  firmas: { imagenJpeg: 'BLOB' },
  partidas: { tipo: 'TEXT' },
  usuarios: { mfa_secreto: 'TEXT', mfa_pendiente: 'TEXT', mfa_ultimo_paso: 'INTEGER', mfa_recuperacion: 'TEXT',
    rol: 'TEXT', activo: 'INTEGER', nombre: 'TEXT', ultimo_acceso: 'TEXT', cambiar_clave: 'INTEGER', permisos: 'TEXT' },
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
  // Roles: los usuarios de antes de existir los roles podían hacerlo todo, así que pasan a ser administradores.
  db.exec("UPDATE usuarios SET rol = 'admin' WHERE rol IS NULL");
  db.exec('UPDATE usuarios SET activo = 1 WHERE activo IS NULL');
  // Las sesiones se guardan ahora como huella (hash): las antiguas se borran una vez (hay que volver a entrar).
  if (leerConfig(db, 'sesiones_hash') !== '1') { db.exec('DELETE FROM sesiones'); guardarConfig(db, 'sesiones_hash', '1'); }
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
// sinFacturas: para quien no tiene permiso de ver facturas, ni siquiera se envían.
export function leerTodo(db, { sinFacturas = false, operario = false } = {}) {
  const out = {};
  for (const t of Object.keys(COLUMNAS)) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  if (operario) {
    // Operario: solo los albaranes (partes de trabajo), los clientes y los datos de la empresa para enseñarlos.
    const albaranes = new Set(out.presupuestos.filter((p) => p.tipo === 'albaran').map((p) => p.id));
    out.presupuestos = out.presupuestos.filter((p) => albaranes.has(p.id));
    out.partidas = out.partidas.filter((p) => albaranes.has(p.presupuestoId));
    const aj = JSON.parse(db.prepare("SELECT valor FROM ajustes WHERE id = 'ajustes'").get()?.valor || '{}');
    if (!aj.partesImportes) {
      for (const p of out.presupuestos) { p.base = null; p.total = null; }
      for (const l of out.partidas) { l.precioUnitario = null; l.precioTotal = null; l.precioM2 = null; }
    }
    out.ajustes = Object.fromEntries(['nombre', 'cif', 'direccion', 'contacto', 'logo', 'iva', 'partesImportes'].filter((k) => k in aj).map((k) => [k, aj[k]]));
    return out;
  }
  if (sinFacturas) {
    const facturas = new Set(out.presupuestos.filter((p) => p.tipo === 'factura').map((p) => p.id));
    out.presupuestos = out.presupuestos.filter((p) => !facturas.has(p.id));
    out.partidas = out.partidas.filter((p) => !facturas.has(p.presupuestoId));
  }
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

// ---------- Permisos de escritura ----------

// Ajustes que se cambian con cada permiso (el resto de claves son de «ajustes»: empresa, logotipo, sinónimos…).
const CLAVES_AJUSTES = { tarifa: ['tarifa', 'tarifaAjuste', 'tarifaOcultos'], copias: ['ultimaCopia'] };
const permisoDeClave = (k) => Object.keys(CLAVES_AJUSTES).find((p) => CLAVES_AJUSTES[p].includes(k)) || 'ajustes';

// Comprueba que el usuario puede hacer los cambios. Devuelve { error } o { ops } (los ajustes, ya combinados:
// lo que no puede cambiar se queda como estaba).
export function comprobarEscritura(db, permisos, { put = {}, del = {} }) {
  const tiene = (p) => permisos.includes(p);
  const doc = db.prepare('SELECT * FROM presupuestos WHERE id = ?');
  const partida = db.prepare('SELECT presupuestoId FROM partidas WHERE id = ?');
  const enLote = new Map((put.presupuestos || []).map((p) => [String(p?.id), p]));
  const borrados = new Set((del.presupuestos || []).map(String));
  const sinPermiso = (que) => ({ error: `No tienes permiso para ${que}. Pídeselo a un administrador.` });
  const esFactura = (id) => enLote.get(id)?.tipo === 'factura' || doc.get(id)?.tipo === 'factura';

  // Documentos firmados: no se pueden cambiar (antes hay que anular la firma).
  const firmado = (id) => doc.get(String(id))?.estadoFirma === 'firmado';
  const BLOQUEADO = { error: 'Este documento está firmado y no se puede modificar. Para cambiarlo, anula antes la firma.' };
  const mismoContenido = (a, b) => ['tipo', 'numero', 'fecha', 'clienteNombre'].every((k) => String(a?.[k] ?? '') === String(b?.[k] ?? ''))
    && ['iva', 'base', 'total'].every((k) => Math.abs((Number(a?.[k]) || 0) - (Number(b?.[k]) || 0)) < 0.005);
  for (const p of put.presupuestos || []) {
    const id = String(p?.id);
    const existe = doc.get(id);
    if (existe?.estadoFirma === 'firmado' && !mismoContenido(p, existe)) return BLOQUEADO;
    // El estado de la firma solo lo cambia el servidor al firmar o anular.
    if (p) for (const k of ['estadoFirma', 'firmaId', 'firmaFecha', 'firmaNombre']) p[k] = existe?.[k] ?? null;
    if ((p?.tipo === 'factura' || existe?.tipo === 'factura') && !tiene('facturas')) return sinPermiso('trabajar con facturas');
    if (existe ? !tiene('editar') : !tiene(p?.origen === 'importado' ? 'importar' : 'editar')) {
      return sinPermiso(existe ? 'modificar documentos' : p?.origen === 'importado' ? 'importar documentos' : 'crear documentos');
    }
  }
  for (const l of put.partidas || []) {
    const pid = String(l?.presupuestoId);
    if (firmado(pid)) return BLOQUEADO;
    if (enLote.has(pid)) continue; // ya comprobado con su documento
    if (!tiene('editar')) return sinPermiso('modificar documentos');
    if (esFactura(pid) && !tiene('facturas')) return sinPermiso('trabajar con facturas');
  }
  if ((put.clientes || []).length && !tiene('editar') && !tiene('importar')) return sinPermiso('modificar clientes');
  for (const id of del.presupuestos || []) {
    if (firmado(id)) return BLOQUEADO;
    if (!tiene('borrar')) return sinPermiso('borrar documentos');
    if (esFactura(String(id)) && !tiene('facturas')) return sinPermiso('trabajar con facturas');
  }
  for (const id of del.partidas || []) {
    const pid = partida.get(String(id))?.presupuestoId;
    if (pid && firmado(pid)) return BLOQUEADO;
    if (pid && borrados.has(pid)) continue; // se borran con su documento
    if (!tiene('editar')) return sinPermiso('modificar documentos');
  }
  if ((del.clientes || []).length && !tiene('borrar')) return sinPermiso('borrar clientes');
  if ((del.archivos || []).length && !tiene('borrar')) return sinPermiso('borrar archivos');

  // Ajustes: cada clave según su permiso; lo que no se puede cambiar se conserva.
  let ajustes = put.ajustes;
  if (ajustes) {
    const guardado = JSON.parse(db.prepare("SELECT valor FROM ajustes WHERE id = 'ajustes'").get()?.valor || '{}');
    ajustes = ajustes.map((nuevo) => {
      const out = { ...guardado };
      for (const k of new Set([...Object.keys(guardado), ...Object.keys(nuevo || {})])) {
        if (JSON.stringify(guardado[k]) === JSON.stringify(nuevo?.[k])) continue;
        if (tiene(permisoDeClave(k))) { if (nuevo && k in nuevo) out[k] = nuevo[k]; else delete out[k]; }
      }
      return out;
    });
  }
  return { ops: { put: { ...put, ...(ajustes ? { ajustes } : {}) }, del } };
}

// Documento al que pertenece un archivo original (para no dar facturas a quien no puede verlas).
export const tipoDocDeArchivo = (db, archivoId) => db.prepare('SELECT tipo FROM presupuestos WHERE archivoId = ? ORDER BY tipo = \'factura\' DESC LIMIT 1').get(String(archivoId))?.tipo || null;

// ---------- Archivos originales (PDF, Excel…) ----------

export function guardarArchivo(db, { id, nombre, tipo, datos }) {
  db.prepare('INSERT OR REPLACE INTO archivos (id, nombre, tipo, datos, creado) VALUES (?, ?, ?, ?, ?)')
    .run(String(id), String(nombre || ''), String(tipo || ''), datos, new Date().toISOString());
}
export const leerArchivo = (db, id) => db.prepare('SELECT id, nombre, tipo, datos FROM archivos WHERE id = ?').get(String(id));
export const listaArchivos = (db) => db.prepare('SELECT id, nombre, tipo FROM archivos').all();

// ---------- Usuarios y sesiones ----------

export const MIN_CLAVE = 12;

function hashClave(clave, sal = randomBytes(16).toString('hex')) {
  return `scrypt:${sal}:${scryptSync(clave, sal, 64).toString('hex')}`;
}

// operario: solo partes de trabajo (albaranes), recoger firmas y enviarlos para firmar.
export const ROLES = ['admin', 'usuario', 'operario'];
// Permisos que se pueden dar a un usuario (un administrador los tiene todos). Consultar lo tiene todo el mundo.
export const PERMISOS = ['editar', 'borrar', 'importar', 'facturas', 'tarifa', 'ajustes', 'copias', 'firmas'];
const limpiarPermisos = (lista) => (Array.isArray(lista) ? PERMISOS.filter((p) => lista.includes(p)) : []);
// Permisos efectivos: el administrador, todos; los usuarios de antes de existir los permisos (NULL), también todos.
export function permisosDe(u) {
  if (!u) return [];
  if (u.rol === 'operario') return ['firmas'];
  if (u.rol === 'admin' || u.permisos == null) return [...PERMISOS];
  try { return limpiarPermisos(JSON.parse(u.permisos)); } catch { return []; }
}

function validarClave(usuario, clave) {
  if (String(clave).length < MIN_CLAVE) throw new Error(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`);
  if (String(clave).length > 200) throw new Error('La contraseña es demasiado larga.');
  if (String(clave).toLowerCase().includes(String(usuario).toLowerCase())) throw new Error('La contraseña no puede contener el nombre de usuario.');
}

export const existeUsuario = (db, usuario) => !!db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(String(usuario));

export function crearUsuario(db, usuario, clave, { rol = 'usuario', nombre = '', cambiarAlEntrar = false, permisos = [] } = {}) {
  if (!/^[\w.@-]{2,40}$/.test(usuario)) throw new Error('Usuario no válido: de 2 a 40 letras sin acentos, números, . - _ @ (sin espacios).');
  if (existeUsuario(db, usuario)) throw new Error(`Ya existe el usuario «${usuario}».`);
  if (!ROLES.includes(rol)) throw new Error('Rol no válido.');
  validarClave(usuario, clave);
  db.prepare('INSERT INTO usuarios (usuario, hash, creado, rol, activo, nombre, cambiar_clave, permisos) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
    .run(usuario, hashClave(clave), new Date().toISOString(), rol, String(nombre || '').slice(0, 80), cambiarAlEntrar ? 1 : 0, JSON.stringify(limpiarPermisos(permisos)));
}

// Nueva contraseña: conserva el resto (rol, verificación en dos pasos) y cierra las sesiones abiertas.
// cambiarAlEntrar: la puso otra persona (un administrador), así que el usuario tendrá que cambiarla al entrar.
export function cambiarClave(db, usuario, clave, { cambiarAlEntrar = false } = {}) {
  if (!existeUsuario(db, usuario)) throw new Error('Ese usuario no existe.');
  validarClave(usuario, clave);
  if (comprobarClave(db, usuario, clave)) throw new Error('La contraseña nueva tiene que ser distinta de la actual.');
  db.prepare('UPDATE usuarios SET hash = ?, cambiar_clave = ? WHERE usuario = ?').run(hashClave(clave), cambiarAlEntrar ? 1 : 0, String(usuario));
  db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(String(usuario));
}

export function editarUsuario(db, usuario, { rol, activo, nombre, permisos } = {}) {
  if (!existeUsuario(db, usuario)) throw new Error('Ese usuario no existe.');
  if (permisos !== undefined) db.prepare('UPDATE usuarios SET permisos = ? WHERE usuario = ?').run(JSON.stringify(limpiarPermisos(permisos)), String(usuario));
  if (rol !== undefined) {
    if (!ROLES.includes(rol)) throw new Error('Rol no válido.');
    db.prepare('UPDATE usuarios SET rol = ? WHERE usuario = ?').run(rol, String(usuario));
  }
  if (nombre !== undefined) db.prepare('UPDATE usuarios SET nombre = ? WHERE usuario = ?').run(String(nombre || '').slice(0, 80), String(usuario));
  if (activo !== undefined) {
    db.prepare('UPDATE usuarios SET activo = ? WHERE usuario = ?').run(activo ? 1 : 0, String(usuario));
    if (!activo) cerrarSesionesDe(db, usuario); // desactivar lo echa al momento
  }
}

export const borrarUsuario = (db, usuario) => {
  db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(String(usuario));
  return db.prepare('DELETE FROM usuarios WHERE usuario = ?').run(String(usuario)).changes > 0;
};
export const listaUsuarios = (db) => db.prepare(`
  SELECT u.usuario, u.nombre, u.rol, u.activo, u.creado, u.ultimo_acceso, u.mfa_secreto IS NOT NULL AS mfa, u.cambiar_clave, u.permisos,
    (SELECT COUNT(*) FROM sesiones s WHERE s.usuario = u.usuario AND s.expira > ?) AS sesiones
  FROM usuarios u ORDER BY u.usuario`).all(Date.now())
  .map((u) => ({ ...u, activo: !!u.activo, mfa: !!u.mfa, cambiar_clave: !!u.cambiar_clave, permisos: permisosDe(u) }));
export const datosUsuario = (db, usuario) => listaUsuarios(db).find((u) => u.usuario === usuario) || null;
// Administradores activos (siempre tiene que quedar al menos uno).
export const adminsActivos = (db) => db.prepare("SELECT usuario FROM usuarios WHERE rol = 'admin' AND activo = 1").all().map((r) => r.usuario);
export const cerrarSesionesDe = (db, usuario) => db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(String(usuario)).changes;

// Solo valen los usuarios activos (un usuario desactivado no puede entrar aunque sepa su contraseña).
export function comprobarClave(db, usuario, clave) {
  const u = db.prepare('SELECT hash FROM usuarios WHERE usuario = ? AND activo = 1').get(String(usuario));
  // Se calcula el hash aunque el usuario no exista, para no dar pistas por el tiempo de respuesta.
  const [, sal, h] = (u?.hash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const calc = scryptSync(String(clave), sal, 64);
  return !!u && timingSafeEqual(calc, Buffer.from(h, 'hex'));
}

// En la base de datos solo se guarda la huella del token: quien viera una copia de la base de datos
// no podría usarla para entrar.
export const huella = (token) => createHash('sha256').update(String(token || '')).digest('hex');
const DIAS_SESION = 7;
export function crearSesion(db, usuario) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario, expira) VALUES (?, ?, ?)').run(huella(token), usuario, Date.now() + DIAS_SESION * 86400000);
  db.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now());
  db.prepare('UPDATE usuarios SET ultimo_acceso = ? WHERE usuario = ?').run(new Date().toISOString(), usuario);
  return { token, maxAge: DIAS_SESION * 86400 };
}
export function usuarioDeSesion(db, token) {
  if (!token) return null;
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const s = db.prepare('SELECT s.usuario, s.expira FROM sesiones s JOIN usuarios u ON u.usuario = s.usuario WHERE s.token = ? AND u.activo = 1').get(huella(token));
  return s && s.expira > Date.now() ? s.usuario : null;
}
export const cerrarOtrasSesiones = (db, usuario, token) => db.prepare('DELETE FROM sesiones WHERE usuario = ? AND token <> ?').run(String(usuario), huella(token));
export const cerrarSesion = (db, token) => db.prepare('DELETE FROM sesiones WHERE token = ?').run(huella(token));
