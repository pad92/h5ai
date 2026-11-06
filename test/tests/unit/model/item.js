const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {drain} = require('../../../util/fresh');
const config = reqlib('config');

config.setup = {PUBLIC_HREF: '/', ROOT_HREF: '/'};
config.theme = {};
config.types = {
    'txt-md': {glob: ['*.md']},
    image: {glob: ['*.png', '*.jpg']}
};
Object.defineProperty(document, 'domain', {configurable: true, value: 'localhost'});

const Item = reqlib('model/item');
const location = reqlib('core/location');
const view = reqlib('view/view');
const store = reqlib('core/store');
reqlib('view/viewmode');
reqlib('ext/crumb');
reqlib('ext/title');
reqlib('ext/theme');
reqlib('ext/info');
reqlib('ext/tree');

class FakeAudio {
    constructor() {
        this.listeners = {};
        this.paused = true;
        this.volume = 1;
        this.muted = false;
        this.currentTime = 0;
        this.duration = 180;
        window.__audioPlayer = this;
    }

    addEventListener(type, listener) {
        this.listeners[type] = listener;
    }

    emit(type) {
        if (this.listeners[type]) this.listeners[type]();
    }

    play() {
        this.paused = false;
        this.emit('play');
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
        this.emit('pause');
    }

    load() {}

    canPlayType() {
        return 'maybe';
    }
}

window.Audio = FakeAudio;
reqlib('ext/player');
reqlib('ext/download');
reqlib('ext/search');
const preview = reqlib('ext/preview/preview');
reqlib('ext/preview/preview-img');
reqlib('ext/preview/preview-vid');
reqlib('ext/select');
reqlib('ext/sort');

test('item model builds cached hierarchy, labels, types and statistics', () => {
    const root = Item.get('/');
    const folder = Item.get('/photos/');
    const image = Item.get('/photos/a%20photo.JPG');
    const markdown = Item.get('/README.md');

    assert.equal(Item.get('/photos/'), folder);
    assert.equal(root.isDomain(), true);
    assert.equal(folder.isFolder(), true);
    assert.equal(folder.type, 'folder');
    assert.equal(folder.parent, root);
    assert.equal(image.label, 'a photo.JPG');
    assert.equal(image.type, 'image');
    assert.equal(image.parent, folder);
    assert.equal(markdown.type, 'txt-md');
    assert.deepEqual(folder.getStats(), {folders: 0, files: 1, depth: 1});
    assert.deepEqual(root.getStats(), {folders: 1, files: 1, depth: 0});
    assert.deepEqual(folder.getSubfolders(), []);
    assert.deepEqual(markdown.getCrumb().map(item => item.absHref), ['/', '/README.md']);
});

test('item model: a listing sets or clears the expired size flag, an href alone keeps it', () => {
    const folder = Item.get({href: '/stale-flag/', size: 5, sizeStale: true});
    assert.equal(folder.isSizeStale, true);
    assert.equal(Item.get('/stale-flag/').isSizeStale, true, 'an href alone carries no size');
    Item.get({href: '/stale-flag/', size: 7});
    assert.equal(folder.isSizeStale, false, 'a size without the flag is up to date');
    Item.get({href: '/stale-flag/', size: null, sizeStale: true});
    assert.equal(folder.isSizeStale, true);
});

test('item model rejects paths outside root and removes cached descendants', () => {
    const parent = Item.get('/remove-me/');
    const child = Item.get('/remove-me/child.txt');
    assert.equal(Item.get('outside.txt'), null);
    Item.remove(parent.absHref);
    const restored = Item.get('/remove-me/child.txt');
    assert.notEqual(restored, child);
    assert.equal(restored.parent.content[restored.absHref], restored);
    assert.equal(location.getDomain(), document.domain);
});

test('directory view renders, replaces, incrementally changes, and updates item rows', () => {
    const folder = Item.get('/view-folder/');
    const first = Item.get('/view-folder/first.txt', {size: 10, time: 1700000000000});
    const second = Item.get('/view-folder/second.txt', {size: 20, time: 1700000000000});
    folder.content[first.absHref] = first;
    first.parent = folder;

    view.setItems([first]);
    assert.equal(document.querySelectorAll('#items .item').length, 1);
    assert.equal(first.$view.find('.label')[0].textContent, 'first.txt');

    view.changeItems([second], [first]);
    assert.equal(document.querySelectorAll('#items .item').length, 1);
    assert.equal(second.$view.find('.label')[0].textContent, 'second.txt');

    view.setLocation(folder);
    assert.equal(document.querySelectorAll('#items .item').length, 3);
    second.size = 42;
    second.time = 1800000000000;
    reqlib('core/event').pub('location.refreshed', folder, [], [], [second]);
    assert.equal(second.$view.find('.size').attr('data-bytes'), '42');
    assert.equal(second.$view.find('.date').attr('data-time'), '1800000000000');
    assert.equal(second.$view.find('.size').hasCls('stale'), false);
    second.isSizeStale = true;
    reqlib('core/event').pub('location.refreshed', folder, [], [], [second]);
    assert.equal(second.$view.find('.size').hasCls('stale'), true, 'an expired size blinks');
    second.isSizeStale = false;
    reqlib('core/event').pub('location.refreshed', folder, [], [], [second]);
    assert.equal(second.$view.find('.size').hasCls('stale'), false, 'a recomputed size stops blinking');
    view.setHint('noMatch');
    assert.equal(view.getModes().includes(view.getMode()), true);
    view.setMode('grid');
    assert.equal(view.getMode(), 'grid');
    view.setSize(80);
    assert.equal(view.getSize(), 80);

    const ten = Item.get('/view-folder/file10.txt');
    const two = Item.get('/view-folder/file2.txt');
    view.setItems([ten, two]);
    assert.equal(document.querySelector('#items .item .label').textContent, 'file2.txt');
    document.querySelector('#items li.header a.label').click();
    assert.equal(document.querySelector('#items .item .label').textContent, 'file10.txt');
});

