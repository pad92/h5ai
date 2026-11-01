const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {flush} = require('../../../util/fresh');

// These tests drive the overlay that the item tests already mounted, so they
// share its DOM and must leave it closed.
const Item = reqlib('model/item');
const view = reqlib('view/view');
const event = reqlib('core/event');
const preview = reqlib('ext/preview/preview');
const {dom} = reqlib('util/dom');

const overlay = () => document.querySelector('#pv-overlay');
const isOpen = () => !overlay().classList.contains('hidden');
const isFullscreen = () => overlay().classList.contains('fullscreen');
const shown = () => document.querySelector('#pv-container').textContent;

const unloads = [];

// Opens a preview on the first of three items of a type nobody else handles.
const open = async (type, load) => {
    const items = ['one', 'two', 'three'].map(name => {
        const item = Item.get(`/pv-controls-${type}-${name}`);
        item.type = type;
        return item;
    });
    view.setItems(items);
    preview.register([type], load || (async item => {
        const $content = dom('<div class="pv-controls"></div>').text(item.label);
        $content[0].unload = () => unloads.push(item.label);
        return $content;
    }));
    event.pub('view.changed', items, []);
    items[0].$view.find('a')[0].click();
    await flush();
    return items;
};

const close = () => {
    if (isOpen()) {
        document.querySelector('#pv-bar-close').click();
    }
    preview.setControlType('default');
};

const key = (init, target = window) => {
    const ev = new window.KeyboardEvent('keydown', Object.assign({bubbles: true, cancelable: true}, init));
    target.dispatchEvent(ev);
    return ev;
};

const touch = (type, target, points) => {
    const ev = new window.Event(type, {bubbles: true, cancelable: true});
    Object.defineProperty(ev, 'changedTouches', {value: points.map(([pageX, pageY]) => ({pageX, pageY}))});
    target.dispatchEvent(ev);
    return ev;
};

// Runs a gesture with a fixed clock so its speed does not depend on the host.
const withClock = async run => {
    const now = Date.now;
    let time = 1000000;
    Date.now = () => time;
    try {
        await run(ms => { time += ms; });
    } finally {
        Date.now = now;
    }
};

test('preview keys: Backspace and Enter step back and forth, and wrap around', async () => {
    const items = await open('pvc-keys');
    try {
        const ev = key({key: 'Backspace', keyCode: 8});
        assert.equal(ev.defaultPrevented, true);
        await flush();
        assert.equal(preview.item, items[2], 'stepping back from the first wraps to the last');

        key({key: 'Enter', keyCode: 13});
        await flush();
        assert.equal(preview.item, items[0]);
        assert.deepEqual(unloads.slice(-2), ['pv-controls-pvc-keys-one', 'pv-controls-pvc-keys-three']);
    } finally {
        close();
    }
});

test('preview keys: typing in a form field does not drive the preview', async () => {
    const items = await open('pvc-input');
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
        const ev = key({key: 'ArrowRight', keyCode: 39}, input);
        await flush();
        assert.equal(ev.defaultPrevented, false);
        assert.equal(preview.item, items[0]);
        assert.equal(isOpen(), true);
    } finally {
        input.remove();
        close();
    }
});

test('preview keys: video controls step with comma and period and leave space to the player', async () => {
    const items = await open('pvc-video');
    preview.setControlType('vid');
    try {
        key({key: 'ArrowRight', keyCode: 39});
        await flush();
        assert.equal(preview.item, items[1], 'ArrowRight is still next');

        key({key: '.', keyCode: 190});
        await flush();
        assert.equal(preview.item, items[2]);
        key({key: ',', keyCode: 188});
        await flush();
        assert.equal(preview.item, items[1]);

        const space = key({key: ' ', keyCode: 32});
        assert.equal(space.defaultPrevented, false, 'space is left to the player');

        const before = isFullscreen();
        key({key: 'F', keyCode: 70});
        assert.equal(isFullscreen(), !before);
        key({key: 'f', keyCode: 70});
        assert.equal(isFullscreen(), before);

        key({key: 'Escape', keyCode: 27});
        assert.equal(isOpen(), false);
    } finally {
        close();
    }
});

