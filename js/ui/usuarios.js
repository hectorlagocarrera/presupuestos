// Mi cuenta (cambiar la contraseña) y gestión de usuarios para administradores:
// crear, editar nombre y rol, activar o desactivar, poner contraseña nueva, quitar la verificación, cerrar sesiones y borrar.
import { $, esc, fmtDate } from '../util.js';
import { cuentas } from '../backend.js';
import { toast } from './common.js';

const MIN_CLAVE = 12;

// Permisos que se pueden dar (consultar el histórico, la tarifa y los albaranes lo puede hacer todo el mundo).
export const PERMISOS = {
  editar: 'Crear y editar albaranes, presupuestos y clientes',
  borrar: 'Borrar documentos y clientes',
  importar: 'Importar PDF y Excel',
  facturas: 'Ver las facturas y lo facturado',
  tarifa: 'Cambiar la tarifa (precios fijados, ajuste general)',
  ajustes: 'Cambiar datos de la empresa, logotipo y sinónimos',
  copias: 'Descargar y cargar copias de seguridad',
  firmas: 'Recoger firmas de clientes y enviar documentos para firmar',
};
const CORTO = { editar: 'editar', borrar: 'borrar', importar: 'importar', facturas: 'facturas', tarifa: 'tarifa', ajustes: 'ajustes', copias: 'copias', firmas: 'firmas' };
// Plantillas: marcan las casillas de golpe (luego se pueden ajustar).
const PLANTILLAS = {
  consulta: { nombre: 'Solo consulta', permisos: [] },
  comercial: { nombre: 'Comercial', permisos: ['editar', 'firmas'] },
  oficina: { nombre: 'Oficina', permisos: ['editar', 'borrar', 'importar', 'facturas', 'tarifa', 'firmas'] },
  todo: { nombre: 'Todo (sin gestionar usuarios)', permisos: Object.keys(PERMISOS) },
};

// Casillas de permisos + plantillas + «Administrador». Devuelve el HTML; leerPermisos() lee lo marcado.
function bloquePermisos(rol, permisos) {
  return `
    <fieldset class="permisos s2">
      <legend>Permisos</legend>
      <div class="chips plantillas">
        ${Object.entries(PLANTILLAS).map(([k, t]) => `<button type="button" class="chip" data-plantilla="${k}">${t.nombre}</button>`).join('')}
        <button type="button" class="chip" data-plantilla="operario">Operario</button>
        <button type="button" class="chip" data-plantilla="admin">Administrador</button>
      </div>
      <p class="muted small">Todos pueden consultar el histórico, los albaranes y la tarifa. Marca lo que además puede hacer:</p>
      <div class="lista-permisos">
        ${Object.entries(PERMISOS).map(([k, txt]) => `<label class="check"><input type="checkbox" data-permiso="${k}" ${permisos.includes(k) ? 'checked' : ''}> ${txt}</label>`).join('')}
        <label class="check admin-permiso" data-ayuda="Solo ve «Partes de trabajo»: busca el albarán del cliente, lo enseña y recoge la firma (o lo envía para firmar). No ve el histórico, la tarifa, los presupuestos ni las facturas, ni los importes salvo que se permita en Ajustes → Correo y firmas."><input type="checkbox" id="pmOperario" ${rol === 'operario' ? 'checked' : ''}> <strong>Operario</strong>: solo partes de trabajo (buscar el albarán y recoger la firma)</label>
        <label class="check admin-permiso" data-ayuda="Además de todo lo anterior, puede crear, cambiar y borrar usuarios y exigir la verificación en dos pasos."><input type="checkbox" id="pmAdmin" ${rol === 'admin' ? 'checked' : ''}> <strong>Administrador</strong>: todo, y gestionar usuarios</label>
      </div>
    </fieldset>`;
}
function prepararPermisos(raiz) {
  const casillas = () => [...raiz.querySelectorAll('input[data-permiso]')];
  const admin = raiz.querySelector('#pmAdmin');
  const operario = raiz.querySelector('#pmOperario');
  const pintar = () => casillas().forEach((c) => {
    c.disabled = admin.checked || operario.checked;
    if (admin.checked) c.checked = true;
    if (operario.checked) c.checked = c.dataset.permiso === 'firmas';
  });
  admin.addEventListener('change', () => { if (admin.checked) operario.checked = false; pintar(); });
  operario.addEventListener('change', () => { if (operario.checked) admin.checked = false; pintar(); });
  raiz.querySelector('.plantillas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-plantilla]');
    if (!b) return;
    admin.checked = b.dataset.plantilla === 'admin';
    operario.checked = b.dataset.plantilla === 'operario';
    if (!admin.checked && !operario.checked) casillas().forEach((c) => { c.checked = PLANTILLAS[b.dataset.plantilla].permisos.includes(c.dataset.permiso); });
    pintar();
  });
  pintar();
}
function leerPermisos(raiz) {
  const admin = raiz.querySelector('#pmAdmin').checked;
  const operario = raiz.querySelector('#pmOperario').checked;
  return { rol: admin ? 'admin' : operario ? 'operario' : 'usuario', permisos: admin ? Object.keys(PERMISOS) : operario ? ['firmas'] : [...raiz.querySelectorAll('input[data-permiso]:checked')].map((c) => c.dataset.permiso) };
}
const resumenPermisos = (u) => (u.rol === 'admin' ? '<span class="tag">Administrador</span>'
  : u.rol === 'operario' ? '<span class="tag soft">Operario</span> solo partes'
  : u.permisos.length === 0 ? 'Solo consulta'
    : u.permisos.length === Object.keys(PERMISOS).length ? 'Todo menos usuarios'
      : u.permisos.map((p) => CORTO[p]).join(', '));
