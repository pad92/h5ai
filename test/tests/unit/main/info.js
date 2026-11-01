const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh, flush} = require('../../../util/fresh');
const {restore_html} = require('../../../util/pin');

const config = reqlib('config');
const server = reqlib('server');

const ADMIN_SETUP = {
    AS_ADMIN: true,
    VERSION: '1.4.0',
    INDEX_HREF: '/_h5ai/public/index.php',
    HAS_SERVER: true,
    SERVER_NAME: 'nginx',
    SERVER_VERSION: '1.27',
    MIN_PHP_VERSION: '8.2',
    PHP_VERSION: '8.4.1',
    PHP_ARCH: '64-bit',
    HAS_WRITABLE_CACHE_PUB: true,
    HAS_WRITABLE_CACHE_PRV: false,
    HAS_PHP_WEBP: true,
    HAS_CMD_FFMPEG: true,
    HAS_CMD_MAGICK: true
};

// Loads the info page against the given setup with a stubbed server, and
// records the requests it sends and the page reloads they trigger.
const loadInfo = ({setup, options = {}, response = Promise.resolve({})}) => {
    const savedSetup = config.setup;
    const savedOptions = config.options;
    const savedRequest = server.request;
    const requests = [];
    let reloads = 0;

    const content = document.createElement('div');
    content.id = 'content';
    document.body.appendChild(content);

    config.setup = setup;
    config.options = Object.assign({}, savedOptions, options);
    server.request = query => {
        requests.push(query);
        return typeof response === 'function' ? response(query) : response;
    };
    const {cleanup} = fresh('main/info');

    // jsdom cannot reload, and window.location is unforgeable, so the page
    // sees a stand-in window only while its request callbacks settle.
    const settle = async () => {
        const win = global.window;
        global.window = {location: {reload: () => { reloads += 1; }}};
        try {
            await flush();
        } finally {
            global.window = win;
        }
    };

    const done = () => {
        cleanup();
        config.setup = savedSetup;
        config.options = savedOptions;
        server.request = savedRequest;
        restore_html();
    };

    return {requests, reloads: () => reloads, settle, done};
};

const results = () => [...document.querySelectorAll('#checks .test')].map(el => ({
    label: el.querySelector('.label').textContent,
    result: el.querySelector('.result').textContent,
    outcome: ['passed', 'failed', 'neutral'].find(cls => el.classList.contains(cls))
}));

const byLabel = () => Object.fromEntries(results().map(row => [row.label, row]));

const submitLogin = pass => {
    document.querySelector('#pass').value = pass;
    document.querySelector('#login').dispatchEvent(new window.Event('submit', {cancelable: true}));
};

const METRICS = {
    now: 10000,
    tasks: {
        warmer: {
            running: {id: 'warmer', percent: 42, remaining: 90},
            last: {finished: 9000, seconds: 42, phases: {files: {done: 1200, seconds: 30}, sizes: {done: 0, seconds: 12}}},
            schedule: {enabled: true, interval: 86400, lastRun: 9000, nextRun: 95400}
        },
        refresh: {running: null, last: null}
    },
    cache: {
        thumbnails: {files: 3, sources: 2, bytes: 3000000, coverage: {at: 9000, categories: {img: {files: 4, thumbnails: 3}}}},
        thumbnailDb: {bytes: 8192, sources: 2},
        folderSizes: {entries: 5, fresh: 4, bytes: 512, ttl: 300, newest: 9940}
    }
};

const adminResponse = query => Promise.resolve(query.metrics ? {metrics: METRICS} : {});

