// Página pública para que el cliente firme (o vea su copia firmada) con el enlace que le ha llegado.
import { crearPadFirma } from './firmapad.js';
import { descargarPdf } from './descargapdf.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => (n == null ? '' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n));
const num = (n) => (n == null ? '' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n));
const fecha = (f) => (f ? f.split('-').reverse().join('/') : '');
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }) : '');
const NOMBRE = { albaran: 'Albarán', presupuesto: 'Presupuesto', factura: 'Factura' };
const t = new URLSearchParams(location.search).get('t') || '';
const api = (ruta, opciones = {}) => fetch(`api/${ruta}`, { credentials: 'omit', ...opciones, headers: { 'X-Presupuestos': '1', 'Content-Type': 'application/json', ...(opciones.headers || {}) } });

function cabecera(v) {
  const e = v.empresa; const d = v.doc;
  return `
    <header class="fp-cab">
      <div>${e.logo ? `<img class="fp-logo" src="${e.logo}" alt="">` : ''}<strong>${esc(e.nombre)}</strong>
        <div class="muted small">${[e.cif && 'NIF ' + e.cif, e.direccion, e.contacto].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="fp-titulo"><h1>${NOMBRE[d.tipo] || 'Documento'} ${esc(d.numero)}</h1><span class="muted">${fecha(d.fecha)}</span></div>
    </header>
    <p class="fp-cliente"><span class="muted small">Cliente</span><br><strong>${esc(d.cliente)}</strong>${d.clienteCif ? ` · ${esc(d.clienteCif)}` : ''}</p>
    <table class="firma-lineas">
      <thead><tr><th>Concepto</th><th class="num">Cant.</th>${v.importes ? '<th class="num">Precio</th><th class="num">Importe</th>' : ''}</tr></thead>
      <tbody>${d.lineas.map((l) => `<tr><td><strong>${esc(l.articulo)}</strong>${l.descripcion ? `<div class="muted small">${esc(l.descripcion)}</div>` : ''}</td>
        <td class="num">${num(l.cantidad)}</td>${v.importes ? `<td class="num">${eur(l.precio)}</td><td class="num">${eur(l.importe)}</td>` : ''}</tr>`).join('')}</tbody>
      ${v.importes && d.total != null ? `<tfoot><tr><td colspan="3">Base imponible</td><td class="num">${eur(d.base)}</td></tr>
        <tr><td colspan="3"><strong>Total (IVA ${num(d.iva)} % incl.)</strong></td><td class="num"><strong>${eur(d.total)}</strong></td></tr></tfoot>` : ''}
    </table>
    ${d.notas ? `<p class="muted small">${esc(d.notas)}</p>` : ''}`;
}

function vistaFirmada(v) {
  const f = v.firma;
  const ok = v.estado === 'firmado';
  $('#fpCaja').innerHTML = `${cabecera(v)}
    <div class="panel-firma ${ok ? 'firmado' : 'rechazado'}">
      <p><strong>${ok ? (v.doc.tipo === 'presupuesto' ? '✓ Aceptado y firmado' : '✓ Firmado') : '✗ No conforme'}</strong>${f ? ` por ${esc(f.nombre)}${f.dni ? ` (DNI ${esc(f.dni)})` : ''} el ${esc(fechaHora(f.fecha))}` : ''}.</p>
      ${f?.observaciones ? `<p class="small">Observaciones: ${esc(f.observaciones)}</p>` : ''}
      ${f?.motivo ? `<p class="small">Motivo: ${esc(f.motivo)}</p>` : ''}
      ${ok ? `<img class="firma-img" src="api/publico/firma/imagen?t=${encodeURIComponent(t)}" alt="Firma">` : ''}
      ${f ? `<p class="muted small huella">Huella del documento (SHA-256): ${esc(f.huella)}</p>` : ''}
    </div>
    <div class="btns actions no-print"><button class="btn" id="fpPdf">Descargar PDF</button><button class="btn ghost" id="fpImprimir">Imprimir</button></div>`;
  $('#fpImprimir').addEventListener('click', () => window.print());
  $('#fpPdf').addEventListener('click', async () => {
    const img = ok ? await fetch(`api/publico/firma/imagen?t=${encodeURIComponent(t)}`, { credentials: 'omit' }).then((r) => (r.ok ? r.blob() : null)).catch(() => null) : null;
    await descargarPdf({ empresa: v.empresa, doc: v.doc, importes: v.importes, firma: f, logo: v.empresa.logo || 'logo.png', imagenFirma: img });
  });
}

