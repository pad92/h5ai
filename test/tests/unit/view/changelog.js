const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh, flush} = require('../../../util/fresh');
const {restore_html} = require('../../../util/pin');

const config = reqlib('config');
const i18n = reqlib('core/i18n');

const win = global.window;

// Requests wait until the test answers them.
const mockXhr = () => {
    const requests = [];
    const saved = win.XMLHttpRequest;
    win.XMLHttpRequest = class {
        open(method, href) {
            this.method = method;
            this.href = href;
        }

        send() {
            requests.push(this);
        }
    };
    const answer = (status, text) => {
        const xhr = requests[requests.length - 1];
        xhr.status = status;
        xhr.responseText = text;
        xhr.onload();
    };
    return {requests, answer, restore: () => { win.XMLHttpRequest = saved; }};
};

// The top bar built for `version`, with its own changelog module (each keeps
// the loaded file).
const withTopbar = async (version, run) => {
    const savedVersion = config.setup.VERSION;
    config.setup.VERSION = version;
    const xhr = mockXhr();
    const changelog = fresh('view/changelog');
    const base = fresh('view/base');
    try {
        await run(xhr);
    } finally {
        base.cleanup();
        changelog.cleanup();
        xhr.restore();
        config.setup.VERSION = savedVersion;
        i18n.set({});
        restore_html();
    }
};

const $ = sel => document.querySelector(sel);
const dialog = () => $('#changelog');
const isOpen = () => Boolean(dialog() && dialog().hasAttribute('open'));

test('top bar: a release shows "v1.6.0", the project link stays', async () => {
    await withTopbar('1.6.0', () => {
        assert.equal($('#version').textContent, 'v1.6.0');
        assert.equal($('#version').tagName, 'BUTTON');
        assert.equal($('#backlink-home').getAttribute('href'), 'https://github.com/pad92/h5ai/');
        assert.equal($('#backlink-home').contains($('#version')), false, 'the version is not inside the link');
    });
});

test('top bar: a commit build shows its id, without "v" and never a branch', async () => {
    await withTopbar('1fd0cb1e', () => {
        assert.equal($('#version').textContent, '1fd0cb1e');
    });
});

test('changelog: a click on the version loads CHANGELOG.md and renders it safely', async () => {
    await withTopbar('1.6.0', async ({requests, answer}) => {
        $('#version').click();
        assert.ok(isOpen(), 'opens at once');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'GET');
        assert.equal(requests[0].href, '/../CHANGELOG.md', 'next to public/, as the build copies it');
        assert.equal($('#changelog-body').textContent, 'loading');

        answer(200, '# Changelog\n\n## v1.6.0\n\n* **Player**: fixed\n\n<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>');
        await flush();

        assert.equal($('#changelog-body h2').textContent, 'v1.6.0');
        assert.equal($('#changelog-body strong').textContent, 'Player');
        assert.equal($('#changelog-body script'), null);
        const img = $('#changelog-body img');
        assert.ok(!img || !img.hasAttribute('onerror'), 'event handlers are stripped');
        assert.equal(win.pwned, undefined);
    });
});

test('changelog: loaded once, then shown again without a request', async () => {
    await withTopbar('1.6.0', async ({requests, answer}) => {
        $('#version').click();
        answer(200, '## v1.6.0');
        await flush();
        $('#changelog-close').click();
        assert.equal(isOpen(), false, 'the close button closes it');

        $('#version').click();
        await flush();
        assert.equal(requests.length, 1);
        assert.equal($('#changelog-body h2').textContent, 'v1.6.0');
        assert.equal(document.querySelectorAll('#changelog').length, 1, 'one dialog, reused');
    });
});

test('changelog: a failed load says so and the next click retries', async () => {
    await withTopbar('1.6.0', async ({requests, answer}) => {
        $('#version').click();
        answer(404, 'Not Found');
        await flush();
        assert.equal($('#changelog-body').textContent, '[request failed] HTTP 404');

        dialog().dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        assert.equal(isOpen(), false, 'Escape closes it');

        $('#version').click();
        assert.equal(requests.length, 2, 'a failure is not kept');
        answer(200, '## v1.6.0');
        await flush();
        assert.equal($('#changelog-body h2').textContent, 'v1.6.0');
    });
});

test('changelog: the dialog labels follow the language, the file does not', async () => {
    await withTopbar('1.6.0', async ({answer}) => {
        i18n.set({changelog: 'Journal des modifications', close: 'fermer', loading: 'chargement'});
        assert.equal($('#version').getAttribute('title'), 'Journal des modifications');

        $('#version').click();
        assert.equal($('#changelog-title').textContent, 'Journal des modifications');
        assert.equal($('#changelog-close').getAttribute('aria-label'), 'fermer');
        assert.equal($('#changelog-body').textContent, 'chargement');

        answer(200, '## v1.6.0\n\n* **Player**: fixed');
        await flush();
        assert.equal($('#changelog-body li').textContent, 'Player: fixed', 'rendered as written');
    });
});
