-- =============================================================================
-- Retirada de la ficción de la plantilla «Atlas Online University»
-- =============================================================================
--
-- ESTE GUION LO EJECUTA UNA PERSONA, A PROPÓSITO.
-- Retira filas de la base de PRODUCCIÓN. No lo corre ningún despliegue ni
-- ninguna tarea automática. Léase entero antes de ejecutarlo.
--
-- Qué es esto y por qué no se limita a renombrar. La plataforma de TFU se
-- construyó sobre un producto anterior, «Atlas Online University», cuya siembra
-- de demostración dejó en la base de producción personas, certificados,
-- facturas y pagos que nunca existieron. Un barrido de las 314 columnas de
-- texto de la base encontró esto:
--
--   usuarios ficticios .................. 11  (@atlas.edu, @demo.atlas.edu)
--   prospectos del CRM .................. 15  (@prospect.demo.atlas.edu)
--   directorio de personal ..............  8  (@atlas.edu, @contractor.atlas.edu)
--   certificados ........................  7  (serie ATLAS-DEMO-*)
--   apuntes del libro mayor ............. 15
--   facturas / pagos .................... 6 / 6
--   ayuda financiera / retenciones ...... 4 / 3
--   registro de accesos FERPA ...........  5  (registrar@atlas.edu)
--   mensajes de contacto de prueba ...... 42  (todos de @test.invalid, 8 oct)
--   solicitudes de admisión ............. 12 ficticias + 2 reales
--
-- **No se reescriben los dominios a `@thefloridianuniversity.com`.** Hacerlo
-- convertiría ocho empleados inventados, siete certificados inventados y quince
-- prospectos inventados en empleados, certificados y prospectos aparentemente
-- reales de una universidad real y acreditada. Eso es peor que no tenerlos, y
-- choca de frente con la regla del proyecto de no inventar contenido
-- institucional. Por eso se retiran en vez de renombrarse.
--
-- Lo que sí se reescribe es el campo de integridad académica de los sílabos:
-- ahí el sílabo es real de TFU y lo único equivocado es el nombre de la
-- institución.
--
-- Lo que NO se toca:
--   - `demo.estudiante@thefloridianuniversity.com` y sus 2 matrículas SIS.
--   - `academic_calendar` (20) y `degree_requirements` (25): son datos reales de
--     TFU; de Atlas sólo llevaban la clave del tenant, que se renombra abajo.
--   - `content_assets`: contenido que alguien del equipo debe revisar uno a uno.
--
-- Es idempotente: correrlo dos veces no hace daño.
--
-- ANTES DE CORRERLO, volcado de la base (no es opcional):
--   sudo -u postgres pg_dump -d atlas -Fc -f /var/lib/postgresql/pre-retirada.dump
--   sudo mkdir -p /var/backups/api
--   sudo mv /var/lib/postgresql/pre-retirada.dump /var/backups/api/
--
-- Cómo se corre:
--   sudo -u postgres psql -d atlas -f retirar-ficcion-atlas.sql
--
-- Si algo sale mal, se restaura con:
--   sudo -u postgres pg_restore -d atlas --clean /var/backups/api/pre-retirada.dump
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Quiénes son los usuarios ficticios
-- -----------------------------------------------------------------------------
-- Se calcula una vez y se reutiliza, para que el criterio sea idéntico en todas
-- las tablas y no haya forma de que una se quede a medias.
CREATE TEMP TABLE ficticios AS
  SELECT id, email FROM users WHERE email ILIKE '%atlas%';

\echo '--- usuarios ficticios detectados (se esperan 11) ---'
SELECT count(*) AS usuarios_a_retirar FROM ficticios;

-- -----------------------------------------------------------------------------
-- 1. Expediente financiero y académico de los usuarios ficticios
-- -----------------------------------------------------------------------------
-- En orden de dependencia: los pagos cuelgan de las facturas.
DELETE FROM payments         WHERE student_user_id IN (SELECT id FROM ficticios);
DELETE FROM invoices         WHERE student_user_id IN (SELECT id FROM ficticios);
DELETE FROM student_ledger   WHERE student_user_id IN (SELECT id FROM ficticios);
DELETE FROM financial_aid    WHERE student_user_id IN (SELECT id FROM ficticios);
DELETE FROM enrollment_holds WHERE student_user_id IN (SELECT id FROM ficticios);

-- -----------------------------------------------------------------------------
-- 2. Certificados inventados
-- -----------------------------------------------------------------------------
-- Siete, con serie `ATLAS-DEMO-*`. Un certificado acredita algo ante terceros;
-- dejar siete falsos en la base de una universidad acreditada, aunque fuera con
-- otro nombre de serie, no es aceptable.
DELETE FROM certificates
 WHERE student_user_id IN (SELECT id FROM ficticios)
    OR serial ILIKE '%atlas%';

-- -----------------------------------------------------------------------------
-- 3. CRM y directorio de personal
-- -----------------------------------------------------------------------------
DELETE FROM crm_contacts
 WHERE email ILIKE '%atlas%' OR owner_email ILIKE '%atlas%';

DELETE FROM staff_directory WHERE email ILIKE '%atlas%';

-- -----------------------------------------------------------------------------
-- 4. Registro de accesos FERPA
-- -----------------------------------------------------------------------------
-- Cinco apuntes cuyo actor es `registrar@atlas.edu`, una cuenta que no existe.
-- Un registro de auditoría con actores inventados es peor que uno vacío:
-- parece una traza y no lo es.
DELETE FROM ferpa_access_log
 WHERE actor_email ILIKE '%atlas%'
    OR subject_user_id IN (SELECT id FROM ficticios);

