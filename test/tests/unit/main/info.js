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
        return response;
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

const results = () => [...document.querySelectorAll('#tests .test')].map(el => ({
    label: el.querySelector('.label').textContent,
    result: el.querySelector('.result').textContent,
    passed: el.querySelector('.result').classList.contains('passed')
}));

test('info page: an admin sees every check and can only log out', async () => {
    const page = loadInfo({setup: ADMIN_SETUP});
    try {
        const rows = results();
        assert.equal(rows.length, 20);
        const byLabel = Object.fromEntries(rows.map(row => [row.label, row]));
        assert.deepEqual(byLabel['h5ai version'], {label: 'h5ai version', result: '1.4.0', passed: true});
        assert.equal(byLabel['Server software'].result, 'nginx 1.27');
        assert.equal(byLabel['PHP arch'].passed, true);
        assert.equal(byLabel['Public Cache directory'].result, 'yes');
        assert.equal(byLabel['Private Cache directory'].result, 'no');
        assert.equal(byLabel['Private Cache directory'].passed, false);
        assert.equal(byLabel['Video thumbs'].passed, true, 'ffmpeg alone is enough');
        assert.equal(byLabel['PDF thumbs'].passed, true);
        assert.equal(byLabel['Shell tar'].passed, false);

        assert.equal(document.querySelector('#pass'), null);
        assert.equal(document.querySelector('#login'), null);
        assert.ok(document.querySelector('#hint'), 'the preset password hint stays');

        document.querySelector('#logout').click();
        await page.settle();
        assert.deepEqual(page.requests, [{action: 'logout'}]);
        assert.equal(page.reloads(), 1);
    } finally {
        page.done();
    }
});

test('info page: a development version is flagged and a 32-bit PHP fails', () => {
    const page = loadInfo({setup: Object.assign({}, ADMIN_SETUP, {VERSION: '1.4.0-dev', PHP_ARCH: '32-bit'})});
    try {
        const byLabel = Object.fromEntries(results().map(row => [row.label, row]));
        assert.deepEqual(byLabel['h5ai version'], {label: 'h5ai version', result: '1.4.0-dev', passed: false});
        assert.deepEqual(byLabel['PHP arch'], {label: 'PHP arch', result: '32-bit', passed: false});
    } finally {
        page.done();
    }
});

test('info page: a visitor gets no checks and logs in with Enter or the button', async () => {
    const page = loadInfo({setup: {AS_ADMIN: false}});
    try {
        assert.equal(document.querySelector('#tests'), null);
        assert.equal(document.querySelector('#logout'), null);
        const pass = document.querySelector('#pass');
        assert.equal(document.activeElement, pass, 'the password field has focus');

        pass.value = 'secret';
        const other = new window.KeyboardEvent('keydown');
        Object.defineProperty(other, 'which', {value: 65});
        pass.dispatchEvent(other);
        assert.deepEqual(page.requests, [], 'other keys do not submit');

        const enter = new window.KeyboardEvent('keydown');
        Object.defineProperty(enter, 'which', {value: 13});
        pass.dispatchEvent(enter);
        document.querySelector('#login').click();
        await page.settle();

        assert.deepEqual(page.requests, [
            {action: 'login', pass: 'secret'},
            {action: 'login', pass: 'secret'}
        ]);
        assert.equal(page.reloads(), 2);
    } finally {
        page.done();
    }
});

test('info page: a refused login does not reload and a custom password hides the hint', async () => {
    const page = loadInfo({
        setup: {AS_ADMIN: false},
        options: {hasCustomPasshash: true},
        response: Promise.reject(new Error('refused'))
    });
    try {
        assert.equal(document.querySelector('#hint'), null);
        document.querySelector('#login').click();
        await page.settle();
        assert.equal(page.requests.length, 1);
        assert.equal(page.reloads(), 0);
    } finally {
        page.done();
    }
});
