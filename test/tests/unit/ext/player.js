const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {flush, drain} = require('../../../util/fresh');

// Drives the audio player mounted by the item tests (with their FakeAudio).
// The player is a singleton, so every test starts from a cleared, plain state.
const Item = reqlib('model/item');
const view = reqlib('view/view');
const event = reqlib('core/event');
const preview = reqlib('ext/preview/preview');

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const audio = () => window.__audioPlayer;
const trackName = () => $('#ap-track-name-el').textContent;
const queueNames = () => $$('#aq-list-el .aq-item-name').map(el => el.textContent);
const barIsActive = () => $('#audio-player-bar').classList.contains('active');
const settle = async () => {
    await flush();
    await flush();
};

// ID3 tags, built just far enough for the cover parser.
const JPEG = [0xFF, 0xD8, ...new Array(12).fill(1)];
const PNG = [0x89, 0x50, ...new Array(12).fill(1)];
const bytes = text => [...text].map(c => c.charCodeAt(0));
// Big-endian digits of `value` in `base`: 256 for plain sizes, 128 for syncsafe ones.
const digits = (value, count, base) => Array.from({length: count}, (unused, idx) => {
    return Math.floor(value / base ** (count - 1 - idx)) % base;
});
const syncsafe = size => digits(size, 4, 128);
const frame = (version, id, data) => {
    if (version === 2) {
        return [...bytes(id), ...digits(data.length, 3, 256), ...data];
    }
    const size = version === 3 ? digits(data.length, 4, 256) : syncsafe(data.length);
    return [...bytes(id), ...size, 0, 0, ...data];
};
const id3 = (version, ...frames) => {
    const body = [].concat(...frames, new Array(10).fill(0));
    return Uint8Array.from([...bytes('ID3'), version, 0, 0, ...syncsafe(body.length), ...body]).buffer;
};
const apic = ({mime = 'image/jpeg', encoding = 0, desc = [0], picture = JPEG} = {}) =>
    [encoding, ...bytes(mime), 0, 3, ...desc, ...picture];

const reset = () => {
    delete audio().play;
    $('#ap-close-btn').click();
    if ($('#ap-shuffle').classList.contains('active')) {
        $('#ap-shuffle').click();
    }
    while ($('#ap-repeat').getAttribute('title') !== 'Repeat (Off)') {
        $('#ap-repeat').click();
    }
    if (audio().muted) {
        $('#ap-volume-btn').click();
    }
    audio().currentTime = 0;
};

// Answers each track's cover request from `covers` (a buffer, a status, or a
// function returning a promise of either), and loads every image
// except the ones listed as broken.
const withPlayer = async (covers, broken, run) => {
    const saved = {
        fetch: window.fetch,
        Image: window.Image,
        createObjectURL: Object.getOwnPropertyDescriptor(window.URL, 'createObjectURL'),
        revokeObjectURL: Object.getOwnPropertyDescriptor(window.URL, 'revokeObjectURL'),
        random: Math.random,
        warn: console.warn,
        error: console.error
    };
    const blobs = [];
    const revoked = [];
    const logged = [];
    window.fetch = async href => {
        const cover = typeof covers[href] === 'function' ? await covers[href]() : covers[href];
        if (cover && cover.status) {
            return {ok: false, status: cover.status};
        }
        return {ok: true, status: 206, arrayBuffer: async () => cover || new Uint8Array(10).buffer};
    };
    window.Image = class {
        set src(value) {
            window.setTimeout(() => broken.includes(value) ? this.onerror() : this.onload(), 0);
        }
    };
    Object.defineProperty(window.URL, 'createObjectURL', {configurable: true, value: blob => {
        blobs.push(blob.type);
        return `blob:${blobs.length}`;
    }});
    Object.defineProperty(window.URL, 'revokeObjectURL', {configurable: true, value: url => revoked.push(url)});
    console.warn = (...args) => logged.push(['warn', ...args]);
    console.error = (...args) => logged.push(['error', ...args]);

    reset();
    try {
        await run({blobs, revoked, logged});
    } finally {
        reset();
        window.fetch = saved.fetch;
        window.Image = saved.Image;
        ['createObjectURL', 'revokeObjectURL'].forEach(name => {
            if (saved[name]) {
                Object.defineProperty(window.URL, name, saved[name]);
            } else {
                delete window.URL[name];
            }
        });
        Math.random = saved.random;
        console.warn = saved.warn;
        console.error = saved.error;
    }
};

const tracks = (folder, ...names) => names.map(name => {
    const item = Item.get(`/${folder}/${name}`);
    item.type = name.endsWith('.mp3') ? 'aud' : 'img';
    return item;
});
// The listing keeps the sort order other tests chose, so tests read it back.
const list = (...items) => {
    view.setItems(items);
    return $$('#items .item').map(el => el._item);
};
const labels = items => items.map(item => item.label);
const press = (item, action) => item.$view.find(`.ap-row-${action}`)[0].click();

// The W3C check of the rendered pages (test:docker) rejects an aria-label
// on a div without a role; the player's markup is mounted at load.
test('player markup: no aria-label on a div without a role', () => {
    const offending = $$('div[aria-label]').filter(el => !el.getAttribute('role')).map(el => el.id || el.className);
    assert.deepEqual(offending, []);
});

test('audio covers: ID3 v2.2 PIC and v2.4 APIC pictures become object URLs', async () => {
    const [v22, v24, mime] = tracks('aud-id3', 'v22.mp3', 'v24.mp3', 'mime.mp3');
    const covers = {
        [v22.absHref]: id3(2, frame(2, 'PIC', [0, ...bytes('PNG'), 3, 0, ...PNG])),
        [v24.absHref]: id3(4, frame(4, 'TIT2', [0, 65, 66]), frame(4, 'APIC', apic({
            mime: 'image/png', encoding: 1, desc: [65, 0, 0, 0], picture: PNG
        }))),
        [mime.absHref]: id3(3, frame(3, 'APIC', apic({mime: ''})))
    };
    await withPlayer(covers, [], async ({blobs, revoked}) => {
        list(v22, v24, mime);
        for (const item of [v22, v24, mime]) {
            press(item, 'folder');
            await settle();
        }
        assert.deepEqual(blobs, ['image/png', 'image/png', 'image/jpeg']);
        assert.equal($('#ap-cover-img').getAttribute('src'), 'blob:3');
        assert.deepEqual(revoked, ['blob:1', 'blob:2'], 'replacing the queue releases its covers');
    });
});

test('audio covers: unreadable tags fall back to the folder image', async () => {
    const items = tracks('aud-bad', 'old.mp3', 'notpic.mp3', 'empty.mp3', 'missing.mp3', 'utf8.mp3', 'zz.png', 'Folder.jpg');
    const [old, notpic, empty, missing, utf8] = items;
    const covers = {
        [old.absHref]: id3(5, frame(3, 'APIC', apic())),
        [notpic.absHref]: id3(3, frame(3, 'APIC', apic({picture: new Array(14).fill(7)}))),
        [empty.absHref]: id3(3, [...bytes('APIC'), 0, 0, 0, 0, 0, 0, ...new Array(20).fill(0)]),
        [missing.absHref]: {status: 404},
        [utf8.absHref]: id3(3, frame(3, 'APIC', apic({encoding: 3, desc: [65, 66], picture: []})))
    };
    await withPlayer(covers, [], async ({blobs}) => {
        list(...items);
        for (const item of [old, notpic, empty, missing, utf8]) {
            press(item, 'folder');
            await settle();
            assert.equal($('#ap-cover-img').getAttribute('src'), '/aud-bad/Folder.jpg', `${item.label}: a folder image is preferred`);
        }
        assert.deepEqual(blobs, []);
    });
});

test('audio covers: a server thumbnail wins and spares the tag read', async () => {
    const [thumbed, ogg] = tracks('aud-thumb', 'thumbed.mp3', 'song.ogg');
    ogg.type = 'aud';
    thumbed.thumbRational = '/thumbed.webp';
    const fetched = [];
    const covers = {[thumbed.absHref]: id3(3, frame(3, 'APIC', apic()))};
    await withPlayer(covers, [], async ({blobs}) => {
        const fetch = window.fetch;
        window.fetch = (href, options) => {
            fetched.push(href);
            return fetch(href, options);
        };
        list(thumbed, ogg);
        press(thumbed, 'folder');
        await settle();
        assert.equal($('#ap-cover-img').getAttribute('src'), '/thumbed.webp');
        press(ogg, 'folder');
        await settle();
        assert.deepEqual(fetched, [], 'neither a thumbnailed track nor an untagged format is read');
        assert.deepEqual(blobs, []);
    });
});

test('audio covers: a broken cover falls back to the folder image, then to a gradient', async () => {
    const [tagged, lone, folderImage] = tracks('aud-cover', 'tagged.mp3', 'lone.mp3', 'Cover.png');
    const [orphan, photo] = tracks('aud-orphan', 'orphan.mp3', 'holiday.jpg');
    const covers = {[tagged.absHref]: id3(3, frame(3, 'APIC', apic()))};
    await withPlayer(covers, ['blob:1', '/aud-cover/Cover.png'], async ({blobs, revoked}) => {
        list(tagged, lone, folderImage, orphan, photo);
        press(tagged, 'folder');
        await settle();
        assert.ok($('#ap-cover-img').classList.contains('hidden'), 'the folder image is broken too');
        assert.ok($('#ap-cover-gradient').style.background.includes('linear-gradient'));
        assert.deepEqual(revoked, ['blob:1'], 'a broken picture is released');

        press(orphan, 'folder');
        await settle();
        assert.ok($('#ap-cover-img').classList.contains('hidden'), 'a random photo is not an album cover');

        press(tagged, 'folder');
        await settle();
        assert.equal(blobs.length, 1, 'a broken picture is not looked up again');
    });
});

test('audio covers: the blob type comes from the picture bytes, not from the tag', async () => {
    const [html, unknown] = tracks('aud-mime', 'html.mp3', 'unknown.mp3');
    const covers = {
        [html.absHref]: id3(3, frame(3, 'APIC', apic({mime: 'text/html'}))),
        [unknown.absHref]: id3(3, frame(3, 'APIC', apic({mime: 'image/png', picture: bytes('<script>x</script>')})))
    };
    await withPlayer(covers, [], async ({blobs}) => {
        list(html, unknown);
        press(html, 'folder');
        await settle();
        press(unknown, 'folder');
        await settle();
        assert.deepEqual(blobs, ['image/jpeg']);
    });
});

