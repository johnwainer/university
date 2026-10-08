<?php
// paeu-dbconfig.php
//
// Reads Moodle's config.php and prints its database settings in one of two
// shapes. Used by paeu-moodle-backup.sh so no credential is ever passed on a
// command line (where `ps` would expose it) or duplicated in a shell script.
//
//   php paeu-dbconfig.php <path/to/config.php> fields
//       -> "<dbname> <dbuser> <dbhost> <dbport> <prefix>" on one line
//
//   php paeu-dbconfig.php <path/to/config.php> mycnf
//       -> a [client] section suitable for mysql/mysqldump --defaults-file
//
// Write the mycnf output only to a file created with mode 0600.

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "cli only\n");
    exit(1);
}
define('CLI_SCRIPT', true);
define('ABORT_AFTER_CONFIG', true);   // parse config.php without booting Moodle

$configpath = $argv[1] ?? '';
$mode       = $argv[2] ?? 'fields';

if ($configpath === '' || !is_readable($configpath)) {
    fwrite(STDERR, "usage: php paeu-dbconfig.php <config.php> [fields|mycnf]\n");
    exit(2);
}

$CFG = new stdClass();
require($configpath);

if (empty($CFG->dbname) || empty($CFG->dbuser)) {
    fwrite(STDERR, "config.php did not define dbname/dbuser\n");
    exit(3);
}

$port = '3306';
if (!empty($CFG->dboptions) && is_array($CFG->dboptions) && !empty($CFG->dboptions['dbport'])) {
    $port = (string)$CFG->dboptions['dbport'];
}

switch ($mode) {
    case 'fields':
        printf(
            "%s %s %s %s %s\n",
            $CFG->dbname,
            $CFG->dbuser,
            $CFG->dbhost,
            $port,
            $CFG->prefix ?? 'mdl_'
        );
        break;

    case 'mycnf':
        // my.cnf double-quoted values: backslash and double quote need escaping.
        $esc = static function (string $v): string {
            return str_replace(['\\', '"'], ['\\\\', '\\"'], $v);
        };
        printf(
            "[client]\nuser=\"%s\"\npassword=\"%s\"\nhost=\"%s\"\nport=%s\n",
            $esc((string)$CFG->dbuser),
            $esc((string)$CFG->dbpass),
            $esc((string)$CFG->dbhost),
            $port
        );
        break;

    default:
        fwrite(STDERR, "unknown mode '{$mode}' (expected 'fields' or 'mycnf')\n");
        exit(2);
}
exit(0);
