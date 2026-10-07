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

## 3. Instala la aplicación

Copia y pega estas dos líneas en la ventana de PowerShell (con clic derecho se pega) y pulsa Intro:

```
curl -fsSLO https://raw.githubusercontent.com/hectorlagocarrera/presupuestos/main/deploy/instalar.sh
sudo bash instalar.sh
```

Te hará unas preguntas:

| Pregunta | Qué contestar |
|---|---|
| Nombre del servidor | Pulsa Intro si sale tu `vps-….vps.ovh.net`. Si no, escríbelo. |
| Email para avisos del certificado | Tu email (te avisarían si hubiera un problema con el HTTPS). |
| Usuario para entrar en la aplicación | Por ejemplo `oficina` o tu nombre. |
| Contraseña | Mínimo 12 caracteres; mejor una frase fácil de recordar (`grapa-caballo-bateria-azul`). **No se ve al escribir.** |
| ¿Traer las actualizaciones automáticamente? | `n` (recomendado). Actualizarás a mano con `sudo presupuestos-actualizar`. |

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

## Usuarios

Se gestionan desde la aplicación: **Ajustes → Usuarios** (solo la ven los **administradores**).

- **Nuevo usuario**: pon el usuario, el nombre y los permisos. La aplicación genera una contraseña provisional:
  pásasela en persona o por teléfono. Al entrar por primera vez tendrá que poner la suya.
- **Editar**: cambiar nombre y permisos, **desactivar** (no puede entrar, pero se conserva; se le echa al
  momento), poner una contraseña nueva, quitar la verificación en dos pasos (móvil perdido), cerrar sus sesiones o
  borrarlo. Los albaranes y demás datos nunca se borran al borrar un usuario.
- **Permisos**: todos pueden consultar el histórico, los albaranes y la tarifa. Además, a cada usuario se le
  marca qué puede hacer: crear y editar albaranes · borrar documentos · importar · ver facturas · cambiar la
  tarifa · cambiar los ajustes de la empresa · copias de seguridad. Hay plantillas para ir rápido (Solo consulta,
  Comercial, Oficina, Todo). El *Administrador* lo puede todo y además gestiona usuarios.
  Los permisos los comprueba el servidor: lo que no se puede hacer no se ve, y aunque se intentara por otra vía,
  se rechaza (y queda en el registro). Sin el permiso de facturas, las facturas ni siquiera se envían a su
  navegador.
- Antes de cualquier cambio se vuelve a pedir **tu contraseña** (vale 10 minutos), y todo queda en el registro.
- Siempre queda al menos un administrador activo, y nadie puede desactivarse ni borrarse a sí mismo.
- Cada uno puede cambiar su contraseña en **Ajustes → Mi cuenta**.

Los usuarios que ya existían antes de esta versión pasan a ser administradores: revisa la lista y deja como
*Usuario* a quien no necesite gestionar usuarios.

## Uso diario y mantenimiento

Todo esto se hace conectado al VPS como en el paso 2. (Lo de los usuarios también se puede hacer desde la
aplicación, como se explica arriba; los comandos sirven, por ejemplo, si nadie puede entrar.)

| Para… | Comando |
|---|---|
| Crear otro usuario (o cambiar una contraseña) | `sudo presupuestos-usuario nuevo maria` (añade `admin` para que sea administrador) |
| Hacer administrador / quitárselo | `sudo presupuestos-usuario admin maria` · `sudo presupuestos-usuario normal maria` |
| Impedir que entre / volver a dejarle | `sudo presupuestos-usuario desactivar maria` · `sudo presupuestos-usuario activar maria` |
| Ver los usuarios | `sudo presupuestos-usuario lista` |
| Borrar un usuario | `sudo presupuestos-usuario borrar maria` |
| Quitar la verificación en dos pasos (móvil perdido y sin códigos) | `sudo presupuestos-usuario mfa-quitar maria` |
| Exigir verificación en dos pasos a todos | `sudo presupuestos-usuario mfa-obligatoria si` (o `no`) |
| Hacer una copia de seguridad ahora | `sudo presupuestos-copia` |
| Traer la última versión de la aplicación | `sudo presupuestos-actualizar` |
| Ver intentos de entrada fallidos | `sudo journalctl -u presupuestos \| grep SEGURIDAD` |
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

## Verificación en dos pasos (MFA)

Recomendado: así nadie puede entrar aunque conozca la contraseña.

