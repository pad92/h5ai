const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {drain} = require('../../../util/fresh');

// Runs after model/item, which loads the filter and search extensions into
// the shared document with debounceTime 0.
const Item = reqlib('model/item');
const event = reqlib('core/event');
const location = reqlib('core/location');
const server = reqlib('server');
const view = reqlib('view/view');

// The labels listed, sorted, without the parent folder.
const labels = () => Array.from(document.querySelectorAll('#items .item:not(.folder-parent) .label'), el => el.textContent).sort();
const isActive = id => document.querySelector(`#${id}`).classList.contains('active');
const hint = () => document.querySelector('#view-hint').className;

const type = async (id, value) => {
    const input = document.querySelector(`#${id} input`);
    input.value = value;
    input.dispatchEvent(new window.KeyboardEvent('keyup', {bubbles: true}));
    await drain();
};

const open = async id => {
    document.querySelector(`#${id} img`).click();
    await drain();
};

// A folder with alpha.txt and beta.md as the current location, and the
// server requests recorded: each answer waits for respond(index, paths) or
// fail(index).
const withFolder = async run => {
    const folder = Item.get('/pattern-tool/');
    const alpha = Item.get('/pattern-tool/alpha.txt');
    const beta = Item.get('/pattern-tool/beta.md');
    folder.content = {[alpha.absHref]: alpha, [beta.absHref]: beta};
    const requests = [];
    const saved = {getItem: location.getItem, getAbsHref: location.getAbsHref, request: server.request};
    location.getItem = () => folder;
    location.getAbsHref = () => folder.absHref;
    // Other modules (thumbnails, say) also ask the server: only searches
    // are recorded, the rest get an empty answer.
    server.request = data => {
        if (!data.search) {
            return Promise.resolve({});
        }
        return new Promise((resolve, reject) => requests.push({data, resolve, reject}));
    };
    const respond = async (index, paths) => {
        requests[index].resolve({search: paths});
        await drain();
    };
    const fail = async index => {
        requests[index].reject(new Error('offline'));
        await drain();
    };

    // Closing a tool from its icon keeps what was typed: start empty.
    ['filter', 'search'].forEach(id => { document.querySelector(`#${id} input`).value = ''; });

    try {
        view.setLocation();
        await run({folder, alpha, beta, requests, respond, fail});
    } finally {
        ['filter', 'search'].filter(isActive).forEach(id => document.querySelector(`#${id} img`).click());
        await drain();
        location.getItem = saved.getItem;
        location.getAbsHref = saved.getAbsHref;
        server.request = saved.request;
    }
};

test('search: an answer to an older pattern does not replace the newer one', async () => {
    await withFolder(async ({alpha, beta, requests, respond}) => {
        await open('search');
        await type('search', 're:al');
        await type('search', 're:be');
        assert.equal(requests.length, 2);

        await respond(1, [beta.absHref]);
        await respond(0, [alpha.absHref]);
        assert.deepEqual(labels(), ['beta.md']);
        assert.equal(document.querySelector('#search').classList.contains('pending'), false);
    });
});

test('search: an answer arriving after the search closed leaves the folder listed', async () => {
    await withFolder(async ({alpha, respond}) => {
        await open('search');
        await type('search', 're:al');
        await open('search');
        await respond(0, [alpha.absHref]);

        assert.deepEqual(labels(), ['alpha.txt', 'beta.md']);
        assert.equal(document.querySelector('#search').classList.contains('pending'), false);
    });
});

test('search: after a failed request, the same pattern is asked again', async () => {
    await withFolder(async ({alpha, requests, respond, fail}) => {
        await open('search');
        await type('search', 're:al');
        await fail(0);
        assert.deepEqual(labels(), ['alpha.txt', 'beta.md'], 'the folder is listed again');

        await type('search', 're:al');
        assert.equal(requests.length, 2);
        await respond(1, [alpha.absHref]);
        assert.deepEqual(labels(), ['alpha.txt']);
    });
});

test('filter: a refresh adds only the new items that match', async () => {
    await withFolder(async ({folder}) => {
        await open('filter');
        await type('filter', 're:^a');
        assert.deepEqual(labels(), ['alpha.txt']);

        const added = [Item.get('/pattern-tool/apple.txt'), Item.get('/pattern-tool/notes.txt')];
        added.forEach(item => { folder.content[item.absHref] = item; });
        event.pub('location.refreshed', folder, added, [], []);

        assert.deepEqual(labels(), ['alpha.txt', 'apple.txt']);
        assert.ok(hint().includes('l10n-noMatch'), 'the hint still speaks of matches');
    });
});

test('search: a refresh of the folder adds nothing to the results', async () => {
    await withFolder(async ({folder, alpha, respond}) => {
        await open('search');
        await type('search', 're:al');
        await respond(0, [alpha.absHref]);

        const added = Item.get('/pattern-tool/also.txt');
        folder.content[added.absHref] = added;
        event.pub('location.refreshed', folder, [added], [], []);

        assert.deepEqual(labels(), ['alpha.txt']);
    });
});

test('search and filter: opening one closes the other and lists the folder', async () => {
    await withFolder(async ({alpha, respond}) => {
        await open('search');
        await type('search', 're:al');
        await respond(0, [alpha.absHref]);
        assert.deepEqual(labels(), ['alpha.txt']);

        await open('filter');
        assert.equal(isActive('search'), false);
        assert.equal(document.querySelector('#search input').value, '');
        assert.equal(isActive('filter'), true);
        assert.deepEqual(labels(), ['alpha.txt', 'beta.md']);

        await type('filter', 're:^b');
        await open('search');
        assert.equal(isActive('filter'), false);
        assert.deepEqual(labels(), ['alpha.txt', 'beta.md']);
    });
});

test('view: removing an item that was never shown does not throw', () => {
    const hidden = Item.get('/pattern-tool/never-shown/');
    delete hidden.$view;
    view.changeItems([], [hidden]);
});
