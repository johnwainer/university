#!/usr/bin/env bash
# Respaldo nocturno de la base de la API (Etapa I, TFU). Conserva 7 dias.
#
# La instancia de Moodle ya tenia respaldo; esta no tenia ninguno, y aqui es
# donde viven el repositorio de compliance, los expedientes de faculty, los
# mensajes del formulario de contacto y las cuentas. Complementa los snapshots
# de Lightsail con un volcado logico, que es lo que permite restaurar una tabla
# sin levantar toda la imagen.
set -Eeuo pipefail
DEST=/var/backups/api
STAMP=$(date +%F)
mkdir -p "$DEST"

# La cadena de conexion vive en el .env del servicio; se usa tal cual, sin
# copiarla a ningun sitio.
DBURL=$(grep -m1 '^DATABASE_URL=' /opt/plataforma-estudiantil/api/shared/.env | cut -d= -f2-)

# --no-owner y --no-acl para poder restaurar en un servidor con otros roles.
pg_dump --no-owner --no-acl --format=custom "$DBURL" > "$DEST/api-$STAMP.dump"
gzip -f "$DEST/api-$STAMP.dump"

find "$DEST" -type f -name 'api-*.dump.gz' -mtime +7 -delete
chmod 640 "$DEST"/api-*.dump.gz

printf 'respaldo %s: api=%s\n' "$STAMP" "$(du -h "$DEST/api-$STAMP.dump.gz" | cut -f1)"