test('info page: an admin sees grouped checks with a summary and can only log out', async () => {
    const page = loadInfo({setup: ADMIN_SETUP, response: adminResponse});
    try {
        assert.equal(results().length, 20);
        assert.deepEqual([...document.querySelectorAll('#checks h2')].map(el => el.textContent),
            ['h5ai', 'Server and PHP', 'Commands']);
        const rows = byLabel();
        assert.deepEqual(rows.Version, {label: 'Version', result: '1.4.0', outcome: 'passed'});
        assert.deepEqual(rows['Index file'],
            {label: 'Index file', result: '/_h5ai/public/index.php', outcome: 'neutral'},
            'the index file is a hint, not a check');
        assert.equal(rows['Web server'].result, 'nginx 1.27');
        assert.equal(rows['PHP architecture'].outcome, 'passed');
        assert.equal(rows['Public cache'].result, 'yes');
        assert.deepEqual(rows['Private cache'], {label: 'Private cache', result: 'no', outcome: 'failed'});
        assert.deepEqual(rows['Video thumbnails'],
            {label: 'Video thumbnails', result: 'ffmpeg', outcome: 'passed'}, 'ffmpeg alone is enough');
        assert.equal(rows['Document thumbnails'].result, 'magick');
        assert.equal(rows.tar.outcome, 'failed');

        const summary = document.querySelector('#checks-summary');
        assert.equal(summary.textContent, '10 of 19 checks passed');
        assert.ok(summary.classList.contains('failed'));

        assert.equal(document.querySelector('#login'), null);
        assert.equal(document.querySelector('#login-disabled'), null);

        await page.settle();
        document.querySelector('#logout').click();
        assert.equal(document.querySelector('#logout').disabled, true, 'no double logout');
        await page.settle();
        assert.deepEqual(page.requests, [{action: 'get', metrics: true}, {action: 'logout'}]);
        assert.equal(page.reloads(), 1);
    } finally {
        page.done();
    }
});

const metricRows = () => Object.fromEntries([...document.querySelectorAll('#metrics .test')].map(el => [
    el.querySelector('.label').textContent, el.querySelector('.result').textContent
]));

test('info page: an admin sees task and cache metrics and can refresh them', async () => {
    const page = loadInfo({setup: ADMIN_SETUP, response: adminResponse});
    try {
        assert.equal(document.querySelector('#metrics-status').textContent, 'Loading…');
        await page.settle();
        assert.equal(document.querySelector('#metrics-status').textContent, '');
        assert.deepEqual([...document.querySelectorAll('#metrics .group h2')].map(el => el.textContent),
            ['Background tasks', 'Cache']);
        assert.equal(results().length, 20, 'metrics are not counted as checks');
        const rows = metricRows();
        assert.equal(rows['Cache warmer'], 'running · 42 % · ~ 2 min · last run 42 s');
        assert.equal(rows['Last warm run'], '17 min ago');
        assert.equal(rows['Folder size refresh'], 'idle');
        assert.equal(rows['Thumbnail files'], '3.0 MB');
        assert.equal(rows.Images, '3 of 4 (75 %)');
        assert.equal(rows['Folder sizes'], '4 of 5 entries fresh');

        document.querySelector('#metrics-refresh').click();
        assert.equal(document.querySelector('#metrics-refresh').disabled, true);
        await page.settle();
        assert.equal(page.requests.filter(query => query.metrics).length, 2);
        assert.equal(document.querySelectorAll('#metrics .group').length, 2, 'a refresh replaces the groups');
    } finally {
        page.done();
    }
});

test('info page: refused metrics show an error and keep the checks', async () => {
    const page = loadInfo({
        setup: ADMIN_SETUP,
        response: query => Promise.resolve(query.metrics ? {err: 'ERR_DISABLED', msg: 'metrics need an admin session'} : {})
    });
    try {
        await page.settle();
        const status = document.querySelector('#metrics-status');
        assert.ok(status.classList.contains('error'));
        assert.ok((/did not answer/).test(status.textContent));
        assert.equal(document.querySelectorAll('#metrics .group').length, 0);
        assert.equal(results().length, 20);
        assert.equal(document.querySelector('#metrics-refresh').disabled, false, 'a retry stays possible');
    } finally {
        page.done();
    }
});

const sections = selector => [...document.querySelectorAll(`${selector} details`)].map(el => ({
    title: el.querySelector('h2').textContent,
    count: el.querySelector('.count') ? el.querySelector('.count').textContent : null,
    open: el.open
}));

test('info page: sections with a failed check stay open, clean ones are folded', async () => {
    const allGood = Object.assign({}, ADMIN_SETUP, {
        HAS_WRITABLE_CACHE_PRV: true, HAS_PHP_EXIF: true, HAS_PHP_FILEINFO: true, HAS_PHP_ZIP: true,
        HAS_PHP_RAR: true, HAS_PHP_SQLITE3: true
    });
    const page = loadInfo({setup: allGood, response: adminResponse});
    try {
        await page.settle();
        assert.deepEqual(sections('#checks'), [
            {title: 'h5ai', count: '5/5', open: false},
            {title: 'Server and PHP', count: '9/9', open: false},
            {title: 'Commands', count: '2/5', open: true}
        ], 'the index file hint is not counted');
        const counts = [...document.querySelectorAll('#checks .count')];
        assert.deepEqual(counts.map(el => el.className), ['count passed', 'count passed', 'count failed']);
        assert.ok(sections('#metrics').every(section => section.open && section.count === ''),
            'metrics have no outcome and stay open');
    } finally {
        page.done();
    }
});

