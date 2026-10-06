// Tema de colores (automático, claro u oscuro). Se carga antes de pintar la página para que no parpadee.
// La elección se guarda en este navegador. window.Tema.poner('oscuro') lo cambia desde otras partes.
(function () {
  var TEMAS = ['auto', 'claro', 'oscuro'];
  var NOMBRES = { auto: 'Tema: automático', claro: 'Tema: claro', oscuro: 'Tema: oscuro' };
  function leer() { try { return localStorage.getItem('tema') || 'auto'; } catch (e) { return 'auto'; } }
  function pintar(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-tema');
    else document.documentElement.setAttribute('data-tema', t);
    var b = document.getElementById('btnTema');
    if (b) b.textContent = NOMBRES[t];
    var botones = document.querySelectorAll('[data-tema]');
    for (var i = 0; i < botones.length; i++) {
      if (botones[i].tagName === 'BUTTON') botones[i].setAttribute('aria-pressed', String(botones[i].getAttribute('data-tema') === t));
    }
  }
  function poner(t) {
    try { localStorage.setItem('tema', t); } catch (e) { /* sin almacenamiento: solo esta vez */ }
    pintar(t);
  }
  window.Tema = { leer: leer, poner: poner };
  pintar(leer());
  document.addEventListener('DOMContentLoaded', function () {
    pintar(leer());
    var b = document.getElementById('btnTema');
    if (b) b.addEventListener('click', function () { poner(TEMAS[(TEMAS.indexOf(leer()) + 1) % TEMAS.length]); });
    var grupo = document.getElementById('menuTemas');
    if (grupo) grupo.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tema]');
      if (t) poner(t.getAttribute('data-tema'));
    });
  });
})();