function formulario(v) {
  const presu = v.doc.tipo === 'presupuesto';
  $('#fpCaja').innerHTML = `${cabecera(v)}
    <h2 class="fp-h2">${presu ? 'Aceptar el presupuesto' : 'Firmar'}</h2>
    <form id="fpForm" class="grid g2 firma-form">
      <label>Nombre y apellidos * <input id="fpNombre" autocomplete="name" required></label>
      <label>DNI / NIF <span class="muted">(opcional)</span> <input id="fpDni" autocomplete="off"></label>
      <label class="s2">Email para recibir la copia firmada <input id="fpEmail" type="email" inputmode="email" autocomplete="email" value="${esc(v.emailSugerido || '')}"></label>
      <label class="s2">Observaciones <span class="muted">(opcional)</span> <textarea id="fpObs" rows="2"></textarea></label>
      <div class="s2 firma-zona">
        <div class="firma-pad-cab"><span>Firme aquí con el dedo o el ratón</span><button type="button" class="btn ghost small" id="fpBorrar">Borrar</button></div>
        <canvas class="firma-pad" id="fpPad" aria-label="Recuadro para firmar"></canvas>
      </div>
      <label class="check s2" id="fpConformeL"><input type="checkbox" id="fpConforme"> ${presu ? 'Acepto este presupuesto.' : 'He recibido los trabajos y materiales descritos y estoy conforme.'}</label>
      <div class="s2 hidden" id="fpRechazo"><label>Motivo por el que no está conforme * <textarea id="fpMotivo" rows="3"></textarea></label></div>
      <p id="fpMsg" class="warn hidden s2"></p>
      <div class="btns actions s2">
        <button class="btn grande" type="submit" id="fpBoton">${presu ? 'Aceptar y firmar' : 'Firmar'}</button>
        <button class="btn ghost" type="button" id="fpNo">${presu ? 'No acepto…' : 'No estoy conforme…'}</button>
      </div>
      <p class="muted small s2">Al firmar se guardan su nombre, la fecha y hora y la dirección de su conexión como prueba de la firma. Caduca el ${esc(fechaHora(new Date(v.caduca).toISOString()))}.</p>
    </form>`;
  const pad = crearPadFirma($('#fpPad'));
  let rechazo = false;
  const error = (m) => { $('#fpMsg').textContent = m; $('#fpMsg').classList.toggle('hidden', !m); };
  $('#fpPad').addEventListener('firma', () => { if (!pad.vacio()) error(''); });
  $('#fpBorrar').addEventListener('click', () => pad.borrar());
  $('#fpNo').addEventListener('click', () => {
    rechazo = !rechazo;
    $('#fpRechazo').classList.toggle('hidden', !rechazo);
    $('#fpConformeL').classList.toggle('hidden', rechazo);
    $('#fpBoton').textContent = rechazo ? 'Enviar: no conforme' : (presu ? 'Aceptar y firmar' : 'Firmar');
    $('#fpNo').textContent = rechazo ? 'Volver a firmar conforme' : (presu ? 'No acepto…' : 'No estoy conforme…');
  });
  $('#fpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    error('');
    if ($('#fpNombre').value.trim().length < 3) { error('Escriba su nombre y apellidos.'); return; }
    if (!rechazo && pad.vacio()) { error('Falta la firma: firme en el recuadro.'); return; }
    if (!rechazo && !$('#fpConforme').checked) { error('Marque la casilla de conformidad.'); return; }
    if (rechazo && $('#fpMotivo').value.trim().length < 3) { error('Escriba el motivo.'); return; }
    $('#fpBoton').disabled = true; $('#fpBoton').textContent = 'Enviando…';
    try {
      const res = await api('publico/firma', { method: 'POST', body: JSON.stringify({
        t, nombre: $('#fpNombre').value, dni: $('#fpDni').value, email: $('#fpEmail').value.trim(), observaciones: $('#fpObs').value,
        conforme: $('#fpConforme').checked, rechazo, motivo: $('#fpMotivo').value, imagen: pad.vacio() ? null : pad.png(), imagenJpeg: pad.vacio() ? null : await pad.jpeg(),
      }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'No se pudo enviar.');
      $('#fpCaja').innerHTML = `<div class="firma-hecha ${rechazo ? 'no' : ''}"><div class="firma-icono">${rechazo ? '✗' : '✓'}</div>
        <h2>${rechazo ? 'Hemos recibido su respuesta' : '¡Gracias! Documento firmado'}</h2>
        <p>${$('#fpEmail')?.value ? 'Le llegará una copia por email.' : ''}</p>
        <div class="btns actions"><button class="btn" id="fpVer">Ver la copia firmada</button></div></div>`;
      $('#fpVer').addEventListener('click', cargar);
    } catch (err) {
      error(err.message);
      $('#fpBoton').disabled = false; $('#fpBoton').textContent = rechazo ? 'Enviar: no conforme' : 'Firmar';
    }
  });
}

async function cargar() {
  try {
    const res = await api(`publico/firma?t=${encodeURIComponent(t)}`);
    const v = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(v.error || 'El enlace no es válido.');
    document.title = `${NOMBRE[v.doc.tipo] || 'Documento'} ${v.doc.numero} · ${v.empresa.nombre || ''}`;
    if (v.modo === 'firmar') formulario(v); else vistaFirmada(v);
  } catch (err) {
    $('#fpCaja').innerHTML = `<h1>No se puede abrir</h1><p>${esc(err.message)}</p>`;
  }
}
cargar();