test('view mode controls cycle modes and update the selected size', () => {
    const current = view.getMode();
    document.querySelector('#viewmode-toggle').click();
    assert.notEqual(view.getMode(), current);
    document.querySelector('#viewmode-grid').click();
    assert.equal(view.getMode(), 'grid');
    const size = document.querySelector('#viewmode-size');
    size.value = '2';
    size.dispatchEvent(new window.Event('input', {bubbles: true}));
    assert.equal(view.getSize(), 80);
    assert.equal(document.querySelector('#viewmode-grid').classList.contains('active'), true);
});

const pressed = el => el.getAttribute('aria-pressed');

test('sidebar: each view mode is a keyboard button that announces the current mode', () => {
    const initial = view.getMode();
    const modes = view.getModes();
    assert.ok(modes.length > 1, 'the test config offers several modes');
    try {
        modes.forEach(mode => {
            const el = document.getElementById('viewmode-' + mode);
            assert.equal(el.tagName, 'BUTTON', `${mode} reaches the keyboard`);
            assert.equal(el.getAttribute('type'), 'button', `${mode} never submits a form`);
        });
        modes.forEach(mode => {
            view.setMode(mode);
            modes.forEach(other => {
                assert.equal(pressed(document.getElementById('viewmode-' + other)), String(other === mode),
                    `${other} pressed while ${mode} shows`);
            });
        });
    } finally {
        view.setMode(initial);
    }
});

test('sidebar: the size slider is named by a visible label', () => {
    const input = document.getElementById('viewmode-size');
    assert.ok(input, 'the slider is there');
    const label = document.querySelector('label[for="viewmode-size"]');
    assert.ok(label && label.textContent.trim(), 'a label names the slider');
});

test('sidebar: the tree and info toggles announce whether their panel shows', () => {
    [['view-tree', 'ext/tree', 'tree'], ['view-info', 'ext/info', 'info']].forEach(([id, key, panel]) => {
        const el = document.getElementById(id);
        const initial = store.get(key);
        assert.equal(el.tagName, 'BUTTON', `${id} reaches the keyboard`);
        try {
            [0, 1].forEach(() => {
                el.click();
                const shown = store.get(key) === true;
                assert.equal(pressed(el), String(shown), `${id} matches the stored state`);
                assert.equal(!document.getElementById(panel).classList.contains('hidden'), shown,
                    `${id} matches the ${panel} panel`);
            });
        } finally {
            if (store.get(key) !== initial) {
                el.click();
            }
        }
    });
});

test('crumbs and document title follow the active item hierarchy', () => {
    const folder = Item.get('/crumb-folder/');
    const child = Item.get('/crumb-folder/file.txt');
    reqlib('core/event').pub('location.changed', child);
    assert.equal(document.title, 'file.txt - localhost > crumb-folder > file.txt');
    assert.equal(document.querySelectorAll('#crumbbar .crumb').length, 3);
    assert.equal(document.querySelector('#crumbbar .crumb:last-child .label').textContent, 'file.txt');

    reqlib('core/event').pub('location.changed', folder);
    assert.equal(document.title, 'crumb-folder - localhost > crumb-folder');
});

test('theme toggle supports mouse and keyboard input', () => {
    const theme = document.querySelector('#theme');
    theme.click();
    assert.equal(document.body.getAttribute('data-theme'), 'dark');
    assert.equal(theme.getAttribute('aria-pressed'), 'true');
    theme.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
    assert.equal(document.body.getAttribute('data-theme'), 'light');
    assert.equal(theme.getAttribute('aria-pressed'), 'false');
});

test('information panel follows directory and hovered item events', () => {
    const folder = Item.get('/information-folder/');
    const file = Item.get('/information-folder/file.txt');
    file.size = 512;
    file.time = 1700000000000;
    folder.content[file.absHref] = file;
    folder.isContentFetched = true;
    reqlib('core/event').pub('location.changed', folder);
    assert.equal(document.querySelector('#info .label').textContent, 'information-folder');
    assert.equal(document.querySelector('#info .content').classList.contains('hidden'), false);

    reqlib('core/event').pub('item.mouseenter', file);
    assert.equal(document.querySelector('#info .label').textContent, 'file.txt');
    assert.equal(document.querySelector('#info .size').textContent, '512 B');
    reqlib('core/event').pub('item.mouseleave', file);
    assert.equal(document.querySelector('#info .label').textContent, 'information-folder');

    document.querySelector('#view-info').click();
    assert.equal(document.querySelector('#view-info').classList.contains('active'), true);
    reqlib('core/event').pub('theme.changed', 'dark');
});

