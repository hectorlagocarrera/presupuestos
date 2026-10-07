// Firmas: firmar en persona (con el dedo en el móvil o la tablet), enviar un enlace para firmar a distancia,
// ver la firma y su historial, reenviar la copia y anular. El estado lo decide siempre el servidor.
import { $, esc, fmtEur, fmtNum, fmtDate, TIPOS, tipoDe } from '../util.js';
import { firmasApi } from '../backend.js';
import { data, getPresupuesto, partidasDe, clientePorNombre, actualizarFirma } from '../store.js';
import { crearPadFirma } from '../firmapad.js';
import { toast } from './common.js';

export const firmable = (p) => p && ['albaran', 'presupuesto'].includes(tipoDe(p));
const puedeFirmar = () => !document.body.classList.contains('sin-firmas');
const puedeAnular = () => document.body.classList.contains('es-admin') || !document.body.classList.contains('sin-editar');
const esPresupuesto = (p) => tipoDe(p) === 'presupuesto';
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Etiqueta de estado para listas.
export function etiquetaFirma(p, { corta = false } = {}) {
  if (!firmable(p)) return '';
  const e = p.estadoFirma;
  if (e === 'firmado') return `<span class="tag firma-ok" title="Firmado por ${esc(p.firmaNombre || '')} el ${esc(fechaHora(p.firmaFecha))}">✓ ${esPresupuesto(p) ? 'Aceptado' : 'Firmado'}${corta ? '' : ' ' + esc(fmtDate((p.firmaFecha || '').slice(0, 10)))}</span>`;
  if (e === 'pendiente') return '<span class="tag firma-pend">⏳ Pendiente de firma</span>';
  if (e === 'rechazado') return '<span class="tag firma-no">✗ No conforme</span>';
  return '<span class="tag soft">Sin firmar</span>';
}

function dialogo(html, clase = '') {
  const dlg = $('#modal');
  $('#modalBody').innerHTML = html;
  dlg.className = clase;
  dlg.addEventListener('close', () => { dlg.className = ''; }, { once: true });
  dlg.onclick = null;
  if (!dlg.open) dlg.showModal();
  return dlg;
}

function resumenDoc(p, importes) {
  const lineas = partidasDe(p.id);
  const hayPrecios = lineas.some((l) => l.precioUnitario != null);
  const imp = importes && hayPrecios;
  return `
    <div class="firma-doc">
      <div class="firma-doc-cab"><strong>${esc(p.clienteNombre || 'Sin cliente')}</strong><span class="muted">${TIPOS[tipoDe(p)].nombre} ${esc(p.numero || '')} · ${fmtDate(p.fecha)}</span></div>
      <table class="firma-lineas">
        <thead><tr><th>Concepto</th><th class="num">Cant.</th>${imp ? '<th class="num">Importe</th>' : ''}</tr></thead>
        <tbody>${lineas.map((l) => `<tr><td><strong>${esc(l.articulo)}</strong>${l.descripcion ? `<div class="muted small">${esc(l.descripcion)}</div>` : ''}${l.observaciones ? `<div class="muted small">${esc(l.observaciones)}</div>` : ''}</td>
          <td class="num">${fmtNum(l.cantidad)}</td>${imp ? `<td class="num">${fmtEur(l.precioTotal)}</td>` : ''}</tr>`).join('')}</tbody>
        ${imp && p.total != null ? `<tfoot><tr><td colspan="2">Total (IVA incl.)</td><td class="num"><strong>${fmtEur(p.total)}</strong></td></tr></tfoot>` : ''}
      </table>
      ${p.notas ? `<p class="muted small">${esc(p.notas)}</p>` : ''}
    </div>`;
}

// Ubicación (si el navegador la da en pocos segundos; si no, se firma sin ella).
const ubicacion = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition((pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});

// ---------- Firmar en persona ----------

