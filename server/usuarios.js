// Gestión de usuarios de la aplicación.
//   node server/usuarios.js nuevo <usuario>      crea o cambia la contraseña (la pide por teclado)
//   node server/usuarios.js borrar <usuario>
//   node server/usuarios.js lista
// Usa la misma base de datos que el servidor (variable PRESUPUESTOS_DB).
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as DB from './db.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = DB.abrir(process.env.PRESUPUESTOS_DB || join(RAIZ, 'datos', 'datos.db'));
const [orden, usuario] = process.argv.slice(2);

// Lee una contraseña sin mostrarla en pantalla (o de la entrada estándar si no es un terminal).
function leerClave(texto) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let d = '';
      stdin.on('data', (c) => { d += c; });
      stdin.on('end', () => resolve(d.split('\n')[0]));
      return;
    }
    process.stdout.write(texto);
    let clave = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(clave);
      } else if (ch === '\u0003') process.exit(1);
      else if (ch === '\u007f' || ch === '\b') clave = clave.slice(0, -1);
      else clave += ch;
    };
    stdin.on('data', onData);
  });
}

try {
  if (orden === 'nuevo' && usuario) {
    const c1 = await leerClave(`Contraseña para ${usuario}: `);
    if (process.stdin.isTTY) {
      const c2 = await leerClave('Repite la contraseña: ');
      if (c1 !== c2) throw new Error('Las contraseñas no coinciden.');
    }
    DB.crearUsuario(db, usuario, c1);
    console.log(`Usuario «${usuario}» guardado.`);
  } else if (orden === 'borrar' && usuario) {
    console.log(DB.borrarUsuario(db, usuario) ? `Usuario «${usuario}» borrado.` : 'Ese usuario no existe.');
  } else if (orden === 'lista') {
    const us = DB.listaUsuarios(db);
    console.log(us.length ? us.map((u) => `${u.usuario}  (desde ${String(u.creado).slice(0, 10)})`).join('\n') : 'No hay usuarios.');
  } else {
    console.log('Uso:\n  node server/usuarios.js nuevo <usuario>\n  node server/usuarios.js borrar <usuario>\n  node server/usuarios.js lista');
  }
} catch (err) {
  console.error('Error: ' + err.message);
  process.exitCode = 1;
}
db.close();
