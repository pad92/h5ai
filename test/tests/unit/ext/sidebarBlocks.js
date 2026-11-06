const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh, flush} = require('../../../util/fresh');

const server = reqlib('server');

// Loads a sidebar module against a sidebar of its own, removed afterwards.
const withSidebar = async (name, settings, run) => {
    const saved = document.getElementById('sidebar');
    if (saved) {
        saved.id = 'saved-sidebar';
    }
    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar';
    document.body.appendChild(sidebar);
    const savedRequest = server.request;
    server.request = () => Promise.resolve({});
    const {cleanup} = fresh(name, settings);
    try {
        await flush();
        await run(sidebar);
    } finally {
        cleanup();
        server.request = savedRequest;
        sidebar.remove();
        if (saved) {
            saved.id = 'sidebar';
        }
    }
};

test('admin link: points to index.php next to the public assets of this install', async () => {
    await withSidebar('ext/admin-link', {publicHref: '/files/_h5ai/public/', view: {}}, sidebar => {
        const link = sidebar.querySelector('a#admin-link');
        assert.ok(link, 'shown by default');
        assert.equal(link.getAttribute('href'), '/files/_h5ai/public/index.php');
        assert.ok(link.textContent.trim(), 'the link has a name');
    });
});

test('admin link: view.adminLink false keeps it off the sidebar', async () => {
    await withSidebar('ext/admin-link', {view: {adminLink: false}}, sidebar => {
        assert.equal(sidebar.querySelector('#admin-link'), null);
    });
});

test('language menu: names each language in itself, without its code', async () => {
    await withSidebar('ext/l10n', {l10n: {enabled: true, lang: 'en', useBrowserLang: false}}, sidebar => {
        const select = sidebar.querySelector('select#langs');
        assert.ok(select.getAttribute('aria-label'), 'the menu has a name');
        const options = Array.from(select.options).map(option => [option.value, option.lang, option.textContent]);
        assert.deepEqual(options, [['en', 'en', 'English'], ['fr', 'fr', 'Français']]);
    });
});
