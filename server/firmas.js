// Firmas de partes de trabajo (albaranes) y aceptación de presupuestos: en persona o con un enlace a distancia.
// Cada firma guarda quién firmó, cuándo (hora del servidor), desde dónde, quién la recogió y una huella del
// contenido del documento en ese momento: si después se cambia, se nota.
import { randomBytes, createHash } from 'node:crypto';
import { emailValido } from './correo.js';
import { crearPdf } from '../js/pdfdoc.js';

const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const nuevoId = () => randomBytes(12).toString('hex');
export const TIPOS_FIRMABLES = ['albaran', 'presupuesto'];
export const NOMBRE_TIPO = { albaran: 'albarán', presupuesto: 'presupuesto', factura: 'factura' };

export const leerDoc = (db, id) => db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(String(id));
const partidasDe = (db, id) => db.prepare('SELECT * FROM partidas WHERE presupuestoId = ? ORDER BY orden').all(String(id));
const ajustes = (db) => JSON.parse(db.prepare("SELECT valor FROM ajustes WHERE id = 'ajustes'").get()?.valor || '{}');

// Contenido que se firma (lo que el cliente ve) y su huella SHA-256.
export function contenidoDoc(db, id) {
  const p = leerDoc(db, id);
  if (!p) return null;
  const contenido = {
    tipo: p.tipo || 'presupuesto', numero: p.numero || '', fecha: p.fecha || '', cliente: p.clienteNombre || '',
    iva: p.iva, base: p.base, total: p.total,
    lineas: partidasDe(db, id).map((l) => ({ articulo: l.articulo || '', descripcion: l.descripcion || '', cantidad: l.cantidad, precio: l.precioUnitario, importe: l.precioTotal })),
  };
  const json = JSON.stringify(contenido);
  return { contenido, json, huella: sha256(json) };
}

// Datos para enseñar el documento al cliente (página de firma y email), con o sin importes.
export function vistaDoc(db, id, { importes = true } = {}) {
  const c = contenidoDoc(db, id);
  if (!c) return null;
  const p = leerDoc(db, id);
  const cli = p.clienteId ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(p.clienteId) : null;
  const aj = ajustes(db);
  const doc = { ...c.contenido, notas: p.notas || '', clienteEmail: cli?.email || '', clienteCif: cli?.cif || '', clienteDireccion: cli?.direccion || '' };
  if (!importes) {
    doc.base = null; doc.total = null;
    doc.lineas = doc.lineas.map(({ precio, importe, ...l }) => l);
  }
  return {
    empresa: { nombre: aj.nombre || '', cif: aj.cif || '', direccion: aj.direccion || '', contacto: aj.contacto || '', logo: /^data:image\/(png|jpeg);base64,/.test(aj.logo || '') ? aj.logo : '' },
    doc, importes, estado: p.estadoFirma || '', firma: p.firmaId ? resumenFirma(db, p.firmaId) : null,
  };
}

export function resumenFirma(db, firmaId) {
  const f = db.prepare('SELECT id, estado, nombre, dni, email, observaciones, motivo, fecha, modo, recogidaPor, geo, huella, anulada, copia, mostrarImportes FROM firmas WHERE id = ?').get(String(firmaId));
  return f ? { ...f, anulada: !!f.anulada, mostrarImportes: !!f.mostrarImportes } : null;
}

export const historialFirmas = (db, presupuestoId) => db.prepare(
  'SELECT id, estado, nombre, dni, email, observaciones, motivo, fecha, modo, recogidaPor, geo, huella, anulada, anuladaPor, anuladaFecha, anuladaMotivo, copia FROM firmas WHERE presupuestoId = ? ORDER BY fecha DESC',
).all(String(presupuestoId)).map((f) => ({ ...f, anulada: !!f.anulada }));

export const imagenFirma = (db, firmaId) => db.prepare('SELECT imagen FROM firmas WHERE id = ?').get(String(firmaId))?.imagen || null;

// ¿Ha cambiado el documento desde que se firmó?
export function modificadoTrasFirma(db, presupuestoId) {
  const p = leerDoc(db, presupuestoId);
  if (!p?.firmaId) return false;
  const f = db.prepare('SELECT huella FROM firmas WHERE id = ?').get(p.firmaId);
  return !!f && f.huella !== contenidoDoc(db, presupuestoId)?.huella;
}

