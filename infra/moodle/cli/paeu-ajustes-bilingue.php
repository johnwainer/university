<?php
/**
 * Etapa I — ajustes que faltaban para que Moodle opere de verdad en dos
 * idiomas.
 *
 * El contrato pide la instalacion de Moodle «branded, seguro y preparado para
 * operacion bilingue». Estaba lo primero y lo segundo; de lo tercero faltaban
 * dos cosas que se ven en cuanto alguien abre el listado de cursos:
 *
 *   1. Los nombres de categoria estan escritos con la sintaxis del filtro
 *      multiidioma —{mlang en}Sales…{mlang}{mlang es}Ventas…{mlang}— pero el
 *      filtro no estaba activo, asi que /course/index.php mostraba el codigo
 *      en crudo en vez del nombre traducido. La API si resuelve el idioma por
 *      su cuenta, por eso el catalogo publico se veia bien y esto paso
 *      inadvertido.
 *
 *      No basta con activar el filtro: por omision Moodle lo aplica solo al
 *      contenido, y los nombres de curso y categoria son «encabezados». Hay
 *      que poner filterall=1.
 *
 *   2. Queda la categoria por defecto de la instalacion, «Categoria 1»,
 *      vacia. Se oculta en vez de borrarse: borrar una categoria en Moodle
 *      pide decidir que hacer con su contenido, y una categoria oculta no
 *      aparece en el listado publico ni en el selector de curso.
 *
 * Idempotente: se puede correr dos veces.
 *
 * Uso: sudo -u www-data php paeu-ajustes-bilingue.php [--dry-run]
 */
define('CLI_SCRIPT', true);
require('/var/www/moodle/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/filterlib.php');
require_once($CFG->dirroot . '/course/lib.php');

$dryrun = in_array('--dry-run', array_slice($argv, 1), true);
$prefijo = $dryrun ? '[simulacion] ' : '';

// ---------------------------------------------------------------------------
// 1. Filtro de contenido multiidioma, aplicado tambien a los encabezados
// ---------------------------------------------------------------------------

$estado = filter_get_global_states();
$activo = isset($estado['multilang']) && (int) $estado['multilang']->active === TEXTFILTER_ON;

if ($activo) {
    cli_writeln("filtro multilang: ya estaba activo");
} else {
    cli_writeln($prefijo . "filtro multilang: activando");
    if (!$dryrun) {
        filter_set_global_state('multilang', TEXTFILTER_ON);
    }
}

$filterall = (int) get_config('core', 'filterall');
if ($filterall === 1) {
    cli_writeln("filterall: ya estaba en 1 (se aplica a encabezados)");
} else {
    cli_writeln($prefijo . "filterall: {$filterall} -> 1, para que el filtro alcance nombres de curso y categoria");
    if (!$dryrun) {
        set_config('filterall', 1);
    }
}

// Moodle guarda el resultado del filtro en cache; sin esto los nombres siguen
// saliendo en crudo hasta que la cache expire sola.
if (!$dryrun) {
    reset_text_filters_cache();
    purge_caches(['muc' => true]);
    cli_writeln("caches de texto purgadas");
}

// ---------------------------------------------------------------------------
// 2. La categoria por defecto de la instalacion
// ---------------------------------------------------------------------------

$pordefecto = $DB->get_record('course_categories', ['id' => 1]);

if (!$pordefecto) {
    cli_writeln("categoria por defecto: no existe, nada que hacer");
} else {
    $cursos = $DB->count_records('course', ['category' => $pordefecto->id]);
    $hijas  = $DB->count_records('course_categories', ['parent' => $pordefecto->id]);

    if ($cursos > 0 || $hijas > 0) {
        // No se toca una categoria con contenido: eso es una decision
        // academica, no un ajuste de instalacion.
        cli_writeln("categoria '{$pordefecto->name}': tiene {$cursos} curso(s) y {$hijas} subcategoria(s); NO se oculta");
    } else if ((int) $pordefecto->visible === 0) {
        cli_writeln("categoria '{$pordefecto->name}': ya estaba oculta");
    } else {
        cli_writeln($prefijo . "categoria '{$pordefecto->name}': vacia, ocultando");
        if (!$dryrun) {
            $cat = core_course_category::get($pordefecto->id);
            $cat->hide();
        }
    }
}

cli_writeln("");
cli_writeln("Comprobacion:");
cli_writeln("  curl -s https://lms.portal.thefloridianuniversity.com/course/index.php | grep -c '{mlang'");
cli_writeln("  (0 = el filtro esta resolviendo los nombres)");
