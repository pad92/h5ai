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
// The hint's key, whether it shows or not.
const hintKey = () => Array.from($('#view-hint').classList).filter(cls => cls.startsWith('l10n-')).map(cls => cls.slice(5)).join(' ');

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

test('search field: while the subfolders are searched, the view says so instead of "no match"', async () => {
    await withFolder(async ({deep, respond}) => {
        await toggle();
        await type('alpi');
        assert.equal(isPending(), true);
        assert.equal(hintKey(), 'searchPending');
        assert.equal($('#view-hint').textContent, 'searching…');

        await respond(0, [deep]);
        assert.equal(hintKey(), 'noMatch');

        await type('zz');
        assert.equal(hintKey(), 'searchPending');
        await type('zzq');
        assert.equal(isPending(), true, 'the next search started');
        await press('Escape');
        assert.equal(hintKey(), 'empty', 'closing lists the folder');
    });
});

test('search field: typing over a running search puts back the hint it replaced', async () => {
    await withFolder(async ({requests}) => {
        await toggle();
        await type('alpi');
        assert.equal(hintKey(), 'searchPending');
        const input = $('#search input');
        input.value = 'alpin';
        input.dispatchEvent(new window.Event('input', {bubbles: true}));
        assert.equal(isPending(), false);
        assert.equal(hintKey(), 'noMatch', 'the folder matches still show');
        await drain();
        assert.equal(requests.length, 2);
    });
});

test('search field: each subfolder match shows its folder and its name apart', async () => {
    await withFolder(async ({deep, respond}) => {
        await toggle();
        await type('alpi');
        await respond(0, [deep]);
        const $label = $('#items .item .label');
        assert.ok($label.classList.contains('with-path'));
        assert.equal($label.querySelector('.path').textContent, 'sub/deeper/');
        assert.equal($label.querySelector('.name').textContent, 'alpine.txt');
        assert.equal($label.getAttribute('title'), 'sub/deeper/alpine.txt');
        assert.ok($('#view').classList.contains('shows-paths'));

        await type('al');
        assert.equal($('#items .label.with-path'), null, 'folder matches have no path');
        assert.equal($('#view').classList.contains('shows-paths'), false);
    });
});

// The marked parts of the label of the match whose name is given.
const marksOf = name => {
    const item = Array.from(document.querySelectorAll('#items .item')).find(el => el._item.label === name);
    return Array.from(item.querySelectorAll('.label mark'), mark => mark.textContent);
};

test('search field: the browser neither spellchecks nor autocompletes the field', async () => {
    assert.equal($('#search input').getAttribute('spellcheck'), 'false');
    assert.equal($('#search input').getAttribute('autocomplete'), 'off');
});

test('search field: the matched letters of each name are marked', async () => {
    await withFolder(async ({deep, respond}) => {
        await toggle();
        await type('AL txt');
        assert.deepEqual(marksOf('alpha.txt'), ['al', 'txt'], 'each word, in any case');
        assert.equal($('#items .item .label').textContent, 'alpha.txt');

        await type('re:ph.');
        assert.deepEqual(marksOf('alpha.txt'), ['pha'], 'the first match of an expression');

        await type('apn');
        await respond(0, [deep]);
        assert.deepEqual(marksOf('alpine.txt'), ['a', 'p', 'n'], 'letters in order, each as early as it can');
        assert.equal($('#items .item .label .path').textContent, 'sub/deeper/', 'the folder is not marked');

        await press('Escape');
        assert.equal($('#items .label mark'), null, 'the folder listing marks nothing');
    });
});

test('search field: a subfolder search says how many matches it shows, and a cut one offers to search again', async () => {
    await withFolder(async ({deep, requests, respond}) => {
        const isShown = selector => !$(selector).classList.contains('hidden');
        await toggle();
        await type('alpi');
        assert.equal(isShown('#search-found'), false, 'not while it runs');
        await respond(0, [deep]);
        assert.equal(isShown('#search-found'), true);
        assert.equal($('#search-found').textContent, 'Matches in this folder and its subfolders: 1');
        assert.equal(isShown('#search-cut'), false);

        await press('Enter');
        requests[1].resolve({search: [], searchTruncated: true});
        await drain();
        assert.equal($('#search-found').textContent, 'Matches in this folder and its subfolders: 0');
        assert.equal(isShown('#search-cut'), true);
        $('#search-cut button').click();
        await drain();
        assert.equal(requests.length, 3, 'the button searches again');
        assert.equal(isShown('#search-cut'), false);

        await respond(2, [deep]);
        await type('al');
        assert.equal(isShown('#search-found'), false, 'the folder matches need no count');
    });
});

