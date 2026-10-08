<?php
/**
 * Etapa I — Course shells de muestra con la estructura de aula del
 * Master Syllabus TFU.
 *
 * El contrato (Clausula 3) pide "uno o dos course shells de muestra de la
 * Fase I, ya con la estructura de aula definida en el Master Syllabus". Los
 * cursos sincronizados tenian una sola seccion "General" vacia.
 *
 * La cadencia la define la Clausula 7 del contrato:
 *   - termino de ocho semanas, recalculado desde la fecha de inicio;
 *   - semana academica de MARTES a LUNES, con cierre a las 11:59 p.m. del Este;
 *   - apertura del silabo y las lecturas de la semana entrante cada VIERNES;
 *   - tres fechas limite semanales: discusion inicial, respuesta a companeros
 *     y entrega semanal.
 *
 * Esto se hace por CLI y no por web service porque el nucleo de Moodle no
 * expone ninguna funcion para crear modulos de curso; create_module() solo
 * existe en la API interna.
 *
 * Idempotente: si la seccion ya tiene actividades, el curso se salta entero.
 *
 * Uso: sudo php aula-modelo.php <shortname> [<shortname2> ...]
 */
define('CLI_SCRIPT', true);
require('/var/www/moodle/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->libdir . '/gradelib.php');

// can_add_moduleinfo() comprueba capacidades contra el usuario de la sesion, y
// en CLI no hay ninguno. Es el patron estandar de los scripts CLI de Moodle.
\core\session\manager::set_user(get_admin());

$shortnames = array_slice($argv, 1);
if (!$shortnames) {
    fwrite(STDERR, "Uso: php aula-modelo.php <shortname> [...]\n");
    exit(1);
}

$tz = new DateTimeZone('America/New_York');
$SEMANAS = 8;

/** Fecha de cierre (23:59 hora del Este) del dia indicado de la semana N. */
function cierre(DateTime $inicio, int $semana, int $diasDesdeInicioSemana, DateTimeZone $tz): int {
    $d = clone $inicio;
    $d->setTimezone($tz);
    $d->modify('+' . (($semana - 1) * 7 + $diasDesdeInicioSemana) . ' days');
    $d->setTime(23, 59, 0);
    return $d->getTimestamp();
}

function crear_modulo(stdClass $course, int $sectionnum, string $modname, array $datos) {
    $module = $GLOBALS['DB']->get_record('modules', ['name' => $modname], '*', MUST_EXIST);
    // create_module() exige `introeditor` (no `intro`) para todo modulo que
    // soporte FEATURE_MOD_INTRO, y en forma de editor: texto, formato e itemid.
    if (isset($datos['intro'])) {
        $datos['introeditor'] = ['text' => $datos['intro'], 'format' => FORMAT_HTML, 'itemid' => 0];
        unset($datos['intro']);
    }
    $mod = (object) array_merge([
        'modulename'          => $modname,
        'module'              => $module->id,
        'course'              => $course->id,
        'section'             => $sectionnum,
        'visible'             => 1,
        'visibleoncoursepage' => 1,
        'introformat'         => FORMAT_HTML,
        'completion'          => 0,
        'cmidnumber'          => '',
        'groupmode'           => 0,
        'groupingid'          => 0,
    ], $datos);
    return create_module($mod);
}

foreach ($shortnames as $short) {
    $course = $DB->get_record('course', ['shortname' => $short]);
    if (!$course) { echo "  · $short: no existe, se omite\n"; continue; }

    $modinfo = get_fast_modinfo($course);
    $actividades = 0;
    foreach ($modinfo->get_cms() as $cm) { if ($cm->modname !== 'forum' || $cm->sectionnum > 0) { $actividades++; } }
    if ($actividades > 0) { echo "  · $short: ya tiene estructura ($actividades actividades), se omite\n"; continue; }

    // El termino arranca el primer martes a partir de hoy.
    $inicio = new DateTime('now', $tz);
    $inicio->modify('next tuesday');
    $inicio->setTime(0, 0, 0);

    // Ocho secciones semanales mas la cero.
    $DB->set_field('course', 'format', 'topics', ['id' => $course->id]);
    course_create_sections_if_missing($course, range(0, $SEMANAS));

    $s0 = $DB->get_record('course_sections', ['course' => $course->id, 'section' => 0]);
    $DB->update_record('course_sections', (object)[
        'id' => $s0->id,
        'name' => 'Punto de partida · Start here',
        'summary' => '<p><strong>Semana academica: martes a lunes.</strong> Cada semana cierra el lunes a las 11:59 p.m. (hora del Este). El silabo y las lecturas de la semana entrante se abren el viernes anterior.</p>'
                   . '<p><strong>Academic week: Tuesday to Monday.</strong> Each week closes Monday at 11:59 p.m. Eastern. The syllabus and next week\'s readings open the preceding Friday.</p>',
        'summaryformat' => FORMAT_HTML,
    ]);

    crear_modulo($course, 0, 'page', [
        'name' => 'Silabo del curso · Course syllabus',
        'intro' => '<p>Version vigente del silabo para esta seccion.</p>',
        'page' => ['itemid' => 0, 'text' => '<p>El silabo publicado se inserta aqui desde el modulo de silabos (Etapa II). Esta pagina es su destino dentro del aula, conforme a la Clausula 6 del contrato.</p><p>The published syllabus is inserted here from the syllabus module (Stage II). This page is its destination inside the classroom, per Clause 6 of the contract.</p>', 'format' => FORMAT_HTML],
        'display' => 5, 'printheading' => 1, 'printintro' => 0, 'printlastmodified' => 1,
    ]);

    for ($w = 1; $w <= $SEMANAS; $w++) {
        $ini = clone $inicio; $ini->modify('+' . (($w - 1) * 7) . ' days');
        $fin = clone $ini;    $fin->modify('+6 days');
        $rango = $ini->format('j M') . ' – ' . $fin->format('j M');

        $sec = $DB->get_record('course_sections', ['course' => $course->id, 'section' => $w]);
        $DB->update_record('course_sections', (object)[
            'id' => $sec->id,
            'name' => "Semana $w · Week $w ($rango)",
            'summary' => "<p>Apertura: viernes anterior. Cierre: lunes 11:59 p.m. ET.</p><p>Opens: preceding Friday. Closes: Monday 11:59 p.m. ET.</p>",
            'summaryformat' => FORMAT_HTML,
        ]);

        crear_modulo($course, $w, 'page', [
            'name' => "Semana $w · Lecturas y objetivos",
            'intro' => '<p>Materiales de la semana.</p>',
            'page' => ['itemid' => 0, 'text' => "<p>Objetivos de aprendizaje y lecturas de la semana $w. Se abre el viernes anterior al inicio de la semana.</p>", 'format' => FORMAT_HTML],
            'display' => 5, 'printheading' => 1, 'printintro' => 0, 'printlastmodified' => 1,
        ]);

        // Discusion: publicacion inicial el jueves (dia 2), respuesta el sabado (dia 4).
        crear_modulo($course, $w, 'forum', [
            'name' => "Semana $w · Discusion",
            'intro' => '<p><strong>Publicacion inicial:</strong> jueves 11:59 p.m. ET. <strong>Respuesta a companeros:</strong> sabado 11:59 p.m. ET.</p>'
                     . '<p><strong>Initial post:</strong> Thursday 11:59 p.m. ET. <strong>Peer response:</strong> Saturday 11:59 p.m. ET.</p>',
            'type' => 'general', 'forcesubscribe' => 0,
            'duedate' => cierre($ini, 1, 2, $tz),
            'cutoffdate' => cierre($ini, 1, 4, $tz),
        ]);

        // Entrega semanal: lunes (dia 6), que es el cierre de la semana.
        crear_modulo($course, $w, 'assign', [
            'name' => "Semana $w · Entrega aplicada",
            'intro' => '<p>Entrega de la semana. Cierre: lunes 11:59 p.m. ET.</p><p>Weekly submission. Closes Monday 11:59 p.m. ET.</p>',
            'alwaysshowdescription' => 1,
            'duedate' => cierre($ini, 1, 6, $tz),
            'allowsubmissionsfromdate' => $ini->getTimestamp(),
            'gradingduedate' => cierre($ini, 1, 13, $tz),
            'submissiondrafts' => 0, 'requiresubmissionstatement' => 0,
            // Columnas NOT NULL de mdl_assign que el formulario envia siempre
            // y create_module() no rellena por su cuenta.
            'sendnotifications' => 0, 'sendlatenotifications' => 0,
            'sendstudentnotifications' => 1, 'cutoffdate' => 0,
            'blindmarking' => 0, 'requireallteammemberssubmit' => 0,
            'attemptreopenmethod' => 'none', 'markingworkflow' => 0,
            'markingallocation' => 0, 'completionsubmit' => 0,
            'grade' => 100, 'maxattempts' => -1, 'teamsubmission' => 0,
            'assignsubmission_onlinetext_enabled' => 1, 'assignsubmission_onlinetext_wordlimitenabled' => 0,
            'assignsubmission_file_enabled' => 1, 'assignsubmission_file_maxfiles' => 3,
            'assignsubmission_file_maxsizebytes' => 0,
            'assignfeedback_comments_enabled' => 1,
        ]);
    }

    $DB->set_field('course', 'startdate', $inicio->getTimestamp(), ['id' => $course->id]);
    $finCurso = clone $inicio; $finCurso->modify('+' . ($SEMANAS * 7) . ' days');
    $DB->set_field('course', 'enddate', $finCurso->getTimestamp(), ['id' => $course->id]);

    rebuild_course_cache($course->id, true);
    echo "  · $short: $SEMANAS semanas creadas, inicio " . $inicio->format('Y-m-d') . "\n";
}

purge_all_caches();
echo "listo\n";
