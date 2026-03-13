import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

const CONTAINER = 'pae-u-moodle-1';

function runDocker(args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

async function run() {
  console.log('Poblando contenido demo en cursos Moodle (videos + actividades)...');

  const outDir = resolve(process.cwd(), '../../.data');
  mkdirSync(outDir, { recursive: true });
  const phpFile = resolve(outDir, 'populate-moodle-demo-content.php');

  const php = `<?php
define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/mod/page/lib.php');
require_once($CFG->dirroot . '/mod/url/lib.php');
global $DB;

$admin = get_admin();
if ($admin) {
  \\core\\session\\manager::set_user($admin);
}

$demoVideo = 'http://localhost:${config.server.port}/v1/media/demo.mp4';

function ensure_section($course, int $sectionnum, string $name, string $summary): void {
  global $DB;
  course_create_sections_if_missing($course, [$sectionnum]);
  $section = $DB->get_record('course_sections', ['course' => $course->id, 'section' => $sectionnum], '*', MUST_EXIST);
  $section->name = $name;
  $section->summary = $summary;
  $section->summaryformat = FORMAT_HTML;
  $DB->update_record('course_sections', $section);
}

function module_exists(int $courseid, string $modname, string $name): bool {
  global $DB;
  $sql = "SELECT cm.id
            FROM {course_modules} cm
            JOIN {modules} m ON m.id = cm.module
            JOIN {" . $modname . "} x ON x.id = cm.instance
           WHERE cm.course = :courseid
             AND m.name = :modname
             AND x.name = :name";
  return (bool)$DB->record_exists_sql($sql, [
    'courseid' => $courseid,
    'modname' => $modname,
    'name' => $name
  ]);
}

function add_page_if_missing($course, int $section, string $name, string $content): void {
  if (module_exists((int)$course->id, 'page', $name)) {
    return;
  }
  $module = $GLOBALS['DB']->get_record('modules', ['name' => 'page'], '*', MUST_EXIST);
  $moduleinfo = (object)[
    'course' => (int)$course->id,
    'section' => $section,
    'module' => (int)$module->id,
    'modulename' => 'page',
    'name' => $name,
    'intro' => '<p>Actividad de práctica para afianzar conceptos clave.</p>',
    'introformat' => FORMAT_HTML,
    'content' => $content,
    'contentformat' => FORMAT_HTML,
    'visible' => 1,
    'groupmode' => 0,
    'groupingid' => 0
  ];
  add_moduleinfo($moduleinfo, $course);
}

function add_url_if_missing($course, int $section, string $name, string $url): void {
  $existing = $GLOBALS['DB']->get_record('url', ['course' => (int)$course->id, 'name' => $name]);
  $intro = '<p>Video demo del módulo.</p><video controls preload="metadata" style="width:100%;max-width:960px;border-radius:12px;background:#000;"><source src="' . s($url) . '" type="video/mp4"></video>';
  if ($existing) {
    $existing->externalurl = $url;
    $existing->intro = $intro;
    $existing->introformat = FORMAT_HTML;
    $GLOBALS['DB']->update_record('url', $existing);
    return;
  }
  $module = $GLOBALS['DB']->get_record('modules', ['name' => 'url'], '*', MUST_EXIST);
  $moduleinfo = (object)[
    'course' => (int)$course->id,
    'section' => $section,
    'module' => (int)$module->id,
    'modulename' => 'url',
    'name' => $name,
    'intro' => $intro,
    'introformat' => FORMAT_HTML,
    'externalurl' => $url,
    'display' => 0,
    'visible' => 1,
    'groupmode' => 0,
    'groupingid' => 0
  ];
  add_moduleinfo($moduleinfo, $course);
}

$courses = $DB->get_records_select('course', 'id > 1 AND visible = 1', null, 'id ASC');
$processed = 0;

foreach ($courses as $course) {
  $courseObj = get_course((int)$course->id);

  ensure_section($courseObj, 1, 'Módulo 1 · Fundamentos', '<p>Introducción al curso, objetivos y plan de trabajo.</p>');
  ensure_section($courseObj, 2, 'Módulo 2 · Aplicación práctica', '<p>Desarrollo de casos, herramientas y práctica guiada.</p>');
  ensure_section($courseObj, 3, 'Módulo 3 · Cierre y evaluación', '<p>Síntesis de aprendizajes y plan de acción final.</p>');

  add_url_if_missing($courseObj, 1, 'Video 1 · Bienvenida', $demoVideo);
  add_page_if_missing($courseObj, 1, 'Actividad 1 · Reflexión inicial', '<h3>Actividad inicial</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Define 3 objetivos de aprendizaje y compártelos.</p>');

  add_url_if_missing($courseObj, 2, 'Video 2 · Desarrollo', $demoVideo);
  add_page_if_missing($courseObj, 2, 'Actividad 2 · Aplicación', '<h3>Aplicación práctica</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Describe un caso real y cómo aplicarías la metodología del curso.</p>');

  add_url_if_missing($courseObj, 3, 'Video 3 · Cierre', $demoVideo);
  add_page_if_missing($courseObj, 3, 'Quiz de repaso (demo)', '<h3>Quiz de repaso (demo)</h3><p>1) ¿Cuál fue el aprendizaje clave?<br>2) ¿Qué acción ejecutarás esta semana?<br>3) ¿Cómo medirás tu progreso?</p>');

  $processed++;
}

echo json_encode([
  'processedCourses' => $processed
], JSON_PRETTY_PRINT) . PHP_EOL;
`;

  writeFileSync(phpFile, php, 'utf8');
  runDocker(['cp', phpFile, `${CONTAINER}:/tmp/populate-moodle-demo-content.php`]);
  const output = runDocker(['exec', CONTAINER, 'php', '/tmp/populate-moodle-demo-content.php']);
  console.log(output.trim());

  if (config.admin.apiKey) {
    try {
      await fetch(`http://localhost:${config.server.port}/admin/moodle/sync/all`, {
        method: 'POST',
        headers: { 'x-admin-key': config.admin.apiKey }
      });
      console.log('Sincronización del intermediador ejecutada.');
    } catch (error) {
      console.warn(`No se pudo disparar sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