-- -----------------------------------------------------------------------------
-- 5. Mensajes de contacto de prueba
-- -----------------------------------------------------------------------------
-- Los 42 son del 8 de octubre y vienen de `@test.invalid`: son las pruebas del
-- formulario público, no correo real. Se comprobó antes de escribir esto que no
-- hay ningún mensaje real entre ellos.
DELETE FROM contact_messages
 WHERE email ILIKE '%test.invalid%'
    OR email ILIKE '%atlas%'
    OR handled_by ILIKE '%atlas%';

-- -----------------------------------------------------------------------------
-- 6. Solicitudes de admisión
-- -----------------------------------------------------------------------------
-- Doce ficticias; las dos del estudiante demo de TFU se quedan. El criterio es
-- el dominio del correo, no el identificador, para que una solicitud real nunca
-- entre en el conjunto por mucho que esto se vuelva a correr.
DELETE FROM admissions_applications WHERE email ILIKE '%atlas%';

-- -----------------------------------------------------------------------------
-- 7. Los usuarios
-- -----------------------------------------------------------------------------
-- Al final, cuando ya no cuelga nada de ellos. `public_user_auth` y el resto
-- cae por clave ajena en cascada.
DELETE FROM users WHERE id IN (SELECT id FROM ficticios);

-- -----------------------------------------------------------------------------
-- 8. Los sílabos nombran a la institución equivocada
-- -----------------------------------------------------------------------------
-- Aquí NO se retira nada: el sílabo es real de TFU y lo único equivocado es el
-- nombre en el campo de integridad académica. Se reescribe sobre el jsonb sin
-- tocar el resto del documento.
UPDATE syllabi
   SET content = jsonb_set(
         content,
         '{academic_integrity}',
         to_jsonb(replace(content->>'academic_integrity',
                          'Atlas Online University',
                          'The Floridian University'))
       )
 WHERE content->>'academic_integrity' ILIKE '%atlas%';

-- -----------------------------------------------------------------------------
-- 9. La clave del tenant deja de decir Atlas
-- -----------------------------------------------------------------------------
-- `tenants.id` valía literalmente `tenant-atlas` y lo referencian catorce
-- tablas. No se puede renombrar la fila sin arrastrar las referencias, así que
-- se inserta la nueva, se repuntan las claves ajenas y se retira la vieja, todo
-- dentro de esta misma transacción.
--
-- El nombre y el slug ya eran los de TFU desde la limpieza anterior; lo que
-- quedaba era la clave primaria.
INSERT INTO tenants (id, slug, name, locales, currency, branding)
SELECT 'tenant-tfu', slug, name, locales, currency, branding
  FROM tenants WHERE id = 'tenant-atlas'
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  t record;
BEGIN
  -- Se recorren las tablas que de verdad tienen columna `tenant_id`, en vez de
  -- escribir la lista a mano: así no se olvida ninguna hoy ni cuando alguien
  -- añada una tabla mañana.
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = c.table_schema AND x.table_name = c.table_name
       AND x.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
  LOOP
    EXECUTE format('UPDATE %I SET tenant_id = %L WHERE tenant_id = %L',
                   t.table_name, 'tenant-tfu', 'tenant-atlas');
  END LOOP;
END $$;

DELETE FROM tenants WHERE id = 'tenant-atlas';

COMMIT;

-- -----------------------------------------------------------------------------
-- Comprobación
-- -----------------------------------------------------------------------------
\echo '--- el estudiante real y sus matrículas deben seguir ahí ---'
SELECT u.email,
       (SELECT count(*) FROM student_enrollments s WHERE s.user_id = u.id) AS matriculas_sis
  FROM users u ORDER BY u.email;

\echo '--- datos reales de TFU, que no se tocan ---'
SELECT 'academic_calendar'   AS tabla, count(*) FROM academic_calendar
UNION ALL SELECT 'degree_requirements', count(*) FROM degree_requirements
UNION ALL SELECT 'degree_programs',     count(*) FROM degree_programs
UNION ALL SELECT 'moodle_courses',      count(*) FROM moodle_courses
UNION ALL SELECT 'content_assets',      count(*) FROM content_assets;

\echo '--- tenant: la clave debe ser tenant-tfu ---'
SELECT id, slug, name FROM tenants;

\echo '--- barrido final: estas cuentas deben dar todas 0 ---'
SELECT 'users'                   AS tabla, count(*) FROM users                   WHERE email ILIKE '%atlas%'
UNION ALL SELECT 'crm_contacts',           count(*) FROM crm_contacts            WHERE email ILIKE '%atlas%' OR owner_email ILIKE '%atlas%'
UNION ALL SELECT 'staff_directory',        count(*) FROM staff_directory         WHERE email ILIKE '%atlas%'
UNION ALL SELECT 'certificates',           count(*) FROM certificates            WHERE serial ILIKE '%atlas%'
UNION ALL SELECT 'ferpa_access_log',       count(*) FROM ferpa_access_log        WHERE actor_email ILIKE '%atlas%'
UNION ALL SELECT 'contact_messages',       count(*) FROM contact_messages        WHERE handled_by ILIKE '%atlas%' OR email ILIKE '%atlas%'
UNION ALL SELECT 'admissions_applications', count(*) FROM admissions_applications WHERE email ILIKE '%atlas%'
UNION ALL SELECT 'syllabi',                count(*) FROM syllabi                 WHERE content::text ILIKE '%atlas%'
UNION ALL SELECT 'tenants',                count(*) FROM tenants                 WHERE id ILIKE '%atlas%';
