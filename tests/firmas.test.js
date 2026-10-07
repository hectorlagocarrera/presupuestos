import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import * as DB from '../server/db.js';
import * as Firmas from '../server/firmas.js';
import * as Correo from '../server/correo.js';

// Servidor SMTP falso (sin cifrar) que guarda lo que recibe.
function smtpFalso() {
  const recibidos = [];
  const srv = net.createServer((s) => {
    let datos = false; let msg = ''; let env = { rcpt: [] };
    s.write('220 falso\r\n');
    s.on('data', (d) => {
      for (const linea of d.toString().split('\r\n')) {
        if (datos) {
          if (linea === '.') { datos = false; recibidos.push({ ...env, msg }); msg = ''; env = { rcpt: [] }; s.write('250 ok\r\n'); } else msg += linea + '\r\n';
          continue;
        }
        if (!linea) continue;
        if (/^EHLO/.test(linea)) s.write('250-falso\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/.test(linea)) { env.auth = Buffer.from(linea.split(' ')[2], 'base64').toString(); s.write('235 ok\r\n'); }
        else if (/^MAIL FROM/.test(linea)) { env.de = linea; s.write('250 ok\r\n'); }
        else if (/^RCPT TO/.test(linea)) { env.rcpt.push(linea); s.write('250 ok\r\n'); }
        else if (linea === 'DATA') { datos = true; s.write('354 adelante\r\n'); }
        else if (linea === 'QUIT') { s.write('221 adiós\r\n'); s.end(); }
        else s.write('250 ok\r\n');
      }
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, puerto: srv.address().port, recibidos })));
}

const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]).toString('base64');

test('correo: SMTP con autenticación, acentos, copia e imagen incrustada', async () => {
  const { srv, puerto, recibidos } = await smtpFalso();
  await Correo.enviar({ host: '127.0.0.1', puerto, seguridad: 'ninguna', usuario: 'info@demo.es', clave: 'secreta' }, {
    de: 'info@demo.es', nombreDe: 'Empresa Demo', para: 'cliente@ejemplo.com', cc: ['oficina@demo.es'], asunto: 'Albarán firmado · número 7',
    texto: 'Hola\n.línea que empieza por punto', html: '<p>Hola</p>', adjuntos: [{ nombre: 'firma.png', tipo: 'image/png', datos: Buffer.from('x'), cid: 'firma' }],
  });
  srv.close();
  assert.equal(recibidos.length, 1);
  const r = recibidos[0];
  assert.equal(r.auth, '\0info@demo.es\0secreta');
  assert.deepEqual(r.rcpt, ['RCPT TO:<cliente@ejemplo.com>', 'RCPT TO:<oficina@demo.es>']);
  assert.match(r.msg, /Subject: =\?UTF-8\?B\?/);
  assert.match(r.msg, /multipart\/related/);
  assert.match(r.msg, /Content-ID: <firma>/);
  await assert.rejects(Correo.enviar({ host: '127.0.0.1', puerto: 1, seguridad: 'ninguna' }, { de: 'no-es-email', para: 'a@b.es' }), /no válida/);
});

