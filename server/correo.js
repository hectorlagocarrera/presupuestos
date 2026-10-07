// Envío de emails por SMTP (sin dependencias): TLS directo (puerto 465) o STARTTLS (587), con usuario y contraseña.
// Mensajes en HTML + texto, con imágenes incrustadas (la firma) y adjuntos.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { lookup } from 'node:dns/promises';

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
  const { host, usuario } = config;
  // Gmail da las contraseñas de aplicación con espacios («abcd efgh ijkl mnop»): se quitan.
  const clave = /gmail\.com|googlemail\.com/i.test(host || '') ? String(config.clave || '').replace(/\s+/g, '') : config.clave;
  const puerto = Number(config.puerto) || 465;
  const seguridad = config.seguridad || (puerto === 465 ? 'ssl' : 'starttls');
  const de = direccion(mensaje.de);
  const destinos = [...[].concat(mensaje.para), ...(mensaje.cc || []), ...(mensaje.cco || [])].map(direccion).filter(Boolean);
  if (!host || !de || !destinos.length) throw new Error('Falta el servidor de correo, el remitente o el destinatario.');
  for (const d of [de, ...destinos]) if (!emailValido(d)) throw new Error(`Dirección de email no válida: ${d}`);
  const datos = construir(mensaje);

  // Por IPv4 si el servidor la tiene: en los relés autorizados por IP (Google, Microsoft) se suele autorizar la
  // IPv4 del VPS, y si la conexión sale por IPv6 la rechazan. Con ipv6: true se usa lo que diga el sistema.
  let destino = host;
  if (!config.ipv6) { try { destino = (await lookup(host, { family: 4 })).address; } catch { destino = host; } }
  let socket = await new Promise((resolve, reject) => {
    const s = seguridad === 'ssl'
      ? tls.connect({ host: destino, port: puerto, servername: host }, () => resolve(s))
      : net.connect({ host: destino, port: puerto }, () => resolve(s));
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
      let ayuda = '';
      const relay = /smtp-relay\.gmail\.com/i.test(host);
      if (relay && /^53[45]/.test(r)) {
        ayuda = ' → Google no acepta ese usuario y contraseña. Con el relé SMTP lo más sencillo es dejar usuario y contraseña VACÍOS y autorizar la IP del VPS '
          + '(consola de Google Workspace → Aplicaciones → Google Workspace → Gmail → Enrutamiento → Servicio de relé SMTP → «Solo aceptar correo de las direcciones IP especificadas»). '
          + 'Si prefieres usuario y contraseña: el usuario es la dirección completa de Workspace y, con verificación en dos pasos, la contraseña es una «contraseña de aplicación».';
      } else if (relay && /^(421|550|553|554)/.test(r)) {
        ayuda = ' → Relé SMTP de Google: en la consola de administración de Google Workspace (Aplicaciones → Google Workspace → Gmail → Enrutamiento → Servicio de relé SMTP) '
          + 'añade la IP indicada arriba (la pública del VPS) en «Solo aceptar correo de las direcciones IP especificadas» (o marca «Requerir autenticación SMTP» y pon aquí usuario y contraseña de aplicación). Google puede tardar hasta una hora en aplicarlo. '
          + 'Además, '
          + 'elige «Solo direcciones de mis dominios» y comprueba que el remitente es un buzón o alias de tu dominio.';
      } else if (/^53[45]/.test(r)) {
        ayuda = /gmail|google/i.test(`${host} ${usuario}`)
          ? ' → Gmail no acepta la contraseña normal de la cuenta: crea una «contraseña de aplicación» en myaccount.google.com/apppasswords (hace falta tener activada la verificación en dos pasos) y ponla aquí.'
          : ' → Usuario o contraseña del buzón incorrectos (con Microsoft 365/Outlook puede que haya que activar «SMTP autenticado» o usar una contraseña de aplicación).';
      }
      const desde = socket.localAddress ? ` (conectado desde la IP ${String(socket.localAddress).replace(/^::ffff:/, '')})` : '';
      throw new Error(`El servidor de correo rechazó ${visible || 'la conexión'}${desde}: ${r.split('\n').pop()}${ayuda}`);
    }
    return r;
  };
  try {
    await orden(null, ['220']);
    // Nombre con el que se presenta (EHLO): tiene que ser un dominio completo. El relé SMTP de Google rechaza
    // nombres como «vps-1234» o «localhost»; si el del servidor no lo es, se usa el dominio del remitente.
    const propio = hostname() || '';
    const yo = config.ehlo || (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(propio) && !/\.(local|lan|internal)$/i.test(propio) ? propio : (de.split('@')[1] || 'localhost'));
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