test('audio covers: a server ignoring Range is not downloaded in full', async () => {
    const [a] = tracks('aud-norange', 'a.mp3');
    const calls = {cancel: 0, arrayBuffer: 0};
    await withPlayer({}, [], async ({blobs}) => {
        window.fetch = async () => ({
            ok: true,
            status: 200,
            body: {cancel: () => {
                calls.cancel += 1;
                return Promise.resolve();
            }},
            arrayBuffer: async () => {
                calls.arrayBuffer += 1;
                return id3(3, frame(3, 'APIC', apic()));
            }
        });
        list(a);
        press(a, 'folder');
        await settle();
        assert.deepEqual(calls, {cancel: 1, arrayBuffer: 0});
        assert.deepEqual(blobs, []);
    });
});

test('audio covers: a late cover stays with its own track', async () => {
    let release;
    const covers = {};
    await withPlayer(covers, [], async ({blobs}) => {
        const [x, y] = list(...tracks('aud-late', 'a.mp3', 'b.mp3'));
        covers[x.absHref] = () => new Promise(resolve => {
            release = () => resolve(id3(3, frame(3, 'APIC', apic())));
        });
        covers[y.absHref] = id3(3, frame(3, 'APIC', apic({picture: PNG})));
        press(x, 'folder');
        await settle();
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), y.label);
        assert.equal($('#ap-cover-img').getAttribute('src'), 'blob:1');

        release();
        await settle();
        assert.deepEqual(blobs, ['image/png', 'image/jpeg'], 'the late picture is still read');
        assert.equal($('#ap-cover-img').getAttribute('src'), 'blob:1', 'the next track keeps its cover');
    });
});

test('audio queue: rows play, queue and play next without duplicates', async () => {
    const [a, b, c, outside] = tracks('aud-queue', 'a.mp3', 'b.mp3', 'c.mp3', 'outside.mp3');
    await withPlayer({}, [], async () => {
        list(a, b, c, outside);
        const listed = list(a, b, c);

        press(a, 'queue');
        await settle();
        assert.equal(trackName(), 'a.mp3', 'queueing into an idle player starts it');
        press(b, 'queue');
        press(b, 'queue');
        await settle();
        assert.equal(trackName(), 'a.mp3');
        press(c, 'next');
        $('#ap-queue-btn').click();
        assert.deepEqual(queueNames(), ['a.mp3', 'c.mp3', 'b.mp3']);

        $('#ap-next').click();
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), 'b.mp3');
        press(a, 'next');
        assert.deepEqual(queueNames(), ['c.mp3', 'b.mp3', 'a.mp3'], 'a moves after the current track');

        press(outside, 'folder');
        await settle();
        assert.deepEqual(queueNames(), ['outside.mp3'], 'a track outside the listing plays alone');

        press(a, 'folder');
        await settle();
        assert.deepEqual(queueNames(), labels(listed), 'the folder button queues the listed tracks');
        assert.equal(trackName(), 'a.mp3', 'from the one pressed');

        // Play now and a plain click play the track alone, in place of the queue.
        press(b, 'play');
        await settle();
        assert.deepEqual(queueNames(), ['b.mp3'], 'play now replaces the queue with the track');
        assert.equal(trackName(), 'b.mp3');
        assert.equal(audio().paused, false);
        press(a, 'folder');
        await settle();
        c.$view.find('a')[0].click();
        await settle();
        assert.deepEqual(queueNames(), ['c.mp3'], 'a click on the file plays it alone too');
        press(a, 'next');
        assert.deepEqual(queueNames(), ['c.mp3', 'a.mp3'], 'play next builds the queue around it');

        $('#aq-clear').click();
        press(c, 'next');
        await settle();
        assert.equal(trackName(), 'c.mp3', 'play next into an empty queue starts it');
        $('#aq-close').click();
        assert.equal($('#audio-queue-panel').classList.contains('active'), false);
    });
});

test('audio queue: the drawer jumps to and removes tracks', async () => {
    const covers = {};
    await withPlayer(covers, [], async ({revoked}) => {
        const [x, y, z] = list(...tracks('aud-drawer', 'a.mp3', 'b.mp3', 'c.mp3'));
        covers[x.absHref] = id3(3, frame(3, 'APIC', apic()));
        press(x, 'folder');
        await settle();
        $('#ap-queue-btn').click();

        $$('#aq-list-el .aq-item')[2].click();
        await settle();
        assert.equal(trackName(), z.label);

        $$('#aq-list-el .aq-item-remove')[0].click();
        assert.deepEqual(queueNames(), labels([y, z]));
        assert.deepEqual(revoked, ['blob:1'], 'the removed track releases its cover');
        assert.equal(trackName(), z.label, 'removing another track keeps playing');

        $$('#aq-list-el .aq-item-remove')[1].click();
        await settle();
        assert.equal(trackName(), y.label, 'removing the last current track wraps to the first');

        $$('#aq-list-el .aq-item-remove')[0].click();
        assert.deepEqual(queueNames(), []);
        assert.equal(barIsActive(), false);
    });
});

const handleOf = idx => $$('#aq-list-el .aq-item-handle')[idx];
const key = (el, name) => el.dispatchEvent(new window.KeyboardEvent('keydown', {key: name, bubbles: true, cancelable: true}));
const pointer = (target, type, clientY) => target.dispatchEvent(new window.PointerEvent(type, {bubbles: true, cancelable: true, button: 0, clientY}));
// jsdom has no layout: each row is 40px high, at its place in the list.
const layOutRows = () => {
    const rows = $('#aq-list-el');
    [...rows.children].forEach(row => {
        row.getBoundingClientRect = () => {
            const top = [...rows.children].indexOf(row) * 40;
            return {top, bottom: top + 40, height: 40};
        };
    });
    rows.parentNode.getBoundingClientRect = () => ({top: 0, bottom: 400, height: 400});
};
const savedQueue = () => reqlib('core/store').get('ext/player').queue;

test('audio queue: the drawer is a card with the track count, closed by Escape', async () => {
    await withPlayer({}, [], async () => {
        const [x] = list(...tracks('aud-card', 'a.mp3', 'b.mp3', 'c.mp3'));
        press(x, 'folder');
        await settle();
        assert.equal($('#aq-count').textContent, '3', 'counted while closed too');
        $('#ap-queue-btn').click();
        assert.equal($('#audio-queue-panel').getAttribute('role'), 'dialog');
        assert.equal($('#aq-list-el .aq-item.active').getAttribute('aria-current'), 'true');

        let reached = false;
        const spy = () => { reached = true; };
        window.addEventListener('keydown', spy);
        key(handleOf(1), 'Escape');
        window.removeEventListener('keydown', spy);
        assert.equal($('#audio-queue-panel').classList.contains('active'), false);
        assert.equal(document.activeElement, $('#ap-queue-btn'), 'the focus goes back to the queue button');
        assert.equal(reached, false, 'Escape stops at the drawer: an open preview keeps its own');
    });
});

test('audio queue: the keyboard moves and removes rows, and the queue is saved', async () => {
    await withPlayer({}, [], async () => {
        const [x, y, z] = list(...tracks('aud-keys', 'a.mp3', 'b.mp3', 'c.mp3'));
        press(x, 'folder');
        await settle();
        $('#ap-queue-btn').click();

        let reached = 0;
        const spy = () => { reached += 1; };
        window.addEventListener('keydown', spy);
        try {
            handleOf(0).focus();
            key(handleOf(0), 'ArrowDown');
            assert.deepEqual(queueNames(), labels([y, x, z]));
            assert.equal(document.activeElement, handleOf(1), 'the focus follows the moved row');
            assert.deepEqual(savedQueue(), [y.absHref, x.absHref, z.absHref], 'saved');

            key(handleOf(1), 'End');
            assert.deepEqual(queueNames(), labels([y, z, x]));
            key(handleOf(2), 'ArrowDown');
            assert.deepEqual(queueNames(), labels([y, z, x]), 'the last row stays last');
            key(handleOf(2), 'Home');
            assert.deepEqual(queueNames(), labels([x, y, z]));
            key(handleOf(0), 'ArrowUp');
            assert.deepEqual(queueNames(), labels([x, y, z]), 'the first row stays first');
            assert.equal(reached, 0, 'the keys stop at the handle: an open preview does not move');

            key(handleOf(1), 'Delete');
            assert.deepEqual(queueNames(), labels([x, z]));
            assert.equal(document.activeElement, handleOf(1), 'the focus goes to the row taking its place');
            assert.equal(trackName(), x.label, 'the current track keeps playing');
        } finally {
            window.removeEventListener('keydown', spy);
        }
    });
});

test('audio queue: rows are dragged by their handle; a cancelled drag puts the row back', async () => {
    await withPlayer({}, [], async () => {
        const [x, y, z] = list(...tracks('aud-drag', 'a.mp3', 'b.mp3', 'c.mp3'));
        press(x, 'folder');
        await settle();
        $('#ap-queue-btn').click();

        layOutRows();
        pointer(handleOf(0), 'pointerdown', 20);
        assert.equal($('#aq-list-el .aq-item').classList.contains('aq-dragging'), true);
        pointer(document, 'pointermove', 61);
        assert.deepEqual(queueNames(), labels([y, x, z]), 'past the middle of the next row');
        pointer(document, 'pointermove', 115);
        assert.deepEqual(queueNames(), labels([y, z, x]));
        assert.deepEqual(savedQueue(), [x.absHref, y.absHref, z.absHref], 'nothing changes before the release');
        pointer(document, 'pointerup', 115);
        assert.deepEqual(queueNames(), labels([y, z, x]));
        assert.deepEqual(savedQueue(), [y.absHref, z.absHref, x.absHref]);
        assert.equal($$('#aq-list-el .aq-dragging').length, 0);

        layOutRows();
        pointer(handleOf(2), 'pointerdown', 100);
        pointer(document, 'pointermove', 5);
        assert.deepEqual(queueNames(), labels([x, y, z]));
        pointer(document, 'pointercancel', 5);
        assert.deepEqual(queueNames(), labels([y, z, x]), 'cancelled: back in its place');
        assert.deepEqual(savedQueue(), [y.absHref, z.absHref, x.absHref]);

        pointer(document, 'pointermove', 5);
        assert.deepEqual(queueNames(), labels([y, z, x]), 'the drag is over: the pointer moves nothing');
        handleOf(0).click();
        assert.equal(trackName(), x.label, 'a click on a handle does not jump to its track');
    });
});

