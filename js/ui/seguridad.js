// Verificación en dos pasos: configurarla (QR + código), códigos de recuperación, desactivar y política.
import { $, esc, today } from '../util.js';
import { mfa } from '../backend.js';
import { toast, loadScript } from './common.js';

let estado = { usuario: '', mfa: false, mfaObligatorio: false };

function dialogo(html, { cerrable = true } = {}) {
  const dlg = $('#modal');
  $('#modalBody').innerHTML = html;
  dlg.oncancel = (e) => { if (!cerrable) e.preventDefault(); };
  dlg.onclick = (e) => { if (cerrable && e.target === dlg) dlg.close(); };
  if (!dlg.open) dlg.showModal();
  return dlg;
}

async function qrSvg(texto) {
  await loadScript('vendor/qrcode.js');
  const qr = window.qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function descargarCodigos(codigos) {
  const txt = `Códigos de recuperación · Albaranes · usuario ${estado.usuario}\nGenerados el ${today()}\n\n`
    + 'Cada código sirve UNA vez para entrar si no tienes el móvil. Guárdalos en un lugar seguro.\n\n' + codigos.join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  a.download = `codigos-recuperacion-${estado.usuario}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function mostrarCodigos(codigos, alTerminar) {
  const dlg = dialogo(`
    <h2>Guarda tus códigos de recuperación</h2>
    <p>Si pierdes o cambias el móvil, podrás entrar con <strong>uno de estos códigos</strong> (cada uno sirve una sola vez).
      No se volverán a mostrar.</p>
    <div class="codigos">${codigos.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
    <div class="btns actions">
      <button class="btn ghost" data-descargar>Descargar (.txt)</button>
      <button class="btn ghost" data-copiar>Copiar</button>
      <button class="btn" data-hecho>Ya los he guardado</button>
    </div>`, { cerrable: false });
  dlg.onclick = async (e) => {
    if (e.target.closest('[data-descargar]')) descargarCodigos(codigos);
    if (e.target.closest('[data-copiar]')) { try { await navigator.clipboard.writeText(codigos.join('\n')); toast('Códigos copiados'); } catch { toast('No se pudo copiar: descárgalos'); } }
    if (e.target.closest('[data-hecho]')) { dlg.close(); alTerminar?.(); }
  };
}

// Asistente para activar la verificación. obligatoria: no se puede cerrar sin terminar.
export async function configurarMfa({ obligatoria = false, alTerminar } = {}) {
  let datos;
  try { datos = await mfa.iniciar(); } catch (err) { toast(err.message); return; }
  const grupos = datos.secreto.match(/.{1,4}/g).join(' ');
  const dlg = dialogo(`
    <h2>Activar la verificación en dos pasos</h2>
    ${obligatoria ? '<p class="warn">En esta empresa es obligatoria. Configúrala para poder entrar.</p>' : ''}
    <div class="mfa-pasos">
      <div class="qr">${await qrSvg(datos.uri)}</div>
      <div>
        <p><strong>1.</strong> Instala en el móvil <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong> (gratis).</p>
        <p><strong>2.</strong> En la app pulsa <strong>+</strong> y <strong>Escanear código QR</strong>, y apunta la cámara al cuadro.
          Si no puedes escanearlo, elige «Introducir clave» y escribe:</p>
        <p class="secreto">${esc(grupos)}</p>
        <p><strong>3.</strong> Escribe el código de 6 cifras que aparece en la app:</p>
        <label><input id="mfaCodigoAlta" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"></label>
        <p id="mfaAltaMsg" class="warn hidden"></p>
      </div>
    </div>
    <div class="btns actions">
      <button class="btn" data-activar>Activar</button>
      ${obligatoria ? '<button class="btn ghost" data-salir>Salir</button>' : '<button class="btn ghost" data-cancelar>Cancelar</button>'}
    </div>`, { cerrable: !obligatoria });
  $('#mfaCodigoAlta').focus();
  const activar = async () => {
    try {
      const { codigos } = await mfa.activar($('#mfaCodigoAlta').value);
      estado.mfa = true;
      pintar();
      mostrarCodigos(codigos, alTerminar);
      toast('Verificación en dos pasos activada');
    } catch (err) {
      $('#mfaAltaMsg').textContent = err.message;
      $('#mfaAltaMsg').classList.remove('hidden');
      $('#mfaCodigoAlta').select();
    }
  };
  $('#mfaCodigoAlta').addEventListener('keydown', (e) => { if (e.key === 'Enter') activar(); });
  dlg.onclick = async (e) => {
    if (e.target.closest('[data-activar]')) activar();
    if (e.target.closest('[data-cancelar]') || (!obligatoria && e.target === dlg)) dlg.close();
    if (e.target.closest('[data-salir]')) {
      await fetch('api/salir', { method: 'POST', credentials: 'same-origin', headers: { 'X-Presupuestos': '1' } });
      location.reload();
    }
  };
}

function pedirCodigo(titulo, texto, conClave) {
  return new Promise((resolve) => {
    const dlg = dialogo(`
      <h2>${esc(titulo)}</h2>
      <p>${texto}</p>
      ${conClave ? '<label>Contraseña <input id="mfaClave" type="password" autocomplete="current-password"></label>' : ''}
      <label>Código de la app (o de recuperación) <input id="mfaCodigo" inputmode="numeric" autocomplete="one-time-code" maxlength="14"></label>
      <div class="btns actions"><button class="btn" data-ok>Continuar</button><button class="btn ghost" data-cancelar>Cancelar</button></div>`);
    (conClave ? $('#mfaClave') : $('#mfaCodigo')).focus();
    dlg.onclick = (e) => {
      if (e.target.closest('[data-ok]')) { const r = { clave: $('#mfaClave')?.value, codigo: $('#mfaCodigo').value }; dlg.close(); resolve(r); }
      if (e.target.closest('[data-cancelar]') || e.target === dlg) { dlg.close(); resolve(null); }
    };
  });
}

function pintar() {
  const { mfa: activa, mfaObligatorio } = estado;
  $('#mfaEstado').innerHTML = activa
    ? '✅ <strong>Activada</strong> para tu usuario.'
    : '⚠️ <strong>No activada</strong> para tu usuario: se entra solo con la contraseña.';
  $('#mfaActivar').classList.toggle('hidden', activa);
  $('#mfaCodigos').classList.toggle('hidden', !activa);
  $('#mfaDesactivar').classList.toggle('hidden', !activa);
  $('#mfaObligatoria').checked = !!mfaObligatorio;
  $('#mfaObligatoria').disabled = !activa;
  $('#mfaObligatoria').parentElement.title = activa ? '' : 'Actívala primero en tu usuario';
}

export function initSeguridad(yo) {
  estado = { ...estado, ...yo };
  pintar();
  $('#mfaActivar').addEventListener('click', () => configurarMfa());
  $('#mfaCodigos').addEventListener('click', async () => {
    const r = await pedirCodigo('Nuevos códigos de recuperación', 'Los códigos anteriores dejarán de valer.', false);
    if (!r) return;
    try { mostrarCodigos((await mfa.recuperacion(r.codigo)).codigos); } catch (err) { toast(err.message); }
  });
  $('#mfaDesactivar').addEventListener('click', async () => {
    const r = await pedirCodigo('Desactivar la verificación en dos pasos',
      'Para cambiar de móvil, desactívala y vuelve a activarla con el móvil nuevo.', true);
    if (!r) return;
    try {
      const res = await mfa.desactivar(r.clave, r.codigo);
      estado.mfa = false;
      pintar();
      toast('Verificación en dos pasos desactivada');
      if (res.mfaObligatorio) configurarMfa({ obligatoria: true, alTerminar: () => location.reload() });
    } catch (err) { toast(err.message); }
  });
  $('#mfaObligatoria').addEventListener('change', async (e) => {
    try {
      const { mfaObligatorio } = await mfa.politica(e.target.checked);
      estado.mfaObligatorio = mfaObligatorio;
      toast(mfaObligatorio ? 'Ahora es obligatoria para todos los usuarios' : 'Ya no es obligatoria');
    } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
  });
}
