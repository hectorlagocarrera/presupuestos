// Servidor de la aplicación de presupuestos: API con usuario y contraseña + base de datos SQLite.
// También sirve los archivos de la web (útil sin nginx); en el VPS nginx los sirve y reenvía /api aquí.
//   PRESUPUESTOS_DB=/var/lib/presupuestos/datos.db  PORT=3000  node server/server.js
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import * as DB from './db.js';
import * as MFA from './mfa.js';
import * as Correo from './correo.js';
import * as Firmas from './firmas.js';

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
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

// Freno a los intentos: 8 fallos por IP, 20 contraseñas o 10 códigos incorrectos por usuario, en 15 minutos.
// Así no se pueden probar contraseñas ni códigos sin fin, ni repartiendo los intentos entre muchas IP.
const VENTANA = 15 * 60000;
const LIMITES = { ip: 8, usuario: 20, mfa: 10 };
const fallos = new Map();
const claveFallo = (tipo, valor) => `${tipo}:${String(valor).toLowerCase()}`;
function bloqueado(tipo, valor) {
  const f = fallos.get(claveFallo(tipo, valor));
  if (!f) return false;
  if (Date.now() - f.desde > VENTANA) { fallos.delete(claveFallo(tipo, valor)); return false; }
  return f.n >= LIMITES[tipo];
}
function fallo(tipo, valor) {
  const k = claveFallo(tipo, valor);
  const f = fallos.get(k) || { n: 0, desde: Date.now() };
  f.n++;
  fallos.set(k, f);
}
setInterval(() => { const t = Date.now(); for (const [k, f] of fallos) if (t - f.desde > VENTANA) fallos.delete(k); }, 60000).unref();
const aviso = (req, texto) => console.warn(new Date().toISOString(), 'SEGURIDAD', texto, 'ip=' + ip(req));
const DEMASIADOS = { error: 'Demasiados intentos. Espera 15 minutos.' };

// ---------- Confirmación para gestionar usuarios ----------

// Sesión → hasta cuándo puede gestionar usuarios sin volver a escribir la contraseña.
const MINUTOS_CONFIRMACION = 10;
const confirmaciones = new Map();
const confirmado = (token) => (confirmaciones.get(DB.huella(token)) || 0) > Date.now();
setInterval(() => { const t = Date.now(); for (const [k, v] of confirmaciones) if (v < t) confirmaciones.delete(k); }, 60000).unref();

// ---------- Verificación en dos pasos ----------

const retos = new Map(); // reto del paso 2 del inicio de sesión → { usuario, expira, intentos }
setInterval(() => { const t = Date.now(); for (const [k, r] of retos) if (r.expira < t) retos.delete(k); }, 60000).unref();

// Código de la app o de recuperación. Devuelve { recuperacion, restantes } o null.
function verificarCodigo(usuario, cod) {
  const m = DB.datosMfa(db, usuario);
  if (!m?.mfa_secreto) return null;
  const paso = MFA.comprobar(m.mfa_secreto, cod, m.mfa_ultimo_paso ?? -1);
  if (paso != null) { DB.guardarMfa(db, usuario, { mfa_ultimo_paso: paso }); return { recuperacion: false }; }
  const resto = MFA.usarRecuperacion(JSON.parse(m.mfa_recuperacion || '[]'), cod || '');
  if (!resto) return null;
  DB.guardarMfa(db, usuario, { mfa_recuperacion: JSON.stringify(resto) });
  return { recuperacion: true, restantes: resto.length };
}

// Nombre que sale en la app del móvil: «Albaranes (empresa)».
function emisor() {
  try {
    const nombre = JSON.parse(db.prepare("SELECT valor FROM ajustes WHERE id = 'ajustes'").get()?.valor || '{}').nombre;
    return nombre ? `Albaranes ${nombre}`.slice(0, 60) : 'Albaranes';
  } catch { return 'Albaranes'; }
}

// ---------- Correo ----------

const CLAVES_CORREO = ['host', 'puerto', 'seguridad', 'usuario', 'clave', 'remitente', 'nombre', 'copia'];
const configCorreo = () => Object.fromEntries(CLAVES_CORREO.map((k) => [k, DB.leerConfig(db, 'smtp_' + k) || '']));
const correoListo = () => { const c = configCorreo(); return !!(c.host && c.remitente); };
async function mandarCorreo({ para, cc = [], asunto, html, texto, adjuntos }) {
  const c = configCorreo();
  if (!c.host || !c.remitente) throw new Error('El correo no está configurado (Ajustes → Correo).');
  return Correo.enviar(c, { de: c.remitente, nombreDe: c.nombre || undefined, para, cc, responderA: c.copia || undefined, asunto, html, texto, adjuntos });
}

