#!/usr/bin/env bash
# Demuestra que desde el catálogo o la portada no queda ninguna ruta, tarjeta,
# enlace o botón que lleve a la vista de un curso individual.
set -u
RAIZ="${1:-.}"
APP="$RAIZ/apps/web/src/components/PublicApp.tsx"
API="$RAIZ/apps/web/src/lib/api.ts"
fallos=0

# Recorta la sección del temario de la ficha: desde su <section id> hasta el
# </section> que la cierra.
temario() {
  awk '/id="programa-temario"/{dentro=1} dentro{print} dentro && /<\/section>/{exit}' "$APP"
}

comprobar_vacio() {
  local titulo="$1"; shift
  local salida
  salida="$(eval "$1" 2>/dev/null)"
  if [ -n "$salida" ]; then
    echo "FALLO - $titulo:"
    echo "$salida" | sed 's/^/    /'
    fallos=$((fallos + 1))
  else
    echo "OK - $titulo: 0 coincidencias"
  fi
}

echo "=== 1. Quién navega a la vista de aula ==="
grep -n "type: 'course'" "$APP" | sed 's/^/    /'
echo "    -- y abrirAula() se invoca sólo desde:"
grep -n "abrirAula(" "$APP" | sed 's/^/    /'
echo

echo "=== 2. El temario de la ficha, literal (debe ser texto, no accesos) ==="
temario | sed 's/^/    /'
echo

echo "=== 3. Comprobaciones ==="
comprobar_vacio "ninguna navegación a curso por slug" \
  "grep -n \"type: 'course', slug\" '$APP'"

comprobar_vacio "el temario no contiene onClick, <button>, <a> ni href" \
  "awk '/id=\"programa-temario\"/{d=1} d{print} d && /<\\/section>/{exit}' '$APP' | grep -n 'onClick\|<button\|<a \|href='"

comprobar_vacio "el front no extrae moodleCourseId de una pieza del catálogo" \
  "grep -n 'getAssetMoodleCourseId\|content.moodleCourseId\|item.moodleCourseId' '$APP'"

comprobar_vacio "el catálogo/portada no filtra piezas kind === 'course'" \
  "grep -n \"kind === 'course'\" '$APP'"

comprobar_vacio "CursoDelPrograma no lleva identificador de Moodle" \
  "awk '/^export type CursoDelPrograma/,/^};/' '$API' | grep -in moodle"

comprobar_vacio "ProgramaPublico no lleva identificador de Moodle" \
  "awk '/^export type ProgramaPublico/,/^};/' '$API' | grep -in moodle"

comprobar_vacio "no queda modo preview ni módulos candados" \
  "grep -n 'isPreviewOnly\|isModuleLocked\|course-paywall-card\|course-preview-banner\|preview-readonly-box' '$APP'"

comprobar_vacio "sin botones de entrar al curso o ver vista previa" \
  "grep -n 'catalog.enterFullCourse\|catalog.viewPreview\|catalog.previewAvailable\|hero.enterCourse' '$APP'"

comprobar_vacio "la ficha del programa no tiene botón secundario al aula" \
  "grep -rn 'program-cta-secondary' '$RAIZ/apps/web/src'"

echo
if [ "$fallos" -eq 0 ]; then
  echo "RESULTADO: TODO CORRECTO - no queda acceso a curso individual desde el catálogo ni la portada"
  exit 0
fi
echo "RESULTADO: $fallos FALLO(S)"
exit 1
