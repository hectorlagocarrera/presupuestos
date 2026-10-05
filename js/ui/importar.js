// Importación del histórico (PDF, Excel, ODS, CSV, texto) con revisión manual, y copias de seguridad.
import { $, esc, fmtEur, fmtNum, numOrNull, today, calcPartida, round } from '../util.js';
import { textToBudget, rowsToBudgets } from '../parse.js';
import { classify } from '../search.js';
import { data, savePresupuesto, exportar, importar, notify } from '../store.js';
import { toast } from './common.js';
import { onShow } from './nav.js';

// ---------- Lectura de archivos (todo en este ordenador) ----------

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

async function pdfToLines(buf) {
  await loadScript('vendor/pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x: it.transform[4], s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) out.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '));
  }
  return out;
}

// Archivo → [{ b (presupuesto detectado), texto, archivo }]
async function leerArchivo(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const archivo = { nombre: file.name, tipo: file.type || ext, blob: file };
  if (ext === 'pdf') {
    const lines = await pdfToLines(await file.arrayBuffer());
    const b = textToBudget(lines);
    return [{ b, texto: lines.join('\n'), archivo, aviso: lines.length ? '' : 'El PDF no tiene texto (probablemente es un escaneo). Añade las partidas a mano.' }];
  }
  if (['xlsx', 'xls', 'xlsm', 'ods', 'csv'].includes(ext)) {
    await loadScript('vendor/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const out = [];
    for (const name of wb.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const bs = rowsToBudgets(rows, file.name);
      const texto = rows.slice(0, 200).map((r) => r.join(' | ')).join('\n');
      for (const b of bs) out.push({ b, texto, archivo, hoja: wb.SheetNames.length > 1 ? name : '' });
    }
    return out.length ? out : [{ b: { numero: '', fecha: '', cliente: '', partidas: [] }, texto: '', archivo, aviso: 'No se encontraron partidas en el Excel.' }];
  }
  const text = await file.text();
  return [{ b: textToBudget(text.split(/\r?\n/)), texto: text, archivo }];
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
  $('#iFecha').value = b.fecha || '';
  $('#iTextoPre').textContent = it.texto || '';
  $('#iTextoOrig').classList.toggle('hidden', !it.texto);
  $('#iGuardarTodos').classList.toggle('hidden', cola.length < 2);
  $('#iGuardarTodos').textContent = `Guardar todos (${cola.length})`;
  dupCheck();
  renderTabla();
}

function dupCheck() {
  const n = $('#iNumero').value.trim();
  const f = $('#iFecha').value;
  const dup = n && data.presupuestos.find((p) => p.numero === n && (!f || p.fecha === f));
  $('#iDup').classList.toggle('hidden', !dup);
  if (dup) $('#iDup').textContent = `Ya hay un presupuesto nº ${n}${dup.fecha ? ' con fecha ' + dup.fecha.split('-').reverse().join('/') : ''}. ¿Quizá ya lo importaste?`;
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
  b.fecha = $('#iFecha').value;
}

// leer: tomar cliente, nº y fecha de la pantalla (solo vale para el presupuesto que se está viendo).
async function guardarActual(leer = true) {
  if (leer) leerCabecera();
  const it = cola[0];
  const b = it.b;
  const reuse = it.archivo ? archivosGuardados.get(it.archivo.blob) : null;
  const p = await savePresupuesto(
    { numero: b.numero, fecha: b.fecha || today(), clienteNombre: b.cliente, origen: 'importado', archivoId: reuse || null, archivoNombre: it.archivo?.nombre || '', notas: '' },
    b.partidas,
    { archivo: it.archivo && !reuse ? it.archivo : null, silencioso: cola.length > 1 },
  );
  if (it.archivo && p.archivoId) archivosGuardados.set(it.archivo.blob, p.archivoId);
  cola.shift();
}

async function encolar(items) {
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
      try { nuevos.push(...await leerArchivo(f)); } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    msg.textContent = nuevos.length ? '' : 'No se pudo leer ningún archivo.';
    if (nuevos.length) encolar(nuevos);
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
  $('#iFecha').addEventListener('input', dupCheck);

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
    try { await guardarActual(); toast('Guardado en el histórico'); } catch (err) { toast('Error: ' + err.message); }
    mostrarCola();
    if (!cola.length) notify();
  });
  $('#iGuardarTodos').addEventListener('click', async () => {
    const n = cola.length;
    if (!confirm(`¿Guardar los ${n} presupuestos tal como están? Las partidas dudosas quedarán marcadas «revisar».`)) return;
    try {
      await guardarActual(true);
      while (cola.length) await guardarActual(false);
      toast(`${n} presupuestos guardados`);
    } catch (err) { toast('Error: ' + err.message); }
    mostrarCola();
    notify();
  });

  // Copia de seguridad.
  $('#bkExport').addEventListener('click', async () => {
    const blob = await exportar($('#bkOrig').checked);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `copia-presupuestos-${today()}.json`;
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
      $('#bkMsg').textContent = `${n} presupuestos añadidos desde la copia.`;
    } catch (err) {
      $('#bkMsg').textContent = 'No se pudo cargar la copia: ' + err.message;
    }
  });

  onShow('importar', mostrarCola);
}
