const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh, drain} = require('../../../util/fresh');

// Runs after model/item, which loads the search extension into the shared
// document, with filter and search enabled and debounceTime 0.
const Item = reqlib('model/item');
const event = reqlib('core/event');
const location = reqlib('core/location');
const server = reqlib('server');
const view = reqlib('view/view');

// The labels listed, sorted, without the parent folder.
const labels = () => Array.from(document.querySelectorAll('#items .item:not(.folder-parent) .label'), el => el.textContent).sort();
const $ = selector => document.querySelector(selector);
const isOpen = () => $('#search').classList.contains('active');
const isPending = () => $('#search').classList.contains('pending');
const isDeeperShown = () => !$('#search-deeper').classList.contains('hidden');
const hint = () => $('#view-hint').className;

const typeInto = async (input, value) => {
    input.value = value;
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await drain();
};
const type = value => typeInto($('#search input'), value);

const keydown = async (el, key) => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true}));
    await drain();
};
const press = key => keydown($('#search input'), key);

const toggle = async () => {
    $('#search img').click();
    await drain();
};

// A folder with alpha.txt, beta.md and a sub folder as the current location,
// and the search requests recorded: each answer waits for respond(index,
// paths) or fail(index). Other requests get an empty answer.
const withFolder = async run => {
    const folder = Item.get('/search-field/');
    const alpha = Item.get('/search-field/alpha.txt');
    const beta = Item.get('/search-field/beta.md');
    const sub = Item.get('/search-field/sub/');
    const deep = Item.get('/search-field/sub/deeper/alpine.txt');
    folder.content = {[alpha.absHref]: alpha, [beta.absHref]: beta, [sub.absHref]: sub};
    const requests = [];
    const saved = {getItem: location.getItem, getAbsHref: location.getAbsHref, request: server.request};
    location.getItem = () => folder;
    location.getAbsHref = () => folder.absHref;
    server.request = data => {
        if (!data.search) {
            return Promise.resolve({});
        }
        return new Promise((resolve, reject) => requests.push({data, resolve, reject}));
    };
    const respond = async (index, items) => {
        requests[index].resolve({search: items.map(item => item.absHref)});
        await drain();
    };
    const fail = async index => {
        requests[index].reject(new Error('offline'));
        await drain();
    };

    try {
        view.setLocation();
        await run({folder, alpha, beta, sub, deep, requests, respond, fail});
    } finally {
        if (isOpen()) {
            await toggle();
        }
        location.getItem = saved.getItem;
        location.getAbsHref = saved.getAbsHref;
        server.request = saved.request;
    }
};

test('search field: typing filters the folder without a request and offers the subfolders', async () => {
    await withFolder(async ({requests}) => {
        await toggle();
        assert.equal(isOpen(), true);
        assert.equal(isDeeperShown(), false, 'nothing typed, nothing offered');

        await type('al txt');
        assert.deepEqual(labels(), ['alpha.txt'], 'every word must match');
        assert.equal(requests.length, 0);
        assert.equal(isDeeperShown(), true);
        assert.equal($('#search-deeper .pattern').textContent, 'al txt');
    });
});

test('search field: when nothing in the folder matches, typing searches the subfolders', async () => {
    await withFolder(async ({deep, requests, respond}) => {
        await toggle();
        await type('alpi');
        assert.equal(requests.length, 1, 'no Enter needed');
        assert.equal(requests[0].data.search.pattern, 'a.*?l.*?p.*?i');
        assert.equal(isDeeperShown(), false);

        await respond(0, [deep]);
        assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
    });
});

test('search field: typing a match into the folder drops the search it started', async () => {
    await withFolder(async ({deep, requests, respond}) => {
        await toggle();
        await type('alpi');
        await type('al');
        await respond(0, [deep]);

        assert.equal(requests.length, 1);
        assert.deepEqual(labels(), ['alpha.txt']);
        assert.equal(isPending(), false);
        assert.equal(isDeeperShown(), true);
    });
});

test('search field: Enter searches the subfolders and shows the folder of each match', async () => {
    await withFolder(async ({alpha, deep, requests, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].data.search.pattern, 'a.*?l');
        assert.equal(isPending(), true);
        assert.equal(isDeeperShown(), false);

        await respond(0, [alpha, deep]);
        assert.equal(isPending(), false);
        assert.deepEqual(labels(), ['alpha.txt', 'sub/deeper/alpine.txt']);
        const label = Array.from(document.querySelectorAll('#items .item .label')).find(el => el.textContent.endsWith('alpine.txt'));
        assert.equal(label.querySelector('.path').textContent, 'sub/deeper/');
        assert.equal(label.getAttribute('title'), 'sub/deeper/alpine.txt');
    });
});

