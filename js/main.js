// Arranque de la aplicación.
import { $, $$, debounce, numOrNull, today } from './util.js';
import { DEFAULT_SINONIMOS } from './search.js';
import { open, data, saveAjustes, onChange } from './store.js';
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

// Logotipo: se reduce a 600 px y se guarda como imagen dentro de los ajustes.
function pintarLogo() {
  const logo = data.ajustes.logo;
  $('#brandLogo').src = logo || 'icon.svg';
  $('#brandName').textContent = $('[data-aj=nombre]').value || data.ajustes.nombre || 'Presupuestos';
  $('#ajLogoImg').classList.toggle('hidden', !logo);
  if (logo) $('#ajLogoImg').src = logo;
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
  $('[data-aj=nombre]').addEventListener('input', () => { $('#brandName').textContent = $('[data-aj=nombre]').value || 'Presupuestos'; });
  pintarLogo();
}

// Recordatorio de copia de seguridad (los datos solo están en este navegador).
function avisoCopia() {
  const el = $('#aviso');
  const n = data.presupuestos.length;
  const ult = data.ajustes.ultimaCopia;
  const dias = ult ? (new Date(today()) - new Date(ult)) / 86400000 : Infinity;
  const mostrar = n > 0 && dias > 7;
  el.classList.toggle('hidden', !mostrar);
  if (mostrar) el.innerHTML = `${ult ? `Tu última copia de seguridad es del ${ult.split('-').reverse().join('/')}.` : 'Aún no has hecho ninguna copia de seguridad.'} Los datos solo están en este navegador. <a href="#importar">Hacer copia ahora</a>`;
}

async function start() {
  try {
    await open();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:2rem">No se puede abrir la base de datos: ${err.message}. Usa Chrome, Edge o Firefox (no en modo incógnito).</p>`;
    return;
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