// Dirección pública de la aplicación (para los enlaces de los emails).
const urlPublica = (req) => (DB.leerConfig(db, 'url_publica') || `${esHttps(req) ? 'https' : 'http'}://${req.headers.host}`).replace(/\/+$/, '');

// Manda la copia firmada al cliente (si dejó email) y a la oficina, y apunta cómo fue.
async function enviarCopiaFirma(req, presupuestoId, firmaId, emailCliente) {
  const c = configCorreo();
  const para = [emailCliente, c.copia].filter((e) => e && Correo.emailValido(e));
  if (!para.length) return 'sin destinatario';
  if (!correoListo()) { db.prepare('UPDATE firmas SET copia = ? WHERE id = ?').run('correo sin configurar', firmaId); return 'correo sin configurar'; }
  const f = db.prepare('SELECT * FROM firmas WHERE id = ?').get(firmaId);
  const ver = Firmas.crearEnlace(db, presupuestoId, { creadoPor: 'copia', dias: 90, mostrarImportes: !!f.mostrarImportes, solover: true });
  const v = Firmas.vistaDoc(db, presupuestoId, { importes: !!f.mostrarImportes });
  let pdf = null;
  try { pdf = Firmas.pdfFirmado(db, v, f); } catch (err) { console.error(new Date().toISOString(), 'PDF de la copia firmada', err.message); }
  const m = Firmas.emailCopia(v, f, f.imagen, `${urlPublica(req)}/firmar.html?t=${ver}`, pdf);
  try {
    await mandarCorreo({ para: para[0], cc: para.slice(1), ...m });
    const txt = `enviada a ${para.join(', ')} el ${new Date().toISOString()}`;
    db.prepare('UPDATE firmas SET copia = ? WHERE id = ?').run(txt, firmaId);
    return txt;
  } catch (err) {
    console.error(new Date().toISOString(), 'Correo de copia firmada', err.message);
    db.prepare('UPDATE firmas SET copia = ? WHERE id = ?').run('error: ' + err.message.slice(0, 200), firmaId);
    return 'error: ' + err.message;
  }
}

// ---------- API ----------