test('tree extension renders hierarchy, expands fetched folders, and toggles visibility', async () => {
    const root = Item.get('/');
    const folder = Item.get('/tree-folder/');
    const childFolder = Item.get('/tree-folder/sub/');
    root.isContentFetched = true;
    folder.isContentFetched = false;
    folder.isManaged = true;
    folder.content[childFolder.absHref] = childFolder;
    childFolder.parent = folder;
    root.content[folder.absHref] = folder;
    folder.fetchContent = async () => {
        folder.isContentFetched = true;
        return folder;
    };

    reqlib('core/event').pub('location.changed', root);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(document.querySelector('#tree .label'));
    const row = Array.from(document.querySelectorAll('#tree .item')).find(el => el._item === folder);
    assert.ok(row);
    row.querySelector('.indicator').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(folder._treeState, 'open');
    assert.ok(folder._$tree[0].classList.contains('open'));
    document.querySelector('#view-tree').click();
    assert.equal(document.querySelector('#view-tree').classList.contains('active'), false);
});

test('audio player queues tracks and responds to transport, seek, volume, and close controls', async () => {
    const originalFetch = window.fetch;
    const originalImage = window.Image;
    const createObjectURL = window.URL.createObjectURL;
    const frameData = Uint8Array.from([0, 105, 109, 97, 103, 101, 47, 106, 112, 101, 103, 0, 3, 0,
        0xff, 0xd8, ...new Array(12).fill(1)]);
    const tag = new Uint8Array(20 + frameData.length);
    tag.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0], 0);
    const frame = 10;
    tag.set([0x41, 0x50, 0x49, 0x43], frame);
    new DataView(tag.buffer).setUint32(frame + 4, frameData.length);
    tag.set(frameData, frame + 10);
    const tagSize = tag.length - 10;
    tag.set([0, 0, 0, tagSize], 6);
    Object.defineProperty(window.URL, 'createObjectURL', {configurable: true, value: () => 'blob:cover-art'});
    window.Image = class FakeImage {
        set src(value) {
            this._src = value;
            window.setTimeout(() => this.onload && this.onload(), 0);
        }
    };
    window.fetch = async href => ({
        ok: true,
        status: 206,
        arrayBuffer: async () => href.endsWith('cover.mp3') ? tag.buffer : new Uint8Array(10).buffer
    });
    try {
        const first = Item.get('/audio-one.mp3');
        const second = Item.get('/audio-two.mp3');
        const cover = Item.get('/cover.mp3');
        first.type = 'aud';
        second.type = 'aud';
        cover.type = 'aud';
        view.setItems([first, second, cover]);

        first.$view.find('.ap-row-folder')[0].click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(document.querySelector('#ap-track-name-el').textContent, 'audio-one.mp3');
        assert.equal(document.querySelector('#audio-player-bar').classList.contains('active'), true);
        assert.equal(first.$view.hasCls('ap-active-playing'), true);

        document.querySelector('#ap-play-pause').click();
        assert.equal(first.$view.hasCls('ap-active-paused'), true);
        document.querySelector('#ap-play-pause').click();
        document.querySelector('#ap-next').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(document.querySelector('#ap-track-name-el').textContent, 'cover.mp3');

        cover.$view.find('.ap-row-folder')[0].click();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(document.querySelector('#ap-cover-img').getAttribute('src'), 'blob:cover-art');
        const audio = window.__audioPlayer;
        audio.currentTime = 42;
        audio.emit('durationchange');
        audio.emit('timeupdate');
        assert.equal(document.querySelector('#ap-time-dur').textContent, '3:00');
        assert.equal(document.querySelector('#ap-time-cur').textContent, '0:42');
        document.querySelector('#ap-prev').click();
        assert.equal(audio.currentTime, 0);

        const seek = document.querySelector('#ap-seek');
        seek.value = '50';
        seek.dispatchEvent(new window.Event('input', {bubbles: true}));
        seek.dispatchEvent(new window.Event('change', {bubbles: true}));
        document.querySelector('#ap-volume').value = '25';
        document.querySelector('#ap-volume').dispatchEvent(new window.Event('input', {bubbles: true}));
        document.querySelector('#ap-volume-btn').click();
        document.querySelector('#ap-shuffle').click();
        document.querySelector('#ap-repeat').click();
        document.querySelector('#ap-queue-btn').click();
        assert.equal(document.querySelectorAll('#aq-list-el .aq-item').length, 3);
        document.querySelector('#ap-close-btn').click();
        assert.equal(document.querySelector('#audio-player-bar').classList.contains('active'), false);
    } finally {
        window.fetch = originalFetch;
        window.Image = originalImage;
        if (createObjectURL) Object.defineProperty(window.URL, 'createObjectURL', {configurable: true, value: createObjectURL});
        else delete window.URL.createObjectURL;
    }
});

test('task indicator renders server and thumbnail progress and stops polling when idle', async () => {
    const server = reqlib('server');
    const originalRequest = server.request;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    const callbacks = [];
    let response = {tasks: [{id: 'warmer', percent: null, remaining: null}]};
    server.request = async () => response;
    window.setTimeout = callback => {
        callbacks.push(callback);
        return callbacks.length;
    };
    window.clearTimeout = () => {};
    Object.defineProperty(document, 'hidden', {configurable: true, value: false});

    try {
        reqlib('ext/tasks');
        callbacks.shift()();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(document.querySelector('#tasks').classList.contains('hidden'), false);
        assert.equal(document.querySelector('[data-task="warmer"]').classList.contains('indeterminate'), true);

        document.querySelector('#tasks').dispatchEvent(new window.Event('mouseenter'));
        assert.equal(document.querySelector('#tasks-panel').classList.contains('hidden'), false);
        reqlib('core/event').pub('thumbs.progress', {done: 1, total: 2});
        assert.equal(document.querySelector('[data-task="thumbs"]').classList.contains('hidden'), false);

        response = {tasks: []};
        callbacks.at(-1)();
        await new Promise(resolve => setImmediate(resolve));
        reqlib('core/event').pub('thumbs.progress', {done: 2, total: 2});
        assert.equal(document.querySelector('[data-task="thumbs"]').classList.contains('hidden'), true);
        assert.equal(document.querySelector('#tasks').classList.contains('hidden'), true);
    } finally {
        server.request = originalRequest;
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
        if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
        else delete document.hidden;
    }
});