test('audio queue: while shuffled, the drawer lists and reorders the play order', async () => {
    await withPlayer({}, [], async () => {
        const [x, y, z, w] = list(...tracks('aud-shuffled', 'a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'));
        press(x, 'folder');
        await settle();
        $('#ap-queue-btn').click();

        // Math.random() 0 deals the others as z, w, y after the current track.
        Math.random = () => 0;
        $('#ap-shuffle').click();
        assert.deepEqual(queueNames(), labels([x, z, w, y]), 'the order they will play in');

        key(handleOf(3), 'Home');
        key(handleOf(0), 'ArrowDown');
        assert.deepEqual(queueNames(), labels([x, y, z, w]));
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), y.label, 'next follows the reordered play order');

        $('#ap-shuffle').click();
        assert.deepEqual(queueNames(), labels([x, y, z, w]), 'shuffle off: the queue order');
    });
});

test('audio transport: prev, next and shuffle move through the queue', async () => {
    await withPlayer({}, [], async () => {
        const [x, y, z] = list(...tracks('aud-transport', 'a.mp3', 'b.mp3', 'c.mp3'));
        $('#ap-next').click();
        $('#ap-prev').click();
        assert.equal(barIsActive(), false, 'nothing to move through');

        $('#ap-play-pause').click();
        await settle();
        assert.equal(trackName(), x.label, 'play starts the listed tracks');

        $('#ap-prev').click();
        await settle();
        assert.equal(trackName(), z.label, 'prev wraps around');

        // Shuffle deals the others after the current track: z, then y, x.
        Math.random = () => 0;
        $('#ap-shuffle').click();
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), y.label);
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), x.label, 'each track comes once');
        $('#ap-prev').click();
        await settle();
        assert.equal(trackName(), y.label, 'previous goes back through the shuffled order');
        $('#ap-next').click();
        await settle();
        audio().emit('ended');
        await settle();
        assert.equal(trackName(), x.label, 'the shuffled order ends like the queue');
        assert.equal($('#ap-play-pause').classList.contains('playing'), false);

        $('#ap-next').click();
        await settle();
        assert.notEqual(trackName(), x.label, 'next deals a new round, never starting with the last track');
    });
});

test('audio transport: blocked playback leaves the player paused', async () => {
    const [a] = tracks('aud-blocked', 'a.mp3');
    await withPlayer({}, [], async ({logged}) => {
        list(a);
        audio().play = () => Promise.reject(new Error('NotAllowedError'));
        press(a, 'folder');
        await settle();
        assert.equal($('#ap-play-pause').classList.contains('playing'), false);
        assert.ok(a.$view.hasCls('ap-active-paused'));

        $('#ap-play-pause').click();
        await settle();
        assert.deepEqual(logged.map(([level]) => level), ['warn', 'error']);
    });
});

test('audio transport: the end of a track follows the repeat and shuffle modes', async () => {
    await withPlayer({}, [], async ({logged}) => {
        const [x, y] = list(...tracks('aud-ended', 'a.mp3', 'b.mp3'));
        press(x, 'folder');
        await settle();

        audio().emit('ended');
        await settle();
        assert.equal(trackName(), y.label, 'the queue moves on');
        audio().emit('ended');
        assert.equal($('#ap-play-pause').classList.contains('playing'), false, 'the queue stops at its end');

        $('#ap-repeat').click();
        assert.equal($('#ap-repeat').getAttribute('title'), 'Repeat (Queue)');
        audio().emit('ended');
        await settle();
        assert.equal(trackName(), x.label, 'repeat queue wraps around');

        $('#ap-repeat').click();
        assert.equal($('#ap-repeat').getAttribute('title'), 'Repeat (Song)');
        audio().currentTime = 99;
        audio().emit('ended');
        assert.equal(audio().currentTime, 0);
        assert.equal(trackName(), x.label, 'repeat song replays');
        audio().play = () => Promise.reject(new Error('gone'));
        audio().emit('ended');
        await settle();
        assert.deepEqual(logged.map(([level]) => level), ['error']);
        delete audio().play;

        $('#ap-repeat').click();
        assert.equal($('#ap-repeat').getAttribute('title'), 'Repeat (Off)');
        $('#ap-shuffle').click();
        Math.random = () => 0.9;
        audio().emit('ended');
        await settle();
        assert.equal(trackName(), y.label, 'shuffle picks another track');
    });
});

test('audio controls: mute restores the previous volume and odd durations read 0:00', async () => {
    const [a] = tracks('aud-volume', 'a.mp3');
    await withPlayer({}, [], async () => {
        list(a);
        press(a, 'folder');
        await settle();
        audio().volume = 0.4;
        $('#ap-volume-btn').click();
        assert.ok($('#ap-volume-btn').classList.contains('muted'));
        assert.equal($('#ap-volume').value, '0');
        $('#ap-volume-btn').click();
        assert.equal($('#ap-volume-btn').classList.contains('muted'), false);
        assert.equal(audio().volume, 0.4);
        assert.equal($('#ap-volume').value, '40');

        const duration = audio().duration;
        audio().duration = Infinity;
        audio().emit('durationchange');
        assert.equal($('#ap-time-dur').textContent, '0:00');
        audio().duration = duration;
    });
});

test('audio rows: a re-rendered row keeps a single set of actions', async () => {
    const [a] = tracks('aud-rerender', 'a.mp3');
    await withPlayer({}, [], async () => {
        list(a);
        event.pub('item.changed', a);
        assert.equal(a.$view.find('.ap-item-actions').length, 1);
        a.$view.find('a')[0].click();
        await settle();
        assert.equal(trackName(), 'a.mp3');
        assert.equal(barIsActive(), true);
    });
});

test('audio rows: the action buttons sit beside the link, never inside it', async () => {
    const [a] = tracks('aud-markup', 'a.mp3');
    await withPlayer({}, [], async () => {
        list(a);
        const link = a.$view.find('a')[0];
        assert.equal(link.querySelector('button'), null, 'HTML forbids a button inside an <a>');
        assert.equal(a.$view[0].querySelectorAll(':scope > .ap-item-actions button').length, 4);
        assert.deepEqual($$('.ap-item-actions button').filter(btn => a.$view[0].contains(btn)).map(btn => btn.getAttribute('aria-label')),
            ['Play Now', 'Play folder from here', 'Play Next', 'Add to Queue'], 'each button says what it does');
    });
});

test('audio rows: a type the browser cannot play keeps its plain link', async () => {
    const [mp3, wma] = tracks('aud-unplayable', 'a.mp3', 'b.wma');
    wma.type = 'aud';
    await withPlayer({}, [], async () => {
        audio().canPlayType = mime => mime === 'audio/x-ms-wma' ? '' : 'maybe';
        try {
            list(mp3, wma);
            assert.equal(wma.$view.find('.ap-item-actions').length, 0);
            assert.equal(wma.click_callback, undefined, 'the click is left to the link');
            assert.equal(mp3.$view.find('.ap-item-actions').length, 1);

            $('#ap-play-pause').click();
            $('#ap-queue-btn').click();
            await settle();
            assert.deepEqual(queueNames(), ['a.mp3'], 'the folder queue skips it');
        } finally {
            delete audio().canPlayType;
            $('#aq-close').click();
        }
    });
});

test('audio errors: a failed track is shown and the queue moves on until all failed', async () => {
    await withPlayer({}, [], async () => {
        const [x, y] = list(...tracks('aud-error', 'a.mp3', 'b.mp3'));
        audio().emit('error');
        assert.equal(barIsActive(), false, 'an error without a track is ignored');

        press(x, 'folder');
        await settle();
        audio().emit('error');
        await settle();
        assert.equal(trackName(), y.label, 'the queue moves on');
        assert.equal($('#audio-player-bar').classList.contains('ap-error'), false, 'the next track starts clean');

        audio().emit('error');
        await settle();
        assert.equal(trackName(), y.label, 'the last track does not wrap without repeat');
        assert.ok($('#audio-player-bar').classList.contains('ap-error'));
        assert.equal($('#ap-track-folder-el').textContent, 'Cannot play this file');
        assert.equal(barIsActive(), true);

        // As in a browser, an undecodable source also rejects play().
        audio().play = () => Promise.reject(new Error('NotSupportedError'));
        $('#ap-repeat').click();
        press(x, 'folder');
        await settle();
        audio().emit('error');
        await settle();
        audio().emit('error');
        await settle();
        assert.equal(trackName(), y.label, 'once every track failed in a row, it stops');
        assert.ok($('#audio-player-bar').classList.contains('ap-error'));
    });
});

test('audio transport: blocked playback still shows the bar to resume from', async () => {
    const [a] = tracks('aud-blocked-bar', 'a.mp3');
    await withPlayer({}, [], async () => {
        list(a);
        audio().play = () => Promise.reject(new Error('NotAllowedError'));
        press(a, 'folder');
        await settle();
        assert.equal(barIsActive(), true);
        assert.ok($('#root').classList.contains('ap-bar-visible'), 'the listing makes room for the bar');
        $('#ap-close-btn').click();
        assert.equal($('#root').classList.contains('ap-bar-visible'), false);
    });
});

test('audio transport: another player starting pauses the bar', async () => {
    const [a] = tracks('aud-other', 'a.mp3');
    await withPlayer({}, [], async () => {
        list(a);
        press(a, 'folder');
        await settle();
        assert.equal(audio().paused, false);
        const video = document.createElement('video');
        document.body.appendChild(video);
        video.dispatchEvent(new window.Event('play'));
        video.remove();
        assert.equal(audio().paused, true);
    });
});