test('search field: the line under the listing searches the subfolders too', async () => {
    await withFolder(async ({deep, requests, respond}) => {
        await toggle();
        await type('alp');
        $('#search-deeper').click();
        await drain();
        assert.equal(requests.length, 1);
        await respond(0, [deep]);
        assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
    });
});

test('search field: typing after a search filters the folder again, without a request', async () => {
    await withFolder(async ({deep, requests, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');
        await respond(0, [deep]);

        await type('be');
        assert.deepEqual(labels(), ['beta.md']);
        assert.equal(requests.length, 1);
        assert.equal(isDeeperShown(), true);
    });
});

test('search field: an answer to an older search does not replace the newer one', async () => {
    await withFolder(async ({alpha, beta, requests, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');
        await type('be');
        await press('Enter');
        assert.equal(requests.length, 2);

        await respond(1, [beta]);
        await respond(0, [alpha]);
        assert.deepEqual(labels(), ['beta.md']);
        assert.equal(isPending(), false);
    });
});

test('search field: an answer arriving after the field closed leaves the folder listed', async () => {
    await withFolder(async ({deep, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');
        await toggle();
        await respond(0, [deep]);

        assert.deepEqual(labels(), ['alpha.txt', 'beta.md', 'sub']);
        assert.equal(isPending(), false);
        assert.equal(isDeeperShown(), false);
    });
});

test('search field: after a failed search, the folder matches and the line come back', async () => {
    await withFolder(async ({deep, requests, respond, fail}) => {
        await toggle();
        await type('al');
        await press('Enter');
        await fail(0);
        assert.deepEqual(labels(), ['alpha.txt']);
        assert.equal(isDeeperShown(), true);

        await press('Enter');
        assert.equal(requests.length, 2, 'the same text is asked again');
        await respond(1, [deep]);
        assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
    });
});

test('search field: Escape clears and closes it and lists the folder', async () => {
    await withFolder(async () => {
        await toggle();
        await type('be');
        await press('Escape');
        assert.equal(isOpen(), false);
        assert.equal($('#search input').value, '');
        assert.deepEqual(labels(), ['alpha.txt', 'beta.md', 'sub']);
    });
});

test('search field: a refresh adds to a filtered folder only the new items that match', async () => {
    await withFolder(async ({folder}) => {
        await toggle();
        await type('re:^a');
        assert.deepEqual(labels(), ['alpha.txt']);

        const added = [Item.get('/search-field/apple.txt'), Item.get('/search-field/notes.txt')];
        added.forEach(item => { folder.content[item.absHref] = item; });
        event.pub('location.refreshed', folder, added, [], []);

        assert.deepEqual(labels(), ['alpha.txt', 'apple.txt']);
        assert.ok(hint().includes('l10n-noMatch'), 'the hint still speaks of matches');
    });
});

test('search field: a refresh of the folder adds nothing to the subfolder results', async () => {
    await withFolder(async ({folder, deep, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');
        await respond(0, [deep]);

        const added = Item.get('/search-field/also.txt');
        folder.content[added.absHref] = added;
        event.pub('location.refreshed', folder, [added], [], []);

        assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
    });
});

test('search field: accented letters ignore case, and a decomposed name matches', async () => {
    await withFolder(async ({folder}) => {
        const summer = Item.get('/search-field/%C3%A9t%C3%A9.txt');
        const decomposed = Item.get('/search-field/cafe%CC%81.txt');
        folder.content[summer.absHref] = summer;
        folder.content[decomposed.absHref] = decomposed;
        await toggle();

        await type('ÉTÉ');
        assert.deepEqual(labels(), ['été.txt']);
        await type('café');
        assert.deepEqual(labels(), ['café.txt']);
    });
});

test('search field: Enter and Escape that pick an input method candidate are left alone', async () => {
    await withFolder(async ({requests}) => {
        await toggle();
        await type('al');
        for (const key of ['Enter', 'Escape']) {
            $('#search input').dispatchEvent(new window.KeyboardEvent('keydown', {key, isComposing: true, bubbles: true}));
        }
        await drain();
        assert.equal(requests.length, 0);
        assert.equal(isOpen(), true);
        assert.equal($('#search input').value, 'al');
    });
});

test('search field: the Enter Safari sends to end a composition is left alone', async () => {
    await withFolder(async ({requests}) => {
        await toggle();
        await type('al');
        const ev = new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true});
        Object.defineProperty(ev, 'keyCode', {value: 229});
        $('#search input').dispatchEvent(ev);
        await drain();
        assert.equal(requests.length, 0);
    });
});

test('search field: Escape closes the field only, not the panels listening on the window', async () => {
    await withFolder(async () => {
        let reached = 0;
        const listener = ev => { reached += ev.key === 'Escape' ? 1 : 0; };
        window.addEventListener('keydown', listener);
        try {
            await toggle();
            await type('be');
            await press('Escape');
            assert.equal(isOpen(), false);
            assert.equal(reached, 0);
        } finally {
            window.removeEventListener('keydown', listener);
        }
    });
});

test('search field: moving to another folder during a search drops its answer and lists the folder once', async () => {
    await withFolder(async ({folder, deep, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');

        let renders = 0;
        const count = () => { renders += 1; };
        event.sub('view.changed', count);
        try {
            event.pub('location.changed', folder);
            await respond(0, [deep]);
        } finally {
            event.unsub('view.changed', count);
        }
        assert.equal(renders, 1, 'the view lists the new folder, the field does not list it again');
        assert.deepEqual(labels(), ['alpha.txt', 'beta.md', 'sub']);
        assert.equal(isOpen(), false);
        assert.equal(isPending(), false);
        assert.equal(isDeeperShown(), false);
    });
});

// Loads another copy of the field with these settings: its elements are the
// last #search and #search-deeper, removed afterwards.
const withMode = async (settings, run) => {
    const loaded = fresh('ext/search', settings);
    const tool = Array.from(document.querySelectorAll('#search')).pop();
    const deeper = Array.from(document.querySelectorAll('#search-deeper')).pop();
    const input = tool.querySelector('input');
    const typeIn = value => typeInto(input, value);
    try {
        tool.querySelector('img').click();
        await withFolder(context => run({...context, input, deeper, typeIn}));
    } finally {
        loaded.cleanup();
        tool.remove();
        deeper.remove();
    }
};

test('search field: with the search disabled, it only filters and offers no subfolders', async () => {
    await withMode({search: {enabled: false}, filter: {enabled: true, advanced: true, debounceTime: 0}}, async ({input, deeper, typeIn, requests}) => {
        await typeIn('be');
        assert.deepEqual(labels(), ['beta.md']);
        assert.equal(deeper.classList.contains('hidden'), true);
        await keydown(input, 'Enter');
        assert.equal(requests.length, 0);
    });
});

test('search field: with the search disabled, nothing matching in the folder sends no request', async () => {
    await withMode({search: {enabled: false}, filter: {enabled: true, advanced: true, debounceTime: 0}}, async ({typeIn, requests}) => {
        await typeIn('zzz');
        assert.deepEqual(labels(), []);
        assert.equal(requests.length, 0);
    });
});

test('search field: with the filter disabled, typing searches the subfolders', async () => {
    await withMode({filter: {enabled: false}, search: {enabled: true, advanced: true, debounceTime: 0}}, async ({deep, deeper, typeIn, requests, respond}) => {
        await typeIn('alp');
        assert.equal(requests.length, 1, 'no Enter needed');
        assert.equal(deeper.classList.contains('hidden'), true);
        await respond(0, [deep]);
        assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
    });
});

test('search field: the icon opens and closes it from the keyboard, and says whether it is open', async () => {
    await withFolder(async () => {
        const icon = $('#search img');
        assert.equal(icon.getAttribute('tabindex'), '0');
        assert.equal(icon.getAttribute('role'), 'button');

        await keydown(icon, 'Enter');
        assert.equal(isOpen(), true);
        assert.equal(icon.getAttribute('aria-expanded'), 'true');

        await keydown(icon, ' ');
        assert.equal(isOpen(), false);
        assert.equal(icon.getAttribute('aria-expanded'), 'false');
        assert.ok($('#search input').getAttribute('aria-label'), 'the field has a name of its own');
    });
});

test('view: a hint replaces the previous one', () => {
    view.setHint('noMatch');
    view.setHint('empty');
    assert.deepEqual(Array.from($('#view-hint').classList).filter(cls => cls.startsWith('l10n-')), ['l10n-empty']);
});

test('view: items set after a search are listed as they are, and a refresh adds to them', async () => {
    await withFolder(async ({folder, alpha, deep, respond}) => {
        await toggle();
        await type('al');
        await press('Enter');
        await respond(0, [deep]);

        view.setItems([alpha]);
        const added = Item.get('/search-field/added.txt');
        folder.content[added.absHref] = added;
        event.pub('location.refreshed', folder, [added], [], []);
        assert.deepEqual(labels(), ['added.txt', 'alpha.txt']);
    });
});

test('view: removing an item that was never shown does not throw', () => {
    const hidden = Item.get('/search-field/never-shown/');
    delete hidden.$view;
    view.changeItems([], [hidden]);
});
