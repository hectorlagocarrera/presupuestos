// Vista rápida de un documento (sin salir de la pantalla actual) y su original (solo sus páginas si el PDF trae muchos).
import { $, esc, fmtEur, fmtNum, fmtDate, TIPOS, tipoDe } from '../util.js';
import { data, getPresupuesto, partidasDe, getArchivo, guardarPaginas } from '../store.js';
import { abrirPdf, pdfToPages, dibujarPagina } from '../pdf.js';
import { looksLikeColumns, columnsToBudgets } from '../columnas.js';
import { imprimirHtml, imprimir } from './print.js';
import { firmable, panelFirma, descargarPdfDoc } from './firmas.js';
import { medidasTxt, toast } from './common.js';
import { go } from './nav.js';
import { editor } from './editor.js';

// Archivo original tal cual (PDF en otra pestaña; el resto se descarga).
async function abrirArchivoEntero(archivoId) {
  const a = await getArchivo(archivoId);
  if (!a) { toast('No se guardó el archivo original.'); return; }
  const url = URL.createObjectURL(a.blob);
  // Los PDF se abren en otra pestaña; el resto se descarga.
  if (/pdf/.test(a.tipo)) window.open(url, '_blank', 'noopener');
  else {
    const link = document.createElement('a');
    link.href = url; link.download = a.nombre; link.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Páginas del PDF de cada documento, buscadas una vez por archivo (archivoId → { presupuestoId: '12-13' }).
const paginasPorArchivo = new Map();

async function localizarPaginas(p, buf, progreso) {
  if (paginasPorArchivo.has(p.archivoId)) return paginasPorArchivo.get(p.archivoId)[p.id];
  const pages = await pdfToPages(buf, progreso);
  const asignacion = {};
  if (looksLikeColumns(pages)) {
    const leidos = columnsToBudgets(pages).filter((b) => b.numero);
    const clave = (tipo, numero, fecha) => `${tipo}|${String(numero || '').trim().toLowerCase()}|${fecha || ''}`;
    const porClave = new Map(leidos.map((b) => [clave(tipoDe(b), b.numero, b.fecha), b.paginas]));
    const porNumero = new Map(leidos.map((b) => [clave(tipoDe(b), b.numero, ''), b.paginas]));
    for (const d of data.presupuestos.filter((x) => x.archivoId === p.archivoId && x.numero)) {
      const pag = porClave.get(clave(tipoDe(d), d.numero, d.fecha)) || porNumero.get(clave(tipoDe(d), d.numero, ''));
      if (pag) asignacion[d.id] = pag;
    }
  }
  paginasPorArchivo.set(p.archivoId, asignacion);
  guardarPaginas(asignacion); // la próxima vez (y en los demás ordenadores) se abre al momento
  return asignacion[p.id];
}

const rango = (txt, total) => {
  const m = String(txt || '').match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const desde = +m[1]; const hasta = Math.min(+(m[2] || m[1]), total);
  return desde >= 1 && desde <= hasta ? { desde, hasta } : null;
};

// «Original» de un documento: si el PDF trae muchos documentos (un año entero), solo las páginas de este.
export async function abrirOriginal(presupuestoId) {
  const p = getPresupuesto(presupuestoId);
  if (!p?.archivoId) return;
  const compartido = data.presupuestos.some((x) => x.id !== p.id && x.archivoId === p.archivoId);
  if (!compartido || !/\.pdf$/i.test(p.archivoNombre || '')) { abrirArchivoEntero(p.archivoId); return; }

  const t = TIPOS[tipoDe(p)];
  const dlg = $('#modal');
  $('#modalBody').innerHTML = `
    <div class="pane-head"><h2>${t.nombre} ${esc(p.numero || '')} · original</h2>
      <div class="btns"><button class="btn" data-imprimir disabled>Imprimir / PDF</button>
        <button class="btn ghost" data-entero title="Todo el archivo «${esc(p.archivoNombre)}»">Abrir el PDF completo</button>
        <button class="btn ghost" data-cerrar>Cerrar</button></div></div>
    <p class="muted small visor-estado" id="visorEstado">Abriendo «${esc(p.archivoNombre)}»…</p>
    <div class="visor-paginas" id="visorPaginas"></div>`;
  let cancelado = false;
  dlg.classList.add('visor');
  dlg.addEventListener('close', () => { cancelado = true; dlg.classList.remove('visor'); }, { once: true });
  if (!dlg.open) dlg.showModal();
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-cerrar]')) dlg.close();
    if (e.target.closest('[data-entero]')) abrirArchivoEntero(p.archivoId);
    if (e.target.closest('[data-imprimir]')) {
      const imgs = [...$('#visorPaginas').querySelectorAll('canvas')].map((c) => `<img src="${c.toDataURL('image/png')}" alt="">`).join('');
      imprimirHtml(imgs, `${t.nombre} ${p.numero || ''} ${p.clienteNombre || ''}`.trim(), { sinMargen: true });
    }
  };
  const estado = (txt) => { if (!cancelado) $('#visorEstado').textContent = txt; };
  try {
    const a = await getArchivo(p.archivoId);
    if (!a) { estado('No se guardó el archivo original.'); return; }
    const buf = await a.blob.arrayBuffer();
    // pdf.js se queda con el ArrayBuffer que recibe: cada lectura usa su propia copia.
    const pag = p.paginas || await localizarPaginas(p, buf.slice(0), (txt) => estado(`Buscando este documento dentro de «${p.archivoNombre}» (solo la primera vez)… ${txt}`));
    if (cancelado) return;
    const doc = await abrirPdf(buf.slice(0));
    const r = rango(pag, doc.numPages);
    if (!r) { estado('No se ha encontrado este documento dentro del PDF. Puedes abrir el PDF completo.'); await doc.destroy(); return; }
    estado(`${r.desde === r.hasta ? `Página ${r.desde}` : `Páginas ${r.desde} a ${r.hasta}`} de ${doc.numPages} de «${p.archivoNombre}».`);
    for (let n = r.desde; n <= r.hasta && !cancelado; n++) $('#visorPaginas').append(await dibujarPagina(doc, n));
    await doc.destroy();
    if (!cancelado) $('[data-imprimir]', dlg).disabled = false;
  } catch (err) {
    estado('No se pudo abrir el original: ' + err.message);
  }
}

