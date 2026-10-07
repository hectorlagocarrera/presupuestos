// Arranque de la aplicación.
import { $, $$, debounce, numOrNull, today } from './util.js';
import { DEFAULT_SINONIMOS } from './search.js';
import { open, data, saveAjustes, onChange, modo, recargar } from './store.js';
import { servidor, navegador, detectarServidor, entrar, entrarMfa, NoAutorizado } from './backend.js';
import { initSeguridad, configurarMfa } from './ui/seguridad.js';
import { initUsuarios, cambiarMiClave } from './ui/usuarios.js';
import { refreshDatalists, toast, etiquetarTablas } from './ui/common.js';
import { initEditor } from './ui/editor.js';
import { initBuscador, initArticulos, initPresupuestos, initClientes, initFacturas } from './ui/screens.js';
import { initImportar } from './ui/importar.js';
import { initTarifa } from './ui/tarifa.js';
import { show, current, initMenu } from './ui/nav.js';
import { initAyuda } from './ui/ayuda.js';

// Ir a un apartado de Ajustes (y resaltarlo un momento).
function irAjuste(id) {
  show('ajustes');
  if (location.hash !== '#ajustes') history.pushState(null, '', '#ajustes');
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('resaltar');
  setTimeout(() => el.classList.remove('resaltar'), 1500);
}

function initAjustes() {
  $('#ajIndice').addEventListener('click', (e) => { const b = e.target.closest('[data-ir]'); if (b) irAjuste(b.dataset.ir); });
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
  let reto = null;
  const paso = (n) => {
    $('#loginPaso1').classList.toggle('hidden', n !== 1);
    $('#loginPaso2').classList.toggle('hidden', n !== 2);
    $('#loginVolver').classList.toggle('hidden', n !== 2);
    $('#loginBtn').textContent = n === 2 ? 'Verificar' : 'Entrar';
    $('#loginUsuario').required = n === 1;
    $('#loginClave').required = n === 1;
    (n === 2 ? $('#loginCodigo') : $('#loginClave')).focus();
  };
  const error = (msg) => { $('#loginMsg').textContent = msg; $('#loginMsg').classList.toggle('hidden', !msg); };
  $('#loginVolver').addEventListener('click', () => { reto = null; error(''); paso(1); });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (reto) {
        const r = await entrarMfa(reto, $('#loginCodigo').value.trim());
        if (r.recuperacionRestantes != null) alert(`Has usado un código de recuperación. Te quedan ${r.recuperacionRestantes}. Cuando puedas, genera códigos nuevos en Ajustes → Seguridad.`);
        location.reload();
        return;
      }
      const r = await entrar($('#loginUsuario').value.trim(), $('#loginClave').value);
      if (r.mfa) { reto = r.reto; error(''); $('#loginCodigo').value = ''; paso(2); return; }
      location.reload();
    } catch (err) {
      error(err.message);
      if (err.datos?.reiniciar) { reto = null; paso(1); $('#loginClave').value = ''; }
      (reto ? $('#loginCodigo') : $('#loginClave')).select();
    }
  });
  // Si la sesión caduca mientras se trabaja, se vuelve a pedir la contraseña.
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof NoAutorizado) { e.preventDefault(); mostrarLogin('La sesión ha caducado. Vuelve a entrar.'); }
  });
}

// Arranca una parte de la aplicación sin que un fallo en ella deje sin funcionar todo lo demás.
function parte(nombre, fn) {
  try { fn(); } catch (err) {
    console.error(`Error al preparar «${nombre}»`, err);
    toast(`Algo ha fallado en «${nombre}». Si se repite, pulsa Ctrl+F5.`);
  }
}

async function start() {
  window.__arrancando = true; // los módulos se han cargado bien (el vigilante de arranque.js ya no espera)
  initLogin();
  initMenu();
  initAyuda();
  // La navegación entre pestañas, lo primero: funciona aunque luego falle otra parte.
  window.addEventListener('hashchange', () => show(current()));
  const srv = await detectarServidor();
  if (srv === 'login') { mostrarLogin(); return; }
  let yo = null;
  if (srv === 'si') {
    yo = await servidor.usuario();
    // Verificación en dos pasos obligatoria y aún sin configurar: primero hay que configurarla.
    if (yo.mfaObligatorio && !yo.mfa) { configurarMfa({ obligatoria: true, alTerminar: () => location.reload() }); return; }
    // Contraseña provisional puesta por un administrador: primero hay que cambiarla.
    if (yo.cambiarClave) { await cambiarMiClave({ obligatoria: true }); location.reload(); return; }
  }
  try {
    await open(srv === 'si' ? servidor : navegador);
  } catch (err) {
    if (err instanceof NoAutorizado) { mostrarLogin(); return; }
    document.body.innerHTML = `<p style="padding:2rem">No se pueden cargar los datos: ${err.message}.</p>`;
    return;
  }
  if (srv === 'si') {
    $('#sesionUsuario').textContent = yo.usuario;
    parte('Seguridad', () => initSeguridad(yo));
    parte('Usuarios', () => initUsuarios(yo));
    $('#miUsuario').textContent = yo.nombre ? `${yo.usuario} (${yo.nombre})` : yo.usuario;
    $('#miRol').textContent = yo.rol === 'admin' ? ' · administrador' : '';
    $('#sesion').classList.remove('hidden');
    const salir = async () => { await servidor.salir(); location.reload(); };
    $('#btnSalir').addEventListener('click', salir);
    $('#menuSalir').addEventListener('click', salir);
    $('#menuUsuario').textContent = 'Usuario: ' + yo.usuario;
    // El nombre de usuario lleva a la gestión de usuarios (administradores) o a «Mi cuenta».
    for (const id of ['#sesionUsuario', '#menuUsuario']) $(id).addEventListener('click', () => irAjuste(yo.rol === 'admin' ? 'usuarios' : 'miCuenta'));
    $('#menuSesion').classList.remove('hidden');
    // Al volver a la pestaña, traer lo que hayan guardado otros ordenadores.
    let ultima = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima > 60000) { ultima = Date.now(); recargar().catch(() => {}); }
    });
    document.body.classList.add('modo-servidor');
  } else document.body.classList.add('modo-navegador');
  parte('Nuevo albarán', initEditor);
  parte('Buscador histórico', initBuscador);
  parte('Artículos', initArticulos);
  parte('Albaranes', initPresupuestos);
  parte('Facturas', initFacturas);
  parte('Clientes', initClientes);
  parte('Importar', initImportar);
  parte('Tarifa', initTarifa);
  parte('Ajustes', initAjustes);
  parte('Logotipo', initLogo);
  parte('Listas', () => { refreshDatalists(); etiquetarTablas(); avisoCopia(); });
  onChange(() => { refreshDatalists(); avisoCopia(); });
  window.__appLista = true;
  document.querySelector('.aviso-arranque')?.remove();
  show(current());
  if (!data.partidas.length && current() === 'nuevo') toast('Empieza importando tus presupuestos, albaranes o facturas en «Importar».');
}

start();
