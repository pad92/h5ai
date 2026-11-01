const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {flush} = require('../../../util/fresh');

// Drives the image preview mounted by the item tests: EXIF requests, image
// decoding and sample requests are scripted per scenario.
const Item = reqlib('model/item');
const view = reqlib('view/view');
const event = reqlib('core/event');
const server = reqlib('server');
const preview = reqlib('ext/preview/preview');
const EXIF = require('exif-js');

const TAGS = {Make: 'Canon', Model: 'EOS R'};

const withImages = async ({exifStatus = 206, broken = []}, run) => {
    const win = global.window;
    const proto = win.Element.prototype;
    const saved = {
        XHR: win.XMLHttpRequest,
        setAttribute: proto.setAttribute,
        read: EXIF.readFromBinaryFile,
        request: server.request
    };
    const pending = [];
    const requests = [];

    // EXIF answers wait until the test releases them, so it can switch items first.
    win.XMLHttpRequest = class {
        open(method, href) {
            this.href = href;
        }

        setRequestHeader() {}

        send() {
            pending.push(this);
        }
    };
    const release = (count = pending.length) => {
        pending.splice(0, count).forEach(xhr => {
            xhr.status = exifStatus;
            xhr.response = xhr.href;
            xhr.onload();
        });
    };
    EXIF.readFromBinaryFile = () => TAGS;
    proto.setAttribute = function setAttribute(name, value) {
        saved.setAttribute.call(this, name, value);
        if (this.id === 'pv-content-img' && name === 'src') {
            const image = this;
            const type = broken.includes(value) ? 'error' : 'load';
            win.setTimeout(() => image.dispatchEvent(new win.Event(type)), 0);
        }
    };
    server.request = query => {
        requests.push(query);
        return Promise.resolve({thumbs: ['/sample.webp']});
    };

    try {
        await run({release, requests});
    } finally {
        if (document.querySelector('#pv-bar-info').classList.contains('active')) {
            document.querySelector('#pv-bar-info').click();
        }
        if (!document.querySelector('#pv-overlay').classList.contains('hidden')) {
            document.querySelector('#pv-bar-close').click();
        }
        win.XMLHttpRequest = saved.XHR;
        proto.setAttribute = saved.setAttribute;
        EXIF.readFromBinaryFile = saved.read;
        server.request = saved.request;
    }
};

const openImages = async (...names) => {
    const items = names.map(name => {
        const item = Item.get(`/pv-image-${name}`);
        item.type = 'img';
        return item;
    });
    view.setItems(items);
    event.pub('view.changed', items, []);
    items[0].$view.find('a')[0].click();
    await flush();
    await flush();
    return items;
};

const infoButton = () => document.querySelector('#pv-bar-info');
const card = () => document.querySelector('#pv-exif-card');
const hidden = el => el.classList.contains('hidden');

test('image preview: camera details open from the info button and close with a click outside', async () => {
    await withImages({}, async ({release}) => {
        await openImages('canon.jpg');
        assert.ok(hidden(infoButton()), 'no button before the EXIF data arrives');

        release();
        await flush();
        assert.equal(hidden(infoButton()), false);
        assert.ok(card().textContent.includes('Canon'));
        assert.ok(hidden(card()));

        infoButton().click();
        assert.ok(infoButton().classList.contains('active'));
        assert.ok(card().classList.contains('visible'));
        assert.equal(hidden(card()), false);
        assert.equal(hidden(document.querySelector('#pv-overlay')), false, 'the button click stays in the bar');

        infoButton().click();
        assert.equal(infoButton().classList.contains('active'), false);
        assert.ok(hidden(card()));

        infoButton().click();
        document.querySelector('#pv-container').click();
        assert.ok(hidden(card()), 'a click outside the image hides the details');
    });
});

test('image preview: details of an image already left behind are dropped', async () => {
    await withImages({}, async ({release}) => {
        await openImages('first.jpg', 'second.jpg');
        document.querySelector('#pv-bar-next').click();
        await flush();
        assert.equal(preview.item.absHref, '/pv-image-second.jpg');

        release(1);
        await flush();
        assert.ok(hidden(infoButton()), 'the first image details are not shown');
        assert.equal(card().textContent.includes('pv-image-first.jpg'), false);

        release();
        await flush();
        assert.equal(hidden(infoButton()), false);
        assert.ok(card().textContent.includes('pv-image-second.jpg'));
    });
});

test('image preview: an undecodable original falls back to a viewport-sized sample', async () => {
    await withImages({exifStatus: 404, broken: ['/pv-image-photo.raw']}, async ({release, requests}) => {
        await openImages('photo.raw');
        await flush();
        const size = Math.round(Math.max(window.innerWidth, window.innerHeight) * 0.8);
        // The thumbnail extension also asks for thumbs, without a width.
        const samples = requests.filter(query => query.thumbs && 'width' in query.thumbs[0]);
        assert.deepEqual(samples, [{
            action: 'get',
            thumbs: [{type: 'img', href: '/pv-image-photo.raw', width: size, height: 0}]
        }]);
        assert.equal(document.querySelector('#pv-content-img').getAttribute('src'), '/sample.webp');

        release();
        await flush();
        assert.ok(hidden(infoButton()), 'a failed EXIF request shows no button');
    });
});