test('preview overlay opens items, navigates, toggles fullscreen, and closes', async () => {
    const first = Item.get('/preview-first.txt');
    const second = Item.get('/preview-second.txt');
    first.type = 'txt';
    second.type = 'txt';
    view.setItems([first, second]);
    preview.register(['txt'], async item => {
        const {dom} = require('../../../../src/_h5ai/public/js/lib/util/dom');
        return dom('<div class="preview-content"></div>').text(item.label);
    });
    reqlib('core/event').pub('view.changed', [first, second], []);

    first.$view.find('a')[0].click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(preview.item, first);
    assert.equal(document.querySelector('#pv-overlay').classList.contains('hidden'), false);
    assert.equal(document.querySelector('#pv-container').textContent, 'preview-first.txt');

    window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'ArrowRight', keyCode: 39, bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(preview.item, second);
    assert.equal(document.querySelector('#pv-container').textContent, 'preview-second.txt');

    window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'f', keyCode: 70, bubbles: true}));
    assert.equal(document.querySelector('#pv-overlay').classList.contains('fullscreen'), true);
    window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', keyCode: 27, bubbles: true}));
    assert.equal(document.querySelector('#pv-overlay').classList.contains('hidden'), true);
});

test('text preview fetches content and shows a useful message for HTTP failures', async () => {
    const OriginalXHR = window.XMLHttpRequest;
    class FakeXHR {
        static DONE = 4;

        open(method, href) {
            this.href = href;
        }

        send() {
            this.readyState = FakeXHR.DONE;
            this.status = FakeXHR.status;
            this.responseText = FakeXHR.body;
            this.onreadystatechange();
        }
    }
    FakeXHR.status = 200;
    FakeXHR.body = '<plain> text';
    window.XMLHttpRequest = FakeXHR;
    try {
        reqlib('ext/preview/preview-txt');
        const item = Item.get('/preview-text.txt');
        item.type = 'txt';
        view.setItems([item]);
        item.$view.find('a')[0].click();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(document.querySelector('#pv-content-txt').textContent, '<plain> text');
        document.querySelector('#pv-bar-close').click();

        FakeXHR.status = 404;
        const missing = Item.get('/preview-missing.txt');
        missing.type = 'txt';
        view.setItems([missing]);
        missing.$view.find('a')[0].click();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(document.querySelector('#pv-content-txt').textContent, '[request failed] HTTP 404');
        document.querySelector('#pv-bar-close').click();
    } finally {
        window.XMLHttpRequest = OriginalXHR;
    }
});

test('thumbnail extension batches requests and reports progress as item types update', async () => {
    const server = reqlib('server');
    const originalRequest = server.request;
    const calls = [];
    const progress = [];
    const onProgress = value => progress.push(value);
    server.request = async query => {
        calls.push(query);
        return {thumbs: query.thumbs.map(() => null), filetypes: query.thumbs.map(() => 'txt')};
    };

    try {
        const items = ['/thumb-a.png', '/thumb-b.txt', '/thumb-c.png'].map(href => Item.get(href));
        items[0].type = 'img';
        items[1].type = 'file';
        items[2].type = 'img-png';
        view.setItems(items);
        reqlib('ext/thumbnails');
        reqlib('core/event').sub('thumbs.progress', onProgress);
        reqlib('core/event').pub('view.changed', items, []);
        await new Promise(resolve => setTimeout(resolve, 10));

        assert.equal(calls.length, 2);
        assert.equal(calls[0].thumbs.length, 2);
        assert.equal(calls[1].thumbs.length, 1);
        assert.equal(calls[1].thumbs[0].type, 'blocked');
        assert.equal(items.every(item => item.type === 'txt'), true);
        assert.equal(progress[0].total, 3);
        assert.equal(progress.at(-1).done, 3);
        assert.equal(progress.at(-1).total, 3);
        reqlib('core/event').unsub('thumbs.progress', onProgress);
    } finally {
        server.request = originalRequest;
    }
});

test('image preview loads the original image and closes its EXIF request cleanly', async () => {
    const item = Item.get('/preview-image.jpg');
    item.type = 'img';
    view.setItems([item]);
    const OriginalXHR = window.XMLHttpRequest;
    const imageProto = window.Element.prototype;
    const originalSetAttribute = imageProto.setAttribute;
    class FakeXHR {
        open() {}

        setRequestHeader() {}

        send() {
            this.status = 206;
            this.response = new ArrayBuffer(0);
            this.onload();
        }
    }
    window.XMLHttpRequest = FakeXHR;
    imageProto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-img' && name === 'src') {
            const image = this;
            window.setTimeout(() => image.dispatchEvent(new window.Event('load')), 0);
        }
    };
    try {
        item.$view.find('a')[0].click();
        await drain();
        assert.equal(preview.item, item);
        const image = document.querySelector('#pv-content-img');
        assert.ok(image);
        image.dispatchEvent(new window.Event('load'));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(preview.item, item);
        assert.equal(document.querySelector('#pv-container img').getAttribute('src'), item.absHref);
        document.querySelector('#pv-bar-close').click();
        assert.equal(document.querySelector('#pv-overlay').classList.contains('hidden'), true);
    } finally {
        window.XMLHttpRequest = OriginalXHR;
        imageProto.setAttribute = originalSetAttribute;
    }
});

