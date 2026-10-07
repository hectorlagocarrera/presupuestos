import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../server/db.js';

test('base de datos: escribir, leer y borrar en una transacción', () => {
  const db = DB.abrir(':memory:');
  DB.escribir(db, {
    put: {
      clientes: [{ id: 'c1', nombre: 'Cliente Demo' }],
      presupuestos: [{ id: 'p1', numero: '1', fecha: '2026-01-02', clienteNombre: 'Cliente Demo', iva: 21, base: 100, total: 121 }],
      partidas: [{ id: 'l1', presupuestoId: 'p1', orden: 0, articulo: 'Lona 3x1', ancho: 3, alto: 1, cantidad: 1, precioUnitario: 100, revisar: true, campoRaro: 'x' }],
      ajustes: [{ nombre: 'Empresa Demo', iva: 21 }],
    },
  });
  const d = DB.leerTodo(db);
  assert.equal(d.presupuestos[0].total, 121);
  assert.equal(d.partidas[0].revisar, true);
  assert.equal(d.partidas[0].campoRaro, undefined, 'solo se guardan las columnas conocidas');
  assert.equal(d.ajustes.nombre, 'Empresa Demo');
  assert.throws(() => DB.escribir(db, { put: { partidas: [{ id: 'l2', presupuestoId: 'p1' }, { articulo: 'sin id' }] } }));
  assert.equal(DB.leerTodo(db).partidas.length, 1, 'si algo falla no se guarda nada');
  assert.throws(() => DB.escribir(db, { put: { usuarios: [{ id: 'x' }] } }), /desconocida/);
  DB.escribir(db, { del: { partidas: ['l1'], presupuestos: ['p1'] } });
  assert.equal(DB.leerTodo(db).presupuestos.length, 0);
});

test('usuarios y sesiones', () => {
  const db = DB.abrir(':memory:');
  assert.throws(() => DB.crearUsuario(db, 'ana', 'corta-de-11'), /12 caracteres/);
  assert.throws(() => DB.crearUsuario(db, 'ana', 'ana-y-su-clave'), /nombre de usuario/);
  DB.crearUsuario(db, 'ana', 'una-clave-larguisima');
  assert.equal(DB.comprobarClave(db, 'ana', 'una-clave-larguisima'), true);
  assert.equal(DB.comprobarClave(db, 'ana', 'otra'), false);
  assert.equal(DB.comprobarClave(db, 'nadie', 'una-clave-larguisima'), false);
  const { token } = DB.crearSesion(db, 'ana');
  assert.equal(DB.usuarioDeSesion(db, token), 'ana');
  DB.cambiarClave(db, 'ana', 'clave-nueva-larguisima');
  assert.equal(DB.usuarioDeSesion(db, token), null, 'cambiar la contraseña cierra las sesiones');
  assert.ok(!DB.listaUsuarios(db)[0].hash, 'la lista no muestra los hashes');
  const s2 = DB.crearSesion(db, 'ana');
  const guardado = db.prepare('SELECT token FROM sesiones').all().map((r) => r.token);
  assert.ok(!guardado.includes(s2.token), 'en la base de datos solo está la huella del token');
  assert.equal(DB.usuarioDeSesion(db, s2.token), 'ana');
  assert.equal(DB.usuarioDeSesion(db, guardado[0]), null, 'la huella no sirve para entrar');
  assert.equal(DB.usuarioDeSesion(db, "x' OR 1=1 --"), null);
  DB.cerrarSesion(db, s2.token);
  assert.equal(DB.usuarioDeSesion(db, s2.token), null, 'salir cierra la sesión');
});

test('verificación en dos pasos: códigos TOTP (RFC 6238) y de recuperación', async () => {
  const MFA = await import('../server/mfa.js');
  const s = MFA.base32(Buffer.from('12345678901234567890'));
  assert.equal(MFA.codigo(s, Math.floor(59 / 30)), '287082');
  assert.equal(MFA.codigo(s, Math.floor(1111111109 / 30)), '081804');
  const ahora = 1234567890 * 1000;
  const paso = MFA.comprobar(s, '005924', -1, ahora);
  assert.equal(paso, Math.floor(1234567890 / 30));
  assert.equal(MFA.comprobar(s, '005924', paso, ahora), null, 'el mismo código no vale dos veces');
  assert.equal(MFA.comprobar(s, '000000', -1, ahora), null);
  assert.equal(MFA.comprobar(s, MFA.codigo(s, paso - 1), -1, ahora), paso - 1, 'admite el código anterior (reloj desajustado)');
  assert.equal(MFA.comprobar(s, MFA.codigo(s, paso - 3), -1, ahora), null);
  const { codigos, hashes } = MFA.nuevosCodigosRecuperacion();
  assert.equal(codigos.length, 10);
  const resto = MFA.usarRecuperacion(hashes, codigos[3].toUpperCase());
  assert.equal(resto.length, 9);
  assert.equal(MFA.usarRecuperacion(resto, codigos[3]), null, 'cada código de recuperación sirve una vez');
  assert.match(MFA.uri(s, 'ana'), /^otpauth:\/\/totp\/Presupuestos:ana\?secret=/);
});

