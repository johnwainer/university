<?php
/**
 * Localiza el `config.php` de Moodle, venga de donde venga la instalación.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Los guiones de `infra/moodle/` resolvían la raíz de Moodle de tres maneras
 * distintas, y una de ellas depende de dónde esté colocado el archivo:
 *
 *   aula-modelo.php                      require('/var/www/moodle/config.php')
 *   paeu-ajustes-bilingue.php            require('/var/www/moodle/config.php')
 *   paeu-cerrar-curso-suelto.php         require(__DIR__ . '/../../../config.php')
 *   paeu-permitir-asignar-estudiante.php require(__DIR__ . '/../../../config.php')
 *   paeu-provision-webservice.php        getenv('MOODLE_DIR')      <- la buena
 *
 * COMPROBADO CONTRA LA MÁQUINA (13 oct 2026, al abrirse el puerto 22):
 * Moodle 4.5.14+ sobre Debian 12, instalado en `/var/www/moodle`, con PHP 8.3
 * en `/usr/bin/php` y usuario web `www-data`.
 *
 * Es decir: las dos rutas fijas `/var/www/moodle/config.php` eran CORRECTAS
 * para este servidor. Lo que sí es frágil es `__DIR__ . '/../../../config.php'`,
 * que sólo funciona si el guion está exactamente tres niveles por debajo de la
 * raíz de Moodle — condición que se rompe en cuanto lo copias a /tmp o a
 * /var/www/cli para ejecutarlo, que es justo lo que hay que hacer.
 *
 * Nota: `infra/deploy/00-config.sh` describe un despliegue Bitnami en
 * `/opt/bitnami/projects/lms/moodle`. Esa NO es esta máquina. Se dejan las dos
 * familias de rutas en la búsqueda para que el guion sirva en ambas.
 *
 * ORDEN DE BÚSQUEDA
 *   1. La variable de entorno MOODLE_DIR, que es lo que ya usa el guion de
 *      aprovisionamiento y lo que fija el despliegue.
 *   2. Subiendo desde la carpeta del guion, por si está dentro del árbol.
 *   3. Las rutas conocidas, la de esta instalación primero.
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

    // Rutas conocidas. `/var/www/moodle` primero porque es la de ESTA
    // instalación; las de Bitnami quedan por si el otro despliegue las usa.
    foreach ([
        '/var/www/moodle',
        '/var/www/html/moodle',
        '/opt/bitnami/projects/lms/moodle',
        '/opt/bitnami/moodle',
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
        "  sudo -u www-data MOODLE_DIR=/var/www/moodle php " . basename($_SERVER['argv'][0] ?? 'guion.php') . "\n\n" .
        "Rutas probadas:\n  - " . implode("\n  - ", $candidatas) . "\n");
    exit(1);
}
