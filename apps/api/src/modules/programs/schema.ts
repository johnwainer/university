import type { Pool } from 'pg';

/**
 * Composición de los programas: qué cursos contiene cada uno.
 *
 * El modelo del producto es que el programa es la unidad que el estudiante ve
 * y en la que se matricula, y los cursos viven DENTRO del programa. Nadie ve
 * ni cursa un curso suelto.
 *
 * La relación ya tenía sitio en el esquema: `degree_requirements` con
 * `requirement_type = 'course'` es, literalmente, «este curso forma parte de
 * este programa», y es lo que lee la auditoría de grado del módulo SIS. Se
 * reutiliza esa tabla en vez de crear otra, para no acabar con dos fuentes de
 * verdad que puedan discrepar.
 *
 * Lo único que le faltaba era un orden: un programa con varios cursos necesita
 * decir cuál va primero, y la tabla no tenía por dónde.
 */
export async function migratePrograms(pool: Pool): Promise<void> {
  await pool.query(`
    ALTER TABLE degree_requirements
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

    -- Un curso no puede estar dos veces en el mismo programa.
    CREATE UNIQUE INDEX IF NOT EXISTS degree_requirements_curso_unico
      ON degree_requirements(degree_program_id, moodle_course_id)
      WHERE requirement_type = 'course' AND moodle_course_id IS NOT NULL;
  `);

  await limpiarVinculosDeDemostracion(pool);
  await sembrarComposicionTfu(pool);
}

/**
 * Quita los vínculos programa-curso que dejó la semilla de demostración.
 *
 * Seis programas `DEMO-*`, todos desactivados, apuntaban al mismo curso
 * heredado (`historia-del-arte-occidental`), que ni es de TFU ni es visible.
 * Con el modelo nuevo eso ensucia la composición: el panel los mostraba como
 * programas con curso, y rompían la regla de que un curso pertenece a un solo
 * programa.
 *
 * Se borran SÓLO los vínculos, no los programas: siguen desactivados y con sus
 * claves foráneas intactas, como estaban. Y sólo de programas inactivos con
 * código de demostración o de QA, para no tocar nada real.
 */
async function limpiarVinculosDeDemostracion(pool: Pool): Promise<void> {
  const { rowCount } = await pool.query(`
    DELETE FROM degree_requirements dr
     USING degree_programs dp
     WHERE dr.degree_program_id = dp.id
       AND dr.requirement_type = 'course'
       AND dp.is_active = false
       AND (dp.code LIKE 'DEMO-%' OR dp.code LIKE 'QA%')
  `);
  if (rowCount) {
    console.log(`[programas] retirados ${rowCount} vínculo(s) de programas de demostración`);
  }
}

/**
 * Siembra la composición de los programas de TFU.
 *
 * NO se inventa nada: la correspondencia ya existe en los datos como
 * convención de nombres. Cada programa `TFU-<X>` tiene su aula en Moodle con
 * el nombre corto `PCL-<X>`. Comprobado contra producción antes de escribir
 * esto: los 13 programas emparejan, y no hay ningún curso PCL visible sin
 * programa ni ningún programa sin curso.
 *
 * Sólo inserta lo que falta. Si alguien recompone un programa a mano desde el
 * panel, un despliegue posterior no debe deshacerlo.
 */
async function sembrarComposicionTfu(pool: Pool): Promise<void> {
  const { rows } = await pool.query(`
    INSERT INTO degree_requirements (degree_program_id, requirement_type, moodle_course_id, description, sort_order)
    SELECT dp.id, 'course', mc.moodle_course_id,
           'Curso del programa ' || dp.code, 0
      FROM degree_programs dp
      JOIN moodle_courses mc ON mc.short_name = 'PCL-' || substr(dp.code, 5)
     WHERE dp.code LIKE 'TFU-%'
       AND NOT EXISTS (
         SELECT 1 FROM degree_requirements dr
          WHERE dr.degree_program_id = dp.id
            AND dr.requirement_type = 'course'
            AND dr.moodle_course_id = mc.moodle_course_id
       )
    RETURNING id
  `);
  if (rows.length) {
    // Útil en los registros del arranque: dice cuántos vínculos se crearon la
    // primera vez y confirma que las veces siguientes no se toca nada.
    console.log(`[programas] vinculados ${rows.length} curso(s) a su programa`);
  }
}