export function verPresupuesto(id) {
  const p = getPresupuesto(id);
  if (!p) return;
  const partidas = partidasDe(id);
  const dlg = $('#modal');
  $('#modalBody').innerHTML = `
    <div class="pane-head"><h2>${TIPOS[tipoDe(p)].nombre} ${esc(p.numero || '')}</h2><button class="btn ghost small" data-cerrar>Cerrar</button></div>
    <p>${fmtDate(p.fecha)} · <strong>${esc(p.clienteNombre || 'sin cliente')}</strong>${p.archivoNombre ? ` · original: ${esc(p.archivoNombre)}` : ''}</p>
    <div class="table-wrap"><table class="data cards">
      <thead><tr><th>Artículo</th><th>Medidas</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
      <tbody>${partidas.map((l) => `<tr><td data-l="Artículo"><strong>${esc(l.articulo)}</strong>${l.descripcion ? `<div class="muted small">${esc(l.descripcion)}</div>` : ''}</td>
        <td data-l="Medidas">${medidasTxt(l)}</td><td class="num" data-l="Cant.">${fmtNum(l.cantidad)}</td><td class="num" data-l="Precio">${l.precioUnitario != null ? fmtEur(l.precioUnitario) : ''}</td><td class="num" data-l="Total">${l.precioTotal != null ? fmtEur(l.precioTotal) : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    ${p.total != null ? `<p class="right-text">Base ${fmtEur(p.base)} · <strong>Total ${fmtEur(p.total)}</strong> (IVA ${fmtNum(p.iva)} %)</p>` : ''}
    <div id="pvFirma"></div>
    <div class="btns actions">
      ${p.archivoId ? '<button class="btn ghost" data-orig>Ver original</button>' : ''}
      <button class="btn ghost" data-imprimir>Imprimir</button>
      <button class="btn ghost" data-pdf>Descargar PDF</button>
      <button class="btn ghost" data-dup>Duplicar como nuevo</button>
      ${p.estadoFirma === 'firmado' ? '' : '<button class="btn" data-edit>Abrir para editar</button>'}
    </div>`;
  dlg.className = '';
  if (!dlg.open) dlg.showModal();
  if (firmable(p)) panelFirma(id, $('#pvFirma'));
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-cerrar]')) dlg.close();
    if (e.target.closest('[data-imprimir]')) imprimir(p, partidas);
    if (e.target.closest('[data-pdf]')) descargarPdfDoc(p.id);
    if (e.target.closest('[data-orig]')) abrirOriginal(p.id);
    if (e.target.closest('[data-edit]')) { dlg.close(); if (editor.abrir(id)) go('nuevo'); }
    if (e.target.closest('[data-dup]')) { dlg.close(); if (editor.duplicar(id)) go('nuevo'); }
  };
}