export function firmarAhora(id, { alTerminar } = {}) {
  const p = getPresupuesto(id);
  if (!firmable(p)) return;
  if (p.estadoFirma === 'firmado') { verFirma(id); return; }
  const cli = clientePorNombre(p.clienteNombre || '') || {};
  const hayPrecios = partidasDe(p.id).some((l) => l.precioUnitario != null);
  let importes = hayPrecios && !!data.ajustes.partesImportes;
  const textoConforme = esPresupuesto(p) ? 'Acepto este presupuesto.' : 'He recibido los trabajos y materiales descritos y estoy conforme.';
  const dlg = dialogo(`
    <div class="pane-head"><h2>${esPresupuesto(p) ? 'Aceptar' : 'Firmar'} ${TIPOS[tipoDe(p)].nombre.toLowerCase()} ${esc(p.numero || '')}</h2><button class="btn ghost small" data-cerrar>Cerrar</button></div>
    <p class="muted small">Enseña la pantalla al cliente para que revise el ${esPresupuesto(p) ? 'presupuesto' : 'parte'} y firme.</p>
    ${hayPrecios ? '<label class="check"><input type="checkbox" id="fiImportes"> Mostrar importes al cliente (y en su copia)</label>' : ''}
    <div id="fiDoc"></div>
    <form id="fiForm" class="grid g2 firma-form">
      <label>Nombre y apellidos de quien firma * <input id="fiNombre" autocomplete="name" required></label>
      <label>DNI / NIF <span class="muted">(opcional)</span> <input id="fiDni" autocomplete="off"></label>
      <label class="s2">Email para enviarle la copia firmada <input id="fiEmail" type="email" inputmode="email" autocomplete="email" value="${esc(cli.email || '')}"></label>
      <label class="s2">Observaciones del cliente <span class="muted">(opcional)</span> <textarea id="fiObs" rows="2"></textarea></label>
      <div class="s2 firma-zona">
        <div class="firma-pad-cab"><span>Firme aquí con el dedo</span><button type="button" class="btn ghost small" data-borrar>Borrar</button></div>
        <canvas class="firma-pad" id="fiPad" aria-label="Recuadro para firmar"></canvas>
      </div>
      <label class="check s2"><input type="checkbox" id="fiConforme"> ${esc(textoConforme)}</label>
      <label class="check s2 muted small"><input type="checkbox" id="fiGeo" checked> Guardar la ubicación de la firma (GPS)</label>
      <div class="s2 hidden" id="fiRechazo"><label>Motivo por el que no está conforme * <textarea id="fiMotivo" rows="3"></textarea></label></div>
      <p id="fiMsg" class="warn hidden s2"></p>
      <div class="btns actions s2">
        <button class="btn grande" type="submit" id="fiBoton">${esPresupuesto(p) ? 'Aceptar y firmar' : 'Firmar'}</button>
        <button class="btn ghost" type="button" data-rechazo>${esPresupuesto(p) ? 'No acepta…' : 'No conforme…'}</button>
      </div>
    </form>`, 'firma-dlg');
  const pintarDoc = () => { $('#fiDoc').innerHTML = resumenDoc(p, importes); };
  pintarDoc();
  if ($('#fiImportes')) { $('#fiImportes').checked = importes; $('#fiImportes').addEventListener('change', (e) => { importes = e.target.checked; pintarDoc(); }); }
  const pad = crearPadFirma($('#fiPad'));
  let rechazo = false;
  const error = (m) => { $('#fiMsg').textContent = m; $('#fiMsg').classList.toggle('hidden', !m); };
  $('#fiPad').addEventListener('firma', () => { if (!pad.vacio()) error(''); });
  dlg.onclick = (e) => {
    if (e.target.closest('[data-cerrar]')) dlg.close();
    if (e.target.closest('[data-borrar]')) pad.borrar();
    if (e.target.closest('[data-rechazo]')) {
      rechazo = !rechazo;
      $('#fiRechazo').classList.toggle('hidden', !rechazo);
      $('#fiConforme').closest('label').classList.toggle('hidden', rechazo);
      $('#fiBoton').textContent = rechazo ? 'Registrar no conforme' : (esPresupuesto(p) ? 'Aceptar y firmar' : 'Firmar');
      e.target.closest('[data-rechazo]').textContent = rechazo ? 'Volver a firmar conforme' : (esPresupuesto(p) ? 'No acepta…' : 'No conforme…');
      if (rechazo) $('#fiMotivo').focus();
    }
  };
  $('#fiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    error('');
    if ($('#fiNombre').value.trim().length < 3) { error('Escribe el nombre y apellidos de quien firma.'); $('#fiNombre').focus(); return; }
    if (!rechazo && pad.vacio()) { error('Falta la firma: que el cliente firme en el recuadro.'); return; }
    if (!rechazo && !$('#fiConforme').checked) { error('Marca la casilla de conformidad.'); return; }
    if (rechazo && $('#fiMotivo').value.trim().length < 3) { error('Escribe el motivo.'); $('#fiMotivo').focus(); return; }
    const boton = $('#fiBoton');
    boton.disabled = true; boton.textContent = 'Guardando…';
    try {
      const geo = $('#fiGeo').checked ? await ubicacion() : null;
      const r = await firmasApi.presencial({
        presupuestoId: p.id, nombre: $('#fiNombre').value, dni: $('#fiDni').value, email: $('#fiEmail').value.trim(), observaciones: $('#fiObs').value,
        conforme: $('#fiConforme').checked, rechazo, motivo: $('#fiMotivo').value, imagen: pad.vacio() ? null : pad.png(), imagenJpeg: pad.vacio() ? null : await pad.jpeg(), geo, mostrarImportes: importes,
      });
      actualizarFirma(p.id, r);
      mostrarResultado(p, r, rechazo);
      alTerminar?.(r);
    } catch (err) {
      error(err.message);
      boton.disabled = false; boton.textContent = rechazo ? 'Registrar no conforme' : 'Firmar';
    }
  });
}