let yo = { usuario: '', rol: 'usuario' };
let usuarios = [];

function dialogo(html, { cerrable = true } = {}) {
  const dlg = $('#modal');
  $('#modalBody').innerHTML = html;
  dlg.oncancel = (e) => { if (!cerrable) e.preventDefault(); };
  dlg.onclick = null;
  if (!dlg.open) dlg.showModal();
  return dlg;
}

// Contraseña aleatoria fácil de dictar: 4 grupos de 4 letras y números sin caracteres confusos (0/o, 1/l).
export function generarClave() {
  const letras = 'abcdefghijkmnpqrstuvwxyz23456789';
  const n = new Uint32Array(16);
  crypto.getRandomValues(n);
  const s = [...n].map((x) => letras[x % letras.length]).join('');
  return s.match(/.{4}/g).join('-');
}

const errorEn = (el, msg) => { el.textContent = msg; el.classList.toggle('hidden', !msg); };

// ---------- Mi contraseña ----------

export function cambiarMiClave({ obligatoria = false } = {}) {
  return new Promise((resolve) => {
    const dlg = dialogo(`
      <h2>${obligatoria ? 'Pon tu propia contraseña' : 'Cambiar mi contraseña'}</h2>
      ${obligatoria ? '<p class="warn">Un administrador te ha puesto una contraseña provisional. Elige una nueva que solo sepas tú para continuar.</p>' : ''}
      <form id="fClave" class="grid">
        <label>Contraseña actual <input id="cActual" type="password" autocomplete="current-password" required></label>
        <label>Contraseña nueva <input id="cNueva" type="password" autocomplete="new-password" minlength="${MIN_CLAVE}" required></label>
        <label>Repite la contraseña nueva <input id="cRepite" type="password" autocomplete="new-password" required></label>
        <p class="muted small">Mínimo ${MIN_CLAVE} caracteres. Mejor una frase fácil de recordar, por ejemplo <code>grapa-caballo-bateria-azul</code>.</p>
        <p id="cMsg" class="warn hidden"></p>
        <div class="btns actions">
          <button class="btn" type="submit">Guardar contraseña</button>
          ${obligatoria ? '<button class="btn ghost" type="button" data-salir>Salir</button>' : '<button class="btn ghost" type="button" data-cancelar>Cancelar</button>'}
        </div>
      </form>`, { cerrable: !obligatoria });
    $('#cActual').focus();
    dlg.onclick = async (e) => {
      if (e.target.closest('[data-cancelar]')) { dlg.close(); resolve(false); }
      if (e.target.closest('[data-salir]')) {
        await fetch('api/salir', { method: 'POST', credentials: 'same-origin', headers: { 'X-Presupuestos': '1' } });
        location.reload();
      }
    };
    $('#fClave').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nueva = $('#cNueva').value;
      if (nueva.length < MIN_CLAVE) return errorEn($('#cMsg'), `La contraseña nueva debe tener al menos ${MIN_CLAVE} caracteres.`);
      if (nueva !== $('#cRepite').value) return errorEn($('#cMsg'), 'Las dos contraseñas nuevas no coinciden.');
      try {
        await cuentas.cambiarMiClave($('#cActual').value, nueva);
        dlg.close();
        toast('Contraseña cambiada. Las sesiones de otros dispositivos se han cerrado.');
        resolve(true);
      } catch (err) { errorEn($('#cMsg'), err.message); }
    });
  });
}