test('video preview uses native and isolated-player paths with subtitle tracks', async () => {
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    const mediaProto = window.HTMLMediaElement.prototype;
    const originalRemote = Object.getOwnPropertyDescriptor(mediaProto, 'remote');
    let availability;
    let prompted = 0;
    let canceled = 0;
    Object.defineProperty(mediaProto, 'remote', {configurable: true, get: () => ({
        prompt: () => { prompted += 1; return Promise.resolve(); },
        watchAvailability: callback => {
            availability = callback;
            return Promise.resolve(7);
        },
        cancelWatchAvailability: id => {
            assert.equal(id, 7);
            canceled += 1;
            return Promise.resolve();
        }
    })});
    const imageProto = window.Element.prototype;
    const originalSetAttribute = imageProto.setAttribute;
    imageProto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-vid' && name === 'src') {
            const video = this;
            window.setTimeout(() => video.dispatchEvent(new window.Event('loadedmetadata')), 0);
        }
    };

    try {
        const native = Item.get('/native-video.mp4');
        native.type = 'vid';
        view.setItems([native]);
        Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: false});
        native.$view.find('a')[0].click();
        await drain();
        assert.equal(document.querySelector('#pv-content-vid').tagName, 'VIDEO');
        assert.equal(preview.controlsType, 'vid');
        const cast = document.querySelector('#pv-bar-cast');
        assert.ok(cast.classList.contains('hidden'), 'the cast control waits for an available device');
        availability(true);
        assert.equal(cast.classList.contains('hidden'), false);
        cast.click();
        assert.equal(prompted, 1);
        document.querySelector('#pv-bar-close').click();
        assert.equal(canceled, 1, 'closing the preview stops device availability monitoring');

        const folder = Item.get('/movi-folder/');
        const movi = Item.get('/movi-folder/movie.mp4');
        const subtitles = Item.get('/movi-folder/movie.fr.srt');
        movi.type = 'vid';
        folder.content[movi.absHref] = movi;
        folder.content[subtitles.absHref] = subtitles;
        movi.parent = folder;
        subtitles.parent = folder;
        window.customElements.define('movi-player', class extends window.HTMLElement {
            constructor() {
                super();
                this.attachShadow({mode: 'open'});
                this.shadowRoot.appendChild(document.createElement('video'));
            }

            addControl(control) {
                // Movi 0.4.1 MoviControlSpec.placement: one surface, a list of
                // surfaces, or "both".
                const surfaces = ['bar', 'center', 'menu', 'top'];
                const placement = control.placement;
                assert.ok(placement === 'both' || surfaces.includes(placement) ||
                    Array.isArray(placement) && placement.length > 0 && placement.every(p => surfaces.includes(p)),
                'placement is one Movi knows');
                assert.ok(['video', 'audio', 'both'].includes(control.media));
                this.castControl = control;
            }

            removeControl(id) {
                assert.equal(id, 'h5ai-cast');
                this.castControl = null;
            }
        });
        Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: true});
        view.setItems([movi]);
        movi.$view.find('a')[0].click();
        await drain();
        const player = document.querySelector('#pv-content-vid');
        assert.equal(player.tagName.toLowerCase(), 'movi-player');
        assert.equal(player.getAttribute('engine'), null, 'Movi keeps its own engine order by default');
        const engineVideo = player.shadowRoot.querySelector('video');
        availability(true);
        assert.equal(player.castControl, undefined, 'the WASM engine leaves the shadow <video> empty: nothing to cast');
        engineVideo.setAttribute('src', movi.absHref);
        engineVideo.dispatchEvent(new window.Event('loadstart'));
        assert.equal(player.castControl.label, 'Cast to a device', 'Cast is placed in Movi controls once it plays natively');
        player.castControl.onSelect();
        assert.equal(prompted, 2);
        engineVideo.removeAttribute('src');
        engineVideo.dispatchEvent(new window.Event('emptied'));
        assert.equal(player.castControl, null, 'switching back to WASM removes the control');
        engineVideo.setAttribute('src', movi.absHref);
        engineVideo.dispatchEvent(new window.Event('loadstart'));
        assert.ok(player.castControl);
        assert.equal(player.querySelector('track').getAttribute('srclang'), 'fr');
        assert.equal(player.querySelector('track').getAttribute('label'), 'FR');
        document.querySelector('#pv-bar-close').click();
        assert.equal(player.castControl, null, 'closing the preview removes the Movi control');
        assert.equal(canceled, 2);
    } finally {
        imageProto.setAttribute = originalSetAttribute;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
        if (originalRemote) Object.defineProperty(mediaProto, 'remote', originalRemote);
        else delete mediaProto.remote;
    }
});

