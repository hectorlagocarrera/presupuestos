// Vigilante del arranque (script clásico: se ejecuta antes que los módulos de la aplicación).
// Si la aplicación no llega a arrancar —por ejemplo, porque tras una actualización el navegador mezcla
// archivos nuevos con otros antiguos guardados en su caché—, se avisa y se ofrece recargarla del todo.
(function () {
  var avisado = false;

  // Vuelve a descargar del servidor todos los archivos de la aplicación (sin caché) y recarga.
  function recargarDelTodo() {
    var urls = [location.href.split('#')[0]];
    try {
      performance.getEntriesByType('resource').forEach(function (e) {
        if (e.name.indexOf(location.origin) === 0 && /\.(js|css|png|svg)(\?|$)/.test(e.name)) urls.push(e.name);
      });
    } catch (err) { /* sin lista de recursos: al menos la página */ }
    Promise.all(urls.map(function (u) { return fetch(u, { cache: 'reload', credentials: 'same-origin' }).catch(function () {}); }))
      .then(function () { location.reload(); });
  }

  function avisar(detalle) {
    if (avisado || window.__appLista) return;
    avisado = true;
    var caja = document.createElement('div');
    caja.className = 'aviso-arranque';
    caja.setAttribute('role', 'alert');
    caja.innerHTML = '<strong>La aplicación no ha terminado de cargar.</strong> '
      + 'Suele pasar justo después de una actualización. '
      + '<button type="button" class="btn">Recargar del todo</button>'
      + '<small></small>';
    caja.querySelector('small').textContent = detalle ? ' (' + detalle + ')' : '';
    caja.querySelector('button').addEventListener('click', function () {
      this.disabled = true; this.textContent = 'Recargando…'; recargarDelTodo();
    });
    (document.body || document.documentElement).appendChild(caja);
  }

  window.addEventListener('error', function (e) {
    // Errores al cargar o enlazar los módulos (archivos que no coinciden) antes de que la app esté lista.
    // Una imagen que no carga no importa; un script o una hoja de estilos sí.
    var t = e.target;
    var deArchivo = t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK');
    if (!window.__appLista && (deArchivo || e instanceof ErrorEvent)) avisar(e.message || 'no se pudo cargar un archivo');
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (!window.__appLista && !(e.reason && e.reason.name === 'NoAutorizado')) avisar(e.reason && e.reason.message);
  });
  // Si en 20 segundos no ha arrancado (y no está en la pantalla de entrar), también se avisa.
  setTimeout(function () {
    var login = document.getElementById('login');
    // (Si el código ya ha empezado, puede estar esperando a que se entre o se configure la verificación.)
    if (!window.__appLista && !window.__arrancando && !(login && !login.classList.contains('hidden'))) avisar('tarda demasiado');
  }, 20000);
  window.__recargarDelTodo = recargarDelTodo;
})();
