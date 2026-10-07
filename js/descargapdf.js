// Descargar el PDF de un documento desde el navegador (lo usan la aplicación y la página pública de firma).
import { crearPdf } from './pdfdoc.js';

// Cualquier imagen (URL, data URL o Blob) → JPEG con fondo blanco (bytes), para el PDF.
export async function aJpeg(fuente, maxAncho = 900) {
  const url = fuente instanceof Blob ? URL.createObjectURL(fuente) : fuente;
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const escala = Math.min(1, maxAncho / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * escala)); c.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const datos = c.toDataURL('image/jpeg', 0.9);
    return { datos, bytes: Uint8Array.from(atob(datos.split(',')[1]), (ch) => ch.charCodeAt(0)) };
  } catch { return null; } finally { if (fuente instanceof Blob) URL.revokeObjectURL(url); }
}

export function guardarArchivo(bytes, nombre) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const nombrePdf = (doc, firmado) => `${({ albaran: 'albaran', presupuesto: 'presupuesto', factura: 'factura' })[doc.tipo] || 'documento'}-${String(doc.numero || 'sin-numero').replace(/[^\w.-]+/g, '_')}${firmado ? '-firmado' : ''}.pdf`;

// datos: lo mismo que crearPdf, pero con imágenes como URL/Blob (logo, firma).
export async function descargarPdf({ logo, imagenFirma, ...datos }) {
  const imagenes = {};
  if (logo) { const j = await aJpeg(logo, 600); if (j) imagenes.logo = j.bytes; }
  if (imagenFirma) { const j = await aJpeg(imagenFirma, 600); if (j) imagenes.firma = j.bytes; }
  const bytes = crearPdf({ ...datos, imagenes });
  guardarArchivo(bytes, nombrePdf(datos.doc, datos.firma?.estado === 'firmado'));
}