test('video preview: the engine option orders Movi\'s engines, known names only', async () => {
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    const allsettings = reqlib('core/settings');
    const savedVid = allsettings['preview-vid'];
    const movie = Item.get('/engine-folder/movie.mp4');
    movie.type = 'vid';
    const engineFor = async value => {
        allsettings['preview-vid'] = Object.assign({}, savedVid, {engine: value});
        view.setItems([movie]);
        movie.$view.find('a')[0].click();
        await drain();
        const player = document.querySelector('#pv-content-vid');
        assert.equal(player.tagName.toLowerCase(), 'movi-player');
        const engine = player.getAttribute('engine');
        document.querySelector('#pv-bar-close').click();
        return engine;
    };
    try {
        Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: true});
        assert.equal(await engineFor('native wasm'), 'native wasm', 'the browser first, for casting');
        assert.equal(await engineFor('  native\tnative bogus wasm "><x '), 'native wasm', 'unknown names and repeats are dropped');
        assert.equal(await engineFor('"><script>'), null, 'nothing valid: Movi\'s own order');
        assert.equal(await engineFor(''), null);
        assert.equal(await engineFor(42), null, 'not a string');
    } finally {
        allsettings['preview-vid'] = savedVid;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
    }
});

test('video cast button: keyboard, availability races, failures and AirPlay', async () => {
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    const mediaProto = window.HTMLMediaElement.prototype;
    const originalRemote = Object.getOwnPropertyDescriptor(mediaProto, 'remote');
    const tick = drain;
    const castButton = () => document.querySelector('#pv-bar-cast');
    const close = () => document.querySelector('#pv-bar-close').click();
    const first = Item.get('/cast/first.mp4');
    const second = Item.get('/cast/second.mp4');
    first.type = 'vid';
    second.type = 'vid';
    let remote;
    Object.defineProperty(mediaProto, 'remote', {configurable: true, get: () => remote});
    const elementProto = window.Element.prototype;
    const originalSetAttribute = elementProto.setAttribute;
    let metadata = true;
    elementProto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-vid' && name === 'src' && metadata) {
            const video = this;
            window.setTimeout(() => video.dispatchEvent(new window.Event('loadedmetadata')), 0);
        }
    };

    try {
        Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: false});
        view.setItems([first, second]);

        // Enter and Space on the button cast; they must not reach the
        // preview's window handler, where Enter means "next item".
        let availability;
        let prompted = 0;
        remote = {
            prompt: () => { prompted += 1; return Promise.resolve(); },
            watchAvailability: callback => { availability = callback; return Promise.resolve(1); },
            cancelWatchAvailability: () => Promise.resolve()
        };
        first.$view.find('a')[0].click();
        await tick();
        availability(true);
        castButton().dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
        castButton().dispatchEvent(new window.KeyboardEvent('keydown', {key: ' ', keyCode: 32, bubbles: true}));
        assert.equal(prompted, 2);
        assert.equal(preview.item, first, 'Enter on the cast button stays on the same video');
        document.body.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
        await tick();
        assert.equal(preview.item, second, 'Enter elsewhere still steps to the next item');
        close();
        assert.equal(castButton(), null);

        // The preview closes before the browser registers the watch: the
        // late id is still canceled, and a late callback changes nothing.
        let resolveWatch;
        const canceled = [];
        remote = {
            prompt: () => Promise.resolve(),
            watchAvailability: callback => {
                availability = callback;
                return new Promise(resolve => { resolveWatch = resolve; });
            },
            cancelWatchAvailability: id => { canceled.push(id); return Promise.resolve(); }
        };
        first.$view.find('a')[0].click();
        await tick();
        close();
        assert.deepEqual(canceled, []);
        resolveWatch(42);
        await tick();
        assert.deepEqual(canceled, [42], 'a watch registered after closing is canceled');

        // Availability cannot be monitored (Chrome on Android): show the button.
        remote = {
            prompt: () => Promise.resolve(),
            watchAvailability: () => Promise.reject(new window.DOMException('unsupported', 'NotSupportedError'))
        };
        first.$view.find('a')[0].click();
        await tick();
        assert.equal(castButton().classList.contains('hidden'), false);
        close();

        // A video dropped before it is attached never gets a button: nothing
        // would unload it, and it would stay in the bar with a live watch.
        metadata = false;
        let watched = 0;
        remote = {
            prompt: () => Promise.resolve(),
            watchAvailability: () => { watched += 1; return Promise.resolve(3); }
        };
        first.$view.find('a')[0].click();
        await tick();
        assert.equal(document.querySelector('#pv-container #pv-content-vid'), null, 'still loading');
        close();
        assert.equal(castButton(), null);
        assert.equal(watched, 0);
        metadata = true;

        // No route at all (Firefox): no button.
        remote = undefined;
        first.$view.find('a')[0].click();
        await tick();
        assert.equal(castButton(), null);
        close();

        // Safari without Remote Playback: the AirPlay event drives the button.
        let picked = 0;
        const listeners = new Map();
        const originalAdd = mediaProto.addEventListener;
        const originalRemove = mediaProto.removeEventListener;
        mediaProto.webkitShowPlaybackTargetPicker = () => { picked += 1; };
        mediaProto.addEventListener = function addEventListener(type, fn, opts) {
            if (type === 'webkitplaybacktargetavailabilitychanged') listeners.set(fn, this);
            return originalAdd.call(this, type, fn, opts);
        };
        mediaProto.removeEventListener = function removeEventListener(type, fn, opts) {
            if (type === 'webkitplaybacktargetavailabilitychanged') listeners.delete(fn);
            return originalRemove.call(this, type, fn, opts);
        };
        try {
            first.$view.find('a')[0].click();
            await tick();
            const video = document.querySelector('#pv-content-vid');
            const airplay = availabilityState => {
                const ev = new window.Event('webkitplaybacktargetavailabilitychanged');
                ev.availability = availabilityState;
                video.dispatchEvent(ev);
            };
            assert.ok(castButton().classList.contains('hidden'), 'hidden until AirPlay reports a device');
            airplay('available');
            assert.equal(castButton().classList.contains('hidden'), false);
            castButton().click();
            assert.equal(picked, 1);
            airplay('not-available');
            assert.ok(castButton().classList.contains('hidden'));
            close();
            assert.equal(listeners.size, 0, 'closing the preview removes the AirPlay listener');

            // Safari with Remote Playback: its availability watch is used,
            // not the AirPlay picker that would show without any device.
            prompted = 0;
            remote = {
                prompt: () => { prompted += 1; return Promise.resolve(); },
                watchAvailability: callback => { availability = callback; return Promise.resolve(5); },
                cancelWatchAvailability: () => Promise.resolve()
            };
            first.$view.find('a')[0].click();
            await tick();
            assert.ok(castButton().classList.contains('hidden'));
            assert.equal(listeners.size, 0);
            availability(true);
            castButton().click();
            assert.equal(prompted, 1);
            assert.equal(picked, 1, 'the AirPlay picker is not used');
            close();
        } finally {
            delete mediaProto.webkitShowPlaybackTargetPicker;
            mediaProto.addEventListener = originalAdd;
            mediaProto.removeEventListener = originalRemove;
        }
    } finally {
        elementProto.setAttribute = originalSetAttribute;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
        if (originalRemote) Object.defineProperty(mediaProto, 'remote', originalRemote);
        else delete mediaProto.remote;
    }
});