function textoCopia(copia) {
  if (!copia || copia === 'sin destinatario') return 'No se ha enviado copia por email (no se indicó ninguno).';
  if (copia === 'correo sin configurar') return 'No se ha enviado la copia: el correo de la aplicación aún no está configurado (Ajustes → Correo).';
  if (copia.startsWith('error')) return `No se pudo enviar la copia por email (${copia.slice(7)}). Puedes reenviarla desde «Ver firma».`;
  return `Copia ${copia}.`.replace(/ el \d{4}-[^ ]+$/, '');
}

function mostrarResultado(p, r, rechazo) {
  const dlg = dialogo(`
    <div class="firma-hecha ${rechazo ? 'no' : ''}">
      <div class="firma-icono">${rechazo ? '✗' : '✓'}</div>
      <h2>${rechazo ? 'Registrado: no conforme' : esPresupuesto(p) ? 'Presupuesto aceptado' : 'Parte firmado'}</h2>
      <p>${TIPOS[tipoDe(p)].nombre} ${esc(p.numero || '')} · ${esc(p.clienteNombre || '')}</p>
      <p class="muted">${esc(textoCopia(r.copia))}</p>
      <div class="btns actions"><button class="btn" data-pdf>Descargar PDF</button><button class="btn ghost" data-ver>Ver firma</button><button class="btn ghost" data-cerrar>Cerrar</button></div>
    </div>`, 'firma-dlg');
  dlg.onclick = (e) => {
    if (e.target.closest('[data-cerrar]')) dlg.close();
    if (e.target.closest('[data-ver]')) verFirma(p.id);
    if (e.target.closest('[data-pdf]')) descargarPdfDoc(p.id);
  };
}

