// Importación del histórico (PDF, Excel, ODS, CSV, texto) con revisión manual, y copias de seguridad.
import { $, esc, fmtEur, fmtNum, numOrNull, today, calcPartida, round, tipoDe, TIPOS } from '../util.js';
import { textToBudget, rowsToBudgets } from '../parse.js';
import { rowsToLines, looksLikeColumns, columnsToBudgets } from '../columnas.js';
import { esTarifaPdf, leerTarifaPdf, esTarifaFilas, leerTarifaFilas } from '../catalogo.js';
import { classify } from '../search.js';
import { data, savePresupuesto, buscarDuplicado, exportar, importar, notify, saveAjustes, enBloque, recargar, getArchivo, sustituirDeArchivo, onChange, guardarCatalogo } from '../store.js';
import { toast, loadScript } from './common.js';
import { pdfToPages } from '../pdf.js';
import { onShow, go } from './nav.js';

// ---------- Lectura de archivos (todo en este ordenador) ----------

// Archivo → [{ b (presupuesto detectado), texto, archivo }]
async function leerArchivo(file, progreso) {
  const ext = file.name.split('.').pop().toLowerCase();
  const archivo = { nombre: file.name, tipo: file.type || ext, blob: file };
  if (ext === 'pdf') {
    const pages = await pdfToPages(await file.arrayBuffer(), (t) => progreso?.(`${file.name}: ${t}`));
    const vacio = !pages.some((p) => p.rows.length);
    // Tarifa de artículos (Código · Descripción · Precio · Unidad): va a la tarifa oficial, no al histórico.
    if (esTarifaPdf(pages)) return [{ tarifa: leerTarifaPdf(pages), archivo }];
    if (looksLikeColumns(pages)) {
      // Formato con columnas Cantidad/Artículo/Precio/Subtotal (puede traer muchos presupuestos).
      return columnsToBudgets(pages, file.name).map((b) => ({ b, texto: '', archivo }));
    }
    const lines = pages.flatMap((p) => rowsToLines(p.rows));
    return [{ b: textToBudget(lines), texto: lines.join('\n'), archivo, aviso: vacio ? 'El PDF no tiene texto (probablemente es un escaneo). Añade las partidas a mano.' : '' }];
  }
  if (['xlsx', 'xls', 'xlsm', 'ods', 'csv'].includes(ext)) {
    await loadScript('vendor/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const out = [];
    for (const name of wb.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      if (esTarifaFilas(rows)) { out.push({ tarifa: leerTarifaFilas(rows), archivo }); continue; }
      const bs = rowsToBudgets(rows, file.name);
      const texto = rows.slice(0, 200).map((r) => r.join(' | ')).join('\n');
      for (const b of bs) out.push({ b, texto, archivo, hoja: wb.SheetNames.length > 1 ? name : '' });
    }
    return out.length ? out : [{ b: { numero: '', fecha: '', cliente: '', partidas: [] }, texto: '', archivo, aviso: 'No se encontraron partidas en el Excel.' }];
  }
  const text = await file.text();
  return [{ b: textToBudget(text.split(/\r?\n/)), texto: text, archivo }];
}

// ---------- Tarifa oficial (PDF o Excel de tarifas) ----------

function revisarTarifa({ tarifa, archivo }) {
  return new Promise((resolve) => {
    if (!tarifa.length) { toast(`${archivo.nombre}: no se encontraron artículos en la tarifa.`); resolve(); return; }
    const secciones = [...new Set(tarifa.map((a) => a.seccion || 'Sin sección'))];
    const cuenta = (f) => tarifa.filter(f).length;
    const actuales = data.catalogo.length;
    const nuevosCod = tarifa.filter((a) => !data.catalogo.some((c) => c.id === a.id)).length;
    const dlg = $('#modal');
    $('#modalBody').innerHTML = `
      <div class="pane-head"><h2>Tarifa de artículos · ${esc(archivo.nombre)}</h2><button class="btn ghost small" data-cerrar>Cerrar</button></div>
      <p>Se han leído <strong>${tarifa.length} artículos</strong> en ${secciones.length} secciones. Se guardan como <strong>tarifa oficial</strong>
        (aparte del histórico de presupuestos y facturas): la verás en <em>Tarifa</em> y te los propondrá al hacer un albarán.</p>
      <ul class="small">
        <li>${cuenta((a) => a.porM2)} por m² · ${cuenta((a) => !a.porM2 && a.precio != null)} por unidad, lote o servicio</li>
        ${cuenta((a) => a.tipo.startsWith('suplemento') || a.tipo.startsWith('ajuste')) ? `<li>${cuenta((a) => a.tipo.startsWith('suplemento') || a.tipo.startsWith('ajuste'))} suplementos o descuentos (+ / −)</li>` : ''}
        ${cuenta((a) => a.precio == null) ? `<li class="warn-txt">${cuenta((a) => a.precio == null)} sin precio («Consultar»)</li>` : ''}
        ${cuenta((a) => a.tipo.endsWith('+iva')) ? `<li>${cuenta((a) => a.tipo.endsWith('+iva'))} con «+ IVA» en el precio</li>` : ''}
        ${cuenta((a) => /revis/i.test(a.observaciones)) ? `<li class="warn-txt">${cuenta((a) => /revis/i.test(a.observaciones))} con observaciones de «revisar»</li>` : ''}
      </ul>
      <div class="table-wrap visor-tarifa"><table class="data cards">
        <thead><tr><th>Sección</th><th>Código</th><th>Descripción</th><th class="num">Precio</th><th>Unidad</th><th>Observaciones</th></tr></thead>
        <tbody>${tarifa.map((a) => `<tr><td data-l="Sección" class="small">${esc(a.seccion)}</td><td data-l="Código" class="small mono">${esc(a.codigo)}</td><td data-l="Descripción">${esc(a.descripcion)}</td>
          <td data-l="Precio" class="num nowrap">${a.precio == null ? '<span class="tag warn">Consultar</span>' : esc(a.precioTexto)}</td><td data-l="Unidad" class="small">${esc(a.unidad)}</td><td data-l="Observaciones" class="small muted">${esc(a.observaciones)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${actuales ? `<fieldset class="permisos"><legend>Ya hay una tarifa oficial con ${actuales} artículos</legend>
        <label class="check"><input type="radio" name="tModo" value="sustituir" checked> Sustituirla por esta (se quitan los artículos que no estén en este archivo)</label>
        <label class="check"><input type="radio" name="tModo" value="anadir"> Añadir y actualizar por código (${nuevosCod} nuevos, ${tarifa.length - nuevosCod} actualizados; el resto se queda)</label>
      </fieldset>` : ''}
      <p id="tImpMsg" class="warn hidden"></p>
      <div class="btns actions"><button class="btn" data-guardar>Guardar tarifa oficial</button><button class="btn ghost" data-cerrar>Cancelar</button></div>`;
    dlg.className = 'visor';
    if (!dlg.open) dlg.showModal();
    const fin = () => { dlg.close(); dlg.className = ''; resolve(); };
    dlg.onclick = async (e) => {
      if (e.target.closest('[data-cerrar]')) fin();
      if (e.target.closest('[data-guardar]')) {
        const sustituir = !actuales || $('input[name=tModo]:checked', dlg)?.value !== 'anadir';
        try {
          const r = await guardarCatalogo(tarifa, { sustituir, origen: archivo.nombre });
          fin();
          toast(`Tarifa oficial guardada: ${r.guardados} artículos${r.quitados ? ` (${r.quitados} quitados)` : ''}`);
          go('tarifa');
        } catch (err) { $('#tImpMsg').textContent = err.message; $('#tImpMsg').classList.remove('hidden'); }
      }
    };
  });
}

// ---------- Volver a leer documentos mal importados ----------

// Originales con documentos importados sin número.
function reparables() {
  const porArchivo = new Map();
  for (const p of data.presupuestos) {
    if (p.origen !== 'importado' || !p.archivoId) continue;
    const a = porArchivo.get(p.archivoId) || { id: p.archivoId, nombre: p.archivoNombre || 'archivo', n: 0, sinNumero: 0 };
    a.n++;
    if (!String(p.numero || '').trim()) a.sinNumero++;
    porArchivo.set(p.archivoId, a);
  }
  return [...porArchivo.values()].filter((a) => a.sinNumero > 0 && /\.pdf$/i.test(a.nombre));
}

function pintarReparar() {
  const lista = reparables();
  $('#iReparar').classList.toggle('hidden', !lista.length);
  $('#iRepararTabla').innerHTML = lista.map((a) => `
    <tr><td>${esc(a.nombre)}</td><td class="num">${a.n}</td><td class="num">${a.sinNumero}</td>
      <td class="acciones"><button class="btn small" data-releer="${esc(a.id)}">Volver a leer</button></td></tr>`).join('');
}

async function releer(archivoId) {
  const a = reparables().find((x) => x.id === archivoId);
  const msg = (t) => { $('#iRepararMsg').textContent = t; };
  try {
    msg(`Leyendo «${a.nombre}»…`);
    const original = await getArchivo(archivoId);
    if (!original) { msg('No se encontró el archivo original.'); return; }
    const pages = await pdfToPages(await original.blob.arrayBuffer(), (t) => msg(`Leyendo «${a.nombre}»: ${t}`));
    if (!looksLikeColumns(pages)) { msg('Este archivo no tiene el formato de columnas del programa de gestión: no se puede volver a leer solo. Revisa sus documentos a mano.'); return; }
    const leidos = columnsToBudgets(pages, a.nombre);
    const tipos = Object.entries(leidos.reduce((m, b) => ({ ...m, [tipoDe(b)]: (m[tipoDe(b)] || 0) + 1 }), {}))
      .map(([t, n]) => `${n} ${(n === 1 ? TIPOS[t].nombre : TIPOS[t].plural).toLowerCase()}`).join(', ');
    const sinNum = leidos.filter((b) => !b.numero).length;
    if (!confirm(`«${a.nombre}»\n\nAhora se leen ${leidos.length} documentos (${tipos})${sinNum ? `, ${sinNum} todavía sin número` : ', todos con número'}.\n`
      + `Se sustituirán los ${a.n} documentos que se importaron de este archivo (el PDF original se conserva).\n\n`
      + 'Si habías corregido alguno a mano, esos cambios se perderán. ¿Continuar?')) { msg(''); return; }
    msg(`Guardando ${leidos.length} documentos…`);
    const r = await sustituirDeArchivo(archivoId, a.nombre, leidos);
    msg(`Listo: ${r.guardados} documentos leídos de nuevo (antes había ${r.borrados})${r.saltados ? ` · ${r.saltados} ya existían y se han saltado` : ''}.`);
    toast('Documentos leídos de nuevo');
  } catch (err) {
    msg('No se pudo: ' + err.message);
    await recargar().catch(() => {});
  }
  pintarReparar();
}

// ---------- Cola de revisión ----------

let cola = [];
const archivosGuardados = new Map(); // archivo (File) → archivoId ya guardado

function mostrarCola() {
  const hay = cola.length > 0;
  $('#iRevision').classList.toggle('hidden', !hay);
  $('#iInicio').classList.toggle('hidden', hay);
  $('#iCopia').classList.toggle('hidden', hay);
  if (!hay) return;
  const it = cola[0];
  const b = it.b;
  $('#iTitulo').textContent = `Revisar importación · ${cola.length === 1 ? 'último' : `1 de ${cola.length}`}`;
  $('#iOrigen').textContent = `${it.archivo?.nombre || 'Texto pegado'}${it.hoja ? ' · hoja ' + it.hoja : ''} · ${b.partidas.length} partidas detectadas. ${it.aviso || 'Revisa lo marcado en amarillo.'}`;
  $('#iCliente').value = b.cliente || '';
  $('#iNumero').value = b.numero || '';
  $('#iTipo').value = tipoDe(b);
  $('#iTipoTodos').classList.toggle('hidden', cola.length < 2);
  $('#iFecha').value = b.fecha || '';
  $('#iTextoPre').textContent = it.texto || '';
  $('#iTextoOrig').classList.toggle('hidden', !it.texto);
  $('#iGuardarTodos').classList.toggle('hidden', cola.length < 2);
  $('#iGuardarTodos').textContent = `Guardar todos (${cola.length})`;
  dupCheck();
  renderTabla();
}

// Ya importado: mismo tipo de documento y número en el mismo año (o, sin número, misma fecha, cliente y total).
const duplicadoDe = (b) => buscarDuplicado({ tipo: tipoDe(b), numero: b.numero, fecha: b.fecha, clienteNombre: b.cliente, total: b.total });
const textoDuplicado = (b, dup) => (`Ya hay ${dup.tipo === 'factura' ? 'una' : 'un'} ${TIPOS[tipoDe(dup)].nombre.toLowerCase()} ${dup.numero ? 'número ' + dup.numero : 'sin número'}`
  + `${dup.fecha ? ' con fecha ' + dup.fecha.split('-').reverse().join('/') : ''}${dup.clienteNombre ? ' de ' + dup.clienteNombre : ''}`).replace(/\.?$/, '.');

function dupCheck() {
  const b = { ...cola[0].b, tipo: $('#iTipo').value, numero: $('#iNumero').value.trim(), fecha: $('#iFecha').value, cliente: $('#iCliente').value.trim() };
  const dup = duplicadoDe(b);
  $('#iDup').classList.toggle('hidden', !dup);
  if (dup) $('#iDup').textContent = textoDuplicado(b, dup) + ' Parece que ya lo importaste: si es así, pulsa «Descartar».';
}

function renderTabla() {
  const ps = cola[0].b.partidas;
  $('#iTabla').innerHTML = ps.map((p, i) => `
    <tr data-i="${i}" class="${p.revisar ? 'flag' : ''}">
      <td><input type="checkbox" data-f="revisar" ${p.revisar ? 'checked' : ''} title="Marcada para revisar más tarde"></td>
      <td class="wide"><input data-f="articulo" value="${esc(p.articulo)}" placeholder="Artículo"><input data-f="descripcion" value="${esc(p.descripcion)}" placeholder="Descripción" class="sub"></td>
      <td><input data-f="categoria" list="dlCategorias" value="${esc(p.categoria)}"></td>
      <td><input data-f="material" list="dlMateriales" value="${esc(p.material)}"></td>
      <td class="num"><input data-f="ancho" inputmode="decimal" value="${fmtNum(p.ancho)}"></td>
      <td class="num"><input data-f="alto" inputmode="decimal" value="${fmtNum(p.alto)}"></td>
      <td class="num"><input data-f="cantidad" inputmode="decimal" value="${fmtNum(p.cantidad)}"></td>
      <td class="num"><input data-f="precioUnitario" inputmode="decimal" value="${fmtNum(p.precioUnitario)}"></td>
      <td class="num" data-o="total">${fmtEur(p.precioTotal)}</td>
      <td><button class="icon" data-del="${i}" title="Quitar">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="10" class="muted">No se detectaron partidas. Añádelas con «+ Añadir partida» o descarta este archivo.</td></tr>';
}

function leerCabecera() {
  const b = cola[0].b;
  b.cliente = $('#iCliente').value.trim();
  b.numero = $('#iNumero').value.trim();
  b.tipo = $('#iTipo').value;
  b.fecha = $('#iFecha').value;
}

// leer: tomar cliente, nº y fecha de la pantalla (solo vale para el presupuesto que se está viendo).
async function guardarActual(leer = true) {
  if (leer) leerCabecera();
  const it = cola[0];
  const b = it.b;
  const reuse = it.archivo ? archivosGuardados.get(it.archivo.blob) : null;
  const p = await savePresupuesto(
    { tipo: tipoDe(b), numero: b.numero, fecha: b.fecha || today(), clienteNombre: b.cliente, clienteDatos: b.clienteDatos, origen: 'importado', archivoId: reuse || null, archivoNombre: it.archivo?.nombre || '', paginas: b.paginas || '', notas: '' },
    b.partidas,
    { archivo: it.archivo && !reuse ? it.archivo : null, silencioso: cola.length > 1, totalesPdf: b.base != null ? { base: b.base, total: b.total } : null },
  );
  if (it.archivo && p.archivoId) archivosGuardados.set(it.archivo.blob, p.archivoId);
  cola.shift();
}

// Datos de la empresa sacados de la cabecera del PDF (solo si aún no se han puesto en Ajustes).
async function datosEmpresa(lineas) {
  const nif = lineas.find((l) => /n\.?i\.?f|c\.?i\.?f/i.test(l));
  const contacto = lineas.filter((l) => /tel|email|@|www/i.test(l));
  const resto = lineas.slice(1).filter((l) => l !== nif && !contacto.includes(l));
  await saveAjustes({
    nombre: lineas[0],
    cif: nif ? nif.replace(/^n\.?i\.?f\.?\s*|^c\.?i\.?f\.?\s*/i, '') : '',
    direccion: resto.join(', '),
    contacto: contacto.map((l) => l.replace(/^email:\s*/i, '')).join(' · '),
  });
  document.querySelectorAll('[data-aj]').forEach((el) => { el.value = data.ajustes[el.dataset.aj] ?? ''; });
  toast('Datos de la empresa rellenados desde el PDF (revísalos en Ajustes).');
}

async function encolar(items) {
  // Datos de la empresa: los del presupuesto más reciente (por si cambió la razón social).
  const reciente = items.filter((x) => x.b.empresa?.length).sort((a, b) => (b.b.fecha || '').localeCompare(a.b.fecha || ''))[0];
  if (reciente && !data.ajustes.nombre) await datosEmpresa(reciente.b.empresa);
  cola.push(...items);
  mostrarCola();
}

// ---------- Eventos ----------

export function initImportar() {
  const procesar = async (files) => {
    const msg = $('#iMsg');
    const nuevos = [];
    for (const f of files) {
      msg.textContent = `Leyendo ${f.name}…`;
      try { nuevos.push(...await leerArchivo(f, (t) => { msg.textContent = `Leyendo ${t}…`; })); } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    msg.textContent = nuevos.length ? '' : 'No se pudo leer ningún archivo.';
    const tarifas = nuevos.filter((x) => x.tarifa);
    const docs = nuevos.filter((x) => !x.tarifa);
    if (docs.length) encolar(docs);
    for (const t of tarifas) await revisarTarifa(t);
  };
  $('#iFiles').addEventListener('change', (e) => { procesar([...e.target.files]); e.target.value = ''; });
  const drop = $('#iDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); procesar([...e.dataTransfer.files]); });

  $('#iTextoBtn').addEventListener('click', () => {
    const t = $('#iTexto').value;
    if (!t.trim()) return;
    encolar([{ b: textToBudget(t.split(/\r?\n/)), texto: t, archivo: null }]);
    $('#iTexto').value = '';
  });

  $('#iNumero').addEventListener('input', dupCheck);
  $('#iTipo').addEventListener('change', dupCheck);
  $('#iTipoTodos').addEventListener('click', () => {
    const t = $('#iTipo').value;
    for (const it of cola) it.b.tipo = t;
    toast(`Los ${cola.length} documentos se guardarán como ${TIPOS[t].plural.toLowerCase()}`);
    dupCheck();
  });
  $('#iFecha').addEventListener('input', dupCheck);
  $('#iCliente').addEventListener('input', dupCheck);

  $('#iTabla').addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const tr = e.target.closest('tr');
    const ps = cola[0].b.partidas;
    const i = +tr.dataset.i;
    let p = ps[i];
    if (f === 'revisar') p.revisar = e.target.checked;
    else if (['ancho', 'alto', 'cantidad', 'precioUnitario'].includes(f)) p[f] = numOrNull(e.target.value);
    else p[f] = e.target.value;
    if (f === 'articulo' && !p.categoria) {
      const c = classify(p.articulo + ' ' + p.descripcion);
      p.categoria = c.categoria; p.material = p.material || c.material;
    }
    p = ps[i] = { ...calcPartida({ ...p, precioTotal: null }), revisar: p.revisar };
    tr.querySelector('[data-o=total]').textContent = fmtEur(p.precioTotal);
    tr.classList.toggle('flag', !!p.revisar);
  });
  $('#iTabla').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (!d) return;
    cola[0].b.partidas.splice(+d.dataset.del, 1);
    renderTabla();
  });
  $('#iAdd').addEventListener('click', () => {
    cola[0].b.partidas.push({ articulo: '', descripcion: '', categoria: '', material: '', ancho: null, alto: null, cantidad: 1, precioUnitario: null, precioTotal: null, revisar: false });
    renderTabla();
    const inputs = $('#iTabla').querySelectorAll('[data-f=articulo]');
    inputs[inputs.length - 1]?.focus();
  });

  $('#iDescartar').addEventListener('click', () => { cola.shift(); mostrarCola(); if (!cola.length) notify(); });
  $('#iGuardar').addEventListener('click', async () => {
    leerCabecera();
    const dup = duplicadoDe(cola[0].b);
    if (dup && !confirm(`${textoDuplicado(cola[0].b, dup)}\n\n¿Guardarlo otra vez de todas formas? (Aceptar = guardar un duplicado; Cancelar = no guardar)`)) return;
    try { await guardarActual(false); toast('Guardado en el histórico'); } catch (err) { toast('Error: ' + err.message); }
    mostrarCola();
    if (!cola.length) notify();
  });
  $('#iGuardarTodos').addEventListener('click', async () => {
    const n = cola.length;
    if (!confirm(`¿Guardar los ${n} documentos tal como están? Las partidas dudosas quedarán marcadas «revisar» y los ya importados se saltarán.`)) return;
    try {
      leerCabecera();
      let saltados = 0;
      let hechos = 0;
      // Todo en un solo envío a la base de datos.
      await enBloque(async () => {
        while (cola.length) {
          const b = cola[0].b;
          if (duplicadoDe(b)) { cola.shift(); saltados++; continue; }
          await guardarActual(false);
          hechos++;
        }
        $('#iTitulo').textContent = `Guardando ${hechos} documentos…`;
      });
      toast(`${hechos} documentos guardados${saltados ? ` · ${saltados} repetidos saltados` : ''}`);
    } catch (err) {
      toast('No se pudo guardar: ' + err.message);
      await recargar().catch(() => {});
    }
    mostrarCola();
    notify();
  });

  // Copia de seguridad.
  $('#bkExport').addEventListener('click', async () => {
    const blob = await exportar($('#bkOrig').checked);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `copia-albaranes-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('#bkMsg').textContent = `Copia descargada (${round(blob.size / 1048576, 1)} MB). Guárdala en un lugar seguro: contiene datos privados.`;
  });
  $('#bkImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const n = await importar(JSON.parse(await f.text()));
      $('#bkMsg').textContent = `${n} documentos añadidos desde la copia.`;
    } catch (err) {
      $('#bkMsg').textContent = 'No se pudo cargar la copia: ' + err.message;
    }
  });

  onShow('importar', () => { mostrarCola(); pintarReparar(); });
  onChange(() => { if (!$('#s-importar').classList.contains('hidden')) pintarReparar(); });
  $('#iRepararTabla').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-releer]');
    if (!b) return;
    $('#iRepararTabla').querySelectorAll('button').forEach((x) => { x.disabled = true; });
    await releer(b.dataset.releer);
  });
}