test('audio media session: the playing track is published with its cover', async () => {
    const [a] = tracks('aud-session', 'a.mp3');
    a.thumbRational = '/a.webp';
    const session = {};
    const saved = {
        mediaSession: Object.getOwnPropertyDescriptor(window.navigator, 'mediaSession'),
        MediaMetadata: window.MediaMetadata
    };
    Object.defineProperty(window.navigator, 'mediaSession', {configurable: true, value: session});
    window.MediaMetadata = class {
        constructor(init) {
            Object.assign(this, init);
        }
    };
    try {
        await withPlayer({}, [], async () => {
            list(a);
            press(a, 'folder');
            await settle();
            assert.equal(session.metadata.title, 'a.mp3');
            assert.equal(session.metadata.album, 'aud-session');
            assert.deepEqual(session.metadata.artwork, [{src: '/a.webp'}]);
            assert.equal(session.playbackState, 'playing');
        });
    } finally {
        if (saved.mediaSession) {
            Object.defineProperty(window.navigator, 'mediaSession', saved.mediaSession);
        } else {
            delete window.navigator.mediaSession;
        }
        window.MediaMetadata = saved.MediaMetadata;
    }
});

// The native video preview resolves on its metadata, which jsdom never loads.
const withVideoMetadata = async (run, answer = 'loadedmetadata') => {
    const proto = window.Element.prototype;
    const originalSetAttribute = proto.setAttribute;
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: false});
    proto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-vid' && name === 'src') {
            const video = this;
            window.setTimeout(() => {
                if (answer === 'error') {
                    Object.defineProperty(video, 'error', {configurable: true, value: {code: 4}});
                }
                video.dispatchEvent(new window.Event(answer));
            }, 0);
        }
    };
    try {
        await run();
    } finally {
        proto.setAttribute = originalSetAttribute;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
    }
};
const videos = (folder, ...names) => names.map(name => {
    const item = Item.get(`/${folder}/${name}`);
    item.type = 'vid';
    return item;
});
const previewShown = () => !$('#pv-overlay').classList.contains('hidden') && $('#pv-overlay').style.display !== 'none';
const videoEl = () => $('#pv-container #pv-content-vid');
const tick = drain;

test('video rows: the same four actions, and the click still opens the preview', async () => {
    const [clip] = videos('vid-rows', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(clip);
            assert.equal(clip.$view[0].querySelectorAll(':scope > .ap-item-actions button').length, 4);
            clip.$view.find('a')[0].click();
            await tick();
            assert.ok(previewShown());
            assert.equal(barIsActive(), false, 'a plain click is a preview, not the queue');
            $('#pv-bar-close').click();
        });
    });
});

test('video queue: the folder button queues the folder videos and opens the preview', async () => {
    const [one, two] = videos('vid-now', 'one.mp4', 'two.mp4');
    const [song] = tracks('vid-now', 'song.mp3');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            const listedVideos = list(one, song, two).filter(item => item.type === 'vid');
            press(two, 'folder');
            await tick();
            assert.equal(trackName(), 'two.mp4');
            assert.ok(previewShown());
            assert.equal(preview.item, two);
            assert.ok(videoEl(), 'the video is shown');
            $('#ap-queue-btn').click();
            assert.deepEqual(queueNames(), labels(listedVideos), 'the folder queue holds its videos only');
            $('#aq-close').click();

            videoEl().dispatchEvent(new window.Event('play'));
            assert.ok($('#ap-play-pause').classList.contains('playing'), 'the bar follows the video');
            videoEl().dispatchEvent(new window.Event('pause'));
            assert.equal($('#ap-play-pause').classList.contains('playing'), false);
        });
    });
});

test('video queue: tracks and videos follow each other in one queue', async () => {
    const [a, b] = tracks('vid-mixed', 'a.mp3', 'b.mp3');
    const [clip] = videos('vid-mixed', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            const [first, second] = list(a, clip, b).filter(item => item.type === 'aud');
            press(first, 'folder');
            await settle();
            press(clip, 'next');
            $('#ap-queue-btn').click();
            assert.deepEqual(queueNames(), labels([first, clip, second]));
            assert.ok($$('#aq-list-el .aq-item')[1].classList.contains('aq-video'));
            $('#aq-close').click();

            audio().emit('ended');
            await tick();
            assert.equal(trackName(), 'clip.mp4');
            assert.ok(previewShown(), 'the video plays in the preview');
            assert.equal(audio().paused, true);

            // The audio element's own events no longer drive the bar.
            audio().emit('play');
            assert.equal($('#ap-play-pause').classList.contains('playing'), false);

            videoEl().dispatchEvent(new window.Event('ended'));
            await settle();
            assert.equal(trackName(), second.label);
            assert.equal(previewShown(), false, 'the preview closes for the next track');
            assert.equal(audio().paused, false);
        });
    });
});

test('video queue: closing the preview pauses, the play button reopens it', async () => {
    const [clip, next] = videos('vid-close', 'clip.mp4', 'next.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            const [firstVideo, secondVideo] = list(clip, next);
            press(firstVideo, 'folder');
            await tick();
            videoEl().dispatchEvent(new window.Event('play'));
            $('#pv-bar-close').click();
            assert.equal(previewShown(), false);
            assert.equal($('#ap-play-pause').classList.contains('playing'), false);
            assert.equal(trackName(), firstVideo.label, 'the video stays the current entry');

            $('#ap-play-pause').click();
            await tick();
            assert.ok(previewShown());
            assert.equal(preview.item, firstVideo);

            videoEl().dispatchEvent(new window.Event('ended'));
            await tick();
            assert.equal(preview.item, secondVideo, 'the next video replaces it in the open preview');
            assert.ok(previewShown());

            $('#ap-close-btn').click();
            assert.equal(previewShown(), false, 'stopping the player closes its video');
        });
    });
});

test('video queue: a video loading late never replaces the one skipped to', async () => {
    const [one, two, three] = videos('vid-race', 'one.mp4', 'two.mp4', 'three.mp4');
    const proto = window.Element.prototype;
    const originalSetAttribute = proto.setAttribute;
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: false});
    // Each video waits for its metadata until the test lets it through.
    const loading = {};
    proto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-vid' && name === 'src') {
            loading[value.split('/').pop()] = this;
        }
    };
    const loaded = async name => {
        loading[name].dispatchEvent(new window.Event('loadedmetadata'));
        await tick();
    };
    let unloaded = 0;
    try {
        await withPlayer({}, [], async () => {
            list(one, two, three);
            press(one, 'folder');
            await tick();
            await loaded('one.mp4');
            assert.equal(preview.item, one);

            $('#ap-next').click();
            $('#ap-next').click();
            await tick();
            assert.deepEqual(Object.keys(loading), ['one.mp4', 'two.mp4', 'three.mp4']);
            const unload = loading['two.mp4'].unload;
            loading['two.mp4'].unload = function counted() {
                unloaded += 1;
                return unload && unload.call(this);
            };

            await loaded('three.mp4');
            await loaded('two.mp4');
            assert.equal(preview.item, three);
            assert.equal(trackName(), 'three.mp4');
            assert.equal(document.querySelectorAll('#pv-content-vid').length, 1);
            assert.ok(videoEl().getAttribute('src').endsWith('three.mp4'), 'the late video stays out');
            assert.equal(unloaded, 1, 'and is unloaded');
            $('#ap-close-btn').click();
        });
    } finally {
        proto.setAttribute = originalSetAttribute;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
    }
});

// Holds each native video's metadata until the test lets it through:
// `loads` lists the elements in the order they started loading.
const withHeldMetadata = async run => {
    const proto = window.Element.prototype;
    const originalSetAttribute = proto.setAttribute;
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: false});
    const loads = [];
    proto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-vid' && name === 'src') {
            loads.push(this);
        }
    };
    const release = async el => {
        el.dispatchEvent(new window.Event('loadedmetadata'));
        await tick();
    };
    // Counts the unload() calls of `el`, set once its loader ran.
    const countUnloads = el => {
        const counter = {count: 0};
        const unload = el.unload;
        el.unload = function counted() {
            counter.count += 1;
            return unload && unload.call(this);
        };
        return counter;
    };
    try {
        await run({loads, release, countUnloads});
    } finally {
        proto.setAttribute = originalSetAttribute;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
    }
};

test('video preview: closed while its video loads, nothing shows and the music goes on', async () => {
    const [a] = tracks('vid-closed', 'a.mp3');
    const [clip] = videos('vid-closed', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withHeldMetadata(async ({loads, release, countUnloads}) => {
            list(a, clip);
            press(a, 'folder');
            await settle();
            assert.equal(audio().paused, false);

            clip.$view.find('a')[0].click();
            await tick();
            assert.equal(loads.length, 1);
            const unloads = countUnloads(loads[0]);
            $('#pv-bar-close').click();
            await release(loads[0]);

            assert.equal(document.querySelector('#pv-content-vid'), null, 'no video in the closed preview');
            assert.equal(unloads.count, 1, 'the late video is unloaded');
            assert.equal(audio().paused, false, 'the track is not paused for it');
            assert.equal(barIsActive(), true);
            assert.equal(document.querySelector('.ap-video-shown'), null, 'the bar is not hidden for it');
        });
    });
});

test('video preview: back and forth while loading shows the last load only', async () => {
    const [first, second] = videos('vid-back', 'first.mp4', 'second.mp4');
    await withPlayer({}, [], async () => {
        await withHeldMetadata(async ({loads, release, countUnloads}) => {
            list(first, second);
            first.$view.find('a')[0].click();
            await tick();
            $('#pv-bar-next').click();
            await tick();
            $('#pv-bar-prev').click();
            await tick();
            assert.equal(loads.length, 3, 'first, second, first again');
            const [early, middle, last] = loads;
            const earlyUnloads = countUnloads(early);
            const middleUnloads = countUnloads(middle);

            await release(early);
            await release(middle);
            await release(last);
            assert.equal(preview.item, first);
            assert.equal(document.querySelectorAll('#pv-content-vid').length, 1);
            assert.equal(videoEl(), last, 'the last load is the one shown');
            assert.equal(earlyUnloads.count, 1, 'the earlier load of the same video is unloaded');
            assert.equal(middleUnloads.count, 1);
            $('#pv-bar-close').click();
        });
    });
});

