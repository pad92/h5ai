const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {flush} = require('../../../util/fresh');

// Drives the audio player mounted by the item tests (with their FakeAudio).
// The player is a singleton, so every test starts from a cleared, plain state.
const Item = reqlib('model/item');
const view = reqlib('view/view');
const event = reqlib('core/event');

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
            press(item, 'play');
            await settle();
        }
        assert.deepEqual(blobs, ['image/png', 'image/png', 'image/jpeg']);
        assert.equal(mime.embeddedCoverUrl, 'blob:3');
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
            press(item, 'play');
            await settle();
            assert.equal(item.embeddedCoverUrl, 'none', item.label);
            assert.equal($('#ap-cover-img').getAttribute('src'), '/aud-bad/Folder.jpg', 'a folder image is preferred');
        }
        assert.deepEqual(blobs, []);
    });
});

test('audio covers: a broken cover falls back to the thumbnail, then to a gradient', async () => {
    const [thumbed, lone, picture] = tracks('aud-cover', 'thumbed.mp3', 'lone.mp3', 'pic.png');
    const [orphan] = tracks('aud-orphan', 'orphan.mp3');
    thumbed.thumbRational = '/thumbed.webp';
    const covers = {[thumbed.absHref]: id3(3, frame(3, 'APIC', apic()))};
    await withPlayer(covers, ['blob:1', '/aud-cover/pic.png'], async ({revoked}) => {
        list(thumbed, lone, picture, orphan);
        press(thumbed, 'play');
        await settle();
        assert.equal(thumbed.embeddedCoverUrl, 'none', 'a cover that fails to load is forgotten');
        assert.equal($('#ap-cover-img').getAttribute('src'), '/thumbed.webp');

        press(lone, 'play');
        await settle();
        assert.ok($('#ap-cover-img').classList.contains('hidden'), 'the only image is broken');
        assert.ok($('#ap-cover-gradient').style.background.includes('linear-gradient'));

        press(orphan, 'play');
        await settle();
        assert.ok($('#ap-cover-img').classList.contains('hidden'), 'no image in the folder');
        assert.deepEqual(revoked, []);
    });
});

test('audio covers: a late cover stays with its own track', async () => {
    let release;
    const covers = {};
    await withPlayer(covers, [], async () => {
        const [x, y] = list(...tracks('aud-late', 'a.mp3', 'b.mp3'));
        covers[x.absHref] = () => new Promise(resolve => {
            release = () => resolve(id3(3, frame(3, 'APIC', apic())));
        });
        y.embeddedCoverUrl = 'blob:y';
        press(x, 'play');
        await settle();
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), y.label);

        release();
        await settle();
        assert.equal(x.embeddedCoverUrl, 'blob:1');
        assert.equal(y.embeddedCoverUrl, 'blob:y', 'the next track keeps its cover');
        assert.equal($('#ap-cover-img').getAttribute('src'), 'blob:y');
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

        press(outside, 'play');
        await settle();
        assert.deepEqual(queueNames(), ['outside.mp3'], 'a track outside the listing plays alone');

        a.$view.find('a')[0].click();
        await settle();
        assert.deepEqual(queueNames(), labels(listed), 'a listed track queues its folder');

        $('#aq-clear').click();
        press(c, 'next');
        await settle();
        assert.equal(trackName(), 'c.mp3', 'play next into an empty queue starts it');
        $('#aq-close').click();
        assert.equal($('#audio-queue-panel').classList.contains('active'), false);
    });
});

test('audio queue: the drawer jumps to and removes tracks', async () => {
    await withPlayer({}, [], async ({revoked}) => {
        const [x, y, z] = list(...tracks('aud-drawer', 'a.mp3', 'b.mp3', 'c.mp3'));
        x.embeddedCoverUrl = 'blob:x';
        press(x, 'play');
        await settle();
        $('#ap-queue-btn').click();

        $$('#aq-list-el .aq-item')[2].click();
        await settle();
        assert.equal(trackName(), z.label);

        $$('#aq-list-el .aq-item-remove')[0].click();
        assert.deepEqual(queueNames(), labels([y, z]));
        assert.deepEqual(revoked, ['blob:x'], 'the removed track releases its cover');
        assert.equal(trackName(), z.label, 'removing another track keeps playing');

        $$('#aq-list-el .aq-item-remove')[1].click();
        await settle();
        assert.equal(trackName(), y.label, 'removing the last current track wraps to the first');

        $$('#aq-list-el .aq-item-remove')[0].click();
        assert.deepEqual(queueNames(), []);
        assert.equal(barIsActive(), false);
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

        $('#ap-shuffle').click();
        const draws = [2 / 3, 0];
        Math.random = () => draws.shift();
        $('#ap-next').click();
        await settle();
        assert.equal(trackName(), x.label, 'shuffle redraws the current track');
        Math.random = () => 0.5;
        $('#ap-prev').click();
        await settle();
        assert.equal(trackName(), y.label);
    });
});

test('audio transport: blocked playback leaves the player paused', async () => {
    const [a] = tracks('aud-blocked', 'a.mp3');
    await withPlayer({}, [], async ({logged}) => {
        list(a);
        audio().play = () => Promise.reject(new Error('NotAllowedError'));
        press(a, 'play');
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
        press(x, 'play');
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
        press(a, 'play');
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
