#!/usr/bin/env bash
# Instala la aplicación de presupuestos en un VPS Ubuntu desde cero:
#   Node.js + base de datos SQLite + servicio que arranca solo + nginx con HTTPS (Let's Encrypt)
#   + cortafuegos + copia de seguridad diaria + primer usuario.
# Uso (en el VPS):
#   curl -fsSLO https://raw.githubusercontent.com/hectorlagocarrera/presupuestos/main/deploy/instalar.sh
#   sudo bash instalar.sh
# Se puede volver a ejecutar sin perder datos (por ejemplo, para reparar la instalación).
set -euo pipefail

REPO="https://github.com/hectorlagocarrera/presupuestos.git"
APP="/opt/presupuestos"
DATOS="/var/lib/presupuestos"
COPIAS="/var/backups/presupuestos"
PUERTO=3000

if [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo con sudo."; exit 1; fi
# Las preguntas se leen del teclado. (Si el script llega por una tubería, del terminal directamente.)
if [ -t 0 ]; then exec 3<&0; else exec 3</dev/tty; fi
pregunta() { local r; read -r -u 3 -p "$1${2:+ [$2]}: " r; echo "${r:-${2:-}}"; }

echo "=== Instalación de Presupuestos ==="
echo "Primero unas preguntas (pulsa Intro para aceptar lo que sale entre corchetes)."
# hostname -f puede tardar si el DNS va lento: como mucho 5 segundos.
NOMBRE="$(timeout 5 hostname -f 2>/dev/null || hostname)"
case "$NOMBRE" in *.*) ;; *) NOMBRE="";; esac
HOST="$(pregunta 'Nombre del servidor (el vps-....vps.ovh.net del panel de OVH)' "$NOMBRE")"
while [ -z "$HOST" ]; do HOST="$(pregunta 'Escribe el nombre del servidor, p. ej. vps-1a2b3c4d.vps.ovh.net' '')"; done
EMAIL="$(pregunta 'Email para avisos del certificado HTTPS (opcional)' '')"
CREAR_USUARIO=1
if [ -f "$DATOS/datos.db" ]; then
  echo "Ya hay una base de datos: se conserva."
  [ "$(pregunta '¿Crear otro usuario ahora? (s/n)' 'n')" = "s" ] || CREAR_USUARIO=0
fi
if [ "$CREAR_USUARIO" = 1 ]; then
  USUARIO="$(pregunta 'Usuario para entrar en la aplicación' 'oficina')"
  while true; do
    read -r -s -u 3 -p "Contraseña (mínimo 12 caracteres; mejor una frase): " P1; echo
    read -r -s -u 3 -p "Repite la contraseña: " P2; echo
    if [ "${#P1}" -ge 12 ] && [ "$P1" = "$P2" ]; then break; fi
    echo "No coinciden o es demasiado corta. Prueba otra vez."
  done
fi
# Actualizar sola cada noche desde GitHub es cómodo, pero si alguien entrara en la cuenta de GitHub
# su código llegaría al servidor sin que nadie lo revise. Por eso, por defecto, se actualiza a mano.
AUTO_ACTUALIZAR="$(pregunta '¿Traer las actualizaciones de GitHub automáticamente cada noche? (s/n, recomendado n)' 'n')"

echo "--- 1/7 Instalando programas (nginx, Node.js, certificados…)."
export DEBIAN_FRONTEND=noninteractive
# En un VPS recién encendido Ubuntu suele estar instalando actualizaciones y bloquea apt unos minutos.
if fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; then
  echo "    Ubuntu está instalando sus actualizaciones automáticas. Esperando a que termine (puede tardar 5-10 min)…"
  while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do printf '.'; sleep 10; done
  echo " ya está."