test('video queue: a video the user opened is left alone by the queue', async () => {
    const [a, b] = tracks('vid-own', 'a.mp3', 'b.mp3');
    const [clip] = videos('vid-own', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            const [first, second] = list(a, b, clip).filter(item => item.type === 'aud');
            press(first, 'folder');
            await settle();
            clip.$view.find('a')[0].click();
            await tick();
            assert.ok(previewShown());
            $('#ap-next').click();
            await settle();
            assert.equal(trackName(), second.label);
            assert.ok(previewShown(), 'only a video opened by the queue is closed by it');
            $('#pv-bar-close').click();
        });
    });
});

test('video queue: a preview the user is browsing is not taken over', async () => {
    const [a] = tracks('vid-busy', 'a.mp3');
    const [clip] = videos('vid-busy', 'clip.mp4');
    const [photo] = tracks('vid-busy', 'photo.jpg');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(a, clip, photo);
            press(a, 'folder');
            await settle();
            press(clip, 'next');
            photo.$view.find('a')[0].click();
            await tick();
            assert.equal(preview.item, photo);

            audio().emit('ended');
            await tick();
            assert.equal(trackName(), 'clip.mp4', 'the queue moves on');
            assert.equal(preview.item, photo, 'the photo stays on screen');
            assert.equal($('#ap-play-pause').classList.contains('playing'), false);

            $('#pv-bar-close').click();
            $('#ap-play-pause').click();
            await tick();
            assert.equal(preview.item, clip, 'the play button opens the waiting video');
        });
    });
});

test('video queue: an explicit play opens the waiting video over the preview', async () => {
    const [a] = tracks('vid-play', 'a.mp3');
    const [clip] = videos('vid-play', 'clip.mp4');
    const [photo] = tracks('vid-play', 'photo.jpg');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(a, clip, photo);
            press(a, 'folder');
            await settle();
            press(clip, 'next');
            photo.$view.find('a')[0].click();
            await tick();
            audio().emit('ended');
            await tick();
            assert.equal(preview.item, photo, 'the queue moving on leaves the photo');

            $('#ap-play-pause').click();
            await tick();
            assert.equal(preview.item, clip, 'the play button asks for the video');
            assert.ok(videoEl());
            $('#ap-close-btn').click();
        });
    });
});

test('video queue: next and the queue replace a preview with their video', async () => {
    const [a] = tracks('vid-moves', 'a.mp3');
    const [clip] = videos('vid-moves', 'clip.mp4');
    const [photo] = tracks('vid-moves', 'photo.jpg');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(a, clip, photo);
            const browsePhoto = async () => {
                photo.$view.find('a')[0].click();
                await tick();
                assert.equal(preview.item, photo);
            };
            press(a, 'folder');
            await settle();
            press(clip, 'next');

            await browsePhoto();
            $('#ap-next').click();
            await tick();
            assert.equal(preview.item, clip, 'the next button');
            assert.ok(videoEl());

            $('#pv-bar-close').click();
            $('#ap-queue-btn').click();
            $$('#aq-list-el .aq-item')[0].click();
            await settle();
            assert.equal(trackName(), a.label);
            await browsePhoto();
            $$('#aq-list-el .aq-item')[1].click();
            await tick();
            assert.equal(preview.item, clip, 'a click in the queue');
            $('#ap-close-btn').click();
        });
    });
});

test('video queue: a video failing before it is shown still moves the queue on', async () => {
    const [clip] = videos('vid-broken', 'clip.mp4');
    const [b] = tracks('vid-broken', 'b.mp3');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(clip, b);
            press(clip, 'folder');
            press(b, 'queue');
            await tick();
            await settle();
            assert.equal(trackName(), 'b.mp3', 'the failure seen once attached skips the video');
            assert.equal(previewShown(), false);
        }, 'error');
    });
});

test('video queue: the bar shows the new entry time, and video progress counts as playing', async () => {
    const [a] = tracks('vid-time', 'a.mp3');
    const [clip] = videos('vid-time', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(a, clip);
            press(a, 'folder');
            await settle();
            audio().emit('durationchange');
            assert.equal($('#ap-time-dur').textContent, '3:00');

            press(clip, 'folder');
            await tick();
            assert.equal($('#ap-time-dur').textContent, '0:00', 'the previous duration is not kept');

            const video = videoEl();
            Object.defineProperty(video, 'duration', {configurable: true, value: 90});
            Object.defineProperty(video, 'currentTime', {configurable: true, writable: true, value: 30});
            Object.defineProperty(video, 'paused', {configurable: true, value: false});
            video.dispatchEvent(new window.Event('timeupdate'));
            assert.equal($('#ap-time-dur').textContent, '1:30');
            assert.equal($('#ap-time-cur').textContent, '0:30');
            assert.ok($('#ap-play-pause').classList.contains('playing'), 'a play missed while detached is caught up');
        });
    });
});

const store = reqlib('core/store');
const playerExt = reqlib('ext/player');
const absolute = item => new window.URL(item.absHref, window.location.href).href;

// Captures what the player hands to the browser as a download, and runs
// the delayed release of its URL before leaving.
const withDownloads = async run => {
    const saved = {
        click: window.HTMLAnchorElement.prototype.click,
        createObjectURL: Object.getOwnPropertyDescriptor(window.URL, 'createObjectURL'),
        setTimeout: window.setTimeout
    };
    const downloads = [];
    const delayed = [];
    let blob = null;
    window.setTimeout = (fn, ms) => {
        delayed.push(fn);
        return ms;
    };
    Object.defineProperty(window.URL, 'createObjectURL', {configurable: true, value: value => {
        blob = value;
        return 'blob:download';
    }});
    window.HTMLAnchorElement.prototype.click = function click() {
        downloads.push({name: this.getAttribute('download'), href: this.getAttribute('href'), blob});
    };
    try {
        await run(downloads);
    } finally {
        delayed.forEach(fn => fn());
        window.setTimeout = saved.setTimeout;
        window.HTMLAnchorElement.prototype.click = saved.click;
        Object.defineProperty(window.URL, 'createObjectURL', saved.createObjectURL);
    }
};

test('player export: the queue downloads as an M3U playlist with absolute URLs', async () => {
    const [a, b] = tracks('aud-export', 'a.mp3', 'b.mp3');
    const [other] = tracks('aud-export-2', 'c d.mp3');
    await withPlayer({}, [], async ({revoked}) => {
        await withDownloads(async downloads => {
            const [first, second] = list(a, b);
            $('#ap-queue-btn').click();
            assert.equal($('#aq-export').disabled, true, 'nothing to export');

            press(first, 'folder');
            await settle();
            assert.equal($('#aq-export').disabled, false);
            $('#aq-export').click();
            assert.equal(downloads.length, 1);
            assert.equal(downloads[0].name, 'aud-export.m3u8', 'named after the folder');
            assert.equal(downloads[0].blob.type, 'audio/x-mpegurl');
            assert.equal(await downloads[0].blob.text(), [
                '#EXTM3U',
                `#EXTINF:-1,${first.label}`, absolute(first),
                `#EXTINF:-1,${second.label}`, absolute(second),
                ''
            ].join('\n'));

            list(a, b, other);
            press(other, 'queue');
            $('#aq-export').click();
            assert.equal(downloads[1].name, 'queue.m3u8', 'tracks from several folders');
            assert.ok((await downloads[1].blob.text()).includes(absolute(other)), 'the URL stays encoded');
            $('#aq-close').click();
        });
        assert.deepEqual(revoked, ['blob:download', 'blob:download'], 'each download URL is released');
    });
});

test('player memory: the queue, position and settings are saved as they change', async () => {
    await withPlayer({}, [], async () => {
        const [x, y] = list(...tracks('aud-save', 'a.mp3', 'b.mp3'));
        press(y, 'folder');
        await settle();
        $('#ap-repeat').click();
        const volume = $('#ap-volume');
        volume.value = '30';
        volume.dispatchEvent(new window.Event('input', {bubbles: true}));
        const saved = store.get('ext/player');
        assert.deepEqual(saved.queue, [x.absHref, y.absHref]);
        assert.equal(saved.current, y.absHref);
        assert.equal(saved.repeat, 1);
        assert.equal(saved.volume, 0.3);

        $('#ap-close-btn').click();
        assert.deepEqual(store.get('ext/player').queue, [], 'closing the player forgets the queue');
    });
});

test('player memory: a saved queue comes back paused at its position', async () => {
    await withPlayer({}, [], async () => {
        const [x, y] = list(...tracks('aud-restore', 'a.mp3', 'b.mp3'));
        store.put('ext/player', {
            queue: [x.absHref, 'https://elsewhere.example/c.mp3', '//elsewhere.example/d.mp3', 42, y.absHref],
            current: y.absHref,
            time: 42,
            volume: 0.3,
            lastVolume: 0.6,
            muted: false,
            shuffle: false,
            repeat: 1
        });
        playerExt.restoreSaved();
        await settle();
        assert.equal(barIsActive(), true);
        assert.equal(trackName(), y.label);
        assert.equal(audio().paused, true, 'no sound without a click');
        assert.equal(audio().currentTime, 42);
        assert.equal($('#ap-time-cur').textContent, '0:42');
        assert.equal($('#ap-repeat').getAttribute('title'), 'Repeat (Queue)');
        assert.equal($('#ap-volume').value, '30');
        $('#ap-queue-btn').click();
        assert.deepEqual(queueNames(), labels([x, y]), 'only paths of this site are kept');
        $('#aq-close').click();

        store.put('ext/player', {queue: [x.absHref], current: x.absHref, time: 5});
        playerExt.restoreSaved();
        assert.equal(trackName(), y.label, 'a player in use is left alone');
    });
});

test('player memory: a broken or foreign saved state is ignored', async () => {
    await withPlayer({}, [], async () => {
        [null, 'text', {queue: 'nope', repeat: 7, volume: 3}].forEach(state => {
            store.put('ext/player', state);
            playerExt.restoreSaved();
            assert.equal(barIsActive(), false);
            assert.equal($('#ap-repeat').getAttribute('title'), 'Repeat (Off)');
        });
    });
});

