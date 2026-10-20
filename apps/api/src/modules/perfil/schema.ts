import type { Pool } from 'pg';
import {
  VALORES_CONTACTO_PREFERIDO,
  VALORES_FAMILIARIDAD_IA
} from './catalogos.js';

/**
 * Perfil extendido del estudiante.
 *
 * Por qué una tabla aparte y no columnas en `users`: `users` es la identidad
 * —nombre, correo, idioma, roles— y la escriben el registro público, la
 * sincronización con Moodle y el panel. El perfil es declarativo, lo llena el
 * estudiante, y la mitad de sus campos NO son visibles para él mismo en la
 * ficha pública sino sólo para docentes y staff. Mezclarlos obligaría a filtrar
 * columnas en cada consulta de identidad que ya existe, que es exactamente la
 * clase de descuido con el que se filtra un dato.
 *
 * LA LÍNEA DE VISIBILIDAD ESTÁ EN EL NOMBRE DE LAS COLUMNAS.
 *
 * Los campos que TFU marcó como «visible to instructors and staff only» están
 * agrupados abajo, detrás de un comentario, y el API los sirve en un objeto
 * distinto (`staff`). Así, añadir un campo al bloque equivocado se ve al leer
 * el esquema y no hace falta recordar una lista en otro archivo.
 *
 * Qué NO lleva esta tabla: fecha de nacimiento, documento de identidad,
 * dirección, género ni datos de salud. No los pidió TFU y un dato que no se
 * guarda no se filtra.
 */
export async function migratePerfiles(pool: Pool): Promise<void> {
  const familiaridad = VALORES_FAMILIARIDAD_IA.map((v) => `'${v}'`).join(',');
  const contacto = VALORES_CONTACTO_PREFERIDO.map((v) => `'${v}'`).join(',');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

      /* ---- Visible para la institución y para quien acompaña al estudiante */
      preferred_name TEXT,
      avatar_url TEXT,
      avatar_object_key TEXT,
      headline TEXT,
      industry TEXT,
      bio TEXT,
      country_region TEXT,
      portfolio_url TEXT,

      /* ---- Sólo docentes y staff ---------------------------------------- */
      legal_name TEXT,
      -- OJO: la columna NO se llama current_role.
      --
      -- 'current_role' es palabra reservada en PostgreSQL (es una función del
      -- estándar, como current_user), y un CREATE TABLE que la use sin comillas
      -- falla con: syntax error at or near "current_role". Entrecomillarla
      -- obligaría a entrecomillarla en cada consulta para siempre, así que la
      -- columna se llama current_position y el campo de la API sigue siendo
      -- 'currentRole', que es el nombre que usó TFU.
      current_position TEXT,
      years_experience INTEGER CHECK (years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 70)),
      ai_familiarity TEXT CHECK (ai_familiarity IS NULL OR ai_familiarity IN (${familiaridad})),
      learning_goals TEXT[] NOT NULL DEFAULT '{}',
      time_zone TEXT,
      preferred_contact TEXT CHECK (preferred_contact IS NULL OR preferred_contact IN (${contacto})),
      languages TEXT,
      language_support TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Índice para el panel: el staff lista estudiantes por industria y por
  // familiaridad con IA para armar cohortes, y son las dos únicas columnas de
  // este módulo por las que se filtra.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS student_profiles_industria_idx
      ON student_profiles(industry)
      WHERE industry IS NOT NULL;
    CREATE INDEX IF NOT EXISTS student_profiles_familiaridad_idx
      ON student_profiles(ai_familiarity)
      WHERE ai_familiarity IS NOT NULL;
  `);
}