test('search field: matches show best first until a column header is clicked', async () => {
    await withFolder(async ({requests}) => {
        const names = ['IMG_0001 - copie (2).jpg', 'IMG_0002.jpg', 'x0002 long name.jpg', '0002.jpg'];
        const found = names.map(name => Item.get('/search-field/sub/' + encodeURIComponent(name)));
        const shown = () => Array.from(document.querySelectorAll('#items .item:not(.folder-parent) .name'), el => el.textContent);
        const $nameHeader = () => $('#items li.header a.label');
        const answer = async index => {
            requests[index].resolve({search: found.map(item => item.absHref)});
            await drain();
        };
        await toggle();
        await type('0002');
        await answer(0);
        assert.deepEqual(shown(), ['0002.jpg', 'x0002 long name.jpg', 'IMG_0002.jpg', 'IMG_0001 - copie (2).jpg'],
            'in one piece before in two, earlier first, then the shorter name');
        assert.equal($nameHeader().classList.contains('ascending'), false, 'no column arrow');

        $nameHeader().click();
        await drain();
        assert.deepEqual(shown(), ['0002.jpg', 'IMG_0001 - copie (2).jpg', 'IMG_0002.jpg', 'x0002 long name.jpg']);
        assert.equal($nameHeader().classList.contains('ascending'), true);

        await press('Enter');
        await answer(1);
        assert.equal(shown()[0], '0002.jpg');
        assert.equal(shown()[1], 'x0002 long name.jpg', 'a new search shows best first again');

        await press('Escape');
        assert.equal($nameHeader().classList.contains('ascending'), true, 'the folder is sorted by its column');
    });
});

test('search field: after a subfolder search found nothing, longer text does not search again', async () => {
    await withFolder(async ({requests, respond}) => {
        await toggle();
        await type('zz');
        assert.equal(requests.length, 1);
        await respond(0, []);

        await type('zzy');
        await type('zzy q');
        assert.equal(requests.length, 1, 'longer text can only match fewer names');
        assert.deepEqual(labels(), []);
        assert.equal(isDeeperShown(), true, 'the line still searches on demand');

        await press('Enter');
        assert.equal(requests.length, 2, 'Enter still searches');
        await respond(1, []);

        await type('z');
        assert.equal(requests.length, 3, 'shorter text may match more');
    });
});

test('search field: a regular expression is searched at each pause, even after an empty answer', async () => {
    await withFolder(async ({requests, respond}) => {
        await toggle();
        await type('re:zz');
        await respond(0, []);
        await type('re:zz|alpine');
        assert.equal(requests.length, 2);
    });
});