async function api(req, res, ruta) {
  // Protección CSRF: las peticiones de la app llevan esta cabecera (otra web no puede ponerla sin permiso).
  if (req.method !== 'GET' && req.headers['x-presupuestos'] !== '1') return json(res, 403, { error: 'Petición no permitida' });

  const leerJson = async (max = 10000) => { try { return JSON.parse((await cuerpo(req, max)).toString() || '{}'); } catch { return null; } };
  const abrirSesion = (usuario, extra = {}) => {
    const s = DB.crearSesion(db, usuario);
    const cookie = `sid=${s.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${s.maxAge}${esHttps(req) ? '; Secure' : ''}`;
    return json(res, 200, { usuario, ...extra }, { 'Set-Cookie': cookie });
  };

  // Paso 1: usuario y contraseña. Si tiene verificación en dos pasos, se devuelve un «reto» en vez de la sesión.
  if (ruta === 'entrar' && req.method === 'POST') {
    const dir = ip(req);
    if (bloqueado('ip', dir)) return json(res, 429, DEMASIADOS);
    const datos = await leerJson();
    if (!datos) return json(res, 400, { error: 'Datos no válidos' });
    const usuario = String(datos.usuario || '').trim().slice(0, 60);
    if (bloqueado('usuario', usuario)) { aviso(req, `usuario bloqueado por intentos: ${usuario}`); return json(res, 429, DEMASIADOS); }
    if (!DB.comprobarClave(db, usuario, String(datos.clave || '').slice(0, 200))) {
      fallo('ip', dir); fallo('usuario', usuario);
      aviso(req, `contraseña incorrecta para «${usuario}»`);
      return json(res, 401, { error: 'Usuario o contraseña incorrectos' });
    }
    if (DB.datosMfa(db, usuario)?.mfa_secreto) {
      if (bloqueado('mfa', usuario)) { aviso(req, `códigos bloqueados para «${usuario}»`); return json(res, 429, DEMASIADOS); }
      const reto = randomBytes(24).toString('hex');
      retos.set(reto, { usuario, expira: Date.now() + 5 * 60000, intentos: 0 });
      return json(res, 200, { mfa: true, reto });
    }
    fallos.delete(claveFallo('ip', dir));
    return abrirSesion(usuario);
  }

  // Paso 2: código de la app (o uno de recuperación).
  if (ruta === 'entrar-mfa' && req.method === 'POST') {
    const dir = ip(req);
    if (bloqueado('ip', dir)) return json(res, 429, DEMASIADOS);
    const datos = await leerJson();
    const r = datos && retos.get(String(datos.reto || ''));
    if (!r || r.expira < Date.now()) return json(res, 401, { error: 'Ha pasado demasiado tiempo. Vuelve a escribir la contraseña.', reiniciar: true });
    // Límite por usuario: aunque se sepa la contraseña, no se pueden probar códigos sin fin pidiendo retos nuevos.
    if (bloqueado('mfa', r.usuario)) { retos.delete(datos.reto); return json(res, 429, { ...DEMASIADOS, reiniciar: true }); }
    const v = verificarCodigo(r.usuario, datos.codigo);
    if (!v) {
      fallo('ip', dir); fallo('mfa', r.usuario);
      aviso(req, `código incorrecto para «${r.usuario}»`);
      if (++r.intentos >= 5) { retos.delete(datos.reto); return json(res, 401, { error: 'Demasiados códigos incorrectos. Vuelve a empezar.', reiniciar: true }); }
      return json(res, 401, { error: 'Código incorrecto' });
    }
    retos.delete(datos.reto);
    fallos.delete(claveFallo('ip', dir));
    fallos.delete(claveFallo('mfa', r.usuario));
    if (v.recuperacion) aviso(req, `entrada con código de recuperación de «${r.usuario}»`);
    return abrirSesion(r.usuario, v.recuperacion ? { recuperacionRestantes: v.restantes } : {});
  }

  // ---------- Firma a distancia (pública: basta el enlace) ----------
  if (ruta === 'publico/firma' || ruta === 'publico/firma/imagen') {
    const dir = ip(req);
    if (bloqueado('ip', dir)) return json(res, 429, DEMASIADOS);
    const t = new URL(req.url, 'http://x').searchParams.get('t');
    const datosPost = req.method === 'POST' ? await (async () => { try { return JSON.parse((await cuerpo(req, 800000)).toString()); } catch { return null; } })() : null;
    const e = Firmas.leerEnlace(db, req.method === 'POST' ? datosPost?.t : t);
    if (!e) { fallo('ip', dir); return json(res, 404, { error: 'El enlace no es válido o ha caducado. Pide uno nuevo a la empresa.' }); }
    const d = Firmas.leerDoc(db, e.presupuestoId);
    if (!d) return json(res, 404, { error: 'El documento ya no existe.' });
    if (ruta === 'publico/firma/imagen') {
      const img = d.firmaId ? Firmas.imagenFirma(db, d.firmaId) : null;
      if (!img) return json(res, 404, { error: 'No existe' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(Buffer.from(img));
    }
    const yaFirmado = d.estadoFirma === 'firmado' || d.estadoFirma === 'rechazado';
    if (req.method === 'GET') {
      const v = Firmas.vistaDoc(db, e.presupuestoId, { importes: !!e.mostrarImportes });
      // Al cliente, solo lo que tiene que ver de la firma (no la ubicación ni datos internos).
      if (v.firma) v.firma = Object.fromEntries(['estado', 'nombre', 'dni', 'fecha', 'modo', 'observaciones', 'motivo', 'huella'].map((k) => [k, v.firma[k]]));
      return json(res, 200, { ...v, modo: e.solover || e.usado || yaFirmado ? 'ver' : 'firmar', caduca: e.expira, emailSugerido: e.email || v.doc.clienteEmail });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'No permitido' });
    if (e.solover || e.usado || yaFirmado) return json(res, 409, { error: 'Este documento ya está firmado.' });
    const datos = Firmas.validarFirma(datosPost || {});
    if (datos.error) return json(res, 400, { error: datos.error });
    const f = Firmas.registrarFirma(db, e.presupuestoId, datos, { ip: dir, agente: req.headers['user-agent'], modo: 'enlace', recogidaPor: null, mostrarImportes: !!e.mostrarImportes });
    aviso(req, `${Firmas.NOMBRE_TIPO[d.tipo] || 'documento'} ${d.numero} ${datos.estado} a distancia por «${datos.nombre}»`);
    enviarCopiaFirma(req, e.presupuestoId, f.id, datos.email).catch(() => {});
    return json(res, 200, { ok: true, estado: datos.estado });
  }

  const token = cookies(req).sid;
  const usuario = DB.usuarioDeSesion(db, token);
  if (!usuario) return json(res, 401, { error: 'Hay que entrar con usuario y contraseña' });

  const yo = DB.datosUsuario(db, usuario);
  const mfaActivo = yo.mfa;
  const esAdmin = yo.rol === 'admin';
  const permisos = yo.permisos;
  const puede = (p) => permisos.includes(p);
  const obligatorio = DB.leerConfig(db, 'mfa_obligatorio') === '1';
  // Si la verificación en dos pasos es obligatoria, sin activarla solo se puede configurar.
  if (obligatorio && !mfaActivo && !['yo', 'salir', 'yo/clave'].includes(ruta) && !ruta.startsWith('mfa/')) {
    return json(res, 403, { error: 'Tienes que activar la verificación en dos pasos', configurarMfa: true });
  }
  // Contraseña puesta por un administrador: hay que cambiarla antes de seguir.
  if (yo.cambiar_clave && !['yo', 'salir', 'yo/clave'].includes(ruta) && !ruta.startsWith('mfa/')) {
    return json(res, 403, { error: 'Tienes que cambiar tu contraseña', cambiarClave: true });
  }

  if (ruta === 'yo' && req.method === 'GET') {
    return json(res, 200, { usuario, nombre: yo.nombre || '', rol: yo.rol, permisos, mfa: mfaActivo, mfaObligatorio: obligatorio, cambiarClave: yo.cambiar_clave });
  }

  // Cambiar la propia contraseña (pide la actual). Cierra las demás sesiones y abre una nueva.
  if (ruta === 'yo/clave' && req.method === 'POST') {
    const dir = ip(req);
    if (bloqueado('ip', dir) || bloqueado('usuario', usuario)) return json(res, 429, DEMASIADOS);
    const datos = (await leerJson()) || {};
    if (!DB.comprobarClave(db, usuario, String(datos.actual || '').slice(0, 200))) {
      fallo('ip', dir); fallo('usuario', usuario);
      aviso(req, `contraseña actual incorrecta al cambiarla («${usuario}»)`);
      return json(res, 400, { error: 'La contraseña actual no es correcta' });
    }
    try { DB.cambiarClave(db, usuario, String(datos.nueva || '')); } catch (err) { return json(res, 400, { error: err.message }); }
    aviso(req, `«${usuario}» ha cambiado su contraseña`);
    return abrirSesion(usuario);
  }

  // ---------- Gestión de usuarios (solo administradores) ----------
  if (ruta === 'mfa/politica' && !esAdmin) return json(res, 403, { error: 'Solo un administrador puede cambiar esto.' });
  if (ruta === 'usuarios' || ruta.startsWith('usuarios/')) {
    if (!esAdmin) { aviso(req, `«${usuario}» sin permiso intentó gestionar usuarios`); return json(res, 403, { error: 'Solo los administradores pueden gestionar usuarios.' }); }
    if (ruta === 'usuarios' && req.method === 'GET') return json(res, 200, { usuarios: DB.listaUsuarios(db), confirmado: confirmado(token) });
    if (req.method !== 'POST') return json(res, 404, { error: 'No existe' });
    const datos = (await leerJson()) || {};
    const dir = ip(req);
    const accion = ruta.slice('usuarios/'.length);
    // Antes de cambiar usuarios hay que volver a escribir la contraseña (vale 10 minutos).
    if (accion === 'confirmar') {
      if (bloqueado('ip', dir) || bloqueado('usuario', usuario)) return json(res, 429, DEMASIADOS);
      if (!DB.comprobarClave(db, usuario, String(datos.clave || '').slice(0, 200))) {
        fallo('ip', dir); fallo('usuario', usuario);
        aviso(req, `contraseña incorrecta al confirmar la gestión de usuarios («${usuario}»)`);
        return json(res, 400, { error: 'Contraseña incorrecta' });
      }
      confirmaciones.set(DB.huella(token), Date.now() + MINUTOS_CONFIRMACION * 60000);
      return json(res, 200, { ok: true, minutos: MINUTOS_CONFIRMACION });
    }
    if (!confirmado(token)) return json(res, 403, { error: 'Confirma tu contraseña para continuar.', confirmar: true });
    const quien = String(datos.usuario || '');
    if (accion !== 'crear' && !DB.existeUsuario(db, quien)) return json(res, 404, { error: 'Ese usuario no existe.' });
    const objetivo = accion !== 'crear' ? DB.datosUsuario(db, quien) : null;
    // Siempre tiene que quedar al menos un administrador activo.
    const quitaUltimoAdmin = (sigueAdmin) => objetivo?.rol === 'admin' && objetivo.activo && !sigueAdmin && DB.adminsActivos(db).length <= 1;
    try {
      if (accion === 'crear') {
        DB.crearUsuario(db, quien, String(datos.clave || ''), { rol: datos.rol, nombre: datos.nombre, permisos: datos.permisos, cambiarAlEntrar: datos.cambiarAlEntrar !== false });
        aviso(req, `«${usuario}» ha creado el usuario «${quien}» (${datos.rol}${datos.rol === 'admin' ? '' : ': ' + DB.permisosDe(DB.datosUsuario(db, quien)).join(', ')})`);
      } else if (accion === 'editar') {
        const cambios = {};
        if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
        if (datos.rol !== undefined) cambios.rol = datos.rol;
        if (datos.activo !== undefined) cambios.activo = !!datos.activo;
        if (datos.permisos !== undefined) cambios.permisos = datos.permisos;
        if (quien === usuario && cambios.activo === false) return json(res, 400, { error: 'No puedes desactivarte a ti mismo.' });
        const sigueAdmin = (cambios.rol ?? objetivo.rol) === 'admin' && (cambios.activo ?? objetivo.activo);
        if (quitaUltimoAdmin(sigueAdmin)) return json(res, 400, { error: 'Tiene que quedar al menos un administrador activo.' });
        DB.editarUsuario(db, quien, cambios);
        aviso(req, `«${usuario}» ha cambiado el usuario «${quien}»: ${JSON.stringify(cambios)}`);
      } else if (accion === 'clave') {
        DB.cambiarClave(db, quien, String(datos.clave || ''), { cambiarAlEntrar: quien !== usuario && datos.cambiarAlEntrar !== false });
        aviso(req, `«${usuario}» ha puesto una contraseña nueva a «${quien}»`);
      } else if (accion === 'mfa-quitar') {
        DB.quitarMfa(db, quien);
        DB.cerrarSesionesDe(db, quien);
        aviso(req, `«${usuario}» ha quitado la verificación en dos pasos a «${quien}»`);
      } else if (accion === 'cerrar-sesiones') {
        if (quien === usuario) DB.cerrarOtrasSesiones(db, usuario, token); else DB.cerrarSesionesDe(db, quien);
        aviso(req, `«${usuario}» ha cerrado las sesiones de «${quien}»`);
      } else if (accion === 'borrar') {
        if (quien === usuario) return json(res, 400, { error: 'No puedes borrarte a ti mismo.' });
        if (quitaUltimoAdmin(false)) return json(res, 400, { error: 'Tiene que quedar al menos un administrador activo.' });
        DB.borrarUsuario(db, quien);
        aviso(req, `«${usuario}» ha borrado el usuario «${quien}»`);
      } else return json(res, 404, { error: 'No existe' });
    } catch (err) { return json(res, 400, { error: err.message }); }
    // Si se ha cambiado la propia contraseña, las sesiones se han cerrado: se abre una nueva.
    if (accion === 'clave' && quien === usuario) return abrirSesion(usuario, { usuarios: DB.listaUsuarios(db) });
    return json(res, 200, { ok: true, usuarios: DB.listaUsuarios(db) });
  }

  if (ruta.startsWith('mfa/') && req.method === 'POST') {
    const datos = (await leerJson()) || {};
    const dir = ip(req);
    if (bloqueado('ip', dir) || bloqueado('mfa', usuario)) return json(res, 429, DEMASIADOS);
    const accion = ruta.slice(4);
    if (accion === 'iniciar') {
      if (mfaActivo) return json(res, 400, { error: 'Ya está activada. Desactívala primero para cambiar de móvil.' });
      const secreto = MFA.nuevoSecreto();
      DB.guardarMfa(db, usuario, { mfa_pendiente: secreto });
      return json(res, 200, { secreto, uri: MFA.uri(secreto, usuario, emisor()) });
    }
    if (accion === 'activar') {
      const pendiente = DB.datosMfa(db, usuario)?.mfa_pendiente;
      if (!pendiente) return json(res, 400, { error: 'Empieza de nuevo la activación.' });
      const paso = MFA.comprobar(pendiente, datos.codigo);
      if (paso == null) { fallo('ip', dir); fallo('mfa', usuario); return json(res, 400, { error: 'Código incorrecto. Comprueba que la hora del móvil es la correcta y prueba con el código nuevo.' }); }
      const { codigos, hashes } = MFA.nuevosCodigosRecuperacion();
      DB.guardarMfa(db, usuario, { mfa_secreto: pendiente, mfa_pendiente: null, mfa_ultimo_paso: paso, mfa_recuperacion: JSON.stringify(hashes) });
      DB.cerrarOtrasSesiones(db, usuario, token); // las sesiones abiertas solo con contraseña se cierran
      return json(res, 200, { codigos });
    }
    if (accion === 'desactivar') {
      if (!DB.comprobarClave(db, usuario, String(datos.clave || '')) || !verificarCodigo(usuario, datos.codigo)) {
        fallo('ip', dir); fallo('mfa', usuario); aviso(req, `intento fallido de desactivar la verificación de «${usuario}»`);
        return json(res, 400, { error: 'Contraseña o código incorrectos' });
      }
      DB.quitarMfa(db, usuario);
      aviso(req, `verificación en dos pasos desactivada por «${usuario}»`);
      return json(res, 200, { ok: true, mfaObligatorio: obligatorio });
    }
    if (accion === 'recuperacion') {
      const m = DB.datosMfa(db, usuario);
      const paso = m?.mfa_secreto ? MFA.comprobar(m.mfa_secreto, datos.codigo, m.mfa_ultimo_paso ?? -1) : null;
      if (paso == null) { fallo('ip', dir); fallo('mfa', usuario); return json(res, 400, { error: 'Código incorrecto' }); }
      const { codigos, hashes } = MFA.nuevosCodigosRecuperacion();
      DB.guardarMfa(db, usuario, { mfa_ultimo_paso: paso, mfa_recuperacion: JSON.stringify(hashes) });
      return json(res, 200, { codigos });
    }
    if (accion === 'politica') {
      if (!mfaActivo) return json(res, 400, { error: 'Activa primero la verificación en tu usuario.' });
      DB.guardarConfig(db, 'mfa_obligatorio', datos.obligatorio ? '1' : '0');
      aviso(req, `verificación obligatoria ${datos.obligatorio ? 'activada' : 'desactivada'} por «${usuario}»`);
      return json(res, 200, { mfaObligatorio: !!datos.obligatorio });
    }
    return json(res, 404, { error: 'No existe' });
  }
  if (ruta === 'salir' && req.method === 'POST') {
    DB.cerrarSesion(db, token);
    confirmaciones.delete(DB.huella(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
  }
  if (ruta === 'datos' && req.method === 'GET') return json(res, 200, DB.leerTodo(db, { sinFacturas: !puede('facturas'), operario: yo.rol === 'operario' }));

  // ---------- Correo (configuración: administradores) ----------
  if (ruta === 'correo' || ruta.startsWith('correo/')) {
    if (ruta === 'correo' && req.method === 'GET') {
      const c = configCorreo();
      return json(res, 200, { ...c, clave: c.clave ? '********' : '', urlPublica: DB.leerConfig(db, 'url_publica') || '', listo: correoListo(), puedeCambiar: esAdmin });
    }
    if (!esAdmin) return json(res, 403, { error: 'Solo un administrador puede configurar el correo.' });
    const datos = (await leerJson(20000)) || {};
    if (ruta === 'correo' && req.method === 'POST') {
      for (const k of CLAVES_CORREO) {
        if (!(k in datos) || (k === 'clave' && datos.clave === '********')) continue;
        DB.guardarConfig(db, 'smtp_' + k, String(datos[k] ?? '').trim().slice(0, 300));
      }
      let avisoUrl = '';
      if ('urlPublica' in datos) {
        const u = String(datos.urlPublica || '').trim().replace(/\/+$/, '').slice(0, 300);
        // Comprobar que es la dirección de esta aplicación: los clientes abrirán ahí los enlaces para firmar.
        if (u) {
          try {
            const r = await fetch(`${u}/firmar.html`, { signal: AbortSignal.timeout(6000), redirect: 'follow' });
            if (!r.ok || !(await r.text()).includes('js/firmar.js')) avisoUrl = `«${u}» no es la dirección de esta aplicación (allí no está la página de firma). Los clientes no podrían abrir los enlaces: déjala vacía para usar la del servidor.`;
          } catch { avisoUrl = `No se ha podido abrir «${u}». Los clientes no podrían abrir los enlaces: déjala vacía para usar la del servidor.`; }
        }
        if (!avisoUrl) DB.guardarConfig(db, 'url_publica', u);
      }
      aviso(req, `«${usuario}» ha cambiado la configuración del correo`);
      return json(res, 200, { ok: true, listo: correoListo(), avisoUrl, urlPublica: DB.leerConfig(db, 'url_publica') || '' });
    }
    if (ruta === 'correo/prueba' && req.method === 'POST') {
      if (!Correo.emailValido(datos.para)) return json(res, 400, { error: 'Escribe un email válido.' });
      try {
        await mandarCorreo({ para: datos.para, asunto: 'Prueba de correo · Albaranes', texto: 'Si recibes este mensaje, el correo de la aplicación funciona.', html: '<p>Si recibes este mensaje, el correo de la aplicación <strong>funciona</strong>.</p>' });
        return json(res, 200, { ok: true });
      } catch (err) { return json(res, 400, { error: err.message }); }
    }
    return json(res, 404, { error: 'No existe' });
  }

  // ---------- Firmas ----------
  if (ruta === 'firmas' || ruta.startsWith('firmas/')) {
    if (!puede('firmas')) return json(res, 403, { error: 'No tienes permiso para recoger firmas.' });
    const mImg = ruta.match(/^firmas\/imagen\/([a-f0-9]{24})$/);
    if (mImg && req.method === 'GET') {
      const f = db.prepare('SELECT presupuestoId, imagen FROM firmas WHERE id = ?').get(mImg[1]);
      const d = f && Firmas.leerDoc(db, f.presupuestoId);
      if (!f?.imagen || !d || (yo.rol === 'operario' && d.tipo !== 'albaran') || (d.tipo === 'factura' && !puede('facturas'))) return json(res, 404, { error: 'No existe' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(Buffer.from(f.imagen));
    }
    const datos = req.method === 'POST' ? (await (async () => { try { return JSON.parse((await cuerpo(req, 800000)).toString()); } catch { return null; } })()) || {} : {};
    const id = req.method === 'GET' ? ruta.split('/')[1] : String(datos.presupuestoId || '');
    const d = Firmas.leerDoc(db, id);
    if (!d) return json(res, 404, { error: 'El documento no existe.' });
    if (!Firmas.TIPOS_FIRMABLES.includes(d.tipo || 'presupuesto') || (yo.rol === 'operario' && d.tipo !== 'albaran')) {
      return json(res, 403, { error: 'Este tipo de documento no se firma aquí.' });
    }
    const accion = req.method === 'GET' ? 'ver' : ruta.slice('firmas/'.length);
    const nombreDoc = `${Firmas.NOMBRE_TIPO[d.tipo] || 'documento'} ${d.numero || ''}`.trim();
    const estado = () => ({ estado: Firmas.leerDoc(db, id).estadoFirma || '', firma: Firmas.leerDoc(db, id).firmaId ? Firmas.resumenFirma(db, Firmas.leerDoc(db, id).firmaId) : null,
      pendiente: Firmas.enlacePendiente(db, id), historial: Firmas.historialFirmas(db, id), modificado: Firmas.modificadoTrasFirma(db, id), correoListo: correoListo() });
    if (accion === 'ver') return json(res, 200, estado());
    if (accion === 'presencial') {
      if (d.estadoFirma === 'firmado') return json(res, 409, { error: 'Ya está firmado.' });
      const f = Firmas.validarFirma(datos);
      if (f.error) return json(res, 400, { error: f.error });
      const r = Firmas.registrarFirma(db, id, f, { ip: ip(req), agente: req.headers['user-agent'], modo: 'presencial', recogidaPor: usuario, mostrarImportes: datos.mostrarImportes !== false });
      aviso(req, `${nombreDoc} ${f.estado} en persona por «${f.nombre}» (recogida por «${usuario}»)`);
      const copia = await enviarCopiaFirma(req, id, r.id, f.email);
      return json(res, 200, { ...estado(), copia });
    }
    if (accion === 'enlace') {
      if (d.estadoFirma === 'firmado') return json(res, 409, { error: 'Ya está firmado.' });
      const email = String(datos.email || '').trim();
      if (email && !Correo.emailValido(email)) return json(res, 400, { error: 'El email no es válido.' });
      const dias = Math.min(30, Math.max(1, Number(datos.dias) || 7));
      Firmas.cancelarPendiente(db, id); // un enlace nuevo sustituye al anterior
      const t = Firmas.crearEnlace(db, id, { creadoPor: usuario, email, dias, mostrarImportes: datos.mostrarImportes !== false });
      const url = `${urlPublica(req)}/firmar.html?t=${t}`;
      let enviado = null;
      if (datos.enviar && email) {
        const m = Firmas.emailSolicitud(Firmas.vistaDoc(db, id, { importes: datos.mostrarImportes !== false }), url, dias);
        try { await mandarCorreo({ para: email, ...m }); enviado = email; } catch (err) { return json(res, 400, { error: 'No se pudo enviar el email: ' + err.message, url, ...estado() }); }
      }
      aviso(req, `«${usuario}» ha enviado ${nombreDoc} para firmar${enviado ? ' a ' + enviado : ' (enlace copiado)'}`);
      return json(res, 200, { url, enviado, ...estado() });
    }
    if (accion === 'cancelar') { Firmas.cancelarPendiente(db, id); return json(res, 200, estado()); }
    if (accion === 'reenviar') {
      if (!d.firmaId) return json(res, 400, { error: 'No está firmado.' });
      const email = String(datos.email || '').trim();
      if (!Correo.emailValido(email)) return json(res, 400, { error: 'Escribe un email válido.' });
      const r = await enviarCopiaFirma(req, id, d.firmaId, email);
      if (r.startsWith('error') || r === 'correo sin configurar') return json(res, 400, { error: r });
      return json(res, 200, { ...estado(), copia: r });
    }
    if (accion === 'anular') {
      if (!esAdmin && !puede('editar')) return json(res, 403, { error: 'Solo la oficina o un administrador pueden anular una firma.' });
      const motivo = String(datos.motivo || '').trim();
      if (motivo.length < 3) return json(res, 400, { error: 'Indica el motivo para anular la firma.' });
      Firmas.anularFirma(db, id, { usuario, motivo });
      aviso(req, `«${usuario}» ha anulado la firma de ${nombreDoc}: ${motivo}`);
      return json(res, 200, estado());
    }
    return json(res, 404, { error: 'No existe' });
  }
  if (ruta === 'escribir' && req.method === 'POST') {
    let ops;
    try { ops = JSON.parse((await cuerpo(req, MAX_JSON)).toString()); } catch { return json(res, 400, { error: 'Datos no válidos' }); }
    if (!ops || typeof ops !== 'object') return json(res, 400, { error: 'Datos no válidos' });
    const r = DB.comprobarEscritura(db, permisos, ops);
    if (r.error) { aviso(req, `«${usuario}» sin permiso: ${r.error}`); return json(res, 403, { error: r.error }); }
    DB.escribir(db, r.ops);
    return json(res, 200, { ok: true });
  }
  // La lista de todos los originales solo sirve para la copia de seguridad completa.
  if (ruta === 'archivos' && req.method === 'GET') {
    if (!puede('copias')) return json(res, 403, { error: 'No tienes permiso para hacer copias de seguridad.' });
    return json(res, 200, DB.listaArchivos(db));
  }

  const m = ruta.match(/^archivos\/([\w-]{1,64})$/);
  if (m && req.method === 'PUT') {
    if (!puede('importar')) return json(res, 403, { error: 'No tienes permiso para importar documentos.' });
    const u = new URL(req.url, 'http://x');
    DB.guardarArchivo(db, { id: m[1], nombre: String(u.searchParams.get('nombre') || '').slice(0, 200), tipo: String(u.searchParams.get('tipo') || '').slice(0, 100), datos: await cuerpo(req, MAX_ARCHIVO) });
    return json(res, 200, { ok: true });
  }
  if (m && req.method === 'GET') {
    const a = DB.leerArchivo(db, m[1]);
    const tipoArch = a ? DB.tipoDocDeArchivo(db, m[1]) : null;
    if (!a || (!puede('facturas') && tipoArch === 'factura') || (yo.rol === 'operario' && tipoArch !== 'albaran')) return json(res, 404, { error: 'No existe' });
    // Solo se muestran en el navegador los tipos conocidos (PDF, imágenes); el resto se descarga.
    // «sandbox» impide que un archivo subido ejecute código en la aplicación aunque fuera una página web.
    const tipo = TIPOS_ARCHIVO.has(a.tipo) ? a.tipo : 'application/octet-stream';
    const verEnNavegador = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(tipo);
    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Disposition': `${verEnNavegador ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nombre || a.id)}`,
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return res.end(Buffer.from(a.datos));
  }
  return json(res, 404, { error: 'No existe' });
}

// Tipos de archivo original admitidos (PDF, Excel, hojas de cálculo, texto, imágenes).
const TIPOS_ARCHIVO = new Set(['application/pdf', 'text/csv', 'text/plain', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet']);

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
    // no-cache: el navegador comprueba siempre si hay versión nueva (evita mezclar archivos tras actualizar).
    res.writeHead(200, { 'Content-Type': TIPOS[extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(datos);
  } catch {
    res.writeHead(404); res.end();
  }
}

// ---------- Arranque ----------

const servidor = http.createServer(async (req, res) => {
  let ruta = '';
  try {
    // Una dirección mal formada (p. ej. «%E0%A4%A») da error 400 en vez de tumbar el servidor.
    try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    const m = ruta.match(/\/api\/(.*)$/);
    if (m) await api(req, res, m[1]);
    else if (req.method === 'GET' || req.method === 'HEAD') await estatico(req, res, ruta);
    else { res.writeHead(405); res.end(); }
  } catch (err) {
    console.error(new Date().toISOString(), req.method, ruta, err);
    // Al navegador no se le dan detalles internos del error (quedan en el registro del servidor).
    if (!res.headersSent) json(res, err.code === 413 ? 413 : 500, { error: err.code === 413 ? err.message : 'Error del servidor. Inténtalo de nuevo.' });
    else res.end();
  }
});

servidor.listen(PORT, HOST, () => {
  console.log(`Albaranes en http://${HOST}:${PORT} · base de datos ${RUTA_DB}`);
  if (!DB.listaUsuarios(db).length) console.log('Aún no hay usuarios. Crea uno con:  node server/usuarios.js nuevo <usuario>');
});

// Última red de seguridad: un error inesperado se apunta en el registro y el servidor sigue funcionando.
process.on('unhandledRejection', (err) => console.error(new Date().toISOString(), 'Error no controlado', err));

for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { servidor.close(); db.close(); process.exit(0); });