test('preview touch: horizontal swipes step through items', async () => {
    const items = await open('pvc-swipe');
    const container = document.querySelector('#pv-container');
    try {
        await withClock(async tick => {
            touch('touchstart', container, [[300, 100]]);
            touch('touchmove', document, [[200, 110]]);
            tick(100);
            const end = touch('touchend', document, [[200, 110]]);
            assert.equal(end.defaultPrevented, true);
            await flush();
            assert.equal(preview.item, items[1], 'a left swipe shows the next item');

            tick(1000);
            touch('touchstart', container, [[100, 100]]);
            touch('touchmove', document, [[200, 90]]);
            touch('touchend', document, [[200, 90]]);
            await flush();
            assert.equal(preview.item, items[0], 'a right swipe shows the previous item');

            tick(1000);
            touch('touchstart', container, [[100, 100]]);
            touch('touchmove', document, [[110, 300]]);
            touch('touchend', document, [[110, 300]]);
            await flush();
            assert.equal(preview.item, items[0], 'a vertical swipe does nothing');

            tick(1000);
            touch('touchstart', container, [[100, 100]]);
            touch('touchmove', document, [[300, 100], [0, 0]]);
            touch('touchend', document, [[300, 100]]);
            await flush();
            assert.equal(preview.item, items[0], 'a pinch is not a swipe');

            tick(1000);
            touch('touchstart', container, [[100, 100]]);
            touch('touchmove', document, [[300, 100]]);
            tick(500);
            touch('touchend', document, [[300, 100]]);
            await flush();
            assert.equal(preview.item, items[0], 'a slow drag is not a swipe');
        });
    } finally {
        close();
    }
});

test('preview touch: a double tap toggles fullscreen', async () => {
    await open('pvc-tap');
    const container = document.querySelector('#pv-container');
    const before = isFullscreen();
    try {
        await withClock(async tick => {
            touch('touchstart', container, [[100, 100]]);
            touch('touchend', document, [[100, 100]]);
            tick(100);
            touch('touchstart', container, [[102, 101]]);
            touch('touchend', document, [[102, 101]]);
            assert.equal(isFullscreen(), !before);

            tick(1000);
            touch('touchstart', container, [[100, 100]]);
            touch('touchend', document, [[100, 100]]);
            assert.equal(isFullscreen(), !before, 'taps far apart in time are not a double tap');

            tick(100);
            touch('touchstart', container, [[100, 100]]);
            touch('touchend', document, [[100, 100]]);
        });
        assert.equal(isFullscreen(), before);
    } finally {
        close();
    }
});

test('preview: images open fullscreen and leave room for the bar when reduced', async () => {
    await open('img-pvc');
    try {
        assert.equal(isFullscreen(), true, 'images open fullscreen');
        document.querySelector('#pv-bar-fullscreen').click();
        assert.equal(isFullscreen(), false);
        // Fullscreen is now stored as off, which is the default the other tests expect.
        const container = document.querySelector('#pv-container');
        const html = document.documentElement;
        assert.equal(container.style.left, Math.round(html.clientWidth * 0.1) + 'px');
        assert.equal(container.style.top, Math.round(html.clientHeight * 0.1) + 'px');
    } finally {
        close();
    }
});

test('preview: a slow item shows the spinner over its thumbnail, and a click outside closes', async () => {
    let finish;
    const items = await open('pvc-slow', item => {
        if (item.label.endsWith('one')) {
            return dom('<div></div>').text(item.label);
        }
        return new Promise(resolve => {
            finish = () => resolve(dom('<div></div>').text(item.label));
        });
    });
    items[1].thumbRational = '/thumb-two.webp';
    const spinner = document.querySelector('#pv-spinner');
    try {
        document.querySelector('#pv-bar-next').click();
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(spinner.classList.contains('hidden'), false, 'shown after its delay');
        assert.equal(spinner.querySelector('.back').getAttribute('src'), '/thumb-two.webp');

        finish();
        await flush();
        assert.equal(spinner.classList.contains('hidden'), true);
        assert.equal(shown(), 'pv-controls-pvc-slow-two');

        overlay().click();
        assert.equal(isOpen(), false);
    } finally {
        close();
    }
});
