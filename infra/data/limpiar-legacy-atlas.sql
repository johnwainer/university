-- =============================================================================
-- Retirada de los datos de demostración heredados del producto Atlas
-- =============================================================================
--
-- Qué es esto. La plataforma de TFU se construyó sobre un producto anterior,
-- «Atlas Online University», y en la base de producción quedaron filas de
-- demostración de aquél. Ninguna es contenido de TFU y varias se servían por la
-- API pública. Esta tanda de trabajo las encontró al matricular de verdad al
-- estudiante demo y comprobar qué devolvía cada ruta.
--
-- Qué NO hace. No borra usuarios ni la fila de `tenants`: `users.tenant_id` es
-- obligatorio y apunta a ella, así que el tenant se RENOMBRA en vez de
-- borrarse. Tampoco toca `content_assets`, que alimenta clases magistrales y
-- eventos en vivo y es contenido que alguien del equipo debe revisar uno a uno
-- antes de decidir —no es evidente cuál es de TFU y cuál no, y borrar catálogo
-- a ciegas es peor que dejarlo.
--
-- Es idempotente: correrlo dos veces no hace daño.
--
-- ANTES DE CORRERLO, volcado de la base:
--   sudo -u postgres pg_dump -d tfu -Fc -f /var/lib/postgresql/x.dump
--   sudo mv /var/lib/postgresql/x.dump /var/backups/api/
--
-- Cómo se corre:
--   sudo -u postgres psql -d tfu -f limpiar-legacy-atlas.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Matrículas SIS de demostración
-- -----------------------------------------------------------------------------
-- Doce filas de seis usuarios que no son el estudiante demo, en aulas de Moodle
-- 3 a 7 —que no son ninguna de las trece de TFU— y en un periodo heredado. Las
-- escribió `apps/api/src/scripts/seed-demo.ts`. Importan porque los contadores
-- del panel cuentan esta tabla: el panel informaba de doce matrículas que no
-- existen.
--
-- El criterio del borrado es deliberadamente estrecho: sólo las filas cuyo aula
-- NO forma parte de ningún programa de TFU. Así una matrícula real nunca entra
-- en el conjunto, por mucho que este guion se vuelva a correr dentro de un año.
DELETE FROM student_enrollments se
 WHERE NOT EXISTS (
   SELECT 1
     FROM degree_requirements dr
     JOIN degree_programs dp ON dp.id = dr.degree_program_id
    WHERE dr.requirement_type = 'course'
      AND dr.moodle_course_id = se.moodle_course_id
      AND dp.code LIKE 'TFU-%'
 );

-- -----------------------------------------------------------------------------
-- 2. Permisos de contenido heredados
-- -----------------------------------------------------------------------------
-- `entitlements` servía por `/v1/entitlements` una lista de contenidos
-- `bundle-1`, `course-1`…`course-4` que no existen en TFU. La ruta se retiró del
-- código en esta misma tanda; estas filas son lo que alimentaba. Quien decide
-- de verdad si alguien ve un contenido es `GET /v1/courses/:id/content`, que
-- exige matrícula activa.
DELETE FROM entitlements
 WHERE content_id LIKE 'course-%'
    OR content_id LIKE 'bundle-%'
    OR content_id LIKE 'live-%';

-- -----------------------------------------------------------------------------
-- 3. Planes de precio inventados
-- -----------------------------------------------------------------------------
-- Tres ofertas —199, 249 y 29 USD— cuyas descripciones nombran a «Atlas Online
-- University» y que TFU nunca fijó. Se servían por `/v1/offers` y dentro de
-- `/v1/home`. El front no las pintaba (el commit 5502e42 quitó del portal el
-- lenguaje de compra), pero la API pública devolvía precios a nombre de una
-- institución real.
DELETE FROM offers
 WHERE id IN ('offer-course-pack', 'offer-sub-yearly', 'offer-sub-monthly')
    OR description ILIKE '%Atlas Online University%';

-- -----------------------------------------------------------------------------
-- 4. El tenant deja de llamarse Atlas
-- -----------------------------------------------------------------------------
-- No se borra: `users.tenant_id` es NOT NULL y apunta aquí, así que borrarlo se
-- llevaría por delante a todos los usuarios. Se renombra. La API ya no lo sirve
-- —`/v1/home` devolvía esta fila entera, con su logo de dummyimage.com, y ahora
-- devuelve el nombre de la institución desde la configuración—, pero el dato no
-- debe seguir diciendo Atlas en la base.
UPDATE tenants
   SET name = 'The Floridian University',
       slug = 'tfu',
       branding = jsonb_build_object(
         'primaryColor', '#0b203a',
         'accentColor', '#2dc4c7',
         'logoUrl', NULL
       )
 WHERE name ILIKE '%Atlas%' OR slug = 'university';

-- -----------------------------------------------------------------------------
-- 5. Periodos de demostración
-- -----------------------------------------------------------------------------
-- `DEMO-2025FA`, `DEMO-2026SP` y `DEMO-2026SU`. El segundo seguía marcado como
-- «activo» en octubre pese a haber terminado en mayo, porque `is_active` era un
-- interruptor manual. La API ahora lo deriva de las fechas en cada arranque
-- (`reconciliarPeriodos`), así que aquí sólo se borran los que ya no tienen
-- ninguna matrícula colgando. Si alguno la tuviera, se queda y se dice.
DELETE FROM academic_terms t
 WHERE t.code LIKE 'DEMO-%'
   AND NOT EXISTS (SELECT 1 FROM student_enrollments se WHERE se.term_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM academic_calendar ac WHERE ac.term_id = t.id);

COMMIT;

-- -----------------------------------------------------------------------------
-- Comprobación
-- -----------------------------------------------------------------------------
\echo '--- matrículas SIS que quedan (deben ser todas de aulas TFU) ---'
SELECT se.moodle_course_id, t.code AS periodo, dp.code AS programa, se.status, se.grade
  FROM student_enrollments se
  JOIN academic_terms t ON t.id = se.term_id
  LEFT JOIN degree_programs dp ON dp.id = se.degree_program_id
 ORDER BY t.code, dp.code;

\echo '--- periodos ---'
SELECT code, name, start_date, end_date, is_active FROM academic_terms ORDER BY start_date;

\echo '--- tenant ---'
SELECT id, slug, name FROM tenants;

\echo '--- restos (los tres deben dar 0) ---'
SELECT
  (SELECT count(*) FROM offers WHERE description ILIKE '%Atlas%')        AS ofertas_atlas,
  (SELECT count(*) FROM entitlements WHERE content_id LIKE 'course-%')   AS entitlements_legacy,
  (SELECT count(*) FROM tenants WHERE name ILIKE '%Atlas%')              AS tenants_atlas;