fi
APT=(-o DPkg::Lock::Timeout=900 -y -q)
apt-get "${APT[@]}" update
apt-get "${APT[@]}" install ca-certificates curl git nginx certbot python3-certbot-nginx ufw sqlite3 unattended-upgrades fail2ban
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "    Instalando Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get "${APT[@]}" install nodejs
fi
echo "    Node.js $(node --version)"

echo "--- 2/7 Descargando la aplicación…"
if [ -d "$APP/.git" ]; then git -C "$APP" pull -q --ff-only; else rm -rf "$APP"; git clone -q --depth 1 "$REPO" "$APP"; fi
chmod -R a+rX "$APP"

echo "--- 3/7 Base de datos y servicio…"
id presupuestos >/dev/null 2>&1 || useradd --system --home "$DATOS" --shell /usr/sbin/nologin presupuestos
install -d -o presupuestos -g presupuestos -m 750 "$DATOS" "$COPIAS"
cat > /etc/systemd/system/presupuestos.service <<UNIT
[Unit]
Description=Presupuestos (aplicación y base de datos)
After=network.target

[Service]
User=presupuestos
Group=presupuestos
Environment=PRESUPUESTOS_DB=$DATOS/datos.db
Environment=PORT=$PUERTO
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning $APP/server/server.js
Restart=always
RestartSec=3
# Aislamiento: el programa solo puede escribir en su carpeta de datos y no puede ganar permisos.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
SystemCallArchitectures=native
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
ReadWritePaths=$DATOS

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q presupuestos
systemctl restart presupuestos

# Comandos de ayuda.
cat > /usr/local/bin/presupuestos-usuario <<CMD
#!/bin/sh
# Uso: sudo presupuestos-usuario nuevo <usuario> | borrar <usuario> | lista
exec sudo -u presupuestos env PRESUPUESTOS_DB=$DATOS/datos.db node --disable-warning=ExperimentalWarning $APP/server/usuarios.js "\$@"
CMD
cat > /usr/local/bin/presupuestos-copia <<CMD
#!/bin/sh
# Copia de la base de datos (se ejecuta sola cada noche). Guarda las de los últimos 30 días.
set -e
F="$COPIAS/datos-\$(date +%F).db"
sqlite3 "$DATOS/datos.db" ".backup '\$F'"
gzip -f "\$F"
find "$COPIAS" -name 'datos-*.db.gz' -mtime +30 -delete
CMD
cat > /usr/local/bin/presupuestos-actualizar <<CMD
#!/bin/sh
# Trae la última versión de la aplicación desde GitHub y reinicia el servicio.
set -e
git -C $APP pull -q --ff-only
chmod -R a+rX $APP
systemctl restart presupuestos
CMD
chmod 755 /usr/local/bin/presupuestos-usuario /usr/local/bin/presupuestos-copia /usr/local/bin/presupuestos-actualizar
cat > /etc/cron.d/presupuestos <<CRON
# Copia de seguridad diaria a las 3:30.
30 3 * * * presupuestos /usr/local/bin/presupuestos-copia
CRON
if [ "$AUTO_ACTUALIZAR" = "s" ]; then
  echo "# Actualización de la aplicación a las 4:15." >> /etc/cron.d/presupuestos
  echo "15 4 * * * root /usr/local/bin/presupuestos-actualizar" >> /etc/cron.d/presupuestos
fi

if [ "$CREAR_USUARIO" = 1 ]; then
  printf '%s\n' "$P1" | sudo -u presupuestos env PRESUPUESTOS_DB="$DATOS/datos.db" node --disable-warning=ExperimentalWarning "$APP/server/usuarios.js" nuevo "$USUARIO" admin
  unset P1 P2
fi

