<?php
/**
 * Repara la matriculacion desde la plataforma.
 *
 * SINTOMA. Cualquier intento de matricular devuelve:
 *   wsusercannotassign — "No tiene permisos para asignar el rol (5) a este
 *   usuario (4) en este curso (24)."
 * Comprobado en produccion: la tabla user_course_enrollments esta VACIA, asi
 * que el alta de estudiantes desde la plataforma no ha funcionado nunca.
 *
 * CAUSA. En Moodle, para asignar un rol hacen falta DOS cosas y el
 * aprovisionamiento solo dejo una:
 *
 *   1. La capacidad moodle/role:assign. Esa SI la concede
 *      paeu-provision-webservice.php al rol 'paeu_ws_client'.
 *   2. Una autorizacion explicita, por pareja de roles, en la tabla
 *      role_allow_assign: "el rol X puede asignar el rol Y". Sin la fila
 *      (paeu_ws_client -> student) la capacidad no basta, y Moodle lanza
 *      justamente wsusercannotassign.
 *
 * Es un fallo de configuracion, no de codigo: la API llama bien a
 * enrol_manual_enrol_users. Por eso se arregla aqui y no en apps/api.
 *
 * NO se puede hacer por servicio web: de las 21 funciones habilitadas ninguna
 * toca roles ni permisos. Hace falta shell en la maquina de Moodle, hoy con el
 * puerto 22 cerrado.
 *
 * Uso:
 *   sudo -u www-data php infra/moodle/cli/paeu-permitir-asignar-estudiante.php --dry-run
 *   sudo -u www-data php infra/moodle/cli/paeu-permitir-asignar-estudiante.php
 *
 * Idempotente.
 */

define('CLI_SCRIPT', true);
require(__DIR__ . '/../../../config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/accesslib.php');

list($opciones, $sinreconocer) = cli_get_params(
    [
        'dry-run'        => false,
        'help'           => false,
        'role-shortname' => 'paeu_ws_client',
        // Roles que el cliente del servicio web debe poder asignar. Solo
        // 'student': no hay motivo para que la integracion pueda nombrar
        // profesores ni gestores, y conceder de mas aqui es conceder de mas
        // en todos los cursos a la vez.
        'asignables'     => 'student',
    ],
    ['h' => 'help', 'n' => 'dry-run']
);

if ($opciones['help']) {
    cli_writeln('Permite al rol del servicio web asignar el rol de estudiante.');
    cli_writeln('  --dry-run, -n            muestra lo que haria sin tocar nada');
    cli_writeln('  --role-shortname=<slug>  rol del cliente (por omision paeu_ws_client)');
    cli_writeln('  --asignables=a,b         roles que podra asignar (por omision student)');
    exit(0);
}

$seco = (bool)$opciones['dry-run'];
$shortname = clean_param((string)$opciones['role-shortname'], PARAM_ALPHANUMEXT);

$rolcliente = $DB->get_record('role', ['shortname' => $shortname]);
if (!$rolcliente) {
    cli_error("No existe el rol '{$shortname}'. Corre antes paeu-provision-webservice.php.", 2);
}
cli_writeln("Rol del cliente: {$rolcliente->shortname} (id {$rolcliente->id})");

// 1. La capacidad, por si el rol se recreo a mano sin ella.
$contexto = context_system::instance();
$capacidades = ['moodle/role:assign', 'enrol/manual:enrol', 'enrol/manual:unenrol'];
foreach ($capacidades as $cap) {
    $actual = $DB->get_record('role_capabilities', [
        'roleid' => $rolcliente->id,
        'capability' => $cap,
        'contextid' => $contexto->id,
    ]);
    if ($actual && (int)$actual->permission === CAP_ALLOW) {
        cli_writeln("  capacidad {$cap}: ya concedida");
        continue;
    }
    if ($seco) {
        cli_writeln("  capacidad {$cap}: SE CONCEDERIA");
        continue;
    }
    assign_capability($cap, CAP_ALLOW, $rolcliente->id, $contexto->id, true);
    cli_writeln("  capacidad {$cap}: concedida");
}

// 2. La autorizacion por pareja de roles, que es lo que faltaba.
$cambios = 0;
foreach (array_filter(array_map('trim', explode(',', (string)$opciones['asignables']))) as $destino) {
    $roldestino = $DB->get_record('role', ['shortname' => $destino]);
    if (!$roldestino) {
        cli_writeln("  AVISO: no existe el rol '{$destino}', se omite");
        continue;
    }

    $ya = $DB->record_exists('role_allow_assign', [
        'roleid' => $rolcliente->id,
        'allowassign' => $roldestino->id,
    ]);
    if ($ya) {
        cli_writeln("  puede asignar '{$destino}': ya estaba permitido");
        continue;
    }
    if ($seco) {
        cli_writeln("  puede asignar '{$destino}': SE PERMITIRIA");
        $cambios++;
        continue;
    }
    core_role_set_assign_allowed($rolcliente->id, $roldestino->id);
    cli_writeln("  puede asignar '{$destino}': permitido");
    $cambios++;
}

if (!$seco && $cambios > 0) {
    // Los permisos estan cacheados; sin esto el cambio no se nota hasta que
    // la cache expire por su cuenta.
    accesslib_clear_all_caches_for_unit_testing();
    cli_writeln('Caches de permisos vaciadas.');
}

cli_writeln('');
cli_writeln($seco ? "[SIMULACION] cambios que se harian: {$cambios}" : "Hecho. Cambios: {$cambios}");
cli_writeln('');
cli_writeln('Para comprobarlo desde fuera, con el token de la API:');
cli_writeln('  curl -X POST "<MOODLE_BASE_URL>/webservice/rest/server.php" \\');
cli_writeln('    -d "wstoken=<MOODLE_TOKEN>" -d "wsfunction=enrol_manual_enrol_users" \\');
cli_writeln('    -d "moodlewsrestformat=json" \\');
cli_writeln('    -d "enrolments[0][roleid]=5" -d "enrolments[0][userid]=<ID>" -d "enrolments[0][courseid]=<CURSO>"');
cli_writeln('Respuesta correcta: null. Si sigue saliendo wsusercannotassign, el rol');
cli_writeln('del token no es el que se ha reparado: revisa --role-shortname.');
