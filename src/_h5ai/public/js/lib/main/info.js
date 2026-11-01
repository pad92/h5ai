const {dom} = require('../util');
const config = require('../config');
const server = require('../server');
const {videoTool, documentTool} = require('./info-checks');
const {metricGroups} = require('./info-metrics');
require('../ext/theme');


const MSG_LOGIN_DISABLED =
    'Admin login is disabled because no password is configured. Set ' +
    '<code>H5AI_ADMIN_PASSWORD</code> for the Docker image, or a ' +
    '<code>password_hash()</code> value as <code>passhash</code> in ' +
    '<code>_h5ai/private/conf/options.json</code>.';
const MSG_LOGIN_REFUSED = 'Wrong password, or too many failed attempts. Try again later.';
const MSG_REQUEST_FAILED = 'The server did not answer the request. Try again.';

// Rows without a pass/fail outcome only report a value.
const NEUTRAL = null;

const loginTpl =
    `<form id="login" class="card" autocomplete="on">
        <label for="pass">Admin password</label>
        <div class="row">
            <input id="pass" name="pass" type="password" autocomplete="current-password" required/>
            <button type="submit">Log in</button>
        </div>
        <p id="login-error" class="error" role="alert" hidden></p>
    </form>`;
const logoutTpl =
    `<div id="logout-wrapper" class="card">
        <span>Logged in as admin.</span>
        <button id="logout" type="button">Log out</button>
        <p id="logout-error" class="error" role="alert" hidden></p>
    </div>`;
const disabledTpl =
    '<p id="login-disabled" class="card notice"></p>';
const checksTpl =
    `<div id="checks">
        <p id="checks-summary" role="status"></p>
    </div>`;
const groupTpl =
    `<section class="group">
        <h2></h2>
        <ul class="tests"></ul>
    </section>`;
const testTpl =
    `<li class="test">
        <span class="label"></span>
        <span class="result"></span>
        <p class="desc"></p>
    </li>`;
const metricsTpl =
    `<div id="metrics">
        <div class="metrics-head">
            <h2>Background tasks and cache</h2>
            <button id="metrics-refresh" type="button">Refresh</button>
        </div>
        <p id="metrics-status" role="status"></p>
        <div class="groups"></div>
    </div>`;
const setup = config.setup;


const yesNo = passed => passed ? 'yes' : 'no';

// Each check: [label, info (trusted static HTML), passed (true, false or
// NEUTRAL), shown result]. Values from the server go into the result, which is
// set as text.
const checkGroups = () => {
    const thumbnails = config.options && config.options.thumbnails;
    const video = videoTool(setup);
    const docTool = documentTool(setup, thumbnails);

    return [
        ['h5ai', [
            ['Version', 'Green for a tagged release only',
                (/^\d+\.\d+\.\d+$/).test(setup.VERSION), setup.VERSION],
            ['Index file', 'Add this path to the index file list of the web server',
                NEUTRAL, setup.INDEX_HREF],
            ['Options', '<code>options.json</code> is readable and valid JSON',
                config.options !== null],
            ['Types', '<code>types.json</code> is readable and valid JSON',
                config.types !== null],
            ['Public cache', 'The web server can write to <code>_h5ai/public/cache</code>',
                setup.HAS_WRITABLE_CACHE_PUB],
            ['Private cache', 'The web server can write to <code>_h5ai/private/cache</code>',
                setup.HAS_WRITABLE_CACHE_PRV]
        ]],
        ['Server and PHP', [
            ['Web server', 'One of Apache, lighttpd, nginx, Cherokee or Angie',
                setup.HAS_SERVER, `${setup.SERVER_NAME} ${setup.SERVER_VERSION}`.trim()],
            ['PHP version', `At least ${setup.MIN_PHP_VERSION}`,
                true, setup.PHP_VERSION],
            ['PHP architecture', '64-bit shows file and folder sizes above about 2 GB correctly',
                setup.PHP_ARCH === '64-bit', setup.PHP_ARCH],
            ['GD with WebP', 'Image thumbnails',
                setup.HAS_PHP_WEBP],
            ['EXIF', 'Image type detection and embedded EXIF thumbnails',
                setup.HAS_PHP_EXIF],
            ['Fileinfo', 'File type detection for thumbnails',
                setup.HAS_PHP_FILEINFO],
            ['Zip', 'Thumbnails from images inside Zip archives',
                setup.HAS_PHP_ZIP],
            ['Rar', 'Thumbnails from images inside Rar archives',
                setup.HAS_PHP_RAR],
            ['SQLite3', 'Thumbnail cache',
                setup.HAS_PHP_SQLITE3]
        ]],
        ['Commands', [
            ['Video thumbnails', '<code>ffmpeg</code> or <code>avconv</code>',
                Boolean(video), video || 'no'],
            ['Document thumbnails',
                'Hardened ImageMagick <code>magick</code> (or <code>convert</code> on ImageMagick 6)',
                Boolean(docTool), docTool || 'no'],
            ['tar', 'Tar downloads', setup.HAS_CMD_TAR],
            ['zip', 'Zip downloads', setup.HAS_CMD_ZIP],
            ['du', 'Folder sizes computed by the shell', setup.HAS_CMD_DU]
        ]]
    ];
};