test('player memory: only paths of this site are read back', () => {
    const memory = reqlib('ext/player/memory');
    const saved = store.get('ext/player');
    try {
        store.put('ext/player', {
            queue: [
                '/music/a.mp3', '//elsewhere.example/b.mp3', 'https://elsewhere.example/c.mp3', 7,
                '/music/a%20b%23c.mp3',
                // Each resolves to https://elsewhere.example/... once parsed as a URL.
                '/\\elsewhere.example/d.mp3', '/\t/elsewhere.example/e.mp3', '/\n/elsewhere.example/f.mp3',
                '/\r/elsewhere.example/g.mp3'
            ],
            current: '/\\elsewhere.example/d.mp3',
            time: -3
        });
        const state = memory.load();
        assert.deepEqual(state.queue, ['/music/a.mp3', '/music/a%20b%23c.mp3']);
        assert.equal(state.current, null);
        assert.equal(state.time, 0);
    } finally {
        store.put('ext/player', saved);
    }
});

test('player memory: every visualizer mode is read back', () => {
    const memory = reqlib('ext/player/memory');
    const saved = store.get('ext/player');
    try {
        ['spectrum', 'scope', 'plasma', 'kaleido', 'vortex', 'off'].forEach(mode => {
            store.put('ext/player', {visualizer: mode});
            assert.equal(memory.load().visualizer, mode);
        });
        store.put('ext/player', {visualizer: 'strobe'});
        assert.equal(memory.load().visualizer, null, 'an unknown mode is dropped');
    } finally {
        store.put('ext/player', saved);
    }
});

const textFrame = (id, text) => frame(4, id, [3, ...new TextEncoder().encode(text)]);
const panelOpen = () => $('#player-now-playing').classList.contains('active');
const details = () => {
    const terms = $$('#np-details dt').map(el => el.textContent);
    const values = $$('#np-details dd').map(el => el.textContent);
    return Object.fromEntries(terms.map((term, idx) => [term, values[idx]]));
};

test('now playing: the bar cover opens the large view with the tags, and reduces it', async () => {
    const [tagged, plain] = tracks('np-view', '01 - tagged.mp3', 'plain.mp3');
    tagged.size = 4000000;
    const covers = {
        [tagged.absHref]: id3(4, [].concat(
            textFrame('TIT2', 'Neon Avenue'),
            textFrame('TPE1', 'Night Drive'),
            textFrame('TALB', 'City Lights'),
            textFrame('TDRC', '2026'),
            textFrame('TCON', 'Synthwave'),
            textFrame('TRCK', '1/4'),
            frame(4, 'APIC', apic())
        ))
    };
    await withPlayer(covers, [], async () => {
        list(tagged, plain);
        const cover = $('#ap-cover-gradient');
        assert.equal(cover.getAttribute('role'), null, 'nothing to open yet');

        press(tagged, 'folder');
        await settle();
        assert.equal(cover.getAttribute('role'), 'button');
        assert.equal(cover.getAttribute('aria-expanded'), 'false');

        cover.click();
        await settle();
        assert.ok(panelOpen());
        assert.equal($('#player-now-playing').hasAttribute('inert'), false);
        assert.equal(cover.getAttribute('aria-expanded'), 'true');
        assert.equal($('#np-title').textContent, 'Neon Avenue');
        assert.equal($('#np-artist').textContent, 'Night Drive');
        assert.equal($('#np-album').textContent, 'City Lights · 2026');
        assert.deepEqual(details(), {
            Genre: 'Synthwave',
            Track: '1 of 4',
            Duration: '3:00',
            Format: 'MP3',
            'Bit rate': '178 kbps',
            Size: reqlib('core/format').formatSize(4000000),
            File: '01 - tagged.mp3'
        });
        assert.ok($('#np-cover-img').getAttribute('src').startsWith('blob:'), 'the embedded picture in full');
        assert.equal(document.activeElement, $('#np-collapse'));

        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), 'plain.mp3', 'next, or around to the first');
        assert.equal($('#np-title').textContent, 'plain', 'the view follows the queue');
        assert.equal($('#np-artist').classList.contains('hidden'), true, 'no empty line for a missing tag');
        assert.equal($('#np-album').textContent, 'np-view', 'the folder stands for a missing album');

        window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}));
        assert.equal(panelOpen(), false, 'Escape reduces it');
        assert.ok($('#player-now-playing').hasAttribute('inert'));
        assert.equal(document.activeElement, cover, 'focus goes back to the cover');
        assert.equal(cover.getAttribute('aria-expanded'), 'false');

        cover.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter'}));
        await settle();
        assert.ok(panelOpen(), 'the keyboard opens it too');
        $('#np-collapse').click();
        assert.equal(panelOpen(), false, 'the reduce button');

        cover.click();
        await settle();
        $('#ap-close-btn').click();
        assert.equal(panelOpen(), false, 'stopping the player closes it');
    });
});

test('now playing: a video entry has no large view', async () => {
    const [clip] = videos('np-video', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(clip);
            press(clip, 'folder');
            await tick();
            const cover = $('#ap-cover-gradient');
            assert.equal(cover.getAttribute('role'), null);
            cover.click();
            await settle();
            assert.equal(panelOpen(), false);
            $('#pv-bar-close').click();
        });
    });
});

test('now playing: a queue moving on to a video closes the view', async () => {
    const [a] = tracks('np-to-video', 'a.mp3');
    const [clip] = videos('np-to-video', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(a, clip);
            press(a, 'folder');
            await settle();
            press(clip, 'next');
            $('#ap-cover-gradient').click();
            await settle();
            assert.ok(panelOpen());
            audio().emit('ended');
            await tick();
            assert.equal(trackName(), 'clip.mp4');
            assert.equal(panelOpen(), false);
            $('#pv-bar-close').click();
        });
    });
});

test('audio covers: a FLAC picture becomes the cover', async () => {
    const [song] = tracks('np-flac', 'song.flac');
    song.type = 'aud';
    const flacStart = Uint8Array.from([
        ...bytes('fLaC'),
        0x86, 0, 0, 32 + JPEG.length,
        0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, ...new Array(16).fill(0), 0, 0, 0, JPEG.length, ...JPEG
    ]).buffer;
    await withPlayer({[song.absHref]: flacStart}, [], async ({blobs}) => {
        list(song);
        press(song, 'folder');
        await settle();
        assert.deepEqual(blobs, ['image/jpeg']);
        assert.equal($('#ap-cover-img').getAttribute('src'), 'blob:1');
    });
});

// Web Audio, animation frames and 2D canvases, which jsdom lacks. `audioEnv`
// says how the next audio context starts and what the analyser hears.
const audioEnv = {startState: 'running', resumes: true, hidden: false, contexts: [], sources: [], frames: [], recorders: new Map(), level: 255, channels: [0.5, 0.5], splits: []};
const recorderOf = canvas => audioEnv.recorders.get(canvas);
const withAudio = async run => {
    const saved = {
        AudioContext: window.AudioContext,
        requestAnimationFrame: window.requestAnimationFrame,
        getContext: window.HTMLCanvasElement.prototype.getContext,
        hidden: Object.getOwnPropertyDescriptor(document, 'hidden')
    };
    // jsdom reports a hidden page, where the visualizer rightly stays idle.
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => audioEnv.hidden});
    window.AudioContext = class {
        constructor() {
            this.state = audioEnv.startState;
            this.sampleRate = 48000;
            this.destination = {};
            this.listeners = [];
            this.resumed = 0;
            audioEnv.contexts.push(this);
        }
        addEventListener(type, fn) {
            if (type === 'statechange') {
                this.listeners.push(fn);
            }
        }
        // What the browser does on a call or a locked screen.
        suspendBy(state) {
            this.state = state;
            this.listeners.forEach(fn => fn());
        }
        resume() {
            this.resumed += 1;
            if (!audioEnv.resumes) {
                return Promise.reject(new Error('NotAllowedError'));
            }
            this.state = 'running';
            return Promise.resolve();
        }
        createMediaElementSource(el) {
            audioEnv.sources.push(el);
            return {connect() {}};
        }
        // The node a mono track is spread through, then the splitter: the
        // channels each analyser was given are recorded.
        createGain() {
            const node = {
                connect: target => {
                    target.from = node;
                }
            };
            return node;
        }
        createChannelSplitter(outputs) {
            const splitter = {
                outputs,
                connect: (node, output) => {
                    node.channel = output;
                    audioEnv.splits.push({from: splitter.from, outputs, output});
                }
            };
            return splitter;
        }
        createAnalyser() {
            return {
                fftSize: 0,
                channel: null,
                get frequencyBinCount() {
                    return this.fftSize / 2;
                },
                connect() {},
                // A square wave of the channel's amplitude.
                getFloatTimeDomainData(arr) {
                    const amplitude = audioEnv.channels[this.channel];
                    arr.forEach((unused, idx) => {
                        arr[idx] = idx % 2 ? amplitude : -amplitude;
                    });
                },
                // Loud bass, silence above.
                getByteFrequencyData: arr => {
                    arr.fill(0);
                    arr.fill(audioEnv.level, 0, 8);
                },
                getByteTimeDomainData: arr => arr.forEach((unused, idx) => {
                    arr[idx] = idx % 2 ? 255 : 0;
                })
            };
        }
    };
    window.requestAnimationFrame = fn => {
        audioEnv.frames.push(fn);
        return audioEnv.frames.length;
    };
    window.HTMLCanvasElement.prototype.getContext = function getContext() {
        if (!audioEnv.recorders.has(this)) {
            const calls = [];
            audioEnv.recorders.set(this, {
                calls,
                fillStyle: null,
                createLinearGradient: () => ({addColorStop() {}}),
                globalAlpha: 1,
                clearRect() {
                    calls.length = 0;
                },
                fillRect(x, y, w, h) {
                    calls.push({x, y, w, h, style: this.fillStyle});
                },
                save() {},
                restore() {},
                beginPath() {},
                rect() {},
                clip() {},
                moveTo() {},
                lineTo(x, y) {
                    calls.push({line: [x, y], style: this.strokeStyle});
                },
                stroke() {},
                fillText(text) {
                    calls.push({text});
                },
                translate(x, y) {
                    calls.push({translate: [x, y]});
                },
                rotate() {},
                scale() {},
                drawImage(source) {
                    calls.push({image: source});
                },
                createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}),
                putImageData(image) {
                    calls.push({put: image});
                }
            });
        }
        return audioEnv.recorders.get(this);
    };
    try {
        await run();
    } finally {
        window.AudioContext = saved.AudioContext;
        window.requestAnimationFrame = saved.requestAnimationFrame;
        window.HTMLCanvasElement.prototype.getContext = saved.getContext;
        if (saved.hidden) {
            Object.defineProperty(document, 'hidden', saved.hidden);
        } else {
            delete document.hidden;
        }
        // Pending frames are kept: a browser always delivers a requested one.
    }
};
let frameTime = 1000;
// Runs the pending animation frames, `count` times 50 ms apart.
const runFrames = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
        frameTime += 50;
        const now = frameTime;
        audioEnv.frames.splice(0).forEach(fn => fn(now));
    }
};
const largeCover = () => $('#np-cover');
const largeCanvas = () => $('#np-viz-canvas');
const vizMenu = () => $('#np-viz-select');
// Picks `mode` in the menu, as a viewer does.
const pick = mode => {
    vizMenu().value = mode;
    vizMenu().dispatchEvent(new window.Event('change'));
};
const showsVisualizer = () => largeCover().classList.contains('np-cover-viz');
// Opens the large view of the playing track.
const openLarge = async () => {
    $('#ap-cover-gradient').click();
    await settle();
    assert.ok(panelOpen());
};
// Shows `mode` through the menu, unless it is shown already.
const switchTo = mode => {
    if (vizMenu().value !== mode) {
        pick(mode);
    }
    assert.equal(store.get('ext/player').visualizer, mode);
};

