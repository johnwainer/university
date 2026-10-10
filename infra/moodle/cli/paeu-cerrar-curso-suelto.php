<?php
/**
 * Cierra el acceso a curso suelto en Moodle.
 *
 * El modelo del producto es que el PROGRAMA es la unidad que el estudiante ve
 * y en la que se matricula, y los cursos viven dentro. Nadie debe poder ver ni
 * cursar un curso por su cuenta.
 *
 * En el portal eso ya esta resuelto: el catalogo publica programas, la ficha
 * lista los cursos como temario sin enlace, y /v1/courses/:id/content exige
 * matricula activa. Y hacia fuera Moodle ya obliga a iniciar sesion: un
 * visitante anonimo no ve nombres de curso ni en /course/ ni en el buscador.
 *
 * Lo que queda, y es lo que arregla este guion, es el hueco de dentro: una
 * persona YA autenticada en Moodle podria llegar a un curso en el que no
 * deberia estar si ese curso tiene automatriculacion o acceso de invitado
 * abiertos. La matricula la hace la plataforma por enrol_manual_enrol_users
 * cuando alguien entra a un programa, asi que cualquier otra via de entrada
 * sobra.
 *
 * NO se puede hacer por servicio web: de las 21 funciones habilitadas ninguna
 * gestiona metodos de matriculacion. Hace falta shell en la maquina de Moodle,
 * que hoy tiene el puerto 22 cerrado. Por eso queda aqui listo para una sola
 * ejecucion en cuanto haya acceso, igual que paeu-ajustes-bilingue.php.
 *
 * Uso:
 *   sudo -u www-data php infra/moodle/cli/paeu-cerrar-curso-suelto.php
 *   sudo -u www-data php infra/moodle/cli/paeu-cerrar-curso-suelto.php --dry-run
 *
 * Es idempotente: se puede correr las veces que haga falta.
 */

define('CLI_SCRIPT', true);
require(__DIR__ . '/../../../config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/enrollib.php');

list($opciones, $sinreconocer) = cli_get_params(
    ['dry-run' => false, 'help' => false, 'prefijo' => 'PCL-'],
    ['h' => 'help', 'n' => 'dry-run']
);

if ($opciones['help']) {
    cli_writeln("Cierra automatriculacion y acceso de invitado en los cursos del catalogo.");
    cli_writeln("  --dry-run, -n   muestra lo que haria sin tocar nada");
    cli_writeln("  --prefijo=XXX   prefijo de shortname a tratar (por omision PCL-)");
    exit(0);
}

$prefijo = $opciones['prefijo'];
$seco = (bool)$opciones['dry-run'];

$cursos = $DB->get_records_select(
    'course',
    $DB->sql_like('shortname', ':patron') . ' AND id <> :sitio',
    ['patron' => $prefijo . '%', 'sitio' => SITEID],
    'shortname ASC',
    'id, shortname, fullname'
);

if (!$cursos) {
    cli_writeln("No hay cursos con prefijo {$prefijo}. Nada que hacer.");
    exit(0);
}

cli_writeln(($seco ? '[SIMULACION] ' : '') . 'Cursos a revisar: ' . count($cursos));
cli_writeln('');

$cambios = 0;

foreach ($cursos as $curso) {
    cli_writeln("{$curso->shortname}  (id {$curso->id})  {$curso->fullname}");

    // Instancias de matriculacion del curso. Interesan dos:
    //  - 'self':  automatriculacion, la via por la que alguien se mete solo.
    //  - 'guest': acceso de invitado, que permite mirar el aula sin matricula.
    // 'manual' se deja intacta: es por donde la plataforma matricula de verdad
    // cuando el estudiante entra a un programa. Desactivarla romperia el alta.
    $instancias = enrol_get_instances($curso->id, false);

    foreach ($instancias as $instancia) {
        if (!in_array($instancia->enrol, ['self', 'guest'], true)) {
            continue;
        }

        $activa = (int)$instancia->status === ENROL_INSTANCE_ENABLED;
        if (!$activa) {
            cli_writeln("    {$instancia->enrol}: ya estaba desactivada");
            continue;
        }

        if ($seco) {
            cli_writeln("    {$instancia->enrol}: SE DESACTIVARIA");
            $cambios++;
            continue;
        }

        $plugin = enrol_get_plugin($instancia->enrol);
        if (!$plugin) {
            cli_writeln("    {$instancia->enrol}: sin plugin disponible, se omite");
            continue;
        }
        $plugin->update_status($instancia, ENROL_INSTANCE_DISABLED);
        cli_writeln("    {$instancia->enrol}: desactivada");
        $cambios++;
    }

    // El curso tambien lleva su propio interruptor de invitados, aparte de la
    // instancia de matriculacion. Si queda a 1, el aula sigue siendo visitable.
    $registro = $DB->get_record('course', ['id' => $curso->id], 'id, visible, groupmode');
    $actual = (int)$DB->get_field('course', 'visible', ['id' => $curso->id]);

    // El curso se deja VISIBLE a proposito: ocultarlo lo esconderia tambien a
    // los estudiantes legitimamente matriculados, que es justo lo contrario de
    // lo que se busca. Lo que se cierra es la via de entrada, no la vista.
    if ($actual !== 1) {
        cli_writeln("    aviso: el curso esta oculto; los matriculados no lo veran");
    }

    cli_writeln('');
}

cli_writeln($seco
    ? "[SIMULACION] cambios que se harian: {$cambios}"
    : "Hecho. Instancias desactivadas: {$cambios}");

// Comprobacion final: que la via manual sigue en pie en todos los cursos, que
// es de la que depende el alta desde la plataforma.
$sinmanual = [];
foreach ($cursos as $curso) {
    $tiene = false;
    foreach (enrol_get_instances($curso->id, true) as $i) {
        if ($i->enrol === 'manual') {
            $tiene = true;
            break;
        }
    }
    if (!$tiene) {
        $sinmanual[] = $curso->shortname;
    }
}

if ($sinmanual) {
    cli_writeln('');
    cli_writeln('ATENCION: estos cursos se han quedado sin matriculacion manual activa,');
    cli_writeln('asi que la plataforma NO podra dar de alta estudiantes en ellos:');
    foreach ($sinmanual as $s) {
        cli_writeln("  - {$s}");
    }
    exit(1);
}

cli_writeln('Matriculacion manual activa en los ' . count($cursos) . ' cursos: la plataforma puede seguir dando altas.');
