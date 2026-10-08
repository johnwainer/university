<?php
// paeu-provision-webservice.php
//
// Idempotently provisions the Moodle side of the PAE-U integration:
//   1. external service (enabled, restricted to authorised users)
//   2. the exact authorised function list
//   3. a dedicated integration user (never a human admin account)
//   4. a dedicated role carrying only the capabilities those functions need
//   5. a permanent web-service token, printed for the operator to store in SSM
//
// It is run by 21-moodle-webservices.sh as the web user through Moodle's CLI
// bootstrap:
//   /opt/bitnami/php/bin/php /path/paeu-provision-webservice.php --help
//
// Re-running is safe: existing records are reused and only drift is corrected.
// The token is NEVER written to disk by this script - it goes to stdout only.

define('CLI_SCRIPT', true);

// The script is copied next to Moodle's own CLI tools, but allow an explicit
// override so it can live outside the webroot.
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
require_once($CFG->dirroot . '/user/lib.php');
// externallib.php is a deprecated shim in recent releases; load it when present
// so external_generate_token() stays available as a fallback.
if (is_readable($CFG->libdir . '/externallib.php')) {
    require_once($CFG->libdir . '/externallib.php');
}
// Historically defined in externallib.php; keep working if that moves again.
if (!defined('EXTERNAL_TOKEN_PERMANENT')) {
    define('EXTERNAL_TOKEN_PERMANENT', 0);
}

// Capabilities the authorised function list actually needs. Granted at system
// context on a dedicated role so the integration user is not a site admin.
$defaultcapabilities = [
    'webservice/rest:use',
    'moodle/webservice:createtoken',
    'moodle/course:view',
    'moodle/course:viewhiddencourses',
    'moodle/course:viewhiddensections',
    'moodle/course:viewhiddenactivities',
    'moodle/course:viewparticipants',
    'moodle/course:create',
    'moodle/course:update',
    'moodle/course:visibility',
    'moodle/course:changecategory',
    'moodle/category:viewhiddencategories',
    'moodle/category:viewcourselist',
    'moodle/user:create',
    'moodle/user:update',
    'moodle/user:editprofile',
    'moodle/user:viewdetails',
    'moodle/user:viewalldetails',
    'moodle/user:viewhiddendetails',
    'moodle/site:viewuseridentity',
    'moodle/site:accessallgroups',
    'moodle/role:assign',
    'moodle/notes:view',
    'moodle/notes:manage',
    'enrol/manual:enrol',
    'enrol/manual:unenrol',
    'enrol/manual:manage',
    'report/progress:view',
    'moodle/competency:coursecompetencyview',
];

[$options, $unrecognised] = cli_get_params(
    [
        'help'                   => false,
        'service-name'           => 'PAE-U Intermediator',
        'service-shortname'      => 'paeu_intermediator',
        'role-shortname'         => 'paeu_ws_client',
        'role-name'              => 'PAE-U Web Service Client',
        'username'               => 'paeu.integration',
        'auth'                   => 'webservice',
        'firstname'              => 'PAEU',
        'lastname'               => 'Integration',
        'email'                  => '',
        'functions'              => '',
        'capabilities'           => '',
        'restricted-users'       => '1',
        'rotate-token'           => false,
        'skip-missing-functions' => false,
        'print-only'             => false,
    ],
    ['h' => 'help']
);

if ($unrecognised) {
    cli_error('unrecognised options: ' . implode(', ', $unrecognised), 2);
}

if ($options['help']) {
    echo <<<USAGE
Provision the PAE-U Moodle web service, integration user, role and token.

Options
  --service-name=<text>        External service display name.
  --service-shortname=<slug>   External service shortname (lookup key).
  --role-shortname=<slug>      Dedicated role shortname for the integration user.
  --role-name=<text>           Dedicated role display name.
  --username=<slug>            Integration user's username.
  --auth=<plugin>              Auth plugin for the integration user
                               (default: webservice; must be enabled site-wide).
  --firstname=<text>           Integration user's first name.
  --lastname=<text>            Integration user's last name.
  --email=<address>            Integration user's email (required when creating).
  --functions=<a,b,c>          Comma or space separated authorised functions.
  --capabilities=<a,b,c>       Override the capability set granted to the role.
  --restricted-users=0|1       1 (default) limits the service to authorised users.
  --rotate-token               Delete the existing token and mint a new one.
  --skip-missing-functions     Warn instead of failing on unknown function names.
  --print-only                 Report current state; change nothing.
  -h, --help                   This text.

The token is written to stdout as  MOODLE_WS_TOKEN=<token>
Everything else goes to stderr. Store the token in SSM, never in the repo.

USAGE;
    exit(0);
}

