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
  assert.throws(() => DB.crearUsuario(db, 'ana', 'corta'), /8 caracteres/);
  DB.crearUsuario(db, 'ana', 'una-clave-larga');
  assert.equal(DB.comprobarClave(db, 'ana', 'una-clave-larga'), true);
  assert.equal(DB.comprobarClave(db, 'ana', 'otra'), false);
  assert.equal(DB.comprobarClave(db, 'nadie', 'una-clave-larga'), false);
  const { token } = DB.crearSesion(db, 'ana');
  assert.equal(DB.usuarioDeSesion(db, token), 'ana');
  DB.crearUsuario(db, 'ana', 'clave-nueva-larga');
  assert.equal(DB.usuarioDeSesion(db, token), null, 'cambiar la contraseña cierra las sesiones');
  assert.ok(!DB.listaUsuarios(db)[0].hash, 'la lista no muestra los hashes');
});
