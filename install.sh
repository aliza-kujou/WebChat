#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Por favor, ejecuta este script como root o usando sudo."
  exit 1
fi

clear
echo "====================================================="
echo "   CONFIGURACION DE DOMINIO PARA KAZUMA WEB          "
echo "====================================================="
read -p "Introduce tu dominio (ej: web.kazuma.uk): " DOMINIO

if [ -z "$DOMINIO" ]; then
  echo "El dominio no puede estar vacio. Cancelando instalacion."
  exit 1
fi

echo "=== Actualizando el sistema ==="
apt update && apt upgrade -y

echo "=== Instalando dependencias del sistema ==="
apt install -y curl git nginx build-essential sqlite3 libsqlite3-dev ffmpeg

echo "=== Instalando Node.js (Version 20) ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "=== Creando estructura de directorios ==="
mkdir -p public
mkdir -p sesion_web

echo "=== Instalando PM2 globalmente ==="
npm install -g pm2

echo "=== Instalando dependencias del proyecto ==="
npm install

echo "=== Configurando Nginx para $DOMINIO ==="
cat << EOF > /etc/nginx/sites-available/kazuma-web
server {
    listen 80;
    server_name $DOMINIO;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/kazuma-web /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo "=== Reiniciando Nginx ==="
systemctl restart nginx

echo "=== Iniciando aplicacion con PM2 ==="
pm2 start index.js --name "kazuma-web"
pm2 save
pm2 startup

echo "=== INSTALACION COMPLETADA ==="
echo "Dominio configurado: $DOMINIO"
echo "Asegurate de que en Cloudflare el SSL este en modo Flexible o Full."
echo "Tu app ya deberia estar accesible en: https://$DOMINIO"