function out(string $msg): void {
    fwrite(STDERR, $msg . "\n");
}

/**
 * Split a comma and/or whitespace separated list into a clean array.
 */
function split_list(string $raw): array {
    $parts = preg_split('/[\s,]+/', trim($raw), -1, PREG_SPLIT_NO_EMPTY);
    return $parts === false ? [] : array_values(array_unique($parts));
}

$dryrun = (bool)$options['print-only'];

$functions = split_list((string)$options['functions']);
if (!$functions) {
    cli_error('--functions is required (comma or space separated list)', 2);
}

$capabilities = split_list((string)$options['capabilities']);
if (!$capabilities) {
    $capabilities = $defaultcapabilities;
}

$serviceshortname = clean_param((string)$options['service-shortname'], PARAM_ALPHANUMEXT);
$roleshortname    = clean_param((string)$options['role-shortname'], PARAM_ALPHANUMEXT);
$username         = clean_param(core_text::strtolower((string)$options['username']), PARAM_USERNAME);
$restrictedusers  = ((string)$options['restricted-users'] === '1') ? 1 : 0;
$authplugin       = clean_param((string)$options['auth'], PARAM_PLUGIN);

if ($serviceshortname === '' || $roleshortname === '' || $username === '') {
    cli_error('service shortname, role shortname and username must all be non-empty', 2);
}

$syscontext = context_system::instance();
$now = time();
$changed = 0;

// webservice_server::authenticate_by_token() refuses a token whose owner's auth
// plugin is not enabled site-wide. Catch that here instead of at the first call.
if (!is_enabled_auth($authplugin)) {
    cli_error("auth plugin '{$authplugin}' is not enabled site-wide; enable it first:\n"
        . "  php admin/cli/cfg.php --name=auth --set=<current-list>,{$authplugin}", 5);
}

// ---------------------------------------------------------------------------
// 1. Validate the requested functions exist in this Moodle build.
// ---------------------------------------------------------------------------
$missing = [];
foreach ($functions as $fn) {
    if (!$DB->record_exists('external_functions', ['name' => $fn])) {
        $missing[] = $fn;
    }
}
if ($missing) {
    $list = implode(', ', $missing);
    if (!$options['skip-missing-functions']) {
        cli_error("these functions do not exist in this Moodle version: {$list}\n"
            . "Re-run with --skip-missing-functions to provision the rest anyway.", 3);
    }
    out("WARN  skipping unknown functions: {$list}");
    $functions = array_values(array_diff($functions, $missing));
}
out('INFO  authorised functions: ' . count($functions));

// ---------------------------------------------------------------------------
// 2. External service.
// ---------------------------------------------------------------------------
$service = $DB->get_record('external_services', ['shortname' => $serviceshortname]);
if (!$service) {
    $record = (object)[
        'name'               => (string)$options['service-name'],
        'shortname'          => $serviceshortname,
        'enabled'            => 1,
        'requiredcapability' => '',
        'restrictedusers'    => $restrictedusers,
        'component'          => null,
        'timecreated'        => $now,
        'timemodified'       => $now,
        'downloadfiles'      => 1,
        'uploadfiles'        => 1,
    ];
    if ($dryrun) {
        out("DRY   would create external service '{$serviceshortname}'");
        exit(0);
    }
    $record->id = $DB->insert_record('external_services', $record);
    $service = $record;
    $changed++;
    out("OK    created external service '{$serviceshortname}' (id {$service->id})");
} else {
    $patch = [];
    if ((int)$service->enabled !== 1)                        { $patch['enabled'] = 1; }
    if ((int)$service->restrictedusers !== $restrictedusers)  { $patch['restrictedusers'] = $restrictedusers; }
    if ((int)$service->downloadfiles !== 1)                   { $patch['downloadfiles'] = 1; }
    if ((int)$service->uploadfiles !== 1)                     { $patch['uploadfiles'] = 1; }
    if ($service->name !== (string)$options['service-name'])   { $patch['name'] = (string)$options['service-name']; }
    if ($patch) {
        if ($dryrun) {
            out('DRY   would update service fields: ' . implode(', ', array_keys($patch)));
        } else {
            $patch['id'] = $service->id;
            $patch['timemodified'] = $now;
            $DB->update_record('external_services', (object)$patch);
            $changed++;
            out('OK    updated service fields: ' . implode(', ', array_keys($patch)));
        }
    } else {
        out("INFO  external service '{$serviceshortname}' already correct (id {$service->id})");
    }
}

