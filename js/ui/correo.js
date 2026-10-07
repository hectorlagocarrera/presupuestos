// Ajustes → Correo y firmas (administradores): buzón SMTP para los enlaces de firma y las copias firmadas.
import { $ } from '../util.js';
import { correoApi } from '../backend.js';
import { data, saveAjustes } from '../store.js';
import { toast } from './common.js';

const CAMPOS = { coHost: 'host', coPuerto: 'puerto', coSeguridad: 'seguridad', coUsuario: 'usuario', coClave: 'clave', coRemitente: 'remitente', coNombre: 'nombre', coCopia: 'copia', coUrl: 'urlPublica' };

// El servidor no puede convertir imágenes: el navegador del administrador le deja el logo en JPEG para los PDF.
async function logoParaPdf() {
  const fuente = data.ajustes.logo || 'logo.png';
  const clave = `${fuente.length}:${fuente.slice(-48)}`;
  if (data.ajustes.logoJpegDe === clave) return;
  const { aJpeg } = await import('../descargapdf.js');
  const j = await aJpeg(fuente, 600);
  if (j) await saveAjustes({ logoJpeg: j.datos, logoJpegDe: clave }).catch(() => {});
}

export async function initCorreo() {
  logoParaPdf().catch(() => {});
  const msg = (t) => { $('#coMsg').textContent = t; };
  const pintar = (c) => {
    for (const [id, k] of Object.entries(CAMPOS)) $('#' + id).value = c[k] || (k === 'seguridad' ? 'ssl' : '');
    msg(c.listo ? '✓ Correo configurado.' : 'Aún no está configurado: sin él, los enlaces para firmar se pueden copiar y enviar por WhatsApp, pero no llegan copias por email.');
  };
  $('#coImportes').checked = !!data.ajustes.partesImportes;
  $('#coImportes').addEventListener('change', (e) => saveAjustes({ partesImportes: e.target.checked }).then(() => toast('Guardado')));
  $('#coSeguridad').addEventListener('change', (e) => { if (!$('#coPuerto').value || ['465', '587'].includes($('#coPuerto').value)) $('#coPuerto').value = e.target.value === 'ssl' ? '465' : '587'; });
  try { pintar(await correoApi.leer()); } catch { return; }
  $('#coForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(Object.entries(CAMPOS).map(([id, k]) => [k, $('#' + id).value.trim()]));
    try { const r = await correoApi.guardar(datos); toast('Correo guardado'); pintar({ ...datos, clave: datos.clave ? '********' : '', listo: r.listo }); } catch (err) { msg(err.message); }
  });
  $('#coPrueba').addEventListener('click', async () => {
    const para = prompt('¿A qué email mando la prueba?', $('#coCopia').value || $('#coRemitente').value);
    if (!para) return;
    msg('Enviando…');
    try { await correoApi.prueba(para.trim()); msg(`✓ Enviado a ${para}. Si no llega en unos minutos, mira la carpeta de spam.`); } catch (err) { msg('✗ ' + err.message); }
  });
}
