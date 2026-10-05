// Navegación entre pantallas por #hash.
const handlers = {};
export const onShow = (tab, fn) => { handlers[tab] = fn; };
export function go(tab) {
  if (location.hash === '#' + tab) show(tab); else location.hash = tab;
}
export function current() { return (location.hash || '#nuevo').slice(1); }
export function show(tab) {
  if (!document.getElementById('s-' + tab)) tab = 'nuevo';
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== 's-' + tab));
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  handlers[tab]?.();
}
