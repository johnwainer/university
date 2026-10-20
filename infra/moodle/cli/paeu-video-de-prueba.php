<?php
/**
 * Pone un video de prueba en un aula, para que TFU pueda verlo.
 *
 * POR QUE EXISTE
 *
 * TFU pidio «we would like to test a video in the online classroom: we cannot
 * visualize what a video would look like there». El aula del portal SI sabe
 * pintar video —reproductor nativo para archivos y, desde el cambio que
 * acompana a este guion, iframe para YouTube y Vimeo—, pero ninguna de las
 * trece aulas tiene una actividad de video, asi que no habia nada que mirar.
 *
 * Esto crea una actividad de tipo `url` en la seccion de Recursos de
 * aprendizaje (§8 del Master Syllabus) apuntando al video que se indique.
 *
 * POR QUE POR CLI Y NO POR SERVICIO WEB
 *
 * De las 21 funciones habilitadas, ninguna crea modulos de curso. El nucleo de
 * Moodle solo expone create_module() en la API interna. Hace falta shell en la
 * maquina de Moodle (admin@34.200.208.43).
 *
 * QUE VE EL ESTUDIANTE
 *
 *   YouTube o Vimeo  ->  el video incrustado dentro del aula.
 *   otra URL         ->  un boton para abrir el enlace.
 *   archivo .mp4     ->  reproductor nativo (eso se sube como `resource`,
 *                        no lo hace este guion).
 *
 * Uso:
 *   sudo -u www-data php paeu-video-de-prueba.php --curso=PCL-EDU-WALK --dry-run
 *   sudo -u www-data php paeu-video-de-prueba.php --curso=PCL-EDU-WALK \
 *        --url=https://www.youtube.com/watch?v=XXXXXXXXXXX
 *
 * Idempotente: si ya existe una actividad con el mismo nombre en esa seccion,
 * actualiza su URL en vez de crear otra.
 */

define('CLI_SCRIPT', true);
require_once(__DIR__ . '/../paeu-bootstrap.php');
require(paeu_config_moodle());
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->libdir . '/clilib.php');

// create_module() comprueba capacidades contra el usuario de la sesion y en
// CLI no hay ninguno. Es el patron estandar de los guiones CLI de Moodle.
\core\session\manager::set_user(get_admin());

list($opciones, $sinreconocer) = cli_get_params(
    [
        'curso'    => null,
        // Video por omision: la charla «What is generative AI?» no sirve aqui,
        // porque un enlace que caduque deja al aula con un reproductor roto y
        // nadie sabria si el fallo es del portal. Sin --url el guion NO inventa
        // un video: pide uno.
        'url'      => null,
        'nombre'   => 'Video de bienvenida (prueba)',
        'seccion'  => 4,
        'dry-run'  => false,
        'help'     => false,
    ],
    ['h' => 'help', 'n' => 'dry-run']
);

if ($opciones['help'] || !$opciones['curso'] || !$opciones['url']) {
    cli_writeln('Pone una actividad de video en un aula.');
    cli_writeln('  --curso=<shortname>   aula de Moodle (obligatorio), p. ej. PCL-EDU-WALK');
    cli_writeln('  --url=<enlace>        URL del video (obligatorio). YouTube y Vimeo se incrustan.');
    cli_writeln('  --nombre=<texto>      nombre de la actividad');
    cli_writeln('  --seccion=<n>         seccion del curso (por omision 4, Recursos de aprendizaje)');
    cli_writeln('  --dry-run, -n         muestra lo que haria sin tocar nada');
    exit($opciones['help'] ? 0 : 2);
}

$seco = (bool)$opciones['dry-run'];
$shortname = clean_param((string)$opciones['curso'], PARAM_TEXT);
$url = clean_param((string)$opciones['url'], PARAM_URL);
$nombre = clean_param((string)$opciones['nombre'], PARAM_TEXT);
$seccion = (int)$opciones['seccion'];

if ($url === '') {
    cli_error('La URL no es valida.', 2);
}

$curso = $DB->get_record('course', ['shortname' => $shortname]);
if (!$curso) {
    cli_error("No existe el aula con shortname '{$shortname}'.", 2);
}
cli_writeln("Aula: {$curso->shortname} (id {$curso->id})");

// El portal incrusta estos dos; cualquier otro dominio sale como enlace. Se
// avisa para que nadie concluya que el aula «no muestra el video» cuando lo
// que pasa es que ese servicio no se puede incrustar.
$host = strtolower((string)parse_url($url, PHP_URL_HOST));
$incrustable = (strpos($host, 'youtube.com') !== false)
    || (strpos($host, 'youtu.be') !== false)
    || (strpos($host, 'vimeo.com') !== false);
cli_writeln($incrustable
    ? '  el portal lo incrustara dentro del aula'
    : "  AVISO: {$host} no es YouTube ni Vimeo; el portal lo mostrara como enlace, no incrustado");

// Busqueda de la actividad por nombre dentro del curso, para ser idempotente.
$modinfo = get_fast_modinfo($curso);
$existente = null;
foreach ($modinfo->get_cms() as $cm) {
    if ($cm->modname === 'url' && trim($cm->name) === $nombre) {
        $existente = $cm;
        break;
    }
}

if ($existente) {
    $registro = $DB->get_record('url', ['id' => $existente->instance], '*', MUST_EXIST);
    if ($registro->externalurl === $url) {
        cli_writeln("  la actividad '{$nombre}' ya existe con esa misma URL: nada que hacer");
        exit(0);
    }
    if ($seco) {
        cli_writeln("  [SIMULACION] se actualizaria la URL de '{$nombre}'");
        exit(0);
    }
    $registro->externalurl = $url;
    $registro->timemodified = time();
    $DB->update_record('url', $registro);
    rebuild_course_cache($curso->id, true);
    cli_writeln("  actualizada la URL de la actividad '{$nombre}'");
    exit(0);
}

if ($seco) {
    cli_writeln("  [SIMULACION] se crearia la actividad '{$nombre}' en la seccion {$seccion}");
    exit(0);
}

$modulo = $DB->get_record('modules', ['name' => 'url'], '*', MUST_EXIST);
$datos = (object)[
    'modulename'          => 'url',
    'module'              => $modulo->id,
    'course'              => $curso->id,
    'section'             => $seccion,
    'name'                => $nombre,
    'externalurl'         => $url,
    // `display` = 0 (automatico). El portal no usa la pagina de Moodle: lee la
    // URL por servicio web y la pinta el mismo, asi que este valor solo afecta
    // a quien entre al LMS directamente.
    'display'             => 0,
    'introeditor'         => [
        'text'   => '<p>Video de prueba cargado para que la universidad vea como se '
                  . 'muestra el material audiovisual dentro del aula.</p>',
        'format' => FORMAT_HTML,
        'itemid' => 0,
    ],
    'introformat'         => FORMAT_HTML,
    'showdescription'     => 1,
    'visible'             => 1,
    'visibleoncoursepage' => 1,
    'completion'          => 0,
    'cmidnumber'          => '',
    'groupmode'           => 0,
    'groupingid'          => 0,
];

$creado = create_module($datos);
rebuild_course_cache($curso->id, true);
cli_writeln("  creada la actividad '{$nombre}' (cmid {$creado->coursemodule})");
cli_writeln('');
cli_writeln('Comprobacion desde el portal: entra al aula de ese programa con una');
cli_writeln('cuenta matriculada y abre la actividad en la seccion indicada.');
