// Navegación entre pantallas por #hash, con el menú desplegable del móvil.
const handlers = {};
export const onShow = (tab, fn) => { handlers[tab] = fn; };
export function go(tab) {
  // Al momento (sin esperar al evento hashchange), para que lo que venga después ya vea la pantalla.
  if (location.hash !== '#' + tab) history.pushState(null, '', '#' + tab);
  show(tab);
}
export function current() { return (location.hash || '#nuevo').slice(1); }

const menu = () => document.getElementById('menuMovil');
export function cerrarMenu() {
  const m = menu();
  if (!m || m.hidden) return;
  m.hidden = true;
  document.body.classList.remove('menu-abierto');
  document.getElementById('btnMenu').setAttribute('aria-expanded', 'false');
}
function abrirMenu() {
  menu().hidden = false;
  document.body.classList.add('menu-abierto');
  document.getElementById('btnMenu').setAttribute('aria-expanded', 'true');
  menu().querySelector('a.active, a')?.focus();
}

export function show(tab) {
  if (!document.getElementById('s-' + tab)) tab = 'nuevo';
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== 's-' + tab));
  let nombre = '';
  document.querySelectorAll('a[data-tab]').forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('active', on);
    if (on) { a.setAttribute('aria-current', 'page'); nombre = a.textContent; } else a.removeAttribute('aria-current');
  });
  const sm = document.getElementById('seccionMovil');
  if (sm) sm.textContent = nombre;
  cerrarMenu();
  window.scrollTo(0, 0);
  handlers[tab]?.();
}

// Copia las pestañas en el menú del móvil y lo hace funcionar.
export function initMenu() {
  const destino = document.getElementById('menuNav');
  destino.innerHTML = document.querySelector('.tabs').innerHTML;
  document.getElementById('btnMenu').addEventListener('click', () => (menu().hidden ? abrirMenu() : cerrarMenu()));
  menu().addEventListener('click', (e) => {
    if (e.target === menu()) cerrarMenu();                       // fuera del panel
    if (e.target.closest('a[data-tab]')) setTimeout(cerrarMenu); // al elegir una sección
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenu(); });
  // Altura real de la cabecera (el menú se abre justo debajo).
  const medir = () => document.documentElement.style.setProperty('--alto-cabecera', document.querySelector('.top').offsetHeight + 'px');
  medir();
  window.addEventListener('resize', medir);
  // El logo siempre lleva al inicio, aunque ya se esté en esa pantalla.
  document.querySelector('.brand').addEventListener('click', (e) => { e.preventDefault(); go('nuevo'); });
}