// ---------- Confirmar la contraseña antes de cambiar usuarios ----------

function pedirConfirmacion() {
  return new Promise((resolve) => {
    const dlg = dialogo(`
      <h2>Confirma que eres tú</h2>
      <p>Para cambiar usuarios, vuelve a escribir <strong>tu</strong> contraseña. Durante 10 minutos no se volverá a pedir.</p>
      <form id="fConf">
        <label>Tu contraseña <input id="confClave" type="password" autocomplete="current-password" required></label>
        <p id="confMsg" class="warn hidden"></p>
        <div class="btns actions"><button class="btn" type="submit">Confirmar</button><button class="btn ghost" type="button" data-cancelar>Cancelar</button></div>
      </form>`);
    $('#confClave').focus();
    dlg.onclick = (e) => { if (e.target.closest('[data-cancelar]')) { dlg.close(); resolve(false); } };
    $('#fConf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await cuentas.confirmar($('#confClave').value); dlg.close(); resolve(true); } catch (err) { errorEn($('#confMsg'), err.message); $('#confClave').select(); }
    });
  });
}

// Hace la acción; si el servidor pide confirmar la contraseña, la pide y la repite.
async function hacer(accion, datos) {
  try {
    return await cuentas.accion(accion, datos);
  } catch (err) {
    if (!err.datos?.confirmar) throw err;
    if (!(await pedirConfirmacion())) return null;
    return cuentas.accion(accion, datos);
  }
}

// ---------- Lista ----------

const fechaHora = (iso) => (iso ? `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : 'nunca');

function pintar() {
  $('#usuTabla').innerHTML = usuarios.map((u) => `
    <tr class="${u.activo ? '' : 'apagado'}">
      <td><strong>${esc(u.usuario)}</strong>${u.usuario === yo.usuario ? ' <span class="tag soft">tú</span>' : ''}${u.nombre ? `<div class="muted small">${esc(u.nombre)}</div>` : ''}</td>
      <td class="small">${resumenPermisos(u)}</td>
      <td>${u.activo ? 'Activo' : '<span class="tag warn">Desactivado</span>'}${u.cambiar_clave ? '<div class="muted small">debe cambiar la contraseña</div>' : ''}</td>
      <td>${u.mfa ? '✅ Sí' : '<span class="muted">No</span>'}</td>
      <td class="small">${fechaHora(u.ultimo_acceso)}</td>
      <td class="num">${u.sesiones}</td>
      <td class="nowrap acciones"><button class="btn small" data-editar="${esc(u.usuario)}">Editar</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No hay usuarios.</td></tr>';
  const sinMfa = usuarios.filter((u) => u.activo && !u.mfa).length;
  $('#usuInfo').textContent = `${usuarios.length} ${usuarios.length === 1 ? 'usuario' : 'usuarios'}`
    + (sinMfa ? ` · ${sinMfa} sin verificación en dos pasos` : ' · todos con verificación en dos pasos');
}

// Antes de abrir un formulario: si hace falta, se pide la contraseña (así no se pierde lo escrito).
async function asegurarConfirmacion() {
  try {
    const r = await cuentas.lista();
    usuarios = r.usuarios; pintar();
    return r.confirmado || pedirConfirmacion();
  } catch (err) { toast(err.message); return false; }
}

async function cargar() {
  try { usuarios = (await cuentas.lista()).usuarios; pintar(); } catch (err) { $('#usuInfo').textContent = err.message; }
}
const actualizar = (r) => { if (r?.usuarios) { usuarios = r.usuarios; pintar(); } };

// ---------- Crear ----------

