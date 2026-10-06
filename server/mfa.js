// Verificación en dos pasos (TOTP, RFC 6238): los códigos de 6 cifras de Google Authenticator,
// Microsoft Authenticator, Authy… Además, códigos de recuperación de un solo uso.
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO = 30; // segundos

export function base32(buf) {
  let bits = 0; let val = 0; let out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function deBase32(txt) {
  const s = String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let val = 0; const out = [];
  for (const ch of s) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const nuevoSecreto = () => base32(randomBytes(20));

export function codigo(secreto, paso) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', deBase32(secreto)).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

export const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 1000 / PASO);

// Comprueba un código admitiendo ±1 paso (relojes algo desajustados). Devuelve el paso usado o null.
// ultimoPaso evita que el mismo código se pueda usar dos veces.
export function comprobar(secreto, cod, ultimoPaso = -1, ahora = Date.now()) {
  const limpio = String(cod || '').replace(/\D/g, '');
  if (limpio.length !== 6) return null;
  const p = pasoActual(ahora);
  for (const d of [0, -1, 1]) {
    const paso = p + d;
    if (paso <= ultimoPaso) continue;
    if (timingSafeEqual(Buffer.from(codigo(secreto, paso)), Buffer.from(limpio))) return paso;
  }
  return null;
}

// Dirección que se convierte en QR para la app del móvil.
export function uri(secreto, usuario, emisor = 'Presupuestos') {
  const e = encodeURIComponent(emisor);
  return `otpauth://totp/${e}:${encodeURIComponent(usuario)}?secret=${secreto}&issuer=${e}&algorithm=SHA1&digits=6&period=${PASO}`;
}

// ---------- Códigos de recuperación ----------

const hashRec = (c) => createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

// 10 códigos tipo «k7m2-x9qp-4r»: se enseñan una vez; se guardan solo sus huellas.
export function nuevosCodigosRecuperacion() {
  const codigos = Array.from({ length: 10 }, () => {
    const s = base32(randomBytes(7)).toLowerCase().slice(0, 10);
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  });
  return { codigos, hashes: codigos.map(hashRec) };
}

// Devuelve la lista de huellas sin el código usado, o null si no es válido.
export function usarRecuperacion(hashes, cod) {
  const h = hashRec(cod);
  if (!/[a-z0-9]{10}/i.test(String(cod).replace(/[^a-z0-9]/gi, ''))) return null;
  const i = hashes.indexOf(h);
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