test('search field: an empty answer in another folder does not stop the searches here', async () => {
    await withFolder(async ({requests, respond}) => {
        await toggle();
        await type('zz');
        await respond(0, []);
        event.pub('location.changed', location.getItem());
        await drain();
        await toggle();
        await type('zzy');
        assert.equal(requests.length, 2);
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

// The answer arrives between the typing and the pause that follows it.
test('search field: typing drops the answer to the text it replaced', async () => {
    await withFolder(async ({deep, requests}) => {
        await toggle();
        await type('al');
        await press('Enter');
        const input = $('#search input');
        input.value = 'be';
        input.dispatchEvent(new window.Event('input', {bubbles: true}));
        requests[0].resolve({search: [deep.absHref]});
        await Promise.resolve();
        await Promise.resolve();

        assert.ok(!labels().includes('sub/deeper/alpine.txt'), 'no answer for al under be');
        assert.equal(isPending(), false);
        await drain();
        assert.deepEqual(labels(), ['beta.md']);
    });
});

test('search field: an empty answer cut short by the server does not stop later searches', async () => {
    await withFolder(async ({requests}) => {
        await toggle();
        await type('zq');
        assert.equal(requests.length, 1);
        requests[0].resolve({search: [], searchTruncated: true});
        await drain();

        await type('zqx');
        assert.equal(requests.length, 2, 'longer text searches again');
    });
});

test('search field: a search the server cut short says matches may be missing', async () => {
    await withFolder(async ({deep, requests, respond}) => {
        const isCutShown = () => !$('#search-cut').classList.contains('hidden');
        const status = () => $('#search .status').textContent;
        await toggle();
        await type('alpi');
        assert.equal(isCutShown(), false, 'not while the search runs');
        requests[0].resolve({search: [deep.absHref], searchTruncated: true});
        await drain();
        assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
        assert.equal(isCutShown(), true);
        assert.ok($('#search-cut .l10n-searchCut'));
        assert.equal(status(), 'Matches: 1. The search stopped early: some matches may be missing.');

        await press('Enter');
        assert.equal(isCutShown(), false, 'a new search hides it');
        requests[1].resolve({search: [], searchTruncated: true});
        await drain();
        assert.equal(isCutShown(), true, 'also when nothing was found');
        assert.equal(status(), 'no match. The search stopped early: some matches may be missing.');

        await press('Enter');
        await respond(2, [deep]);
        assert.equal(isCutShown(), false, 'a complete answer');
        assert.equal(status(), 'Matches: 1');

        requests.length = 0;
        await press('Enter');
        requests[0].resolve({search: [deep.absHref], searchTruncated: true});
        await drain();
        await type('al');
        assert.equal(isCutShown(), false, 'the folder matches are complete');
        await press('Escape');
        assert.equal(isCutShown(), false);
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

// view.isListed() reads view.hideFolders, set once when the view loads: the
// test replaces it with the check that setting makes.
test('search field: with hideFolders, neither the filter nor the subfolder results show folders', async () => {
    await withFolder(async ({sub, deep, requests, respond}) => {
        const isListed = view.isListed;
        view.isListed = item => !item.isFolder();
        try {
            await toggle();
            await type('su');
            assert.deepEqual(labels(), [], 'the sub folder is not listed');
            assert.equal(requests.length, 1, 'nothing listed here: the subfolders are searched');

            await respond(0, [sub, Item.get('/search-field/sub/deeper/'), deep]);
            assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
        } finally {
            view.isListed = isListed;
        }
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

test('view: matches leave out what the view does not list, and the shown ones are returned', async () => {
    await withFolder(async ({alpha, sub}) => {
        const isListed = view.isListed;
        view.isListed = item => !item.isFolder();
        try {
            const shown = view.setMatches([alpha, sub], () => false);
            assert.deepEqual(shown, [alpha]);
            assert.deepEqual(labels(), ['alpha.txt']);
        } finally {
            view.isListed = isListed;
        }
    });
});

const isInvalid = () => $('#search').classList.contains('invalid') && $('#search input').getAttribute('aria-invalid') === 'true';

test('search field: an expression that cannot be read is marked and never searched', async () => {
    await withFolder(async ({requests}) => {
        await toggle();
        await type('re:(');
        assert.equal(isInvalid(), true);
        await press('Enter');
        assert.equal(requests.length, 0);

        await type('re:a');
        assert.equal(isInvalid(), false);
        assert.equal($('#search input').getAttribute('aria-invalid'), 'false');
    });
});

test('search field: while the expression cannot be read, the previous matches are dimmed and not announced', async () => {
    await withFolder(async () => {
        const isStale = () => $('#items').classList.contains('search-stale');
        const status = () => $('#search .status').textContent;
        await toggle();
        await type('al');
        assert.equal(status(), 'Matches: 1');
        assert.equal(isStale(), false);

        await type('re:(');
        assert.deepEqual(labels(), ['alpha.txt'], 'the view stays as it was');
        assert.equal(isStale(), true);
        assert.equal(status(), '', 'the count was for al');
        assert.equal(isDeeperShown(), false, 'nothing to search for');

        await type('re:^b');
        assert.equal(isStale(), false);
        assert.equal(isDeeperShown(), true);
        assert.deepEqual(labels(), ['beta.md']);
        assert.equal(status(), 'Matches: 1');

        await type('re:(');
        await press('Escape');
        assert.equal(isStale(), false, 'closing lists the folder plainly');
    });
});

test('search field: screen readers hear how many matches show', async () => {
    await withFolder(async ({respond}) => {
        const status = () => $('#search .status').textContent;
        assert.equal($('#search .status').getAttribute('role'), 'status');
        await toggle();
        await type('a');
        assert.equal(status(), 'Matches: 2', 'alpha.txt and beta.md');
        await type('zq');
        await respond(0, []);
        assert.equal(status(), 'no match');
        await press('Escape');
        assert.equal(status(), '');
    });
});

// The browser moves between history entries before the page hears of it:
// on Back, history.state is already the entry the folder left.
test('search field: Back to a folder left during a search brings its text back', async () => {
    await withFolder(async ({folder, sub}) => {
        const history = window.history;
        const savedState = history.state;
        sub.content = sub.content || {};
        history.replaceState({absHref: folder.absHref}, '');
        try {
            await toggle();
            await type('al');
            event.pub('location.beforeChange');
            assert.deepEqual(history.state, {absHref: folder.absHref, search: 'al'}, 'the entry keeps the text');
            event.pub('location.changed', sub);
            await drain();
            assert.equal(isOpen(), false);

            const getAbsHref = location.getAbsHref;
            location.getAbsHref = () => sub.absHref;
            event.pub('location.beforeChange');
            location.getAbsHref = getAbsHref;
            // location rewrites the entry it arrives on, as setLocation()
            // does on Back.
            history.replaceState({absHref: folder.absHref}, '');
            event.pub('location.changed', folder);
            await drain();

            assert.equal(isOpen(), true);
            assert.equal($('#search input').value, 'al');
            assert.deepEqual(labels(), ['alpha.txt']);
            assert.deepEqual(history.state, {absHref: folder.absHref, search: 'al'}, 'kept for the next Back');
        } finally {
            history.replaceState(savedState, '');
        }
    });
});

test('search field: Back to subfolder matches searches the subfolders again, without taking the focus', async () => {
    await withFolder(async ({folder, sub, deep, requests, respond}) => {
        const history = window.history;
        const savedState = history.state;
        sub.content = sub.content || {};
        history.replaceState({absHref: folder.absHref}, '');
        try {
            await toggle();
            await type('al');
            await press('Enter');
            await respond(0, [deep]);
            event.pub('location.beforeChange');
            assert.deepEqual(history.state, {absHref: folder.absHref, search: 'al', searchDeep: true});
            event.pub('location.changed', sub);
            await drain();
            $('#search img').focus();

            const getAbsHref = location.getAbsHref;
            location.getAbsHref = () => sub.absHref;
            event.pub('location.beforeChange');
            location.getAbsHref = getAbsHref;
            history.replaceState({absHref: folder.absHref}, '');
            event.pub('location.changed', folder);
            await drain();

            assert.equal(isOpen(), true);
            assert.equal($('#search input').value, 'al');
            assert.notEqual(document.activeElement, $('#search input'), 'the focus stays where it was');
            assert.equal(requests.length, 2, 'the subfolders are searched again');
            assert.equal(requests[1].data.search.pattern, requests[0].data.search.pattern);
            await respond(1, [deep]);
            assert.deepEqual(labels(), ['sub/deeper/alpine.txt']);
            assert.deepEqual(history.state, {absHref: folder.absHref, search: 'al', searchDeep: true}, 'kept for the next Back');
        } finally {
            history.replaceState(savedState, '');
        }
    });
});

test('search field: leaving a folder with an empty field keeps no text in its history entry', async () => {
    await withFolder(async ({folder}) => {
        const history = window.history;
        const savedState = history.state;
        history.replaceState({absHref: folder.absHref, search: 'old'}, '');
        try {
            event.pub('location.beforeChange');
            assert.deepEqual(history.state, {absHref: folder.absHref});
        } finally {
            history.replaceState(savedState, '');
        }
    });
});