test('visualizer: a held-back audio context never takes the track', async () => {
    const [a] = tracks('viz-held', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            audioEnv.startState = 'suspended';
            audioEnv.resumes = false;
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('off');
            largeCover().click();
            await settle();
            assert.equal(audioEnv.contexts.length, 1);
            assert.deepEqual(audioEnv.sources, [], 'not connected: the track keeps its sound');
            assert.equal(audioEnv.frames.length, 0, 'nothing to draw');
        });
    });
});

test('visualizer: without a mode chosen, the track never goes through Web Audio', async () => {
    const [a] = tracks('viz-unused', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            audioEnv.resumes = true;
            // The player is shared by the tests: the cover, as on a first visit.
            store.put('ext/player', {visualizer: 'off'});
            playerExt.restoreSaved();
            const contexts = audioEnv.contexts.length;
            const sources = audioEnv.sources.length;
            list(a);
            press(a, 'folder');
            await settle();
            audio().pause();
            audio().play();
            await settle();
            assert.equal(audioEnv.contexts.length, contexts, 'no audio context at all');
            assert.equal(audioEnv.sources.length, sources);
        });
    });
});

test('visualizer: a context suspended after connecting resumes', async () => {
    const [a] = tracks('viz-resume', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            audioEnv.resumes = true;
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('spectrum');
            await settle();
            const context = audioEnv.contexts[audioEnv.contexts.length - 1];
            const sources = audioEnv.sources.filter(el => el === audio()).length;
            assert.equal(sources, 1, 'connected');

            context.suspendBy('interrupted');
            await settle();
            assert.equal(context.state, 'running', 'resumed while the track plays');

            audio().pause();
            await settle();
            context.suspendBy('suspended');
            assert.equal(context.state, 'suspended', 'left alone while paused');
            const before = context.resumed;
            audio().play();
            await settle();
            assert.ok(context.resumed > before, 'the next play resumes it');
            assert.equal(context.state, 'running');
            assert.equal(audioEnv.sources.filter(el => el === audio()).length, 1, 'connected once only');
        });
    });
});

test('visualizer: the spectrum follows the sound, falls when paused, and stops', async () => {
    const [a] = tracks('viz-live', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            audioEnv.resumes = true;
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('spectrum');
            await settle();
            assert.deepEqual(audioEnv.sources, [audio()], 'choosing a mode connects the track');
            assert.equal(audioEnv.contexts.length, 1, 'one context for the page');

            runFrames(2);
            const bars = recorderOf(largeCanvas()).calls.filter(call => call.w === 3 && call.h > 1);
            assert.ok(bars.length > 0, 'bars drawn');
            assert.equal(bars[0].x, 0, 'the bass bar is lit');
            assert.equal(bars[0].h, 151, 'a full-scale bass fills the square canvas');
            assert.ok(bars.every(call => call.x % 4 === 0 && call.x < 152), 'Winamp layout: 38 bars, 4 pixels apart');

            audio().pause();
            runFrames(1);
            assert.ok(audioEnv.frames.length > 0, 'still falling after the pause');
            runFrames(60);
            assert.equal(audioEnv.frames.length, 0, 'at rest: no frame requested any more');
            assert.equal(recorderOf(largeCanvas()).calls.length, 0, 'an empty display');
        });
    });
});

test('visualizer: none in the bar, the large view shows the cover first', async () => {
    const [a] = tracks('viz-none', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            assert.equal($('#audio-player-bar canvas'), null, 'no visualizer in the bar');
            await openLarge();
            switchTo('off');
            assert.equal(showsVisualizer(), false, 'the cover is shown');
            assert.equal(largeCover().getAttribute('role'), 'button');
            assert.ok(largeCover().getAttribute('title').startsWith('Show the visualizer: '), largeCover().getAttribute('title'));
            assert.equal($('#player-now-playing .np-viz'), null, 'no separate visualizer box');
            assert.equal(vizMenu().classList.contains('hidden'), false, 'the menu below the cover');
            assert.equal(vizMenu().value, 'off');
        });
    });
});

test('visualizer: the menu picks a display, the cover hides it and brings it back, all remembered', async () => {
    const [a] = tracks('viz-modes', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('off');

            const {MODES} = reqlib('ext/player/visualizer');
            const options = [...vizMenu().querySelectorAll('option')];
            assert.deepEqual(options.map(option => option.value), ['off', ...MODES.filter(mode => mode !== 'off')], 'every display, the cover first');
            assert.deepEqual([...vizMenu().querySelectorAll('optgroup')].map(group => group.label), ['Winamp', 'Meters', 'Psychedelic']);
            assert.equal(options[0].parentNode, vizMenu(), 'the cover in no group');
            assert.equal(vizMenu().getAttribute('aria-label'), 'Visualizer');

            pick('scopeDots');
            assert.equal(showsVisualizer(), true, 'the visualizer takes the cover\'s place');
            assert.equal(store.get('ext/player').visualizer, 'scopeDots');
            assert.equal(largeCover().getAttribute('title'), 'Show the cover');
            runFrames(2);
            const dots = recorderOf(largeCanvas()).calls;
            assert.equal(dots.length, 151, 'one dot per column');
            assert.ok(dots.every(call => call.h === 1), 'dots, not lines');

            largeCover().click();
            assert.equal(showsVisualizer(), false, 'a click: the cover again');
            assert.equal(store.get('ext/player').visualizer, 'off');
            assert.equal(vizMenu().value, 'off', 'the menu follows');
            assert.equal(largeCover().getAttribute('title'), 'Show the visualizer: Oscilloscope, dots');
            runFrames(1);
            assert.equal(audioEnv.frames.length, 0, 'the cover: no frame at all');

            largeCover().dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter'}));
            assert.equal(store.get('ext/player').visualizer, 'scopeDots', 'the keyboard brings the last display back');
            assert.equal(vizMenu().value, 'scopeDots');

            // The wave swings from top to bottom on every sample.
            pick('scopeSolid');
            runFrames(2);
            const solid = recorderOf(largeCanvas()).calls;
            assert.equal(solid.length, 151);
            assert.ok(solid.every(call => call.h === 76 && (call.y === 0 || call.y === 75)), 'filled from the middle line');

            pick('scope');
            runFrames(2);
            const columns = recorderOf(largeCanvas()).calls;
            assert.equal(columns.length, 151, 'one column per pixel');
            assert.equal(columns[1].h, 151, 'lines: a full swing joins top and bottom');

            pick('off');
            assert.equal(showsVisualizer(), false, 'the cover from the menu too');
        });
    });
});

test('visualizer: Winamp\'s analyser styles, and its thin bands', async () => {
    const [a] = tracks('viz-styles', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            const bars = () => recorderOf(largeCanvas()).calls.filter(call => call.h > 1);
            const red = 'rgb(239,49,16)';

            // The analyser hears loud bass: the first bars reach the top.
            switchTo('spectrumLine');
            runFrames(2);
            const full = bars().filter(call => call.h === 151);
            assert.ok(full.length > 0);
            assert.ok(full.every(call => call.style === red), 'line: a full bar is red all the way down');

            // Half as loud, and time for the bars to fall there.
            audioEnv.level = 128;
            runFrames(20);
            const half = bars().filter(call => call.h > 60 && call.h < 90);
            assert.ok(half.length > 0, 'bars half way up');
            assert.ok(half.every(call => typeof call.style === 'string' && call.style !== red && call.style !== 'rgb(24,132,8)'), 'line: the colour of their top, neither red nor green');

            switchTo('spectrum');
            runFrames(2);
            assert.ok(bars().every(call => typeof call.style === 'object'), 'normal: the skin\'s gradient, fixed on the screen');

            switchTo('spectrumFire');
            runFrames(2);
            const calls = recorderOf(largeCanvas()).calls;
            const fire = calls.filter(call => call.h > 1);
            assert.ok(fire.some(call => call.h < 151), 'bars short of the top');
            audioEnv.level = 255;
            fire.forEach(call => {
                const shift = calls[calls.indexOf(call) - 1];
                assert.deepEqual(shift.translate, [0, 151 - call.h], 'fire: the gradient moved to the bar\'s top');
                assert.equal(call.y, 0);
            });

            switchTo('spectrumThin');
            runFrames(2);
            const thin = bars();
            assert.ok(thin.length > 5);
            assert.ok(thin.every(call => call.w === 1), 'bands one pixel wide');
            assert.deepEqual(thin.map(call => call.x), thin.map((call, idx) => thin[0].x + idx), 'with no gap');
            switchTo('off');
        });
    });
});

