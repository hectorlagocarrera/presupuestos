// Ayuda en los campos dudosos: un «?» junto al texto. En el ordenador se ve al pasar el ratón;
// en el móvil, al tocarlo. Basta con poner data-ayuda="explicación" en cualquier elemento (también en los
// que se crean después: se añade el «?» solo).

let burbuja = null;
let actual = null;

function crearBurbuja() {
  burbuja = document.createElement('div');
  burbuja.className = 'burbuja';
  burbuja.setAttribute('role', 'tooltip');
  burbuja.id = 'burbujaAyuda';
  burbuja.hidden = true;
  document.body.appendChild(burbuja);
}

function mostrar(btn) {
  actual = btn;
  burbuja.textContent = btn.dataset.texto;
  burbuja.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Debajo del «?» (o encima si no cabe), sin salirse de la pantalla.
  const r = btn.getBoundingClientRect();
  const ancho = Math.min(300, window.innerWidth - 24);
  burbuja.style.width = ancho + 'px';
  let left = r.left + r.width / 2 - ancho / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - ancho - 12));
  burbuja.style.left = left + 'px';
  const alto = burbuja.offsetHeight;
  const abajo = r.bottom + 8 + alto < window.innerHeight;
  burbuja.style.top = (abajo ? r.bottom + 8 : r.top - alto - 8) + 'px';
  burbuja.classList.toggle('arriba', !abajo);
}

function ocultar() {
  if (!burbuja || burbuja.hidden) return;
  burbuja.hidden = true;
  actual?.setAttribute('aria-expanded', 'false');
  actual = null;
}

function decorar(el) {
  if (el.dataset.ayudaPuesta) return;
  el.dataset.ayudaPuesta = '1';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ayuda';
  btn.textContent = '?';
  btn.dataset.texto = el.dataset.ayuda;
  btn.setAttribute('aria-label', 'Ayuda: ' + el.dataset.ayuda);
  btn.setAttribute('aria-describedby', 'burbujaAyuda');
  btn.setAttribute('aria-expanded', 'false');
  // Justo después del primer texto del elemento (la etiqueta), o al final.
  const texto = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  if (texto && !el.matches('[data-ayuda-fin]')) {
    if (el.tagName === 'LABEL') {
      // En las etiquetas en columna, el texto y el «?» van juntos en una línea.
      const fila = document.createElement('span');
      fila.className = 'etq';
      texto.replaceWith(fila);
      fila.append(texto.textContent.trim(), btn);
    } else texto.after(btn);
  } else el.appendChild(btn);
}

export function initAyuda() {
  crearBurbuja();
  const todo = (raiz) => raiz.querySelectorAll?.('[data-ayuda]').forEach(decorar);
  todo(document);
  new MutationObserver((cambios) => {
    for (const c of cambios) for (const n of c.addedNodes) if (n.nodeType === 1) { if (n.matches('[data-ayuda]')) decorar(n); todo(n); }
  }).observe(document.body, { childList: true, subtree: true });

  const pasaRaton = window.matchMedia('(hover: hover)').matches;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ayuda');
    if (btn) {
      e.preventDefault(); // dentro de una etiqueta, no activar el campo
      e.stopPropagation();
      if (actual === btn && !pasaRaton) ocultar(); else mostrar(btn);
      return;
    }
    if (!e.target.closest('.burbuja')) ocultar();
  }, true);
  if (pasaRaton) {
    document.addEventListener('mouseover', (e) => { const b = e.target.closest('.ayuda'); if (b && b !== actual) mostrar(b); });
    document.addEventListener('mouseout', (e) => { if (e.target.closest('.ayuda') && !e.relatedTarget?.closest?.('.ayuda')) ocultar(); });
  }
  // Con el teclado (tabulador) también se ve; al tocar o pulsar ya se encarga el clic.
  document.addEventListener('focusin', (e) => { if (e.target.matches('.ayuda:focus-visible')) mostrar(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target.matches('.ayuda')) ocultar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ocultar(); });
  window.addEventListener('scroll', ocultar, { passive: true, capture: true });
  window.addEventListener('resize', ocultar);
}