test('video preview: subtitles match the video name only, natively as WebVTT', async () => {
    const originalCrossOrigin = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    const proto = window.Element.prototype;
    const originalSetAttribute = proto.setAttribute;
    let answer = 'loadedmetadata';
    proto.setAttribute = function setAttribute(name, value) {
        originalSetAttribute.call(this, name, value);
        if (this.id === 'pv-content-vid' && name === 'src' && answer) {
            const video = this;
            window.setTimeout(() => video.dispatchEvent(new window.Event(answer)), 0);
        }
    };
    const tracksOf = () => [...document.querySelectorAll('#pv-content-vid track')]
        .map(track => [track.getAttribute('label'), track.getAttribute('srclang')]);

    try {
        const folder = Item.get('/episodes/');
        const video = Item.get('/episodes/Episode%201.mkv');
        const names = ['Episode%2010.srt', 'Episode%201.srt', 'Episode%201.en.forced.srt', 'Episode%201_fr.vtt', 'Episode%201%202.srt'];
        video.type = 'vid';
        video.parent = folder;
        folder.content[video.absHref] = video;
        names.forEach(name => {
            const sub = Item.get('/episodes/' + name);
            sub.parent = folder;
            folder.content[sub.absHref] = sub;
        });

        Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: true});
        // Metadata never comes before the element is attached: movi must not wait for it.
        answer = null;
        view.setItems([video]);
        video.$view.find('a')[0].click();
        await drain();
        assert.equal(document.querySelector('#pv-content-vid').tagName.toLowerCase(), 'movi-player');
        assert.deepEqual(tracksOf().sort(), [['EN.FORCED', 'en'], ['FR', 'fr'], ['Subtitles', null]]);
        document.querySelector('#pv-bar-close').click();

        answer = 'loadedmetadata';
        Object.defineProperty(window, 'crossOriginIsolated', {configurable: true, value: false});
        video.$view.find('a')[0].click();
        await drain();
        assert.equal(document.querySelector('#pv-content-vid').tagName, 'VIDEO');
        assert.deepEqual(tracksOf(), [['FR', 'fr']], 'the native element gets WebVTT only');
        document.querySelector('#pv-bar-close').click();

        answer = 'error';
        video.$view.find('a')[0].click();
        await drain();
        assert.ok(document.querySelector('#pv-container #pv-content-vid'), 'an undecodable video still replaces the spinner');
        document.querySelector('#pv-bar-close').click();
    } finally {
        proto.setAttribute = originalSetAttribute;
        if (originalCrossOrigin) Object.defineProperty(window, 'crossOriginIsolated', originalCrossOrigin);
        else delete window.crossOriginIsolated;
    }
});

test('selection checkboxes toggle item state and publish selected items', () => {
    const first = Item.get('/selected-one.txt');
    const second = Item.get('/selected-two.txt');
    view.setItems([first, second]);
    const selected = [];
    const listener = items => selected.push(items);
    reqlib('core/event').sub('selection', listener);
    reqlib('core/event').pub('view.changed', [first, second], []);
    selected.length = 0;

    first.$view.find('.selector')[0].dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
    assert.equal(first.$view.hasCls('selected'), true);
    assert.equal(second.$view.hasCls('selected'), false);
    assert.equal(selected.at(-1).length, 1);
    assert.equal(selected.at(-1)[0], first);

    first.$view.find('.selector')[0].dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
    assert.equal(first.$view.hasCls('selected'), false);
    assert.equal(selected.at(-1).length, 0);
    reqlib('core/event').unsub('selection', listener);
});

