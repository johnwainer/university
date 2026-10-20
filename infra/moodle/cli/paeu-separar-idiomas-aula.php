<?php
/**
 * Convierte los nombres "Español · English" del aula en marcado multiidioma.
 *
 * EL PROBLEMA, COMPROBADO CONTRA PRODUCCION EL 20 DE OCTUBRE
 *
 * El API ya resuelve el idioma del contenido del aula: /v1/courses/:id/content
 * acepta ?locale= y separa el marcado multiidioma. Pero al pedir el MISMO curso
 * en los dos idiomas sale exactamente el mismo texto:
 *
 *   locale=en -> "Punto de partida · Start here" / "Semana 1 · Week 1"
 *   locale=es -> "Punto de partida · Start here" / "Semana 1 · Week 1"
 *
 * Y el motivo no es el API: en la respuesta de Moodle hay CERO marcas de
 * multiidioma. Las aulas se escribieron metiendo los dos idiomas en la misma
 * cadena, separados por "·". No hay nada que separar, asi que el conmutador del
 * portal no tiene efecto sobre esos textos.
 *
 * QUE HACE ESTE GUION
 *
 * Reescribe "Español · English" como
 *   <span lang="es" class="multilang">Español</span><span lang="en" class="multilang">English</span>
 *
 * que es la sintaxis del filtro del NUCLEO de Moodle —la misma a la que se
 * migraron los nombres de categoria (§24 del runbook)— y la que parsea el API.
 * A partir de ahi, un estudiante con el portal en ingles ve "Start here" y uno
 * en español ve "Punto de partida".
 *
 * LO QUE NO HACE, A PROPOSITO
 *
 *   - No traduce nada. Solo separa lo que ya esta escrito en los dos idiomas.
 *     Un nombre en un solo idioma se deja como esta: inventar la traduccion de
 *     contenido academico de una universidad real no es cosa del despliegue.
 *   - No toca el cuerpo de las actividades, solo los NOMBRES de seccion y de
 *     modulo. El cuerpo puede llevar HTML con "·" dentro de una frase y
 *     partirlo por ahi destrozaria el texto.
 *   - No toca una cadena que ya tenga marcado multiidioma.
 *   - No parte en mas de dos: "A · B · C" se deja y se avisa. El orden de los
 *     idiomas no se puede adivinar con tres trozos.
 *
 * EL ORDEN ES ES · EN, que es como estan escritas las aulas de TFU. Si alguna
 * va al reves, --orden=en-es lo invierte para ese curso.
 *
 * Uso:
 *   sudo -u www-data php paeu-separar-idiomas-aula.php --curso=PCL-AI-WORK --dry-run
 *   sudo -u www-data php paeu-separar-idiomas-aula.php --todos --dry-run
 *   sudo -u www-data php paeu-separar-idiomas-aula.php --curso=PCL-AI-WORK
 *
 * Idempotente: pasarlo dos veces no cambia nada la segunda vez.
 */

define('CLI_SCRIPT', true);
require_once(__DIR__ . '/../paeu-bootstrap.php');
require(paeu_config_moodle());
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->libdir . '/clilib.php');

\core\session\manager::set_user(get_admin());

list($opciones, $sinreconocer) = cli_get_params(
    [
        'curso'   => null,
        'todos'   => false,
        'orden'   => 'es-en',
        'dry-run' => false,
        'help'    => false,
    ],
    ['h' => 'help', 'n' => 'dry-run']
);

if ($opciones['help'] || (!$opciones['curso'] && !$opciones['todos'])) {
    cli_writeln('Separa los nombres "Español · English" en marcado multiidioma.');
    cli_writeln('  --curso=<shortname>  un aula concreta');
    cli_writeln('  --todos              todas las aulas visibles');
    cli_writeln('  --orden=es-en|en-es  que idioma va primero (por omision es-en)');
    cli_writeln('  --dry-run, -n        muestra lo que haria sin tocar nada');
    exit($opciones['help'] ? 0 : 2);
}

$seco = (bool)$opciones['dry-run'];
$orden = $opciones['orden'] === 'en-es' ? ['en', 'es'] : ['es', 'en'];

/** Cierto si el texto ya lleva marcado multiidioma de cualquiera de las dos sintaxis. */
function ya_tiene_marcado(string $texto): bool {
    return (stripos($texto, 'class="multilang"') !== false)
        || (stripos($texto, "class='multilang'") !== false)
        || (preg_match('/\{\s*mlang\s+/i', $texto) === 1);
}

