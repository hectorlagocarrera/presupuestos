# Montar Presupuestos en el VPS de OVH (desde cero)

Resultado: la aplicación en `https://vps-xxxxxxxx.vps.ovh.net`, con usuario y contraseña, y los datos en una
**base de datos en el servidor**. Todos los ordenadores ven lo mismo y cada noche se hace una copia de seguridad.

Tiempo: unos 15 minutos. Solo hay que copiar y pegar un par de comandos.

---

## 1. Apunta los datos de tu VPS

En el panel de OVH (<https://www.ovh.com/manager/>), ve a **Bare Metal Cloud → Servidores privados virtuales**
y entra en tu VPS. Necesitas:

- **Nombre del VPS**: algo como `vps-1a2b3c4d.vps.ovh.net` (sale arriba, en el nombre o en «Nombre de host»).
- **Usuario**: normalmente `ubuntu`.
- **Contraseña**: te llegó por email cuando se instaló el VPS. Si no la tienes, en el panel puedes
  **reinstalar** el VPS con Ubuntu 24.04 y te mandan una nueva. Reinstalar borra todo lo que haya en el VPS.

## 2. Conéctate al VPS desde Windows

1. Pulsa la tecla **Windows**, escribe **PowerShell** y ábrelo.
2. Escribe esto, con tu nombre de VPS, y pulsa Intro:
   ```
   ssh ubuntu@vps-1a2b3c4d.vps.ovh.net
   ```
3. La primera vez pregunta *«Are you sure you want to continue connecting?»*: escribe `yes` y pulsa Intro.
4. Escribe la contraseña. **No se ve mientras escribes**, es normal. Pulsa Intro.
   - La primera vez puede que te pida cambiarla: pon la actual y después dos veces una nueva.

Sabrás que estás dentro cuando veas algo como `ubuntu@vps-1a2b3c4d:~$`.

## 3. Instala la aplicación (un solo comando)

Copia y pega esto en la ventana de PowerShell (con clic derecho se pega) y pulsa Intro:

```
curl -fsSL https://raw.githubusercontent.com/hectorlagocarrera/presupuestos/main/deploy/instalar.sh | sudo bash
```

Te hará unas preguntas:

| Pregunta | Qué contestar |
|---|---|
| Nombre del servidor | Pulsa Intro si sale tu `vps-….vps.ovh.net`. Si no, escríbelo. |
| Email para avisos del certificado | Tu email (te avisarían si hubiera un problema con el HTTPS). |
| Usuario para entrar en la aplicación | Por ejemplo `oficina` o tu nombre. |
| Contraseña | Mínimo 8 caracteres. **No se ve al escribir.** |

Tarda unos minutos. Al final verás:

```
 Listo. Abre:  https://vps-1a2b3c4d.vps.ovh.net
```

## 4. Entra en la aplicación

Abre esa dirección en Chrome o Edge y entra con el usuario y la contraseña que has puesto.

## 5. Mete los presupuestos

- **Lo más rápido**: ve a **Importar**, arrastra los PDF de cada año y pulsa **Guardar todos**. En unos segundos
  estarán en la base de datos.
- Si ya tenías datos en la versión de GitHub Pages (los presupuestos creados allí): ábrela, ve a
  **Importar → Descargar copia**, y en el VPS usa **Importar → Cargar copia** con ese archivo.

Como ya estarán en el servidor, puedes desactivar GitHub Pages (en GitHub: **Settings → Pages → Unpublish**).

---

## Uso diario y mantenimiento

Todo esto se hace conectado al VPS como en el paso 2.

| Para… | Comando |
|---|---|
| Crear otro usuario (o cambiar una contraseña) | `sudo presupuestos-usuario nuevo maria` |
| Ver los usuarios | `sudo presupuestos-usuario lista` |
| Borrar un usuario | `sudo presupuestos-usuario borrar maria` |
| Hacer una copia de seguridad ahora | `sudo presupuestos-copia` |
| Traer la última versión de la aplicación | `sudo presupuestos-actualizar` (también se hace sola cada noche) |
| Ver si el servicio funciona | `sudo systemctl status presupuestos` |
| Ver errores | `sudo journalctl -u presupuestos -n 50` |
| Reiniciar la aplicación | `sudo systemctl restart presupuestos` |

**Copias de seguridad:**
- Cada noche, a las 3:30, se guarda una copia de la base de datos en `/var/backups/presupuestos/`. Se conservan
  30 días.
- Esas copias están en el mismo VPS. Para tener otra **fuera** del servidor, de vez en cuando usa en la
  aplicación **Importar → Descargar copia**, marca «incluir los PDF/Excel originales» y guárdala en otro sitio.
- En el panel de OVH también puedes contratar las **copias automáticas del VPS** (opción «Backup automatizado»).

**Recuperar una copia** (solo si algo va mal):
```
sudo systemctl stop presupuestos
sudo -u presupuestos sh -c 'gunzip -c /var/backups/presupuestos/datos-2026-10-06.db.gz > /var/lib/presupuestos/datos.db'
sudo rm -f /var/lib/presupuestos/datos.db-wal /var/lib/presupuestos/datos.db-shm
sudo systemctl start presupuestos
```

## Qué instala el script

- **Node.js 22**: ejecuta la aplicación y su base de datos **SQLite**, que está en
  `/var/lib/presupuestos/datos.db`.
- **Servicio `presupuestos`**: arranca solo al encender el VPS y se reinicia si falla. Funciona con un usuario
  del sistema sin permisos y solo puede escribir en su carpeta de datos.
- **nginx con HTTPS gratuito (Let's Encrypt)**: el certificado se renueva solo.
- **Cortafuegos (ufw)**: solo deja pasar SSH, HTTP y HTTPS.
- **Actualizaciones de seguridad de Ubuntu automáticas.**

**Seguridad de los datos:**
- Sin usuario y contraseña no se puede leer nada.
- Las contraseñas se guardan cifradas (scrypt).
- Tras 8 intentos fallidos, ese ordenador se bloquea 15 minutos.
- La sesión dura 30 días y se cierra con **Salir**.

## Si algo falla

- **«No se pudo poner HTTPS»**: el nombre del servidor no es el correcto. Vuelve a ejecutar el comando del paso 3
  con el nombre exacto del panel de OVH. Los datos no se pierden.
- **La página no carga**: comprueba en el panel de OVH que el VPS está encendido. Si activaste el «Firewall
  de red» de OVH, deja abiertos los puertos 22, 80 y 443.
- **He olvidado la contraseña**: conéctate al VPS y ejecuta `sudo presupuestos-usuario nuevo <usuario>` para
  poner una nueva.
