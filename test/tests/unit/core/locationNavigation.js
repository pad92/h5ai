const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh, flush} = require('../../../util/fresh');

const server = reqlib('server');
const event = reqlib('core/event');
const notification = reqlib('view/notification');
const Item = reqlib('model/item');
const {dom} = reqlib('util/dom');

// Loads a separate copy of core/location against a scripted server. Its
// publications, notifications and history calls are recorded instead of
// reaching the modules that other tests loaded.
const withLocation = async (view, responses, run) => {
    const win = global.window;
    const saved = {
        request: server.request,
        pub: event.pub,
        set: notification.set,
        onpopstate: win.onpopstate
    };
    const calls = {requests: [], events: [], notes: [], history: []};
    server.request = query => {
        calls.requests.push(query);
        const next = responses.shift();
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    };
    event.pub = (topic, ...args) => calls.events.push([topic, ...args]);
    notification.set = content => calls.notes.push(content);
    win.history.pushState = (state, title, url) => calls.history.push(['push', state, url]);
    win.history.replaceState = (state, title, url) => calls.history.push(['replace', state, url]);

    const {cleanup} = fresh('core/location', {view});
    try {
        await run(reqlib('core/location'), calls);
    } finally {
        cleanup();
        // The stubs shadow the History.prototype methods.
        delete win.history.pushState;
        delete win.history.replaceState;
        win.onpopstate = saved.onpopstate;
        server.request = saved.request;
        event.pub = saved.pub;
        notification.set = saved.set;
        // The item cache is shared: drop the folders these tests created.
        Object.keys(Item.get('/').content)
            .filter(href => href.startsWith('/nav'))
            .forEach(href => Item.remove(href));
    }
};

const topics = calls => calls.events.map(([topic]) => topic);
const contentHrefs = item => Object.keys(item.content).sort();

test('location: opening an unloaded folder loads it and drops vanished entries', async () => {
    const stale = Item.get('/nav a/stale.txt');
    const responses = [{items: [{href: '/nav%20a/'}, {href: '/nav%20a/new.txt', size: 1}]}];
    await withLocation({fastBrowsing: true}, responses, async (location, calls) => {
        location.setLocation('/nav a/');
        assert.equal(location.getAbsHref(), '/nav%20a/');
        assert.deepEqual(calls.history, [['push', {absHref: '/nav%20a/'}, '/nav%20a/']]);
        assert.deepEqual(calls.notes, ['loading...']);
        assert.deepEqual(calls.requests, [{action: 'get', items: {href: '/nav%20a/', what: 1}}]);

        await flush();
        const item = location.getItem();
        assert.equal(item.absHref, '/nav%20a/');
        assert.equal(item.isLoaded, true);
        assert.deepEqual(calls.notes, ['loading...', undefined], 'the notice is cleared');
        assert.deepEqual(topics(calls), ['location.beforeChange', 'location.changed']);
        assert.equal(calls.events[1][1], item);
        assert.deepEqual(contentHrefs(item), ['/nav%20a/new.txt']);
        assert.notEqual(Item.get('/nav a/stale.txt'), stale, 'the stale entry left the cache');
    });
});