test('firmas: firmar bloquea el documento, la huella detecta cambios y se puede anular', () => {
  const db = DB.abrir(':memory:');
  DB.escribir(db, { put: {
    presupuestos: [{ id: 'a1', tipo: 'albaran', numero: '2026-001', fecha: '2026-10-01', clienteNombre: 'Cliente Demo', iva: 21, base: 100, total: 121 }],
    partidas: [{ id: 'l1', presupuestoId: 'a1', orden: 0, articulo: 'Montaje de lona', cantidad: 1, precioUnitario: 100, precioTotal: 100 }],
    ajustes: [{ nombre: 'Empresa Demo', partesImportes: false }],
  } });
  assert.match(Firmas.validarFirma({ nombre: 'Al' }).error, /nombre/);
  assert.match(Firmas.validarFirma({ nombre: 'Ana López', conforme: true }).error, /firma/);
  assert.match(Firmas.validarFirma({ nombre: 'Ana López', imagen: PNG }).error, /conformidad/);
  assert.match(Firmas.validarFirma({ nombre: 'Ana López', rechazo: true }).error, /por qué/);

  // Enlace a distancia: pendiente
  const t = Firmas.crearEnlace(db, 'a1', { creadoPor: 'oficina', email: 'c@demo.es', dias: 7 });
  assert.equal(Firmas.leerDoc(db, 'a1').estadoFirma, 'pendiente');
  assert.ok(Firmas.leerEnlace(db, t));
  assert.equal(Firmas.leerEnlace(db, t + 'x'), null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM enlaces_firma WHERE token = ?').get(t).n, 0, 'solo se guarda la huella del token');
  const sinImportes = Firmas.vistaDoc(db, 'a1', { importes: false });
  assert.equal(sinImportes.doc.total, null);
  assert.equal(sinImportes.doc.lineas[0].precio, undefined);

  // Firma
  const datos = Firmas.validarFirma({ nombre: 'Ana López', dni: '00000000T', conforme: true, imagen: PNG, geo: { lat: 42.1, lon: -8.5, precision: 12 } });
  const f = Firmas.registrarFirma(db, 'a1', datos, { ip: '1.2.3.4', modo: 'enlace', mostrarImportes: true });
  const d = Firmas.leerDoc(db, 'a1');
  assert.equal(d.estadoFirma, 'firmado');
  assert.equal(d.firmaNombre, 'Ana López');
  assert.equal(Firmas.leerEnlace(db, t).usado, 1, 'el enlace ya no sirve para firmar');
  assert.equal(Firmas.modificadoTrasFirma(db, 'a1'), false);
  assert.ok(Firmas.imagenFirma(db, f.id));

  // Firmado: no se puede cambiar ni borrar (ni falsificar el estado desde el navegador)
  const todos = DB.PERMISOS;
  assert.match(DB.comprobarEscritura(db, todos, { put: { presupuestos: [{ ...d, total: 999 }] } }).error, /firmado/);
  assert.match(DB.comprobarEscritura(db, todos, { put: { partidas: [{ id: 'l1', presupuestoId: 'a1', precioUnitario: 1 }] } }).error, /firmado/);
  assert.match(DB.comprobarEscritura(db, todos, { del: { presupuestos: ['a1'] } }).error, /firmado/);
  const soloPaginas = DB.comprobarEscritura(db, todos, { put: { presupuestos: [{ ...d, paginas: '3' }] } });
  assert.ok(!soloPaginas.error, 'cambiar solo las páginas del original sí se puede');
  const nuevo = DB.comprobarEscritura(db, todos, { put: { presupuestos: [{ id: 'n1', tipo: 'albaran', origen: 'app', estadoFirma: 'firmado', firmaNombre: 'Falso' }] } });
  assert.equal(nuevo.ops.put.presupuestos[0].estadoFirma, null, 'el estado de firma lo pone solo el servidor');

  // Cambio por detrás de la aplicación: la huella lo detecta
  db.prepare('UPDATE partidas SET precioTotal = 50 WHERE id = ?').run('l1');
  assert.equal(Firmas.modificadoTrasFirma(db, 'a1'), true);

  // Anular
  assert.ok(Firmas.anularFirma(db, 'a1', { usuario: 'jefa', motivo: 'Error en la cantidad' }));
  assert.equal(Firmas.leerDoc(db, 'a1').estadoFirma, null);
  const h = Firmas.historialFirmas(db, 'a1');
  assert.equal(h.length, 1);
  assert.equal(h[0].anulada, true, 'la firma anulada queda en el historial');

  // Operario: solo albaranes y sin importes si así está configurado
  DB.escribir(db, { put: { presupuestos: [{ id: 'p1', tipo: 'presupuesto', numero: '5' }] } });
  const op = DB.leerTodo(db, { operario: true });
  assert.deepEqual(op.presupuestos.map((x) => x.id), ['a1']);
  assert.equal(op.partidas[0].precioUnitario, null);
  assert.deepEqual(Object.keys(op.ajustes).sort(), ['nombre', 'partesImportes']);
  assert.deepEqual(DB.permisosDe({ rol: 'operario', permisos: null }), ['firmas']);
});

test('emails de firma: solicitud con enlace y copia con la firma', () => {
  const db = DB.abrir(':memory:');
  DB.escribir(db, { put: { presupuestos: [{ id: 'a1', tipo: 'albaran', numero: '7', fecha: '2026-10-01', clienteNombre: 'Cliente <Demo>' }], ajustes: [{ nombre: 'Empresa Demo' }] } });
  const v = Firmas.vistaDoc(db, 'a1');
  const s = Firmas.emailSolicitud(v, 'https://demo.es/firmar.html?t=abc', 7);
  assert.match(s.asunto, /albarán 7/);
  assert.match(s.html, /firmar\.html\?t=abc/);
  assert.ok(!s.html.includes('<Demo>'), 'los datos se escapan');
  const c = Firmas.emailCopia(v, { estado: 'firmado', nombre: 'Ana', fecha: new Date().toISOString(), huella: 'abc123' }, Buffer.from('png'), 'https://demo.es/firmar.html?t=ver');
  assert.match(c.asunto, /Copia firmada/);
  assert.ok(c.adjuntos.some((a) => a.cid === 'firma'));
});

test('PDF del documento: válido, con acentos, varias páginas y la firma', async () => {
  const { crearPdf, tamJpeg } = await import('../js/pdfdoc.js');
  // JPEG mínimo de 1×1 (solo cabecera SOF para comprobar que se incrusta).
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
  assert.deepEqual(tamJpeg(jpeg), { alto: 1, ancho: 1, componentes: 3 });
  const lineas = Array.from({ length: 40 }, (_, i) => ({ articulo: `Lona número ${i + 1} (ñ, €)`, cantidad: 1, precio: 10, importe: 10 }));
  const pdf = crearPdf({ empresa: { nombre: 'Empresa Demo' }, doc: { tipo: 'albaran', numero: '7', fecha: '2026-10-01', cliente: 'Cliente (Demo)', lineas, base: 400, total: 484, iva: 21 },
    firma: { estado: 'firmado', nombre: 'Ana', fecha: new Date().toISOString(), huella: 'abc' }, imagenes: { firma: jpeg } });
  const txt = Buffer.from(pdf).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.match(txt, /\/Count 2/, 'cuarenta líneas ocupan dos páginas');
  assert.ok(txt.includes('(N\xfamero: 7)'), 'acentos en WinAnsi');
  assert.ok(txt.includes('Cliente \\(Demo\\)'), 'paréntesis escapados');
  assert.ok(txt.includes('\x80'), 'el euro en WinAnsi');
  assert.match(txt, /\/Filter \/DCTDecode/);
  // La tabla xref apunta al principio de cada objeto.
  const xref = Number(txt.match(/startxref\n(\d+)/)[1]);
  const offs = txt.slice(xref).match(/(\d{10}) 00000 n/g).map((x) => Number(x.slice(0, 10)));
  offs.forEach((o, i) => assert.ok(txt.startsWith(`${i + 1} 0 obj`, o), `objeto ${i + 1}`));
});