function mostrarDatosAcceso(usuario, clave) {
  const texto = `Usuario: ${usuario}\nContraseña provisional: ${clave}\nDirección: ${location.origin}${location.pathname}`;
  const dlg = dialogo(`
    <h2>Usuario «${esc(usuario)}» listo</h2>
    <p>Pásale estos datos por un medio seguro (en persona o por teléfono mejor que por email).
      Al entrar por primera vez tendrá que poner su propia contraseña.</p>
    <pre class="secreto">${esc(texto)}</pre>
    <p class="muted small">La contraseña no se vuelve a mostrar.</p>
    <div class="btns actions"><button class="btn ghost" data-copiar>Copiar</button><button class="btn" data-hecho>Hecho</button></div>`, { cerrable: false });
  dlg.onclick = async (e) => {
    if (e.target.closest('[data-copiar]')) { try { await navigator.clipboard.writeText(texto); toast('Copiado'); } catch { toast('No se pudo copiar'); } }
    if (e.target.closest('[data-hecho]')) dlg.close();
  };
}

function campoClave(id) {
  return `<label>Contraseña provisional
      <span class="fila-clave"><input id="${id}" autocomplete="new-password" minlength="${MIN_CLAVE}" required spellcheck="false">
      <button class="btn ghost small" type="button" data-generar="${id}">Generar</button></span></label>`;
}

function nuevoUsuario() {
  const dlg = dialogo(`
    <h2>Nuevo usuario</h2>
    <form id="fNuevo" class="grid g2">
      <label>Usuario (para entrar) <input id="nuUsuario" autocomplete="off" required pattern="[A-Za-z0-9_.@\\-]{2,40}" placeholder="p. ej. maria"></label>
      <label>Nombre (opcional) <input id="nuNombre" autocomplete="off" placeholder="María López"></label>
      ${campoClave('nuClave')}
      ${bloquePermisos('usuario', PLANTILLAS.comercial.permisos)}
      <label class="check s2"><input type="checkbox" id="nuCambiar" checked> Pedirle que ponga su propia contraseña al entrar</label>
      <p id="nuMsg" class="warn hidden s2"></p>
      <div class="btns actions s2"><button class="btn" type="submit">Crear usuario</button><button class="btn ghost" type="button" data-cancelar>Cancelar</button></div>
    </form>`);
  $('#nuClave').value = generarClave();
  prepararPermisos($('#fNuevo'));
  $('#nuUsuario').focus();
  dlg.onclick = (e) => {
    if (e.target.closest('[data-cancelar]')) dlg.close();
    const g = e.target.closest('[data-generar]');
    if (g) $('#' + g.dataset.generar).value = generarClave();
  };
  $('#fNuevo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('#nuUsuario').value.trim();
    const clave = $('#nuClave').value;
    try {
      const r = await hacer('crear', { usuario, nombre: $('#nuNombre').value.trim(), ...leerPermisos($('#fNuevo')), clave, cambiarAlEntrar: $('#nuCambiar').checked });
      if (!r) return;
      actualizar(r);
      mostrarDatosAcceso(usuario, clave);
    } catch (err) { if ($('#nuMsg')) errorEn($('#nuMsg'), err.message); else toast(err.message); }
  });
}

// ---------- Editar ----------