// Comprueba lo que llega del formulario de firma. Devuelve { error } o los datos limpios.
export function validarFirma(d) {
  const nombre = String(d.nombre || '').trim().slice(0, 120);
  const rechazo = !!d.rechazo;
  if (nombre.length < 3) return { error: 'Escribe el nombre y apellidos de quien firma.' };
  const email = String(d.email || '').trim().slice(0, 200);
  if (email && !emailValido(email)) return { error: 'El email no es válido.' };
  let imagen = null;
  if (!rechazo || d.imagen) {
    const m = String(d.imagen || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { error: 'Falta la firma.' };
    imagen = Buffer.from(m[1], 'base64');
    if (imagen.length < 300 || imagen.length > 600000 || imagen.readUInt32BE(0) !== 0x89504e47) return { error: 'La firma no es válida.' };
  }
  if (!rechazo && !d.conforme) return { error: 'Marca la casilla de conformidad para firmar.' };
  const motivo = String(d.motivo || '').trim().slice(0, 1000);
  if (rechazo && motivo.length < 3) return { error: 'Explica brevemente por qué no estás conforme.' };
  let imagenJpeg = null;
  const mj = String(d.imagenJpeg || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (mj && imagen) {
    imagenJpeg = Buffer.from(mj[1], 'base64');
    if (imagenJpeg.length > 500000 || imagenJpeg[0] !== 0xff || imagenJpeg[1] !== 0xd8) imagenJpeg = null;
  }
  let geo = null;
  if (d.geo && Number.isFinite(+d.geo.lat) && Number.isFinite(+d.geo.lon)) geo = JSON.stringify({ lat: +(+d.geo.lat).toFixed(6), lon: +(+d.geo.lon).toFixed(6), precision: Math.round(+d.geo.precision || 0) });
  return {
    estado: rechazo ? 'rechazado' : 'firmado', nombre, email, imagen, imagenJpeg, motivo, geo,
    dni: String(d.dni || '').trim().slice(0, 30), observaciones: String(d.observaciones || '').trim().slice(0, 1000),
  };
}

// Guarda la firma (o la negativa a firmar) y marca el documento. Cierra los enlaces pendientes.
export function registrarFirma(db, presupuestoId, datos, { ip, agente, modo, recogidaPor, mostrarImportes }) {
  const c = contenidoDoc(db, presupuestoId);
  const id = nuevoId();
  const fecha = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO firmas (id, presupuestoId, estado, nombre, dni, email, observaciones, motivo, imagen, imagenJpeg, fecha, ip, agente, modo, recogidaPor, geo, huella, contenido, mostrarImportes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, String(presupuestoId), datos.estado, datos.nombre, datos.dni, datos.email,
      datos.observaciones, datos.motivo, datos.imagen, datos.imagenJpeg || null, fecha, String(ip || '').slice(0, 64), String(agente || '').slice(0, 300), modo, recogidaPor || null,
      datos.geo, c.huella, c.json, mostrarImportes ? 1 : 0);
    db.prepare('UPDATE presupuestos SET estadoFirma = ?, firmaId = ?, firmaFecha = ?, firmaNombre = ? WHERE id = ?').run(datos.estado, id, fecha, datos.nombre, String(presupuestoId));
    db.prepare('UPDATE enlaces_firma SET usado = 1, firmaId = ? WHERE presupuestoId = ? AND usado = 0 AND solover = 0').run(id, String(presupuestoId));
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { id, fecha };
}

// Enlace para firmar a distancia (o, con solover, para ver la copia firmada). Devuelve el token (solo se guarda su huella).
export function crearEnlace(db, presupuestoId, { creadoPor, email, dias = 7, mostrarImportes = true, solover = false }) {
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO enlaces_firma (token, presupuestoId, creado, creadoPor, email, expira, mostrarImportes, solover, firmaId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), String(presupuestoId), new Date().toISOString(), creadoPor || null, email || null, Date.now() + dias * 86400000, mostrarImportes ? 1 : 0, solover ? 1 : 0,
      solover ? leerDoc(db, presupuestoId)?.firmaId || null : null);
  if (!solover) {
    const p = leerDoc(db, presupuestoId);
    if (p && p.estadoFirma !== 'firmado') db.prepare("UPDATE presupuestos SET estadoFirma = 'pendiente' WHERE id = ?").run(String(presupuestoId));
  }
  return token;
}

export function leerEnlace(db, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
  const e = db.prepare('SELECT * FROM enlaces_firma WHERE token = ?').get(sha256(String(token)));
  return e && e.expira > Date.now() ? e : null;
}

export function anularFirma(db, presupuestoId, { usuario, motivo }) {
  const p = leerDoc(db, presupuestoId);
  if (!p?.firmaId) return false;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE firmas SET anulada = 1, anuladaPor = ?, anuladaFecha = ?, anuladaMotivo = ? WHERE id = ?').run(usuario, new Date().toISOString(), String(motivo || '').slice(0, 500), p.firmaId);
    db.prepare('UPDATE presupuestos SET estadoFirma = NULL, firmaId = NULL, firmaFecha = NULL, firmaNombre = NULL WHERE id = ?').run(String(presupuestoId));
    db.prepare('UPDATE enlaces_firma SET usado = 1 WHERE presupuestoId = ? AND usado = 0').run(String(presupuestoId));
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return true;
}

// Quita «pendiente de firma» (se cancela el envío) sin tocar firmas.
export function cancelarPendiente(db, presupuestoId) {
  db.prepare('UPDATE enlaces_firma SET usado = 1 WHERE presupuestoId = ? AND usado = 0 AND solover = 0').run(String(presupuestoId));
  db.prepare("UPDATE presupuestos SET estadoFirma = NULL WHERE id = ? AND estadoFirma = 'pendiente'").run(String(presupuestoId));
}

export function enlacePendiente(db, presupuestoId) {
  return db.prepare('SELECT creado, creadoPor, email, expira FROM enlaces_firma WHERE presupuestoId = ? AND usado = 0 AND solover = 0 AND expira > ? ORDER BY creado DESC LIMIT 1')
    .get(String(presupuestoId), Date.now()) || null;
}

// ---------- Emails ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => (n == null ? '' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n));
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long', timeStyle: 'short' }) : '');
const fechaCorta = (f) => (f ? f.split('-').reverse().join('/') : '');
const datosLogo = (logo) => { const m = String(logo || '').match(/^data:(image\/(?:png|jpeg));base64,(.+)$/); return m ? { tipo: m[1], datos: Buffer.from(m[2], 'base64') } : null; };

function tablaHtml(v) {
  const imp = v.importes;
  return `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
    <tr style="background:#f1f4f9;text-align:left"><th>Concepto</th><th style="text-align:right">Cant.</th>${imp ? '<th style="text-align:right">Precio</th><th style="text-align:right">Importe</th>' : ''}</tr>
    ${v.doc.lineas.map((l) => `<tr style="border-top:1px solid #e3e7ee"><td><strong>${esc(l.articulo)}</strong>${l.descripcion ? `<br><span style="color:#5b6472">${esc(l.descripcion)}</span>` : ''}</td>
      <td style="text-align:right">${esc(l.cantidad ?? '')}</td>${imp ? `<td style="text-align:right">${eur(l.precio)}</td><td style="text-align:right">${eur(l.importe)}</td>` : ''}</tr>`).join('')}
    ${imp && v.doc.base != null ? `<tr style="border-top:2px solid #c9d1de"><td colspan="3" style="text-align:right">Base imponible</td><td style="text-align:right">${eur(v.doc.base)}</td></tr>
      <tr><td colspan="3" style="text-align:right"><strong>Total (IVA ${esc(v.doc.iva ?? '')} % incl.)</strong></td><td style="text-align:right"><strong>${eur(v.doc.total)}</strong></td></tr>` : ''}
  </table>`;
}

function marco(v, cuerpo) {
  const e = v.empresa;
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d2330">
  <div style="max-width:640px;margin:0 auto;padding:20px">
    <div style="background:#fff;border-radius:10px;padding:22px;border:1px solid #e3e7ee">
      ${e.logo ? '<img src="cid:logo" alt="" style="max-height:60px;max-width:220px;display:block;margin-bottom:10px">' : ''}
      ${cuerpo}
    </div>
    <p style="font-size:12px;color:#6b7280;margin:14px 4px">${esc([e.nombre, e.cif && 'NIF ' + e.cif, e.direccion, e.contacto].filter(Boolean).join(' · '))}</p>
  </div></body></html>`;
}

const adjLogo = (v) => { const l = datosLogo(v.empresa.logo); return l ? [{ nombre: 'logo', tipo: l.tipo, datos: l.datos, cid: 'logo' }] : []; };

// Email al cliente con el enlace para firmar.
export function emailSolicitud(v, url, dias) {
  const t = NOMBRE_TIPO[v.doc.tipo] || 'documento';
  const accion = v.doc.tipo === 'presupuesto' ? 'revisar y aceptar' : 'revisar y firmar';
  const asunto = `${v.empresa.nombre || 'Le enviamos'}: ${t} ${v.doc.numero} para firmar`;
  const html = marco(v, `<h2 style="margin:0 0 10px">${esc(t[0].toUpperCase() + t.slice(1))} ${esc(v.doc.numero)} · ${esc(fechaCorta(v.doc.fecha))}</h2>
    <p>Hola${v.doc.cliente ? ' ' + esc(v.doc.cliente) : ''}:</p>
    <p>Le enviamos el ${esc(t)} para que pueda ${accion}lo desde el móvil o el ordenador.</p>
    <p style="margin:22px 0"><a href="${esc(url)}" style="background:#ea7a10;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${accion[0].toUpperCase() + accion.slice(1)}</a></p>
    ${tablaHtml(v)}
    <p style="font-size:12px;color:#6b7280;margin-top:18px">El enlace es personal y caduca en ${dias} días. Si no esperaba este mensaje, puede ignorarlo.</p>`);
  const texto = `${t} ${v.doc.numero} (${fechaCorta(v.doc.fecha)})\n\nPara ${accion}lo, abra este enlace (caduca en ${dias} días):\n${url}\n\n${v.empresa.nombre || ''}`;
  return { asunto, html, texto, adjuntos: adjLogo(v) };
}

// PDF del documento firmado (para adjuntarlo a la copia). firma: fila de la tabla firmas.
export function pdfFirmado(db, v, firma) {
  const aj = ajustes(db);
  const logo = String(aj.logoJpeg || '').match(/^data:image\/jpeg;base64,(.+)$/);
  const bytes = crearPdf({
    empresa: v.empresa, doc: { ...v.doc, lineas: v.doc.lineas.map((l) => ({ ...l })) }, importes: v.importes,
    firma: { estado: firma.estado, nombre: firma.nombre, dni: firma.dni, fecha: firma.fecha, modo: firma.modo, recogidaPor: firma.recogidaPor, huella: firma.huella, observaciones: firma.observaciones, motivo: firma.motivo },
    imagenes: { ...(logo ? { logo: new Uint8Array(Buffer.from(logo[1], 'base64')) } : {}), ...(firma.imagenJpeg ? { firma: new Uint8Array(firma.imagenJpeg) } : {}) },
  });
  return Buffer.from(bytes);
}
export const nombrePdf = (v, firmado = true) => `${(NOMBRE_TIPO[v.doc.tipo] || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}-${String(v.doc.numero || '').replace(/[^\w.-]+/g, '_')}${firmado ? '-firmado' : ''}.pdf`;

// Copia firmada para el cliente (y la oficina).
export function emailCopia(v, firma, imagen, urlVer, pdf) {
  const t = NOMBRE_TIPO[v.doc.tipo] || 'documento';
  const firmado = firma.estado === 'firmado';
  const asunto = `${firmado ? 'Copia firmada' : 'No conforme'}: ${t} ${v.doc.numero}${v.empresa.nombre ? ' · ' + v.empresa.nombre : ''}`;
  const html = marco(v, `<h2 style="margin:0 0 10px">${esc(t[0].toUpperCase() + t.slice(1))} ${esc(v.doc.numero)} · ${esc(fechaCorta(v.doc.fecha))}</h2>
    <p><strong>Cliente:</strong> ${esc(v.doc.cliente)}</p>
    ${tablaHtml(v)}
    ${v.doc.notas ? `<p style="color:#5b6472">${esc(v.doc.notas)}</p>` : ''}
    <div style="margin-top:18px;padding:14px;border:1px solid ${firmado ? '#b7e0c2' : '#f2c2c2'};background:${firmado ? '#f1fbf4' : '#fdf3f3'};border-radius:8px">
      <p style="margin:0 0 6px"><strong>${firmado ? 'Firmado' : 'No conforme'}</strong> por ${esc(firma.nombre)}${firma.dni ? ` (DNI ${esc(firma.dni)})` : ''} el ${esc(fecha(firma.fecha))}.</p>
      ${firma.observaciones ? `<p style="margin:0 0 6px">Observaciones: ${esc(firma.observaciones)}</p>` : ''}
      ${firma.motivo ? `<p style="margin:0 0 6px">Motivo: ${esc(firma.motivo)}</p>` : ''}
      ${imagen ? '<img src="cid:firma" alt="Firma" style="max-width:300px;background:#fff;border:1px solid #e3e7ee;border-radius:6px;display:block">' : ''}
      <p style="font-size:11px;color:#6b7280;margin:8px 0 0">Huella del documento firmado (SHA-256): ${esc(firma.huella)}</p>
    </div>
    <p style="margin-top:16px">${pdf ? 'Le adjuntamos el documento firmado en PDF.' : ''}${urlVer ? ` También puede <a href="${esc(urlVer)}">verlo y descargarlo aquí</a> durante 90 días.` : ''}</p>`);
  const texto = `${t} ${v.doc.numero} (${fechaCorta(v.doc.fecha)})\n${firmado ? 'Firmado' : 'No conforme'} por ${firma.nombre} el ${fecha(firma.fecha)}.\n${urlVer ? 'Ver el documento: ' + urlVer + '\n' : ''}\n${v.empresa.nombre || ''}`;
  const adjuntos = [...adjLogo(v), ...(imagen ? [{ nombre: 'firma.png', tipo: 'image/png', datos: Buffer.from(imagen), cid: 'firma' }] : []),
    ...(pdf ? [{ nombre: nombrePdf(v), tipo: 'application/pdf', datos: pdf }] : [])];
  return { asunto, html, texto, adjuntos };
}

export { nuevoId };