// PDF del documento (con la firma si está firmado). Si el cliente firmó sin importes, el PDF tampoco los lleva.
export async function descargarPdfDoc(id) {
  const p = getPresupuesto(id);
  if (!p) return;
  try {
    let firma = null;
    if (p.firmaId && document.body.classList.contains('modo-servidor')) firma = (await firmasApi.estado(id)).firma;
    const lineas = partidasDe(id);
    const hayPrecios = lineas.some((l) => l.precioUnitario != null);
    const cli = clientePorNombre(p.clienteNombre || '') || {};
    const a = data.ajustes;
    const { descargarPdf } = await import('../descargapdf.js');
    await descargarPdf({
      empresa: { nombre: a.nombre, cif: a.cif, direccion: a.direccion, contacto: a.contacto },
      doc: { tipo: tipoDe(p), numero: p.numero, fecha: p.fecha, cliente: p.clienteNombre, clienteCif: cli.cif, clienteDireccion: cli.direccion, iva: p.iva, base: p.base, total: p.total, notas: p.notas,
        lineas: lineas.map((l) => ({ articulo: l.articulo, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precioUnitario, importe: l.precioTotal })) },
      importes: hayPrecios && (firma && !firma.anulada ? firma.mostrarImportes : true),
      firma: firma && !firma.anulada ? firma : null,
      logo: a.logo || 'logo.png',
      imagenFirma: firma && !firma.anulada && firma.estado === 'firmado' ? await firmasApi.imagen(firma.id) : null,
    });
  } catch (err) { toast('No se pudo crear el PDF: ' + err.message); }
}

// ---------- WhatsApp ----------

// Teléfono → número para WhatsApp (con prefijo; en España se añade el 34). Si hay varios, se prefiere un móvil.
export function telefonoWhatsapp(t) {
  const numeros = String(t || '').split(/[\/,;]| y | o /).map((x) => x.replace(/[^\d+]/g, '')).filter((x) => x.replace('+', '').length >= 9);
  let d = numeros.find((x) => /^(\+?34|0034)?[67]\d{8}$/.test(x)) || numeros[0] || '';
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^[6789]\d{8}$/.test(d)) d = '34' + d;
  return /^\d{9,15}$/.test(d) ? d : '';
}
const urlWhatsapp = (tel, texto) => `https://wa.me/${telefonoWhatsapp(tel)}?text=${encodeURIComponent(texto)}`;

// Bloque con el teléfono y el botón que abre WhatsApp con el mensaje ya escrito (lo pulsa la persona: si lo
// abriera la página sola, muchos móviles lo bloquean).
function bloqueWhatsapp(contenedor, telefono, texto) {
  contenedor.innerHTML = `
    <div class="whatsapp">
      <label>Teléfono del cliente <span class="muted">(vacío: eliges el contacto en WhatsApp)</span>
        <input id="waTel" type="tel" inputmode="tel" value="${esc(telefono || '')}" placeholder="600 000 000"></label>
      <a class="btn btn-whatsapp" id="waAbrir" target="_blank" rel="noopener">Abrir WhatsApp</a>
      <p class="muted small">Se abre WhatsApp con el mensaje y el enlace escritos: solo queda pulsar enviar.</p>
    </div>`;
  const pintar = () => { $('#waAbrir', contenedor).href = urlWhatsapp($('#waTel', contenedor).value, texto); };
  $('#waTel', contenedor).addEventListener('input', pintar);
  pintar();
}

async function copiaPorWhatsapp(id) {
  const p = getPresupuesto(id);
  const cli = clientePorNombre(p.clienteNombre || '') || {};
  try {
    const { url } = await firmasApi.enlaceCopia(id);
    const t = TIPOS[tipoDe(p)].nombre.toLowerCase();
    const dlg = dialogo(`
      <div class="pane-head"><h2>Enviar copia firmada por WhatsApp</h2><button class="btn ghost small" data-cerrar>Cerrar</button></div>
      <p>El cliente recibe un enlace para ver y descargar el ${t} ${esc(p.numero || '')} firmado en PDF (válido 90 días).</p>
      <div id="waCopia"></div>`, 'firma-dlg');
    bloqueWhatsapp($('#waCopia'), cli.telefono, `Hola, le enviamos el ${t} ${p.numero || ''} firmado${data.ajustes.nombre ? ` (${data.ajustes.nombre})` : ''}. Puede verlo y descargarlo en PDF aquí: ${url}`);
    dlg.onclick = (e) => { if (e.target.closest('[data-cerrar]')) dlg.close(); };
  } catch (err) { toast(err.message); }
}

// ---------- Enviar para firmar a distancia ----------

