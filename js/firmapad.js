// Recuadro para firmar con el dedo, el lápiz o el ratón. Sin dependencias (también lo usa la página pública).
//   const pad = crearPadFirma(canvas); pad.vacio(); pad.borrar(); pad.png()
export function crearPadFirma(canvas, { color = '#10204a' } = {}) {
  const ctx = canvas.getContext('2d');
  let trazos = [];
  let actual = null;

  // El dibujo se guarda en coordenadas del recuadro (0..1) para redibujarlo si cambia de tamaño (girar el móvil).
  const ajustar = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    redibujar();
  };
  const grosor = () => Math.max(1.6, canvas.width / 260);
  function redibujar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = grosor();
    for (const t of trazos) dibujar(t);
  }
  function dibujar(t) {
    const p = t.map(([x, y]) => [x * canvas.width, y * canvas.height]);
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
    // Curvas suaves entre puntos (punto medio como control).
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    ctx.stroke();
  }
  const punto = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  canvas.style.touchAction = 'none'; // que el dedo dibuje en vez de mover la página
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); actual = [punto(e)]; trazos.push(actual); redibujar(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!actual) return;
    for (const ev of e.getCoalescedEvents?.() || [e]) actual.push(punto(ev));
    redibujar();
  });
  const fin = () => { actual = null; canvas.dispatchEvent(new Event('firma')); };
  canvas.addEventListener('pointerup', fin);
  canvas.addEventListener('pointercancel', fin);
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  // Longitud total del trazo (en proporción del recuadro): un punto o una raya mínima no es una firma.
  const longitud = () => trazos.reduce((s, t) => s + t.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - t[i][0], (p[1] - t[i][1]) * 0.4), 0), 0);
  return {
    vacio: () => longitud() < 0.25,
    borrar: () => { trazos = []; redibujar(); canvas.dispatchEvent(new Event('firma')); },
    // JPEG con fondo blanco (para el PDF).
    jpeg() {
      const img = new Image();
      const png = this.png();
      return new Promise((resolve) => {
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', 0.9));
        };
        img.src = png;
      });
    },
    // PNG con fondo transparente, recortado a la firma, de 600 px de ancho como mucho.
    png() {
      const xs = trazos.flat().map((p) => p[0] * canvas.width); const ys = trazos.flat().map((p) => p[1] * canvas.height);
      const m = grosor() * 2;
      const x0 = Math.max(0, Math.min(...xs) - m); const y0 = Math.max(0, Math.min(...ys) - m);
      const w = Math.min(canvas.width, Math.max(...xs) + m) - x0; const h = Math.min(canvas.height, Math.max(...ys) + m) - y0;
      const escala = Math.min(1, 600 / w);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(w * escala)); out.height = Math.max(1, Math.round(h * escala));
      out.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}
