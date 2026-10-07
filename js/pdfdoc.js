// Generador de PDF del documento (albarán, presupuesto…) con su firma, sin dependencias.
// Funciona igual en el navegador («Descargar PDF») y en el servidor (PDF adjunto a la copia firmada por email).
// Imágenes en JPEG (se incrustan tal cual); texto en Helvetica con codificación WinAnsi (acentos, ñ, €).

const A4 = [595.28, 841.89];
const M = 42; // margen
// Anchos de Helvetica (1/1000 em) para los caracteres 32–126; el resto se aproxima por su letra base.
const ANCHOS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667,
  944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Caracteres fuera de Latin-1 que sí tiene WinAnsi.
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

const base = (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '')[0] || c;
function ancho(txt, tam, negrita = false) {
  let w = 0;
  for (const c of String(txt)) {
    let code = c.charCodeAt(0);
    if (code < 32 || code > 126) code = base(c).charCodeAt(0);
    w += (code >= 32 && code <= 126 ? ANCHOS[code - 32] : 556);
  }
  return (w * tam / 1000) * (negrita ? 1.06 : 1);
}
// Texto → cadena PDF (bytes WinAnsi), escapando ( ) \.
function cadena(txt) {
  let out = '';
  for (const c of String(txt ?? '')) {
    const code = c.charCodeAt(0);
    let b = WIN[c] ?? (code <= 0xff ? code : base(c).charCodeAt(0));
    if (b > 0xff || (b < 32 && b !== 9)) b = 63; // ?
    const ch = String.fromCharCode(b);
    out += ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : ch;
  }
  return `(${out})`;
}
// Parte un texto en líneas que caben en «max» puntos.
function partir(txt, max, tam, negrita) {
  const lineas = [];
  for (const parrafo of String(txt ?? '').split(/\r?\n/)) {
    let linea = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = linea ? linea + ' ' + palabra : palabra;
      if (ancho(prueba, tam, negrita) <= max || !linea) {
        // Palabra más larga que la línea: se corta.
        if (!linea && ancho(palabra, tam, negrita) > max) {
          let trozo = '';
          for (const c of palabra) { if (ancho(trozo + c, tam, negrita) > max) { lineas.push(trozo); trozo = ''; } trozo += c; }
          linea = trozo;
        } else linea = prueba;
      } else { lineas.push(linea); linea = palabra; }
    }
    lineas.push(linea);
  }
  return lineas;
}

// Tamaño de un JPEG (marcador SOF).
export function tamJpeg(b) {
  if (!b || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8], componentes: b[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

const eur = (n) => (n == null ? '' : new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(n) + ' €');
const num = (n) => (n == null ? '' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n));
const fecha = (f) => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '');
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const TITULO = { albaran: 'ALBARÁN', presupuesto: 'PRESUPUESTO', factura: 'FACTURA' };

/**
 * datos: { empresa: { nombre, cif, direccion, contacto }, doc: { tipo, numero, fecha, cliente, clienteCif, clienteDireccion, iva, base, total,
 *   notas, lineas: [{ articulo, descripcion, cantidad, precio, importe }] }, importes: bool,
 *   firma: { estado, nombre, dni, fecha, modo, recogidaPor, huella, observaciones, motivo } | null,
 *   imagenes: { logo?: Uint8Array (JPEG), firma?: Uint8Array (JPEG) } }
 * Devuelve los bytes del PDF (Uint8Array).
 */