export async function enviarParaFirmar(id) {
  const p = getPresupuesto(id);
  if (!firmable(p)) return;
  let estado;
  try { estado = await firmasApi.estado(id); } catch (err) { toast(err.message); return; }
  const cli = clientePorNombre(p.clienteNombre || '') || {};
  const hayPrecios = partidasDe(p.id).some((l) => l.precioUnitario != null);
  const pend = estado.pendiente;
  const dlg = dialogo(`
    <div class="pane-head"><h2>Enviar para firmar · ${TIPOS[tipoDe(p)].nombre.toLowerCase()} ${esc(p.numero || '')}</h2><button class="btn ghost small" data-cerrar>Cerrar</button></div>
    <p>El cliente recibe un enlace para ${esPresupuesto(p) ? 'revisar y aceptar el presupuesto' : 'revisar y firmar el parte'} desde su móvil u ordenador, sin usuario ni contraseña.
      El enlace solo sirve para este documento y caduca.</p>
    ${pend ? `<p class="aviso-ajuste">Ya hay un enlace pendiente${pend.email ? ` enviado a ${esc(pend.email)}` : ''} (caduca el ${fechaHora(new Date(pend.expira).toISOString())}). Uno nuevo lo sustituye.</p>` : ''}
    <form id="enForm" class="grid g2">
      <label class="s2">Email del cliente <input id="enEmail" type="email" inputmode="email" value="${esc(pend?.email || cli.email || '')}"></label>
      <label>Caduca en <select id="enDias"><option value="3">3 días</option><option value="7" selected>7 días</option><option value="15">15 días</option><option value="30">30 días</option></select></label>
      ${hayPrecios ? `<label class="check"><input type="checkbox" id="enImportes" ${data.ajustes.partesImportes || esPresupuesto(p) ? 'checked' : ''}> Mostrar importes</label>` : '<span></span>'}
      ${estado.correoListo ? '' : '<p class="muted small s2">El correo de la aplicación no está configurado: copia el enlace y envíalo por WhatsApp o como prefieras.</p>'}
      <p id="enMsg" class="warn hidden s2"></p>
      <div class="btns actions s2">
        ${estado.correoListo ? '<button class="btn" type="submit" data-modo="email">Enviar por email</button>' : ''}
        <button class="btn ${estado.correoListo ? 'ghost' : ''} btn-whatsapp-borde" type="submit" data-modo="whatsapp">Enviar por WhatsApp</button>
        <button class="btn ghost" type="submit" data-modo="copiar">Copiar enlace</button>
        ${pend ? '<button class="btn ghost" type="button" data-cancelar>Cancelar el envío</button>' : ''}
      </div>
    </form>
    <div id="enResultado"></div>`, 'firma-dlg');
  let modo = 'email';
  dlg.onclick = async (e) => {
    const b = e.target.closest('[data-modo]');
    if (b) modo = b.dataset.modo;
    if (e.target.closest('[data-cerrar]')) dlg.close();
    if (e.target.closest('[data-cancelar]')) {
      try { actualizarFirma(id, await firmasApi.cancelar(id)); toast('Envío cancelado: el enlace ya no sirve'); dlg.close(); } catch (err) { toast(err.message); }
    }
  };
  $('#enForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#enEmail').value.trim();
    const msg = $('#enMsg');
    msg.classList.add('hidden');
    if (modo === 'email' && !email) { msg.textContent = 'Escribe el email del cliente.'; msg.classList.remove('hidden'); return; }
    try {
      const r = await firmasApi.enlace({ presupuestoId: id, email, dias: +$('#enDias').value, enviar: modo === 'email', mostrarImportes: $('#enImportes') ? $('#enImportes').checked : false });
      actualizarFirma(id, r);
      let copiado = false;
      if (modo === 'copiar') { try { await navigator.clipboard.writeText(r.url); copiado = true; } catch { /* se enseña para copiar a mano */ } }
      const t = TIPOS[tipoDe(p)].nombre.toLowerCase();
      const texto = `Hola, le enviamos el ${t} ${p.numero || ''}${data.ajustes.nombre ? ` de ${data.ajustes.nombre}` : ''} para ${esPresupuesto(p) ? 'revisarlo y aceptarlo' : 'revisarlo y firmarlo'}: ${r.url}`;
      $('#enForm').classList.add('hidden');
      $('#enResultado').innerHTML = `
        <p class="ok-msg">${r.enviado ? `✓ Enviado a <strong>${esc(r.enviado)}</strong>.` : copiado ? '✓ Enlace copiado: pégalo donde quieras (WhatsApp, SMS, email…).' : modo === 'whatsapp' ? 'Enlace preparado. Abre WhatsApp para enviarlo:' : 'Enlace para el cliente:'}</p>
        ${modo === 'whatsapp' ? '<div id="enWhatsapp"></div>' : `<p class="secreto enlace-firma">${esc(r.url)}</p>`}
        <div class="btns actions">${modo === 'whatsapp' ? '' : '<button class="btn ghost" data-otro-wa>Enviar también por WhatsApp</button>'}<button class="btn" data-cerrar>Hecho</button></div>
        <p class="muted small">Cuando el cliente firme, el ${t} pasará a «Firmado» y le llegará la copia por email (si la deja).</p>`;
      const ponerWa = () => bloqueWhatsapp($('#enWhatsapp') || Object.assign(document.createElement('div'), { id: 'enWhatsapp' }), cli.telefono, texto);
      if (modo === 'whatsapp') ponerWa();
      $('[data-otro-wa]')?.addEventListener('click', (ev) => { ev.target.replaceWith(Object.assign(document.createElement('div'), { id: 'enWhatsapp' })); ponerWa(); });
    } catch (err) {
      msg.textContent = err.message; msg.classList.remove('hidden');
      if (err.datos?.url) actualizarFirma(id, err.datos);
    }
  });
}