// ---------------------------------------------------------------------------
// 3. Reconcile the authorised function list (add missing, remove extras).
// ---------------------------------------------------------------------------
$current = $DB->get_fieldset_select(
    'external_services_functions',
    'functionname',
    'externalserviceid = :sid',
    ['sid' => $service->id]
);
$current = $current ? array_values($current) : [];

$toadd    = array_values(array_diff($functions, $current));
$toremove = array_values(array_diff($current, $functions));

foreach ($toadd as $fn) {
    if ($dryrun) {
        out("DRY   would authorise {$fn}");
        continue;
    }
    $DB->insert_record('external_services_functions', (object)[
        'externalserviceid' => $service->id,
        'functionname'      => $fn,
    ]);
    $changed++;
    out("OK    authorised {$fn}");
}
foreach ($toremove as $fn) {
    if ($dryrun) {
        out("DRY   would de-authorise {$fn} (not in the contract list)");
        continue;
    }
    $DB->delete_records('external_services_functions', [
        'externalserviceid' => $service->id,
        'functionname'      => $fn,
    ]);
    $changed++;
    out("OK    de-authorised {$fn} (not in the contract list)");
}
if (!$toadd && !$toremove) {
    out('INFO  function list already matches the contract');
}

// ---------------------------------------------------------------------------
// 4. Integration user.
// ---------------------------------------------------------------------------
$user = $DB->get_record('user', [
    'username'  => $username,
    'mnethostid' => $CFG->mnet_localhost_id,
    'deleted'   => 0,
]);
if (!$user) {
    $email = trim((string)$options['email']);
    if ($email === '' || !validate_email($email)) {
        cli_error('--email with a valid address is required to create the integration user', 2);
    }
    if ($DB->record_exists('user', ['email' => $email, 'deleted' => 0])) {
        cli_error("another account already uses {$email}; pass a distinct --email", 4);
    }
    if ($dryrun) {
        out("DRY   would create integration user '{$username}'");
    } else {
        $new = (object)[
            'username'     => $username,
            // No interactive login: a random unusable password plus auth=webservice.
            'password'     => hash_internal_user_password(complex_random_string(32)),
            'firstname'    => (string)$options['firstname'],
            'lastname'     => (string)$options['lastname'],
            'email'        => $email,
            'auth'         => $authplugin,
            'confirmed'    => 1,
            'mnethostid'   => $CFG->mnet_localhost_id,
            'lang'         => $CFG->lang ?? 'en',
            'policyagreed' => 1,
        ];
        $new->id = user_create_user($new, false, false);
        $user = $DB->get_record('user', ['id' => $new->id]);
        $changed++;
        out("OK    created integration user '{$username}' (id {$user->id})");
    }
} else {
    out("INFO  integration user '{$username}' already exists (id {$user->id})");
    if ((int)$user->suspended === 1) {
        if ($dryrun) {
            out('DRY   would un-suspend the integration user');
        } else {
            $DB->set_field('user', 'suspended', 0, ['id' => $user->id]);
            $changed++;
            out('OK    un-suspended the integration user');
        }
    }
    if ($user->auth !== $authplugin) {
        if ($dryrun) {
            out("DRY   would switch auth from '{$user->auth}' to '{$authplugin}'");
        } else {
            $DB->set_field('user', 'auth', $authplugin, ['id' => $user->id]);
            $user->auth = $authplugin;
            $changed++;
            out("OK    switched auth to '{$authplugin}'");
        }
    }
}

if ($dryrun && !$user) {
    out('DRY   stopping: later steps need the user to exist');
    exit(0);
}

// ---------------------------------------------------------------------------
// 5. Dedicated role with only the needed capabilities, assigned at system level.
// ---------------------------------------------------------------------------
$role = $DB->get_record('role', ['shortname' => $roleshortname]);
if (!$role) {
    if ($dryrun) {
        out("DRY   would create role '{$roleshortname}'");
    } else {
        $roleid = create_role(
            (string)$options['role-name'],
            $roleshortname,
            'Least-privilege role for the PAE-U API integration user. Managed by '
                . 'infra/moodle/cli/paeu-provision-webservice.php - do not edit by hand.'
        );
        $role = $DB->get_record('role', ['id' => $roleid]);
        set_role_contextlevels($roleid, [CONTEXT_SYSTEM]);
        $changed++;
        out("OK    created role '{$roleshortname}' (id {$roleid})");
    }
} else {
    out("INFO  role '{$roleshortname}' already exists (id {$role->id})");
}