test('info page: a development version is flagged and a 32-bit PHP fails', () => {
    const page = loadInfo({setup: Object.assign({}, ADMIN_SETUP, {VERSION: '1.4.0-dev', PHP_ARCH: '32-bit'})});
    try {
        const rows = byLabel();
        assert.deepEqual(rows.Version, {label: 'Version', result: '1.4.0-dev', outcome: 'failed'});
        assert.deepEqual(rows['PHP architecture'], {label: 'PHP architecture', result: '32-bit', outcome: 'failed'});
    } finally {
        page.done();
    }
});

test('info page: server values are shown as text, never parsed as HTML', () => {
    const page = loadInfo({setup: Object.assign({}, ADMIN_SETUP, {INDEX_HREF: '/<img src=x onerror=alert(1)>/index.php'})});
    try {
        assert.equal(byLabel()['Index file'].result, '/<img src=x onerror=alert(1)>/index.php');
        assert.equal(document.querySelector('#checks img'), null);
    } finally {
        page.done();
    }
});

test('info page: a visitor gets no checks and logs in through a labelled form', async () => {
    const page = loadInfo({
        setup: {AS_ADMIN: false},
        options: {hasCustomPasshash: true},
        response: Promise.resolve({asAdmin: true})
    });
    try {
        assert.equal(document.querySelector('#checks'), null);
        assert.equal(document.querySelector('#logout'), null);
        const pass = document.querySelector('#pass');
        assert.equal(document.activeElement, pass, 'the password field has focus');
        assert.equal(document.querySelector('label[for="pass"]').textContent, 'Admin password');
        assert.equal(pass.getAttribute('autocomplete'), 'current-password');

        submitLogin('secret');
        await page.settle();

        assert.deepEqual(page.requests, [{action: 'login', pass: 'secret'}]);
        assert.equal(page.reloads(), 1);
    } finally {
        page.done();
    }
});

test('info page: a wrong password shows an error and does not reload', async () => {
    const page = loadInfo({
        setup: {AS_ADMIN: false},
        options: {hasCustomPasshash: true},
        response: Promise.resolve({asAdmin: false})
    });
    try {
        const error = document.querySelector('#login-error');
        assert.equal(error.hidden, true);

        submitLogin('wrong');
        assert.equal(document.querySelector('#login button').disabled, true, 'no double submit');
        await page.settle();

        assert.equal(page.reloads(), 0);
        assert.equal(error.hidden, false);
        assert.equal(error.getAttribute('role'), 'alert');
        assert.ok((/Wrong password/).test(error.textContent));
        assert.equal(document.querySelector('#pass').value, '', 'the field is cleared for a retry');
        assert.equal(document.querySelector('#login button').disabled, false);
    } finally {
        page.done();
    }
});

test('info page: a failed login request shows an error and does not reload', async () => {
    const page = loadInfo({
        setup: {AS_ADMIN: false},
        options: {hasCustomPasshash: true},
        response: Promise.reject(new Error('refused'))
    });
    try {
        submitLogin('secret');
        await page.settle();
        assert.equal(page.requests.length, 1);
        assert.equal(page.reloads(), 0);
        assert.ok((/did not answer/).test(document.querySelector('#login-error').textContent));
    } finally {
        page.done();
    }
});

test('info page: without a configured password the login form is replaced by how to set one', () => {
    const page = loadInfo({setup: {AS_ADMIN: false}, options: {hasCustomPasshash: false}});
    try {
        assert.equal(document.querySelector('#login'), null, 'login cannot succeed, so no form');
        const notice = document.querySelector('#login-disabled');
        assert.ok((/H5AI_ADMIN_PASSWORD/).test(notice.textContent));
        assert.ok(!(/empty string/).test(document.body.textContent), 'the stale empty-password hint is gone');
    } finally {
        page.done();
    }
});