test('location: reopening a loaded folder refreshes it and reports the differences', async () => {
    const folder = Item.get('/nav-b/');
    folder.isLoaded = true;
    Item.get({href: '/nav-b/kept.txt', size: 1, time: 10});
    Item.get({href: '/nav-b/changed.txt', size: 1, time: 10});
    const gone = Item.get({href: '/nav-b/gone.txt', size: 1, time: 10});
    const responses = [{items: [
        {href: '/nav-b/kept.txt', size: 1, time: 10},
        {href: '/nav-b/changed.txt', size: 2, time: 10},
        {href: '/nav-b/added.txt', size: 3, time: 10}
    ]}];
    await withLocation({fastBrowsing: true}, responses, async (location, calls) => {
        location.setLocation('/nav-b/', true);
        assert.deepEqual(calls.history, [['replace', {absHref: '/nav-b/'}, '/nav-b/']]);
        assert.deepEqual(topics(calls), ['location.beforeChange', 'location.changed', 'location.beforeRefresh']);

        await flush();
        const [topic, item, added, removed, updated] = calls.events[3];
        assert.equal(topic, 'location.refreshed');
        assert.equal(item, folder);
        assert.deepEqual(added.map(i => i.absHref), ['/nav-b/added.txt']);
        assert.deepEqual(removed, [gone]);
        assert.deepEqual(updated.map(i => i.absHref), ['/nav-b/changed.txt']);

        calls.history.length = 0;
        location.setLocation('/nav-b/');
        assert.deepEqual(calls.history, [], 'the same folder is not pushed twice');
    });
});

test('location: an empty answer keeps the folder content', async () => {
    Item.get('/nav-c/kept.txt');
    await withLocation({fastBrowsing: true}, [null], async location => {
        location.setLocation('/nav-c/');
        await flush();
        assert.deepEqual(contentHrefs(location.getItem()), ['/nav-c/kept.txt']);
    });
});

test('location: load and refresh failures are reported', async () => {
    const offline = new Error('offline');
    await withLocation({fastBrowsing: true}, [offline, offline], async (location, calls) => {
        location.setLocation('/nav-d/');
        await flush();
        assert.equal(location.getItem().isLoaded, undefined);
        assert.deepEqual(calls.notes, ['loading...', 'loading failed']);
        assert.equal(topics(calls).includes('location.changed'), false);

        location.refresh();
        await flush();
        assert.deepEqual(calls.notes, ['loading...', 'loading failed', 'refresh failed']);
        assert.equal(topics(calls).includes('location.refreshed'), false);
    });
});

test('location: browser back restores a folder without a new history entry', async () => {
    Item.get('/nav-e/').isLoaded = true;
    await withLocation({fastBrowsing: true}, [{items: []}], async (location, calls) => {
        window.onpopstate({state: null});
        assert.deepEqual(calls.events, [], 'a state without a folder is ignored');

        window.onpopstate({state: {absHref: '/nav-e/'}});
        assert.equal(location.getAbsHref(), '/nav-e/');
        assert.deepEqual(calls.history, [['replace', {absHref: '/nav-e/'}, '/nav-e/']]);
        await flush();
    });
});

test('location: managed folder links navigate in place with fast browsing', async () => {
    Item.get('/nav-f/').isLoaded = true;
    await withLocation({fastBrowsing: true}, [{items: []}], async location => {
        const link = document.createElement('a');
        location.setLink(dom(link), {absHref: '/nav-f/', isFolder: () => true, isManaged: true});
        const click = new window.MouseEvent('click', {cancelable: true});
        link.dispatchEvent(click);
        assert.equal(click.defaultPrevented, true);
        assert.equal(location.getAbsHref(), '/nav-f/');
        await flush();
    });
});

test('location: without fast browsing, links and history are left to the browser', async () => {
    Item.get('/nav-g/').isLoaded = true;
    await withLocation({fastBrowsing: false, unmanagedInNewWindow: false}, [{items: []}], async (location, calls) => {
        assert.equal(window.onpopstate, null);
        assert.equal(location.getDomain(), document.domain);

        const folder = document.createElement('a');
        const file = document.createElement('a');
        location.setLink(dom(folder), {absHref: '/nav-g/', isFolder: () => true, isManaged: true});
        location.setLink(dom(file), {absHref: '/ext.txt', isFolder: () => false, isManaged: false});
        const click = new window.MouseEvent('click', {cancelable: true});
        folder.dispatchEvent(click);
        assert.equal(click.defaultPrevented, false);
        assert.equal(file.getAttribute('target'), null, 'unmanaged files stay in the same window');

        location.setLocation('/nav-g/');
        assert.deepEqual(calls.history, []);
        await flush();
    });
});