export function crearPdf({ empresa = {}, doc, importes = true, firma = null, imagenes = {} }) {
  const paginas = [];
  let ops = [];
  let y = 0;
  const color = (r, g, b) => ops.push(`${r} ${g} ${b} rg`);
  const texto = (x, yy, txt, tam = 10, negrita = false) => ops.push(`BT /${negrita ? 'F2' : 'F1'} ${tam} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td ${cadena(txt)} Tj ET`);
  const derecha = (x, yy, txt, tam = 10, negrita = false) => texto(x - ancho(txt, tam, negrita), yy, txt, tam, negrita);
  const linea = (x1, y1, x2, y2, gris = 0.75, grosor = 0.6) => ops.push(`${gris} G ${grosor} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  const imagen = (nombre, x, yy, w, h) => ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${yy.toFixed(2)} cm /${nombre} Do Q`);
  const nuevaPagina = () => { if (ops.length) paginas.push(ops); ops = []; y = A4[1] - M; };
  const imgs = {};
  for (const [k, bytes] of Object.entries(imagenes)) { const t = bytes && tamJpeg(bytes); if (t) imgs[k] = { bytes, ...t }; }

  nuevaPagina();
  // Cabecera: logo y empresa a la izquierda; tipo, número y fecha a la derecha.
  const derechaX = A4[0] - M;
  let yIzq = y;
  if (imgs.logo) {
    const h = Math.min(46, 160 * imgs.logo.alto / imgs.logo.ancho);
    const w = h * imgs.logo.ancho / imgs.logo.alto;
    imagen('ImLogo', M, yIzq - h, w, h);
    yIzq -= h + 8;
  }
  color(0, 0, 0);
  if (empresa.nombre) { texto(M, yIzq - 10, empresa.nombre, 10.5, true); yIzq -= 14; }
  color(0.3, 0.3, 0.3);
  for (const l of [empresa.cif && 'NIF ' + empresa.cif, empresa.direccion, empresa.contacto].filter(Boolean)) {
    for (const t of partir(l, 260, 8.5)) { texto(M, yIzq - 9, t, 8.5); yIzq -= 11; }
  }
  color(0.85, 0.42, 0.05);
  derecha(derechaX, y - 18, TITULO[doc.tipo] || 'DOCUMENTO', 18, true);
  color(0, 0, 0);
  derecha(derechaX, y - 36, `Número: ${doc.numero || ''}`, 10, true);
  derecha(derechaX, y - 50, `Fecha: ${fecha(doc.fecha)}`, 10);
  y = Math.min(yIzq, y - 56) - 14;
  // Cliente
  ops.push('0.95 0.96 0.98 rg');
  const lineasCli = [doc.clienteCif, doc.clienteDireccion].filter(Boolean).flatMap((l) => partir(l, A4[0] - 2 * M - 20, 9));
  const altoCli = 30 + lineasCli.length * 11;
  ops.push(`${M} ${(y - altoCli).toFixed(2)} ${(A4[0] - 2 * M).toFixed(2)} ${altoCli} re f`);
  color(0.4, 0.4, 0.4); texto(M + 10, y - 13, 'CLIENTE', 7.5, true);
  color(0, 0, 0); texto(M + 10, y - 26, doc.cliente || '', 11, true);
  color(0.3, 0.3, 0.3);
  lineasCli.forEach((l, i) => texto(M + 10, y - 38 - i * 11, l, 9));
  y -= altoCli + 18;

  // Tabla de líneas
  const colCant = importes ? A4[0] - M - 190 : A4[0] - M;
  const colPrecio = A4[0] - M - 85;
  const colImporte = A4[0] - M;
  const anchoConcepto = (importes ? colCant - 60 : colCant - 70) - M;
  const cabeceraTabla = () => {
    color(0.4, 0.4, 0.4);
    texto(M, y, 'Concepto', 8.5, true);
    derecha(colCant, y, 'Cant.', 8.5, true);
    if (importes) { derecha(colPrecio, y, 'Precio', 8.5, true); derecha(colImporte, y, 'Importe', 8.5, true); }
    linea(M, y - 5, A4[0] - M, y - 5, 0.55, 0.8);
    y -= 9;
  };
  cabeceraTabla();
  const pie = 70;
  for (const l of doc.lineas || []) {
    const tit = partir(l.articulo || '', anchoConcepto, 10, true);
    const desc = l.descripcion ? partir(l.descripcion, anchoConcepto, 8.5) : [];
    // Fila: y es su borde de arriba; el texto empieza 13 pt por debajo y la raya va al final de la fila.
    const alto = 13 + (tit.length - 1) * 12.5 + desc.length * 10.5 + 7;
    if (y - alto < M + pie) { nuevaPagina(); cabeceraTabla(); }
    const b0 = y - 13;
    color(0, 0, 0);
    tit.forEach((t, i) => texto(M, b0 - i * 12.5, t, 10, true));
    derecha(colCant, b0, num(l.cantidad), 10);
    if (importes) { derecha(colPrecio, b0, eur(l.precio), 10); derecha(colImporte, b0, eur(l.importe), 10); }
    color(0.35, 0.35, 0.35);
    desc.forEach((t, i) => texto(M, b0 - tit.length * 12.5 - i * 10.5 + 1.5, t, 8.5));
    y -= alto;
    linea(M, y, A4[0] - M, y, 0.88, 0.5);
  }
  // Totales
  if (importes && doc.total != null) {
    if (y - 50 < M + pie) nuevaPagina();
    y -= 16;
    const ivaImp = doc.base != null ? doc.total - doc.base : null;
    color(0.2, 0.2, 0.2);
    derecha(colPrecio, y, 'Base imponible', 9.5); derecha(colImporte, y, eur(doc.base), 9.5); y -= 14;
    derecha(colPrecio, y, `IVA ${num(doc.iva)} %`, 9.5); derecha(colImporte, y, eur(ivaImp), 9.5); y -= 6;
    linea(colPrecio - 90, y, colImporte, y, 0.4, 0.8); y -= 14;
    color(0, 0, 0);
    derecha(colPrecio, y, 'TOTAL', 11, true); derecha(colImporte, y, eur(doc.total), 11, true); y -= 14;
  }
  if (doc.notas) {
    const ls = partir(doc.notas, A4[0] - 2 * M, 9);
    if (y - ls.length * 11 - 12 < M + pie) nuevaPagina();
    y -= 10; color(0.3, 0.3, 0.3);
    for (const t of ls) { texto(M, y, t, 9); y -= 11; }
  }
  // Firma
  if (firma) {
    const ok = firma.estado === 'firmado';
    const extra = [firma.observaciones && 'Observaciones: ' + firma.observaciones, firma.motivo && 'Motivo: ' + firma.motivo].filter(Boolean).flatMap((t) => partir(t, 250, 8.5));
    const hImg = imgs.firma ? Math.min(70, 220 * imgs.firma.alto / imgs.firma.ancho) : 0;
    const alto = 26 + hImg + 44 + extra.length * 10.5;
    if (y - alto - 14 < M + 20) nuevaPagina();
    y -= 18;
    const x = A4[0] - M - 250;
    color(0.4, 0.4, 0.4);
    texto(x, y, ok ? (doc.tipo === 'presupuesto' ? 'ACEPTADO Y FIRMADO POR EL CLIENTE' : 'CONFORME · FIRMA DEL CLIENTE') : 'NO CONFORME', 8, true);
    y -= 8;
    if (imgs.firma) { const w = hImg * imgs.firma.ancho / imgs.firma.alto; imagen('ImFirma', x, y - hImg, w, hImg); y -= hImg + 4; }
    linea(x, y, A4[0] - M, y, 0.3, 0.8);
    color(0, 0, 0); texto(x, y - 13, firma.nombre + (firma.dni ? ` · DNI ${firma.dni}` : ''), 9.5, true);
    color(0.3, 0.3, 0.3);
    texto(x, y - 25, `${fechaHora(firma.fecha)} · ${firma.modo === 'enlace' ? 'firmado a distancia' : 'firmado en persona'}${firma.recogidaPor ? ` (${firma.recogidaPor})` : ''}`, 8.5);
    extra.forEach((t, i) => texto(x, y - 37 - i * 10.5, t, 8.5));
    y -= 37 + extra.length * 10.5;
    if (firma.huella) { color(0.5, 0.5, 0.5); texto(M, M - 6, `Firma electrónica · huella SHA-256 del contenido firmado: ${firma.huella}`, 6.5); }
  }
  paginas.push(ops);

  // ---------- Montaje del PDF ----------
  const objs = [];
  const add = (cuerpo) => { objs.push(cuerpo); return objs.length; };
  const catalogo = add(null); const raiz = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const xobj = {};
  for (const [k, im] of Object.entries(imgs)) {
    xobj[k] = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.ancho} /Height ${im.alto} /ColorSpace /${im.componentes === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, datos: im.bytes });
  }
  const recursos = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /XObject << ${imgs.logo ? `/ImLogo ${xobj.logo} 0 R ` : ''}${imgs.firma ? `/ImFirma ${xobj.firma} 0 R` : ''} >> >>`;
  const kids = paginas.map((p, i) => {
    const pieTxt = `Página ${i + 1} de ${paginas.length}`;
    const contenido = [...p, `0.5 0.5 0.5 rg BT /F1 7.5 Tf ${(A4[0] - M - ancho(pieTxt, 7.5)).toFixed(2)} ${(M - 18).toFixed(2)} Td ${cadena(pieTxt)} Tj ET`].join('\n');
    const c = add({ dict: `<< /Length ${contenido.length} >>`, datos: contenido });
    return add(`<< /Type /Page /Parent ${raiz} 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources ${recursos} /Contents ${c} 0 R >>`);
  });
  objs[catalogo - 1] = `<< /Type /Catalog /Pages ${raiz} 0 R >>`;
  objs[raiz - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  const trozos = [];
  let pos = 0;
  const poner = (x) => { const b = typeof x === 'string' ? latin1(x) : x; trozos.push(b); pos += b.length; };
  const offsets = [];
  poner('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  objs.forEach((o, i) => {
    offsets.push(pos);
    if (typeof o === 'string') poner(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else { poner(`${i + 1} 0 obj\n${o.dict}\nstream\n`); poner(o.datos); poner('\nendstream\nendobj\n'); }
  });
  const xref = pos;
  poner(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  poner(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let k = 0;
  for (const t of trozos) { out.set(t, k); k += t.length; }
  return out;
}

function latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