test('base de datos: columnas de MFA se añaden a bases antiguas', () => {
  const db = DB.abrir(':memory:');
  DB.crearUsuario(db, 'ana', 'una-clave-larguisima');
  DB.guardarMfa(db, 'ana', { mfa_secreto: 'ABC' });
  assert.equal(DB.datosMfa(db, 'ana').mfa_secreto, 'ABC');
  assert.equal(DB.listaUsuarios(db)[0].mfa, true);
  assert.ok(DB.quitarMfa(db, 'ana'));
  DB.guardarConfig(db, 'mfa_obligatorio', '1');
  assert.equal(DB.leerConfig(db, 'mfa_obligatorio'), '1');
});

test('roles, desactivar y cambiar contraseña sin perder la verificación', () => {
  const db = DB.abrir(':memory:');
  DB.crearUsuario(db, 'jefa', 'clave-de-la-oficina-1', { rol: 'admin' });
  DB.crearUsuario(db, 'pepe', 'clave-provisional-1', { cambiarAlEntrar: true });
  assert.throws(() => DB.crearUsuario(db, 'pepe', 'otra-clave-larga-1'), /Ya existe/);
  assert.throws(() => DB.crearUsuario(db, 'con espacio', 'otra-clave-larga-1'), /no válido/);
  assert.throws(() => DB.crearUsuario(db, 'eva', 'otra-clave-larga-1', { rol: 'superjefe' }), /Rol/);
  const pepe = () => DB.datosUsuario(db, 'pepe');
  assert.equal(pepe().rol, 'usuario');
  assert.equal(pepe().cambiar_clave, true);
  assert.deepEqual(DB.adminsActivos(db), ['jefa']);

  // Cambiar la contraseña conserva la verificación en dos pasos y quita «debe cambiarla».
  DB.guardarMfa(db, 'pepe', { mfa_secreto: 'ABCDEFGH' });
  const { token } = DB.crearSesion(db, 'pepe');
  assert.throws(() => DB.cambiarClave(db, 'pepe', 'clave-provisional-1'), /distinta/);
  DB.cambiarClave(db, 'pepe', 'clave-propia-segura');
  assert.equal(pepe().mfa, true, 'la verificación se mantiene');
  assert.equal(pepe().cambiar_clave, false);
  assert.equal(DB.usuarioDeSesion(db, token), null, 'cambiar la contraseña cierra sus sesiones');
  assert.ok(pepe().ultimo_acceso, 'se apunta el último acceso');

  // Desactivado: no entra y sus sesiones dejan de valer.
  const s2 = DB.crearSesion(db, 'pepe');
  DB.editarUsuario(db, 'pepe', { activo: false });
  assert.equal(DB.comprobarClave(db, 'pepe', 'clave-propia-segura'), false);
  assert.equal(DB.usuarioDeSesion(db, s2.token), null);
  DB.editarUsuario(db, 'pepe', { activo: true, rol: 'admin', nombre: 'Pepe Pérez' });
  assert.equal(DB.comprobarClave(db, 'pepe', 'clave-propia-segura'), true);
  assert.equal(pepe().nombre, 'Pepe Pérez');
  assert.deepEqual(DB.adminsActivos(db).sort(), ['jefa', 'pepe']);
});

test('usuarios de antes de los roles pasan a administradores', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'alb-'));
  const ruta = join(dir, 'antigua.db');
  // Base de datos como las de antes: sin roles ni sesiones con huella.
  const vieja = new DatabaseSync(ruta);
  vieja.exec('CREATE TABLE usuarios (usuario TEXT PRIMARY KEY, hash TEXT NOT NULL, creado TEXT); CREATE TABLE sesiones (token TEXT PRIMARY KEY, usuario TEXT NOT NULL, expira INTEGER NOT NULL);');
  vieja.prepare("INSERT INTO usuarios VALUES ('antiguo', 'x', '2026-01-01')").run();
  vieja.prepare("INSERT INTO sesiones VALUES ('tokenviejo', 'antiguo', ?)").run(Date.now() + 1e9);
  vieja.close();
  const db = DB.abrir(ruta);
  const u = DB.datosUsuario(db, 'antiguo');
  assert.equal(u.rol, 'admin');
  assert.equal(u.activo, true);
  assert.equal(u.sesiones, 0, 'las sesiones antiguas (sin huella) se cierran');
  db.close();
  rmSync(dir, { recursive: true });
});