test('selection drag selects only rows intersecting the dragged rectangle', () => {
    const first = Item.get('/drag-first.txt');
    const second = Item.get('/drag-second.txt');
    view.setItems([first, second]);
    const content = document.querySelector('#content');
    const originalWidth = Object.getOwnPropertyDescriptor(content, 'offsetWidth');
    const originalRect = window.Element.prototype.getBoundingClientRect;
    Object.defineProperty(content, 'offsetWidth', {configurable: true, value: 500});
    window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
        if (this.id === 'content') return {left: 0, top: 0, right: 500, bottom: 500};
        if (this.id === 'selection-rect') {
            const left = parseFloat(this.style.left) || 0;
            const top = parseFloat(this.style.top) || 0;
            return {left, top, right: left + (parseFloat(this.style.width) || 0), bottom: top + (parseFloat(this.style.height) || 0)};
        }
        if (this._item === first) return {left: 20, top: 20, right: 50, bottom: 50};
        if (this._item === second) return {left: 150, top: 150, right: 180, bottom: 180};
        return originalRect.call(this);
    };
    try {
        const makeMouseEvent = (type, x, y) => {
            const ev = new window.MouseEvent(type, {bubbles: true, cancelable: true, button: 0});
            Object.defineProperties(ev, {pageX: {value: x}, pageY: {value: y}});
            return ev;
        };
        const down = makeMouseEvent('mousedown', 10, 10);
        Object.defineProperty(down, 'offsetX', {value: 10});
        content.dispatchEvent(down);
        document.dispatchEvent(makeMouseEvent('mousemove', 80, 80));
        document.dispatchEvent(makeMouseEvent('mouseup', 80, 80));
        assert.equal(first.$view.hasCls('selected'), true);
        assert.equal(second.$view.hasCls('selected'), false);
    } finally {
        window.Element.prototype.getBoundingClientRect = originalRect;
        if (originalWidth) Object.defineProperty(content, 'offsetWidth', originalWidth);
        else delete content.offsetWidth;
    }
});

test('download extension packages selected items through browser form submission', () => {
    const item = Item.get('/download-item.txt');
    item.type = 'txt';
    const proto = window.HTMLFormElement.prototype;
    const originalSubmit = proto.submit;
    let fields;
    proto.submit = function submitDownload() {
        fields = new window.FormData(this);
    };
    try {
        reqlib('core/event').pub('selection', [item]);
        assert.equal(document.querySelector('#download').classList.contains('hidden'), false);
        document.querySelector('#download').click();
        assert.equal(fields.get('action'), 'download');
        assert.equal(fields.get('as'), 'selected.zip');
        assert.equal(fields.get('type'), 'shell-zip');
        assert.equal(fields.get('hrefs[0]'), item.absHref);
        reqlib('core/event').pub('selection', []);
        assert.equal(document.querySelector('#download').classList.contains('hidden'), true);
    } finally {
        proto.submit = originalSubmit;
    }
});

test('search field filters the listing, searches subfolders on Enter, and restores it when closed', async () => {
    const folder = Item.get('/query-folder/');
    const alpha = Item.get('/query-folder/alpha.txt');
    const beta = Item.get('/query-folder/beta.md');
    folder.content[alpha.absHref] = alpha;
    folder.content[beta.absHref] = beta;
    const locationModule = reqlib('core/location');
    const server = reqlib('server');
    const originalGetItem = locationModule.getItem;
    const originalRequest = server.request;
    locationModule.getItem = () => folder;
    server.request = async () => ({search: [alpha.absHref]});

    try {
        view.setItems([alpha, beta]);
        const input = document.querySelector('#search input');
        document.querySelector('#search img').click();
        input.value = 're:^alpha\\.txt$';
        input.dispatchEvent(new window.Event('input', {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(document.querySelectorAll('#items .item').length, 1);
        assert.equal(document.querySelector('#items .item .label').textContent, 'alpha.txt');

        input.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(document.querySelectorAll('#items .item').length, 1);

        document.querySelector('#search img').click();
        assert.equal(document.querySelectorAll('#items .item').length, 3);
        assert.equal(document.querySelector('#search').classList.contains('active'), false);
    } finally {
        locationModule.getItem = originalGetItem;
        server.request = originalRequest;
    }
});

test('localization selects a language and updates translated labels and date formatting', async () => {
    const server = reqlib('server');
    const originalRequest = server.request;
    server.request = async () => ({l10n: {fr: {
        isoCode: 'fr', lang: 'français', dateFormat: 'DD/MM/YYYY', name: 'Nom',
        download: 'télécharger', shuffle: 'Aléatoire'
    }}});
    const i18n = reqlib('core/i18n');
    const button = document.createElement('button');
    button.className = 'l10n_title-shuffle';
    document.body.appendChild(button);
    try {
        reqlib('ext/l10n');
        reqlib('core/event').pub('view.changed', [], []);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(document.querySelector('.l10n-name').textContent, 'Nom');
        assert.equal(document.querySelector('.l10n_ph-search').getAttribute('placeholder'), 'search');
        assert.equal(button.getAttribute('title'), 'Aléatoire', 'titles follow the language');
        assert.equal(i18n.t('download'), 'télécharger', 'strings built in code follow the language');
        const selector = document.querySelector('#langs');
        assert.equal(selector.value, 'fr');
        selector.value = 'en';
        selector.dispatchEvent(new window.Event('change', {bubbles: true}));
        await Promise.resolve();
        assert.equal(document.querySelector('.l10n-name').textContent, 'Name');
        assert.equal(button.getAttribute('title'), 'Shuffle');
        assert.equal(i18n.t('download'), 'download');
    } finally {
        button.remove();
        server.request = originalRequest;
    }
});