const addTest = ($list, [label, info, passed, result]) => {
    const $test = dom(testTpl).appTo($list);
    const outcome = passed === NEUTRAL ? 'neutral' : passed ? 'passed' : 'failed';
    $test.addCls(outcome);
    $test.find('.label').text(label);
    $test.find('.result')
        .addCls(outcome)
        .text(result !== undefined && result !== '' ? result : yesNo(passed));
    $test.find('.desc').html(info);
};

const addChecks = () => {
    if (!setup.AS_ADMIN) {
        return;
    }

    const $checks = dom(checksTpl).appTo('#content');
    let passed = 0;
    let total = 0;

    checkGroups().forEach(([title, checks]) => {
        const $group = dom(groupTpl).appTo($checks);
        $group.find('h2').text(title);
        const $list = $group.find('.tests');
        checks.forEach(check => {
            addTest($list, check);
            if (check[2] !== NEUTRAL) {
                total += 1;
                passed += check[2] ? 1 : 0;
            }
        });
    });

    dom('#checks-summary')
        .addCls(passed === total ? 'passed' : 'failed')
        .text(`${passed} of ${total} checks passed`);
};

const renderMetrics = metrics => {
    const $groups = dom('#metrics .groups').clr();
    metricGroups(metrics).forEach(([title, rows]) => {
        const $group = dom(groupTpl).appTo($groups);
        $group.find('h2').text(title);
        const $list = $group.find('.tests');
        rows.forEach(([label, info, value]) => addTest($list, [label, info, NEUTRAL, value]));
    });
};

const loadMetrics = () => {
    const $button = dom('#metrics-refresh').prop('disabled', true);
    const $status = dom('#metrics-status').text('Loading…').rmCls('error');
    return server.request({action: 'get', metrics: true})
        .then(resp => {
            if (!resp || !resp.metrics) {
                throw new Error(resp && resp.msg || 'no metrics in the answer');
            }
            renderMetrics(resp.metrics);
            $status.text('');
        })
        .catch(() => $status.addCls('error').text(MSG_REQUEST_FAILED))
        .then(() => $button.prop('disabled', false));
};

const addMetrics = () => {
    if (!setup.AS_ADMIN) {
        return;
    }
    dom(metricsTpl).appTo('#content');
    dom('#metrics-refresh').on('click', loadMetrics);
    loadMetrics();
};

const reload = () => {
    global.window.location.reload();
};

const showError = (selector, message) => {
    dom(selector).text(message).rmAttr('hidden');
};

const onLogin = ev => {
    ev.preventDefault();
    const $button = dom('#login button');
    const $pass = dom('#pass');
    dom('#login-error').attr('hidden', '');
    $button.prop('disabled', true);

    server.request({action: 'login', pass: $pass.val()})
        .then(resp => {
            if (resp && resp.asAdmin) {
                reload();
                return;
            }
            showError('#login-error', MSG_LOGIN_REFUSED);
            $pass.val('');
            $pass[0].focus();
        })
        .catch(() => showError('#login-error', MSG_REQUEST_FAILED))
        .then(() => $button.prop('disabled', false));
};

const onLogout = () => {
    const $button = dom('#logout');
    $button.prop('disabled', true);
    server.request({action: 'logout'})
        .then(reload)
        .catch(() => {
            showError('#logout-error', MSG_REQUEST_FAILED);
            $button.prop('disabled', false);
        });
};

const addLogin = () => {
    if (setup.AS_ADMIN) {
        dom(logoutTpl).appTo('#content');
        dom('#logout').on('click', onLogout);
    } else if (config.options && config.options.hasCustomPasshash) {
        dom(loginTpl).appTo('#content');
        dom('#login').on('submit', onLogin);
        dom('#pass')[0].focus();
    } else {
        dom(disabledTpl).appTo('#content').html(MSG_LOGIN_DISABLED);
    }
};

const init = () => {
    addLogin();
    addChecks();
    addMetrics();
};


init();