/**
 * Devuelve el texto con marcado, o null si no hay nada que hacer.
 *
 * El separador es el interpunto "·" rodeado de espacios. Se exige el espacio a
 * ambos lados a proposito: hay nombres que llevan "·" pegado dentro de una
 * referencia y partirlos ahi seria romperlos.
 */
function separar(string $texto, array $orden): ?string {
    if (trim($texto) === '' || ya_tiene_marcado($texto)) {
        return null;
    }
    $partes = preg_split('/\s+·\s+/u', $texto);
    if ($partes === false || count($partes) !== 2) {
        return null;
    }
    [$a, $b] = array_map('trim', $partes);
    if ($a === '' || $b === '') {
        return null;
    }
    [$primero, $segundo] = $orden;
    return sprintf(
        '<span lang="%s" class="multilang">%s</span><span lang="%s" class="multilang">%s</span>',
        $primero, $a, $segundo, $b
    );
}

$cursos = [];
if ($opciones['todos']) {
    $cursos = $DB->get_records_select('course', 'id <> ? AND visible = 1', [SITEID], 'shortname ASC');
} else {
    $curso = $DB->get_record('course', ['shortname' => clean_param((string)$opciones['curso'], PARAM_TEXT)]);
    if (!$curso) {
        cli_error("No existe el aula '{$opciones['curso']}'.", 2);
    }
    $cursos = [$curso];
}

$totalCambios = 0;
$totalAvisos = 0;

foreach ($cursos as $curso) {
    cli_writeln("Aula {$curso->shortname} (id {$curso->id})");
    $cambios = 0;

    // --- Nombres de seccion ------------------------------------------------
    $secciones = $DB->get_records('course_sections', ['course' => $curso->id], 'section ASC');
    foreach ($secciones as $seccion) {
        $nombre = (string)($seccion->name ?? '');
        $nuevo = separar($nombre, $orden);
        if ($nuevo === null) {
            if ($nombre !== '' && !ya_tiene_marcado($nombre) && substr_count($nombre, '·') > 1) {
                cli_writeln("  AVISO: seccion con mas de un separador, se omite: {$nombre}");
                $totalAvisos++;
            }
            continue;
        }
        if ($seco) {
            cli_writeln("  [SIMULACION] seccion: {$nombre}");
        } else {
            $seccion->name = $nuevo;
            $DB->update_record('course_sections', $seccion);
            cli_writeln("  seccion separada: {$nombre}");
        }
        $cambios++;
    }

    // --- Nombres de actividad ---------------------------------------------
    $modinfo = get_fast_modinfo($curso);
    foreach ($modinfo->get_cms() as $cm) {
        $registro = $DB->get_record($cm->modname, ['id' => $cm->instance]);
        if (!$registro || !isset($registro->name)) {
            continue;
        }
        $nombre = (string)$registro->name;
        $nuevo = separar($nombre, $orden);
        if ($nuevo === null) {
            if (!ya_tiene_marcado($nombre) && substr_count($nombre, '·') > 1) {
                cli_writeln("  AVISO: actividad con mas de un separador, se omite: {$nombre}");
                $totalAvisos++;
            }
            continue;
        }
        if ($seco) {
            cli_writeln("  [SIMULACION] actividad: {$nombre}");
        } else {
            $registro->name = $nuevo;
            $DB->update_record($cm->modname, $registro);
            cli_writeln("  actividad separada: {$nombre}");
        }
        $cambios++;
    }

    if (!$seco && $cambios > 0) {
        rebuild_course_cache($curso->id, true);
    }
    cli_writeln("  cambios en esta aula: {$cambios}");
    $totalCambios += $cambios;
}

cli_writeln('');
cli_writeln($seco
    ? "[SIMULACION] cambios que se harian: {$totalCambios} (avisos: {$totalAvisos})"
    : "Hecho. Cambios: {$totalCambios} (avisos: {$totalAvisos})");
cli_writeln('');
cli_writeln('Comprobacion desde fuera, con una sesion de estudiante matriculado:');
cli_writeln('  curl -s "<API>/v1/courses/<id>/content?locale=en" -H "authorization: Bearer <token>"');
cli_writeln('  curl -s "<API>/v1/courses/<id>/content?locale=es" -H "authorization: Bearer <token>"');
cli_writeln('Los nombres de seccion deben salir DISTINTOS en cada idioma.');