1. Entra en la aplicación y ve a **Ajustes → Seguridad → Activar**.
2. Instala en el móvil **Google Authenticator** o **Microsoft Authenticator** (gratis), pulsa **+**, escanea el
   código QR y escribe el código de 6 cifras que aparece.
3. **Guarda los 10 códigos de recuperación** (botón «Descargar»). Cada uno sirve una vez para entrar sin el móvil.
4. Si quieres que todos los usuarios la usen, marca **«Exigirla a todos los usuarios»**. Quien no la tenga tendrá
   que configurarla la próxima vez que entre y, mientras tanto, no podrá ver ningún dato.

Desde entonces, al entrar se pide la contraseña y después el código del móvil.

- **Cambiar de móvil:** en Ajustes → Seguridad, «Desactivar o cambiar de móvil» y vuelve a activarla con el nuevo.
- **Móvil perdido:** entra con un código de recuperación. Si tampoco los tienes, desde el VPS:
  `sudo presupuestos-usuario mfa-quitar <usuario>`.
- Si el código no vale, revisa que la hora del móvil está en automático.

## Qué instala el script

- **Node.js 22**: ejecuta la aplicación y su base de datos **SQLite**, que está en
  `/var/lib/presupuestos/datos.db`.
- **Servicio `presupuestos`**: arranca solo al encender el VPS y se reinicia si falla. Funciona con un usuario
  del sistema sin permisos y solo puede escribir en su carpeta de datos.
- **nginx con HTTPS gratuito (Let's Encrypt)**: el certificado se renueva solo.
- **Cortafuegos (ufw)**: solo deja pasar SSH, HTTP y HTTPS.
- **fail2ban**: bloquea las IP que prueban contraseñas de SSH.
- **Actualizaciones de seguridad de Ubuntu automáticas.**

**Seguridad de los datos** (la aplicación está abierta a Internet, así que se protege por capas):
- Sin usuario y contraseña no se puede leer nada. Todo va cifrado por HTTPS (y el navegador lo exige: HSTS).
- Las contraseñas se guardan cifradas (scrypt) y deben tener al menos 12 caracteres.
- Límites de intentos: nginx admite 10 intentos de entrada por minuto y por IP; la aplicación bloquea 15 minutos
  una IP tras 8 fallos, un usuario tras 20 contraseñas incorrectas (aunque vengan de muchas IP) y tras 10 códigos
  de verificación incorrectos. Cada intento fallido queda en el registro (`SEGURIDAD`).
- La sesión dura 7 días y se cierra con **Salir**. En la base de datos solo se guarda una huella de la sesión.
- Cabeceras de seguridad: la aplicación solo ejecuta su propio código (CSP), no se puede incrustar en otras webs
  y los PDF subidos se abren aislados.
- El servicio funciona aislado: sin permisos, sin acceso a otras carpetas y solo escribe en su carpeta de datos.
- El código es público, pero no contiene datos ni claves: los datos solo están en la base de datos del VPS.

**Recomendaciones:**
1. Activa la **verificación en dos pasos** y márcala como obligatoria para todos (ver arriba). Es la medida más
   importante: sin el móvil no se entra aunque roben una contraseña.
2. Activa la **verificación en dos pasos en tu cuenta de GitHub** (github.com → Settings → Password and
   authentication): de ahí sale el código que se instala en el servidor.
3. Entra al VPS por SSH con **llave** en vez de contraseña (en Windows: `ssh-keygen`, y copia la llave al VPS).
4. Desactiva **GitHub Pages** si aún está publicado: ya no hace falta.

**Aplicar las mejoras de seguridad en un VPS ya instalado:** vuelve a ejecutar el instalador. Los datos y el
certificado se conservan; al preguntar «¿Crear otro usuario?», contesta `n`:
```
curl -fsSLO https://raw.githubusercontent.com/hectorlagocarrera/presupuestos/main/deploy/instalar.sh
sudo bash instalar.sh
```

## Si algo falla

- **«No se pudo poner HTTPS»**: el nombre del servidor no es el correcto. Vuelve a ejecutar el comando del paso 3
  con el nombre exacto del panel de OVH. Los datos no se pierden.
- **La página no carga**: comprueba en el panel de OVH que el VPS está encendido. Si activaste el «Firewall
  de red» de OVH, deja abiertos los puertos 22, 80 y 443.
- **He olvidado la contraseña**: conéctate al VPS y ejecuta `sudo presupuestos-usuario nuevo <usuario>` para
  poner una nueva.