// ---------- Ver la firma, su historial y acciones ----------

const urlsImagen = new Map();
async function urlImagen(firmaId) {
  if (!urlsImagen.has(firmaId)) urlsImagen.set(firmaId, URL.createObjectURL(await firmasApi.imagen(firmaId)));
  return urlsImagen.get(firmaId);
}
export async function imagenFirmaDataUrl(firmaId) {
  const blob = await firmasApi.imagen(firmaId);
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}

// Bloque con el estado de la firma (para la vista del documento). contenedor: elemento donde pintarlo.
export async function panelFirma(id, contenedor) {
  const p = getPresupuesto(id);
  if (!firmable(p) || !contenedor) return;
  contenedor.innerHTML = '<p class="muted small">Cargando la firma…</p>';
  let r;
  try { r = await firmasApi.estado(id); } catch (err) { contenedor.innerHTML = ''; return; }
  actualizarFirma(id, r);
  const f = r.firma && !r.firma.anulada ? r.firma : null;
  const geo = f?.geo ? JSON.parse(f.geo) : null;
  const firmar = puedeFirmar() && r.estado !== 'firmado';
  contenedor.innerHTML = `
    <div class="panel-firma ${r.estado || 'sin'}">
      <div class="panel-firma-cab">${etiquetaFirma(p)}
        ${r.modificado ? '<span class="tag firma-no" title="El contenido actual no coincide con el que se firmó">⚠ Modificado después de firmar</span>' : ''}</div>
      ${f ? `
        <div class="panel-firma-cuerpo">
          ${f.estado === 'firmado' || f.id ? `<img class="firma-img" alt="Firma" data-firma="${esc(f.id)}">` : ''}
          <div>
            <p><strong>${esc(f.nombre)}</strong>${f.dni ? ` · DNI ${esc(f.dni)}` : ''}<br>
              <span class="muted small">${fechaHora(f.fecha)} · ${f.modo === 'enlace' ? 'a distancia (enlace)' : `en persona${f.recogidaPor ? `, recogida por ${esc(f.recogidaPor)}` : ''}`}</span></p>
            ${f.observaciones ? `<p class="small">Observaciones: ${esc(f.observaciones)}</p>` : ''}
            ${f.motivo ? `<p class="small">Motivo: ${esc(f.motivo)}</p>` : ''}
            ${geo ? `<p class="small"><a href="https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=18/${geo.lat}/${geo.lon}" target="_blank" rel="noopener">📍 Ver dónde se firmó</a> <span class="muted">(±${geo.precision} m)</span></p>` : ''}
            <p class="muted small">${esc(textoCopia(f.copia))}</p>
            <p class="muted small huella" title="Huella SHA-256 del contenido firmado">Huella: ${esc(f.huella.slice(0, 16))}…</p>
          </div>
        </div>` : ''}
      ${r.estado === 'pendiente' && r.pendiente ? `<p class="small">Enviado para firmar${r.pendiente.email ? ` a ${esc(r.pendiente.email)}` : ''} el ${fechaHora(r.pendiente.creado)}${r.pendiente.creadoPor ? ` por ${esc(r.pendiente.creadoPor)}` : ''}. Caduca el ${fechaHora(new Date(r.pendiente.expira).toISOString())}.</p>` : ''}
      <div class="btns">
        ${firmar ? `<button class="btn small" data-pf="firmar">${esPresupuesto(p) ? 'Aceptar ahora (firma)' : 'Firmar ahora'}</button><button class="btn small ghost" data-pf="enviar">${r.estado === 'pendiente' ? 'Reenviar enlace' : 'Enviar para firmar'}</button>` : ''}
        ${f ? '<button class="btn small" data-pf="pdf">Descargar PDF firmado</button>' : ''}
        ${f && puedeFirmar() ? '<button class="btn small ghost" data-pf="reenviar">Reenviar copia por email</button><button class="btn small ghost" data-pf="whatsapp">Enviar copia por WhatsApp</button>' : ''}
        ${f && puedeAnular() ? '<button class="btn small ghost peligro" data-pf="anular">Anular firma</button>' : ''}
      </div>
      ${r.historial.filter((h) => h.anulada).length ? `<details class="small"><summary>Historial (${r.historial.filter((h) => h.anulada).length} anulada${r.historial.filter((h) => h.anulada).length === 1 ? '' : 's'})</summary>
        <ul>${r.historial.filter((h) => h.anulada).map((h) => `<li>${h.estado === 'firmado' ? 'Firmada' : 'No conforme'} por ${esc(h.nombre)} el ${fechaHora(h.fecha)} · anulada por ${esc(h.anuladaPor || '')} el ${fechaHora(h.anuladaFecha)}: ${esc(h.anuladaMotivo || '')}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  const img = contenedor.querySelector('[data-firma]');
  if (img) urlImagen(img.dataset.firma).then((u) => { img.src = u; }).catch(() => img.remove());
  contenedor.onclick = async (e) => {
    const b = e.target.closest('[data-pf]');
    if (!b) return;
    try {
      if (b.dataset.pf === 'firmar') firmarAhora(id);
      if (b.dataset.pf === 'pdf') descargarPdfDoc(id);
      if (b.dataset.pf === 'whatsapp') copiaPorWhatsapp(id);
      if (b.dataset.pf === 'enviar') enviarParaFirmar(id);
      if (b.dataset.pf === 'reenviar') {
        const cli = clientePorNombre(p.clienteNombre || '') || {};
        const email = prompt('¿A qué email reenvío la copia firmada?', f.email || cli.email || '');
        if (!email) return;
        await firmasApi.reenviar(id, email.trim());
        toast('Copia reenviada');
        panelFirma(id, contenedor);
      }
      if (b.dataset.pf === 'anular') {
        const motivo = prompt('Anular la firma deja el documento como «sin firmar» para poder cambiarlo (la firma queda en el historial).\n\n¿Por qué se anula?');
        if (!motivo) return;
        actualizarFirma(id, await firmasApi.anular(id, motivo));
        toast('Firma anulada');
        panelFirma(id, contenedor);
      }
    } catch (err) { toast(err.message); }
  };
}

export function verFirma(id) {
  import('./presview.js').then((m) => m.verPresupuesto(id));
}
