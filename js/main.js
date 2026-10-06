// Arranque de la aplicación.
import { $, $$, debounce, numOrNull, today } from './util.js';
import { DEFAULT_SINONIMOS } from './search.js';
import { open, data, saveAjustes, onChange, modo, recargar } from './store.js';
import { servidor, navegador, detectarServidor, entrar, NoAutorizado } from './backend.js';
import { refreshDatalists, toast } from './ui/common.js';
import { initEditor } from './ui/editor.js';
import { initBuscador, initArticulos, initPresupuestos, initClientes } from './ui/screens.js';
import { initImportar } from './ui/importar.js';
import { show, current } from './ui/nav.js';

function initAjustes() {
  $$('[data-aj]').forEach((el) => {
    const k = el.dataset.aj;
    el.value = data.ajustes[k] ?? '';
    const guardar = debounce((v) => saveAjustes({ [k]: v }), 300);
    el.addEventListener('input', () => guardar(k === 'iva' ? (numOrNull(el.value) ?? 0) : el.value));
  });
  $('#ajSin').value = data.ajustes.sinonimos || DEFAULT_SINONIMOS;
  $('#ajSinGuardar').addEventListener('click', async () => {
    await saveAjustes({ sinonimos: $('#ajSin').value });
    $('#ajMsg').textContent = 'Guardado. El buscador ya usa los nuevos sinónimos.';
  });
  $('#ajSinReset').addEventListener('click', () => {
    if (confirm('¿Volver a los sinónimos de fábrica? Perderás los que hayas añadido.')) $('#ajSin').value = DEFAULT_SINONIMOS;
  });
}

// Logotipo: el de la empresa (logo.png) o uno propio, reducido a 600 px y guardado en los ajustes.
function pintarLogo() {
  const logo = data.ajustes.logo;
  $('#brandLogo').src = logo || 'logo.png';
  $('#ajLogoImg').src = logo || 'logo.png';
  $('#ajLogoImg').classList.remove('hidden');
  $('#ajLogoQuitar').classList.toggle('hidden', !logo);
}

function initLogo() {
  $('#ajLogo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode();
    const k = Math.min(1, 600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    await saveAjustes({ logo: c.toDataURL('image/png') });
    pintarLogo();
  });
  $('#ajLogoQuitar').addEventListener('click', async () => { await saveAjustes({ logo: '' }); pintarLogo(); });
  pintarLogo();
}

// Recordatorio de copia de seguridad (solo cuando los datos están en este navegador; el servidor hace copias solo).
function avisoCopia() {
  const el = $('#aviso');
  if (modo() === 'servidor') { el.classList.add('hidden'); return; }
  const n = data.presupuestos.length;
  const ult = data.ajustes.ultimaCopia;
  const dias = ult ? (new Date(today()) - new Date(ult)) / 86400000 : Infinity;
  const mostrar = n > 0 && dias > 7;
  el.classList.toggle('hidden', !mostrar);
  if (mostrar) el.innerHTML = `${ult ? `Tu última copia de seguridad es del ${ult.split('-').reverse().join('/')}.` : 'Aún no has hecho ninguna copia de seguridad.'} Los datos solo están en este navegador. <a href="#importar">Hacer copia ahora</a>`;
}

function mostrarLogin(msg) {
  $('#login').classList.remove('hidden');
  if (msg) { $('#loginMsg').textContent = msg; $('#loginMsg').classList.remove('hidden'); }
  $('#loginUsuario').focus();
}

function initLogin() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await entrar($('#loginUsuario').value.trim(), $('#loginClave').value);
      location.reload();
    } catch (err) {
      $('#loginMsg').textContent = err.message;
      $('#loginMsg').classList.remove('hidden');
      $('#loginClave').select();
    }
  });
  // Si la sesión caduca mientras se trabaja, se vuelve a pedir la contraseña.
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof NoAutorizado) { e.preventDefault(); mostrarLogin('La sesión ha caducado. Vuelve a entrar.'); }
  });
}

async function start() {
  initLogin();
  const srv = await detectarServidor();
  if (srv === 'login') { mostrarLogin(); return; }
  try {
    await open(srv === 'si' ? servidor : navegador);
  } catch (err) {
    if (err instanceof NoAutorizado) { mostrarLogin(); return; }
    document.body.innerHTML = `<p style="padding:2rem">No se pueden cargar los datos: ${err.message}.</p>`;
    return;
  }
  if (srv === 'si') {
    const { usuario } = await servidor.usuario();
    $('#sesionUsuario').textContent = usuario;
    $('#sesion').classList.remove('hidden');
    $('#btnSalir').addEventListener('click', async () => { await servidor.salir(); location.reload(); });
    // Al volver a la pestaña, traer lo que hayan guardado otros ordenadores.
    let ultima = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima > 60000) { ultima = Date.now(); recargar().catch(() => {}); }
    });
    document.body.classList.add('modo-servidor');
  }
  initEditor();
  initBuscador();
  initArticulos();
  initPresupuestos();
  initClientes();
  initImportar();
  initAjustes();
  initLogo();
  refreshDatalists();
  avisoCopia();
  onChange(() => { refreshDatalists(); avisoCopia(); });
  window.addEventListener('hashchange', () => show(current()));
  show(current());
  if (!data.partidas.length && current() === 'nuevo') toast('Empieza importando tus presupuestos antiguos en «Importar».');
}

start();