test('visualizer: the meters read each channel, a mono track in both', async () => {
    const [a] = tracks('viz-meters', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('vu');
            assert.deepEqual(audioEnv.splits.map(split => split.output), [0, 1], 'one analyser per channel');
            const {from, outputs} = audioEnv.splits[0];
            assert.equal(outputs, 2);
            // A splitter alone would leave the right channel of a mono track
            // silent: the node before it spreads mono to both.
            assert.deepEqual(from && [from.channelCount, from.channelCountMode, from.channelInterpretation], [2, 'explicit', 'speakers']);

            const needles = () => recorderOf(largeCanvas()).calls.filter(call => call.line && call.style === 'rgb(242,242,242)');
            // The left channel loud, the right one silent.
            audioEnv.channels = [0.5, 0];
            runFrames(12);
            const [leftNeedle, rightNeedle] = needles();
            assert.ok(leftNeedle.line[0] > 76, 'the left needle pinned to the right');
            assert.ok(rightNeedle.line[0] < 75, 'the right one at rest on the left');
            assert.ok(leftNeedle.line[1] < 76 && rightNeedle.line[1] > 75, 'the left meter above, the right one below');
            assert.deepEqual(recorderOf(largeCanvas()).calls.filter(call => call.text).map(call => call.text), ['L', 'R']);

            audio().pause();
            runFrames(5);
            assert.ok(audioEnv.frames.length > 0, 'the needle falls after the pause');
            runFrames(60);
            assert.equal(audioEnv.frames.length, 0, 'then rests, and nothing runs');
            audio().play();

            switchTo('vectorscope');
            const points = () => recorderOf(largeCanvas()).calls.filter(call => call.style === 'rgb(120,255,140)');
            audioEnv.channels = [0.5, 0.5];
            runFrames(2);
            assert.deepEqual([...new Set(points().map(call => call.x))], [76], 'the same on both sides: one vertical line');
            audioEnv.channels = [0.5, 0];
            recorderOf(largeCanvas()).calls.length = 0;
            runFrames(1);
            assert.ok(points().every(call => (call.x - 76) * (call.y - 76) > 0), 'the left alone: on the up-left diagonal');
            audioEnv.channels = [0.5, 0.5];
            switchTo('off');
        });
    });
});

test('visualizer: the spectrogram draws a column a frame, and stands still when paused', async () => {
    const [a] = tracks('viz-spectrogram', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('spectrogram');
            runFrames(2);
            const images = () => recorderOf(largeCanvas()).calls.filter(call => call.put);
            assert.equal(images().length, 2, 'one image per frame, over the last one');
            const image = images()[1].put;
            assert.equal(image.width, 151);
            const pixel = (x, y) => Array.from(image.data.slice((y * 151 + x) * 4, (y * 151 + x) * 4 + 4));
            assert.notDeepEqual(pixel(150, 150), pixel(150, 0), 'loud bass at the bottom, silent treble at the top');
            assert.deepEqual(pixel(149, 150), pixel(150, 150), 'the frame before, one column to the left');
            assert.deepEqual(pixel(148, 150), [0, 0, 0, 0], 'and nothing before it');

            audio().pause();
            runFrames(1);
            assert.equal(audioEnv.frames.length, 0, 'paused: nothing runs');
            assert.equal(images().length, 2, 'the picture stays as it is');
            audio().play();
            switchTo('off');
        });
    });
});

test('visualizer: a saved psychedelic mode comes back with the queue', async () => {
    const [a] = tracks('viz-restore', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            store.put('ext/player', {queue: [a.absHref], current: a.absHref, visualizer: 'plasma'});
            playerExt.restoreSaved();
            await settle();
            await openLarge();
            assert.equal(showsVisualizer(), true);
            assert.equal(largeCover().getAttribute('title'), 'Show the cover');
            assert.equal(vizMenu().value, 'plasma', 'the menu shows it');
        });
    });
});

test('visualizer: the psychedelic modes draw with the music and rest when paused', async () => {
    const [a] = tracks('viz-trip', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            const calls = () => recorderOf(largeCanvas()).calls;

            switchTo('plasma');
            runFrames(2);
            const put = calls().filter(call => call.put);
            assert.equal(put.length, 2, 'one plasma image per frame');
            assert.equal(put[0].put.width, 151, 'on the whole square');
            assert.ok(put[0].put.data.some(value => value > 0), 'with colours in it');
            audio().pause();
            runFrames(1);
            assert.equal(audioEnv.frames.length, 0, 'paused, the plasma stays still and nothing runs');
            assert.equal(calls().filter(call => call.put).length, 2, 'not even drawn again');

            ['kaleido', 'vortex'].forEach(mode => {
                audio().play();
                switchTo(mode);
                runFrames(2);
                assert.ok(calls().some(call => call.image), `${mode}: the last frame comes back as trails`);
                assert.ok(calls().filter(call => call.w === 2 || call.h >= 1).length > 0, `${mode}: new shapes over them`);
                audio().pause();
                runFrames(5);
                assert.ok(audioEnv.frames.length > 0, `${mode}: the trails fade after the pause`);
                runFrames(30);
                assert.equal(audioEnv.frames.length, 0, `${mode}: then nothing runs`);
                assert.equal(calls().length, 0, `${mode}: on a cleared canvas`);
            });
            $('#np-collapse').click();
        });
    });
});

test('visualizer: a saved mode without Web Audio leaves the cover in place', async () => {
    const [a] = tracks('viz-unsupported', 'a.mp3');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            list(a);
            press(a, 'folder');
            await settle();
            await openLarge();
            switchTo('spectrum');
            $('#np-collapse').click();
        });
        // Outside withAudio: no AudioContext any more.
        await openLarge();
        assert.equal(showsVisualizer(), false, 'the cover, not an empty canvas');
        assert.equal(largeCover().getAttribute('role'), null, 'nothing to switch to');
        assert.ok(vizMenu().classList.contains('hidden'), 'and no menu');
        largeCover().click();
        assert.equal(store.get('ext/player').visualizer, 'spectrum', 'the click changes nothing');
        $('#np-collapse').click();
    });
});

test('visualizer: only for tracks, and drawn in the large view while it is open', async () => {
    const [a] = tracks('viz-video', 'a.mp3');
    const [clip] = videos('viz-video', 'clip.mp4');
    await withPlayer({}, [], async () => {
        await withAudio(async () => {
            await withVideoMetadata(async () => {
                list(a, clip);
                press(a, 'folder');
                await settle();
                await openLarge();
                switchTo('spectrum');
                runFrames(2);
                const large = recorderOf(largeCanvas()).calls.filter(call => call.w === 3 && call.h > 1);
                assert.ok(large.length > 0, 'the large view draws');

                $('#np-collapse').click();
                recorderOf(largeCanvas()).calls.length = 0;
                runFrames(2);
                assert.equal(recorderOf(largeCanvas()).calls.length, 0, 'nothing drawn once reduced');
                assert.equal(audioEnv.frames.length, 0, 'and no frame requested while it plays');

                $('#ap-cover-gradient').click();
                assert.ok(audioEnv.frames.length > 0, 'opening the view again draws again');
                runFrames(1);
                assert.ok(recorderOf(largeCanvas()).calls.length > 0);
                $('#np-collapse').click();
                runFrames(2);

                press(clip, 'folder');
                await tick();
                assert.equal(panelOpen(), false);
                $('#pv-bar-close').click();
            });
        });
    });
});

test('now playing: the large view takes the bar in, one size at a time', async () => {
    const [a] = tracks('np-size', 'a.mp3');
    await withPlayer({}, [], async () => {
        list(a);
        press(a, 'folder');
        await settle();
        assert.equal($('#root').classList.contains('np-open'), false);
        await openLarge();
        // The style sheet hides the bar's own look and track part under
        // #root.np-open: the controls stay the same elements.
        assert.ok($('#root').classList.contains('np-open'));
        $('#ap-play-pause').click();
        assert.equal(audio().paused, true, 'the controls still drive the track');
        $('#np-collapse').click();
        assert.equal($('#root').classList.contains('np-open'), false);
    });
});

test('video takeover: a video shown in the preview pauses the track and hides the player', async () => {
    const [a] = tracks('vid-takeover', 'a.mp3');
    const [clip] = videos('vid-takeover', 'clip.mp4');
    const [picture] = tracks('vid-takeover', 'picture.png');
    picture.type = 'img';
    const hidden = () => $('#root').classList.contains('ap-video-shown');
    await withPlayer({}, [], async () => {
        await withVideoMetadata(async () => {
            list(a, clip, picture);

            // A video the user opens.
            press(a, 'folder');
            await settle();
            await openLarge();
            clip.$view.find('a')[0].click();
            await tick();
            assert.ok(previewShown());
            assert.equal(audio().paused, true, 'the track pauses, even before the video plays');
            assert.ok(hidden(), 'the bar is hidden');
            assert.equal(panelOpen(), false, 'the large view closes');
            $('#pv-bar-close').click();
            assert.equal(hidden(), false, 'the bar comes back with the preview closed');
            assert.ok(barIsActive());
            assert.equal(audio().paused, true, 'still paused: nothing starts on its own');

            // A video the queue plays.
            $('#ap-play-pause').click();
            await settle();
            press(clip, 'folder');
            await tick();
            assert.equal(audio().paused, true);
            assert.ok(hidden());
            $('#pv-bar-close').click();
            assert.equal(hidden(), false);
        });
    });
});

test('video takeover: an image preview leaves the music alone', async () => {
    const [a] = tracks('img-music', 'a.mp3');
    const [picture] = tracks('img-music', 'picture.png');
    picture.type = 'img';
    await withPlayer({}, [], async () => {
        list(a, picture);
        press(a, 'folder');
        await settle();
        preview.open([picture], 0);
        await tick();
        event.pub('preview.content', picture, document.createElement('img'));
        assert.equal(audio().paused, false, 'the track keeps playing');
        assert.equal($('#root').classList.contains('ap-video-shown'), false);
        preview.close();
    });
});
