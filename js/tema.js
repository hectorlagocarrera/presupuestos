// Tema de colores (automático, claro u oscuro). Se carga antes de pintar la página para que no parpadee.
// La elección se guarda en este navegador.
(function () {
  var TEMAS = ['auto', 'claro', 'oscuro'];
  var NOMBRES = { auto: 'Tema: automático', claro: 'Tema: claro', oscuro: 'Tema: oscuro' };
  function leer() { try { return localStorage.getItem('tema') || 'auto'; } catch (e) { return 'auto'; } }
  function aplicar(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-tema');
    else document.documentElement.setAttribute('data-tema', t);
    var b = document.getElementById('btnTema');
    if (b) b.textContent = NOMBRES[t];
  }
  aplicar(leer());
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('btnTema');
    if (!b) return;
    aplicar(leer());
    b.addEventListener('click', function () {
      var t = TEMAS[(TEMAS.indexOf(leer()) + 1) % TEMAS.length];
      try { localStorage.setItem('tema', t); } catch (e) { /* sin almacenamiento: solo esta vez */ }
      aplicar(t);
    });
  });
})();