function editar(nombreUsuario) {
  const u = usuarios.find((x) => x.usuario === nombreUsuario);
  if (!u) return;
  const soyYo = u.usuario === yo.usuario;
  const dlg = dialogo(`
    <h2>Usuario «${esc(u.usuario)}»${soyYo ? ' (tú)' : ''}</h2>
    <p class="muted small">Creado el ${fmtDate(String(u.creado).slice(0, 10))} · último acceso: ${fechaHora(u.ultimo_acceso)} · ${u.sesiones} ${u.sesiones === 1 ? 'sesión abierta' : 'sesiones abiertas'}</p>
    <form id="fEditar" class="grid g2">
      <label>Nombre <input id="edUNombre" value="${esc(u.nombre || '')}" autocomplete="off"></label>
      ${bloquePermisos(u.rol, u.permisos)}
      <label class="check s2" data-ayuda="Un usuario desactivado no puede entrar, pero se conserva por si vuelve. Al desactivarlo se cierran sus sesiones al momento.">
        <input type="checkbox" id="edUActivo" ${u.activo ? 'checked' : ''} ${soyYo ? 'disabled' : ''}> Puede entrar (activo)</label>
      <p id="edUMsg" class="warn hidden s2"></p>
      <div class="btns s2"><button class="btn" type="submit">Guardar cambios</button></div>
    </form>
    <h3>Acceso</h3>
    <div class="btns">
      <button class="btn ghost" data-clave>Poner contraseña nueva</button>
      ${u.mfa ? '<button class="btn ghost" data-mfa>Quitar verificación en dos pasos</button>' : ''}
      ${u.sesiones ? `<button class="btn ghost" data-sesiones>${soyYo ? 'Cerrar mis otras sesiones' : 'Cerrar sus sesiones'}</button>` : ''}
    </div>
    ${soyYo ? '' : '<h3>Zona peligrosa</h3><div class="btns"><button class="btn ghost peligro" data-borrar>Borrar usuario</button></div>'}
    <div class="btns actions"><button class="btn ghost" data-cerrar>Cerrar</button></div>`);
  prepararPermisos($('#fEditar'));
  const tras = (r, msg) => { if (!r) return; actualizar(r); dlg.close(); toast(msg); };
  $('#fEditar').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      tras(await hacer('editar', { usuario: u.usuario, nombre: $('#edUNombre').value.trim(), ...leerPermisos($('#fEditar')), activo: $('#edUActivo').checked }), 'Usuario guardado');
    } catch (err) { if ($('#edUMsg')) errorEn($('#edUMsg'), err.message); else toast(err.message); }
  });
  dlg.onclick = async (e) => {
    try {
      if (e.target.closest('[data-cerrar]')) dlg.close();
      if (e.target.closest('[data-clave]')) ponerClave(u);
      if (e.target.closest('[data-mfa]') && confirm(`¿Quitar la verificación en dos pasos a «${u.usuario}»? Úsalo si ha perdido el móvil. Se cerrarán sus sesiones y la próxima vez entrará solo con la contraseña.`)) {
        tras(await hacer('mfa-quitar', { usuario: u.usuario }), 'Verificación en dos pasos quitada');
      }
      if (e.target.closest('[data-sesiones]')) tras(await hacer('cerrar-sesiones', { usuario: u.usuario }), 'Sesiones cerradas');
      if (e.target.closest('[data-borrar]')
        && confirm(`¿Borrar el usuario «${u.usuario}»? No podrá volver a entrar. Los albaranes y demás datos no se borran.\n\nSi solo quieres impedir que entre por un tiempo, mejor desactívalo.`)) {
        tras(await hacer('borrar', { usuario: u.usuario }), `Usuario «${u.usuario}» borrado`);
      }
    } catch (err) { toast(err.message); }
  };
}

function ponerClave(u) {
  const soyYo = u.usuario === yo.usuario;
  const dlg = dialogo(`
    <h2>Contraseña nueva para «${esc(u.usuario)}»</h2>
    <form id="fPoner" class="grid">
      ${campoClave('pnClave')}
      ${soyYo ? '' : '<label class="check"><input type="checkbox" id="pnCambiar" checked> Pedirle que ponga su propia contraseña al entrar</label>'}
      <p class="muted small">${soyYo ? 'Se cerrarán tus otras sesiones.' : 'Se cerrarán sus sesiones abiertas. La verificación en dos pasos se mantiene.'}</p>
      <p id="pnMsg" class="warn hidden"></p>
      <div class="btns actions"><button class="btn" type="submit">Guardar</button><button class="btn ghost" type="button" data-cancelar>Cancelar</button></div>
    </form>`);
  $('#pnClave').value = generarClave();
  $('#pnClave').select();
  dlg.onclick = (e) => {
    if (e.target.closest('[data-cancelar]')) dlg.close();
    const g = e.target.closest('[data-generar]');
    if (g) $('#' + g.dataset.generar).value = generarClave();
  };
  $('#fPoner').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clave = $('#pnClave').value;
    try {
      const r = await hacer('clave', { usuario: u.usuario, clave, cambiarAlEntrar: soyYo ? false : $('#pnCambiar').checked });
      if (!r) return;
      actualizar(r);
      if (soyYo) { dlg.close(); toast('Tu contraseña se ha cambiado'); } else mostrarDatosAcceso(u.usuario, clave);
    } catch (err) { if ($('#pnMsg')) errorEn($('#pnMsg'), err.message); else toast(err.message); }
  });
}

export function initUsuarios(datosYo) {
  yo = datosYo;
  $('#miClave').addEventListener('click', () => cambiarMiClave());
  const admin = yo.rol === 'admin';
  document.body.classList.toggle('es-admin', admin);
  if (!admin) return;
  $('#usuNuevo').addEventListener('click', async () => { if (await asegurarConfirmacion()) nuevoUsuario(); });
  $('#usuTabla').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-editar]');
    if (b && await asegurarConfirmacion()) editar(b.dataset.editar);
  });
  cargar();
}
