// PDF con pdf.js (en este ordenador): leer el texto con su posición y dibujar páginas.
import { itemsToRows } from './columnas.js';
import { loadScript } from './ui/common.js';

export async function abrirPdf(buf) {
  await loadScript('vendor/pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return lib.getDocument({ data: buf, isEvalSupported: false }).promise;
}

// PDF → páginas con filas y celdas (posición de cada texto).
export async function pdfToPages(buf, progreso) {
  const doc = await abrirPdf(buf);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push({ rows: itemsToRows((await page.getTextContent()).items) });
    page.cleanup();
    if (n % 20 === 0 || n === doc.numPages) progreso?.(`página ${n} de ${doc.numPages}`);
  }
  await doc.destroy();
  return pages;
}

// Dibuja una página en un canvas (ancho en píxeles de pantalla; se dibuja con más detalle para imprimir bien).
export async function dibujarPagina(doc, n, ancho = 900) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const escala = (ancho / base.width) * Math.min(2, window.devicePixelRatio || 1) * 1.25;
  const vp = page.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  page.cleanup();
  return canvas;
}
