// Envío de emails por SMTP (sin dependencias): TLS directo (puerto 465) o STARTTLS (587), con usuario y contraseña.
// Mensajes en HTML + texto, con imágenes incrustadas (la firma) y adjuntos.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

const b64 = (s) => Buffer.from(s).toString('base64');
const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`); // cabeceras con acentos
const partir = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const direccion = (d) => String(d || '').trim();
export const emailValido = (e) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(direccion(e));

// Construye el mensaje MIME. adjuntos: [{ nombre, tipo, datos: Buffer, cid? }] (con cid: imagen incrustada en el HTML).
export function construir({ de, nombreDe, para, cc = [], asunto, texto, html, adjuntos = [], responderA }) {
  const limite = () => '=_' + randomBytes(12).toString('hex');
  const parte = (tipo, cuerpo) => `Content-Type: ${tipo}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${partir(b64(cuerpo))}\r\n`;
  const alt = limite();
  let cuerpo = `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n`
    + `--${alt}\r\n${parte('text/plain', texto || '')}--${alt}\r\n${parte('text/html', html || '')}--${alt}--\r\n`;
  const incrustadas = adjuntos.filter((a) => a.cid);
  const ficheros = adjuntos.filter((a) => !a.cid);
  const bloque = (a, inline) => `Content-Type: ${a.tipo}; name="${enc(a.nombre)}"\r\nContent-Transfer-Encoding: base64\r\n`
    + `Content-Disposition: ${inline ? 'inline' : 'attachment'}; filename="${enc(a.nombre)}"\r\n${inline ? `Content-ID: <${a.cid}>\r\n` : ''}\r\n${partir(a.datos.toString('base64'))}\r\n`;
  if (incrustadas.length) {
    const rel = limite();
    cuerpo = `Content-Type: multipart/related; boundary="${rel}"\r\n\r\n--${rel}\r\n${cuerpo}`
      + incrustadas.map((a) => `--${rel}\r\n${bloque(a, true)}`).join('') + `--${rel}--\r\n`;
  }
  if (ficheros.length) {
    const mix = limite();
    cuerpo = `Content-Type: multipart/mixed; boundary="${mix}"\r\n\r\n--${mix}\r\n${cuerpo}`
      + ficheros.map((a) => `--${mix}\r\n${bloque(a, false)}`).join('') + `--${mix}--\r\n`;
  }
  const dominio = direccion(de).split('@')[1] || 'localhost';
  const cabeceras = [
    `From: ${nombreDe ? `${enc(nombreDe)} ` : ''}<${direccion(de)}>`,
    `To: ${[].concat(para).map(direccion).join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.map(direccion).join(', ')}`] : []),
    ...(responderA ? [`Reply-To: <${direccion(responderA)}>`] : []),
    `Subject: ${enc(asunto || '')}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${dominio}>`,
    'MIME-Version: 1.0',
  ];
  return cabeceras.join('\r\n') + '\r\n' + cuerpo;
}

// Conversación SMTP. config: { host, puerto, usuario, clave, seguridad: 'ssl' | 'starttls' | 'ninguna' }.
export async function enviar(config, mensaje) {
  const { host, usuario, clave } = config;
  const puerto = Number(config.puerto) || 465;
  const seguridad = config.seguridad || (puerto === 465 ? 'ssl' : 'starttls');
  const de = direccion(mensaje.de);
  const destinos = [...[].concat(mensaje.para), ...(mensaje.cc || []), ...(mensaje.cco || [])].map(direccion).filter(Boolean);
  if (!host || !de || !destinos.length) throw new Error('Falta el servidor de correo, el remitente o el destinatario.');
  for (const d of [de, ...destinos]) if (!emailValido(d)) throw new Error(`Dirección de email no válida: ${d}`);
  const datos = construir(mensaje);

  let socket = await new Promise((resolve, reject) => {
    const s = seguridad === 'ssl'
      ? tls.connect({ host, port: puerto, servername: host }, () => resolve(s))
      : net.connect({ host, port: puerto }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20000, () => s.destroy(new Error('El servidor de correo no responde')));
  });
  let bufer = '';
  let esperando = null;
  const alLeer = (d) => {
    bufer += d.toString('utf8');
    // Respuesta completa: última línea «250 texto» (sin guion tras el código).
    const lineas = bufer.split('\r\n');
    const fin = lineas.findIndex((l) => /^\d{3} /.test(l));
    if (fin >= 0 && esperando) {
      const resp = lineas.slice(0, fin + 1).join('\n');
      bufer = lineas.slice(fin + 1).join('\r\n');
      const r = esperando; esperando = null; r.resolve(resp);
    }
  };
  const escuchar = (s) => { s.on('data', alLeer); s.on('error', (e) => esperando?.reject(e)); };
  escuchar(socket);
  const respuesta = () => new Promise((resolve, reject) => { esperando = { resolve, reject }; if (bufer) alLeer(''); });
  const orden = async (linea, codigos) => {
    if (linea != null) socket.write(linea + '\r\n');
    const r = await respuesta();
    if (!codigos.includes(r.slice(0, 3))) {
      const visible = linea && /^(AUTH|[A-Za-z0-9+/=]{8,}$)/.test(linea) ? '(autenticación)' : linea;
      throw new Error(`El servidor de correo rechazó ${visible || 'la conexión'}: ${r.split('\n').pop()}`);
    }
    return r;
  };
  try {
    await orden(null, ['220']);
    const yo = hostname() || 'localhost';
    let ehlo = await orden(`EHLO ${yo}`, ['250']);
    if (seguridad === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) throw new Error('El servidor de correo no admite conexión segura (STARTTLS).');
      await orden('STARTTLS', ['220']);
      socket.removeAllListeners('data');
      socket = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket, servername: host }, () => resolve(s));
        s.once('error', reject);
      });
      escuchar(socket);
      ehlo = await orden(`EHLO ${yo}`, ['250']);
    }
    if (usuario) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo)) await orden(`AUTH PLAIN ${b64(`\0${usuario}\0${clave || ''}`)}`, ['235']);
      else {
        await orden('AUTH LOGIN', ['334']);
        await orden(b64(usuario), ['334']);
        await orden(b64(clave || ''), ['235']);
      }
    }
    await orden(`MAIL FROM:<${de}>`, ['250']);
    for (const d of destinos) await orden(`RCPT TO:<${d}>`, ['250', '251']);
    await orden('DATA', ['354']);
    // Las líneas que empiezan por punto se duplican (transparencia SMTP).
    await orden(datos.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.', ['250']);
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
  return { ok: true, destinatarios: destinos.length };
}
