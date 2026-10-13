<?php
/**
 * Localiza el `config.php` de Moodle, venga de donde venga la instalación.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Los guiones de `infra/moodle/` resolvían la raíz de Moodle de tres maneras
 * distintas, y dos de ellas no corresponden a este despliegue:
 *
 *   aula-modelo.php                      require('/var/www/moodle/config.php')
 *   paeu-ajustes-bilingue.php            require('/var/www/moodle/config.php')
 *   paeu-cerrar-curso-suelto.php         require(__DIR__ . '/../../../config.php')
 *   paeu-permitir-asignar-estudiante.php require(__DIR__ . '/../../../config.php')
 *   paeu-provision-webservice.php        getenv('MOODLE_DIR')      <- la buena
 *
 * Este Moodle es una imagen **Bitnami** y vive en
 * `/opt/bitnami/projects/lms/moodle` (`MOODLE_DIR` en `infra/deploy/00-config.sh`).
 * O sea que los dos primeros fallaban en la primera línea, y los dos del medio
 * sólo funcionan si el archivo está exactamente tres niveles por debajo de la
 * raíz de Moodle, que es una condición que nadie garantiza al copiar un guion a
 * `/tmp` para ejecutarlo.
 *
 * Se descubrió preparando la intervención, antes de abrir el puerto 22: con las
 * rutas como estaban, el primer comando de la sesión habría fallado.
 *
 * ORDEN DE BÚSQUEDA
 *   1. La variable de entorno MOODLE_DIR, que es lo que ya usa el guion de
 *      aprovisionamiento y lo que fija el despliegue.
 *   2. Subiendo desde la carpeta del guion, por si está dentro del árbol.
 *   3. Las rutas conocidas, Bitnami primero.
 *
 * Si no encuentra ninguna, se para y dice cómo arreglarlo, en vez de reventar
 * con un «failed to open stream» que no orienta a nadie.
 */

/** Devuelve la ruta del config.php de Moodle o aborta explicando qué falta. */
function paeu_config_moodle(): string {
    $candidatas = [];

    $env = getenv('MOODLE_DIR');
    if (is_string($env) && $env !== '') {
        $candidatas[] = rtrim($env, '/') . '/config.php';
    }

    // Hacia arriba desde el guion: cubre el caso de estar dentro del árbol de
    // Moodle sin depender de cuántos niveles exactos haya.
    $dir = __DIR__;
    for ($i = 0; $i < 6; $i++) {
        $candidatas[] = $dir . '/config.php';
        $padre = dirname($dir);
        if ($padre === $dir) {
            break;
        }
        $dir = $padre;
    }

    // Rutas conocidas. Bitnami primero porque es la de este despliegue.
    foreach ([
        '/opt/bitnami/projects/lms/moodle',
        '/opt/bitnami/moodle',
        '/var/www/moodle',
        '/var/www/html/moodle',
    ] as $raiz) {
        $candidatas[] = $raiz . '/config.php';
    }

    foreach ($candidatas as $ruta) {
        if (is_readable($ruta)) {
            return $ruta;
        }
    }

    fwrite(STDERR,
        "No encuentro el config.php de Moodle.\n" .
        "Define MOODLE_DIR con la raíz de la instalación y vuelve a ejecutar, por ejemplo:\n" .
        "  sudo MOODLE_DIR=/opt/bitnami/projects/lms/moodle \\\n" .
        "       /opt/bitnami/php/bin/php " . basename($_SERVER['argv'][0] ?? 'guion.php') . "\n\n" .
        "Rutas probadas:\n  - " . implode("\n  - ", $candidatas) . "\n");
    exit(1);
}
