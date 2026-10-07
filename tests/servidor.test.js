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
  DB.crearUsuario(db, 'ana', 'clave-nueva-larguisima');
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
  assert.equal(DB.listaUsuarios(db)[0].mfa, 1);
  assert.ok(DB.quitarMfa(db, 'ana'));
  DB.guardarConfig(db, 'mfa_obligatorio', '1');
  assert.equal(DB.leerConfig(db, 'mfa_obligatorio'), '1');
});
