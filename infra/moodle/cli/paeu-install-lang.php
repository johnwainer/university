<?php
// paeu-install-lang.php
//
// Fallback language-pack installer for Moodle builds that do not ship
// admin/tool/langimport/cli/install.php. Uses tool_langimport's own controller,
// so it downloads from download.moodle.org exactly like the admin UI does.
//
//   sudo -u daemon -g daemon /opt/bitnami/php/bin/php paeu-install-lang.php --lang=es
//
// Idempotent: an already-installed pack is reported and left alone.

define('CLI_SCRIPT', true);

$moodleroot = getenv('MOODLE_DIR');
if ($moodleroot === false || $moodleroot === '') {
    $moodleroot = dirname(__DIR__, 2);
}
$configpath = rtrim($moodleroot, '/') . '/config.php';
if (!is_readable($configpath)) {
    fwrite(STDERR, "FATAL: cannot read {$configpath}. Set MOODLE_DIR to the Moodle webroot.\n");
    exit(1);
}
require($configpath);
require_once($CFG->libdir . '/clilib.php');

[$options, $unrecognised] = cli_get_params(
    ['help' => false, 'lang' => '', 'update' => false],
    ['h' => 'help']
);

if ($unrecognised) {
    cli_error('unrecognised options: ' . implode(', ', $unrecognised), 2);
}

if ($options['help'] || $options['lang'] === '') {
    echo <<<USAGE
Install a Moodle language pack from the command line.

  --lang=<code>   Language pack to install, e.g. es, en, pt_br. Required.
  --update        Also refresh packs that are already installed.
  -h, --help      This text.

USAGE;
    exit($options['help'] ? 0 : 2);
}

$lang = clean_param((string)$options['lang'], PARAM_SAFEDIR);
if ($lang === '') {
    cli_error('--lang is not a valid language code', 2);
}

if (!class_exists('\\tool_langimport\\controller')) {
    cli_error('tool_langimport is not available in this Moodle build; install the pack '
        . 'from Site administration > Language > Language packs', 3);
}

$installed = get_string_manager()->get_list_of_translations(true);
if (isset($installed[$lang]) && !$options['update']) {
    fwrite(STDERR, "INFO  language pack '{$lang}' is already installed\n");
    exit(0);
}

$controller = new \tool_langimport\controller();
if (!$controller->install_languagepacks($lang, (bool)$options['update'])) {
    foreach ($controller->errors as $error) {
        fwrite(STDERR, 'ERROR ' . $error . "\n");
    }
    cli_error("could not install language pack '{$lang}'", 4);
}

foreach ($controller->info as $info) {
    fwrite(STDERR, 'INFO  ' . $info . "\n");
}

// Rebuild the string cache so the new pack is visible immediately.
get_string_manager()->reset_caches();
fwrite(STDERR, "OK    language pack '{$lang}' installed\n");
exit(0);