echo "--- 4/7 Servidor web (nginx)…"
LISTEN6=""; [ -s /proc/net/if_inet6 ] && LISTEN6="listen [::]:80;"
# Límite de intentos de entrada (además del de la aplicación).
cat > /etc/nginx/conf.d/presupuestos-seguridad.conf <<NGINX
limit_req_zone \$binary_remote_addr zone=presupuestos_entrar:10m rate=10r/m;
limit_req_zone \$binary_remote_addr zone=presupuestos_api:10m rate=20r/s;
limit_req_status 429;
NGINX
cat > /etc/nginx/sites-available/presupuestos <<NGINX
server {
    listen 80;
    $LISTEN6
    server_name $HOST;
    root $APP;
    index index.html;
    client_max_body_size 60m;
    server_tokens off; # no decir la versión de nginx (aquí y no en conf.d: Ubuntu ya lo pone en nginx.conf)

    # Archivos internos que no se publican.
    location ~ (^|/)\. { deny all; }
    location ~ ^/(server|deploy|tests|docs|datos|node_modules)/ { deny all; }
    location ~ \.md$ { deny all; }
    location ~ ^/package(-lock)?\.json$ { deny all; }

    # Entrar: como mucho 10 intentos por minuto desde cada IP.
    location ~ ^/api/entrar {
        limit_req zone=presupuestos_entrar burst=5 nodelay;
        client_max_body_size 16k;
        proxy_pass http://127.0.0.1:$PUERTO;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Datos: los gestiona el servidor de la aplicación (con usuario y contraseña).
    location /api/ {
        limit_req zone=presupuestos_api burst=100 nodelay;
        proxy_pass http://127.0.0.1:$PUERTO;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_request_buffering off;
    }

    location / { try_files \$uri \$uri/ =404; }

    # Cabeceras de seguridad: solo HTTPS, sin incrustar la app en otras webs, solo código propio.
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src blob:; frame-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy same-origin always;

    gzip on;
    gzip_types text/css application/javascript image/svg+xml application/json;
}
NGINX
ln -sf /etc/nginx/sites-available/presupuestos /etc/nginx/sites-enabled/presupuestos
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl enable -q nginx
systemctl reload nginx || systemctl restart nginx

echo "--- 5/7 Cortafuegos (solo SSH, HTTP y HTTPS) y bloqueo de ataques a SSH…"
# fail2ban bloquea durante un tiempo las IP que prueban contraseñas de SSH.
systemctl enable -q --now fail2ban || true
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "--- 6/7 Certificado HTTPS gratuito (Let's Encrypt)…"
HTTPS=1
if [ -n "$EMAIL" ]; then CB=(-m "$EMAIL"); else CB=(--register-unsafely-without-email); fi
# --keep-until-expiring: al volver a ejecutar el instalador se reutiliza el certificado que ya hay.
certbot --nginx -d "$HOST" --non-interactive --agree-tos --redirect --keep-until-expiring "${CB[@]}" || HTTPS=0

echo "--- 7/7 Comprobando…"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
sleep 1
if curl -fs -o /dev/null "http://127.0.0.1:$PUERTO/index.html"; then OK=1; else OK=0; fi

echo
echo "=============================================================="
if [ "$OK" = 0 ]; then
  echo " ATENCIÓN: el servicio no responde. Mira el error con:"
  echo "   sudo journalctl -u presupuestos -n 50"
elif [ "$HTTPS" = 1 ]; then
  echo " Listo. Abre:  https://$HOST"
else
  echo " Instalado, pero NO se pudo poner HTTPS (revisa el nombre del servidor)."
  echo " De momento abre:  http://$HOST"
fi
echo
echo " Comandos útiles:"
echo "   sudo presupuestos-usuario nuevo maria   → crear usuario o cambiar contraseña (también desde Ajustes → Usuarios)"
echo "   sudo presupuestos-usuario admin maria   → hacer administrador"
echo "   sudo presupuestos-usuario lista         → ver usuarios"
echo "   sudo presupuestos-usuario mfa-quitar maria → quitar la verificación en dos pasos (móvil perdido)"
echo "   sudo presupuestos-copia                 → copia de seguridad ahora (en $COPIAS)"
echo "   sudo presupuestos-actualizar            → traer la última versión"
echo "=============================================================="