if ($role) {
    $existing = $DB->get_records_menu(
        'role_capabilities',
        ['roleid' => $role->id, 'contextid' => $syscontext->id],
        '',
        'capability, permission'
    );
    foreach ($capabilities as $cap) {
        if (!$DB->record_exists('capabilities', ['name' => $cap])) {
            out("WARN  capability '{$cap}' does not exist in this build; skipped");
            continue;
        }
        if (isset($existing[$cap]) && (int)$existing[$cap] === CAP_ALLOW) {
            continue;
        }
        if ($dryrun) {
            out("DRY   would allow {$cap}");
            continue;
        }
        assign_capability($cap, CAP_ALLOW, $role->id, $syscontext->id, true);
        $changed++;
        out("OK    allowed {$cap}");
    }

    if ($user && !$dryrun) {
        $assigned = $DB->record_exists('role_assignments', [
            'roleid'    => $role->id,
            'userid'    => $user->id,
            'contextid' => $syscontext->id,
        ]);
        if (!$assigned) {
            role_assign($role->id, $user->id, $syscontext->id);
            $changed++;
            out("OK    assigned role '{$roleshortname}' to '{$username}' at system context");
        } else {
            out('INFO  role already assigned at system context');
        }
        // Stable public API: invalidates the access cache for this context tree.
        $syscontext->mark_dirty();
    }
}

// ---------------------------------------------------------------------------
// 6. Authorised-users entry (only meaningful when restrictedusers = 1).
// ---------------------------------------------------------------------------
if ($user && $restrictedusers === 1) {
    $allowed = $DB->record_exists('external_services_users', [
        'externalserviceid' => $service->id,
        'userid'            => $user->id,
    ]);
    if (!$allowed) {
        if ($dryrun) {
            out('DRY   would add the user to the service authorised list');
        } else {
            $DB->insert_record('external_services_users', (object)[
                'externalserviceid' => $service->id,
                'userid'            => $user->id,
                'iprestriction'     => null,
                'validuntil'        => null,
                'timecreated'       => $now,
            ]);
            $changed++;
            out('OK    added the user to the service authorised list');
        }
    } else {
        out('INFO  user already in the service authorised list');
    }
}

// ---------------------------------------------------------------------------
// 7. Token.
// ---------------------------------------------------------------------------
/**
 * Mint a permanent web-service token across Moodle versions.
 *
 * Moodle >= 4.2 exposes core_external\util::generate_token(); earlier versions
 * only have the global external_generate_token(). Both are tried before any
 * direct table write.
 */
function paeu_generate_token(stdClass $service, stdClass $user, context $context): string {
    if (class_exists('\\core_external\\util')
        && method_exists('\\core_external\\util', 'generate_token')) {
        return \core_external\util::generate_token(
            EXTERNAL_TOKEN_PERMANENT, $service, $user->id, $context, 0, ''
        );
    }
    if (function_exists('external_generate_token')) {
        return external_generate_token(
            EXTERNAL_TOKEN_PERMANENT, $service, $user->id, $context, 0, ''
        );
    }
    throw new moodle_exception('no token generation API available in this Moodle build');
}

if (!$user) {
    out('DRY   no user yet, no token to report');
    exit(0);
}

$tokenrecord = $DB->get_record('external_tokens', [
    'userid'            => $user->id,
    'externalserviceid' => $service->id,
    'tokentype'         => EXTERNAL_TOKEN_PERMANENT,
]);

if ($tokenrecord && $options['rotate-token']) {
    if ($dryrun) {
        out('DRY   would rotate the existing token');
    } else {
        $DB->delete_records('external_tokens', ['id' => $tokenrecord->id]);
        $tokenrecord = null;
        $changed++;
        out('OK    deleted the previous token (rotation requested)');
    }
}

if (!$tokenrecord) {
    if ($dryrun) {
        out('DRY   would mint a new permanent token');
        exit(0);
    }
    $token = paeu_generate_token($service, $user, $syscontext);
    $changed++;
    out('OK    minted a new permanent token');
} else {
    $token = $tokenrecord->token;
    out('INFO  reusing the existing permanent token (pass --rotate-token to replace it)');
}

out("INFO  {$changed} change(s) applied");
out('INFO  store the value below in SSM and never commit it');

// stdout: the one machine-readable line.
echo 'MOODLE_WS_TOKEN=' . $token . PHP_EOL;
exit(0);
