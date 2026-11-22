const {test, assert} = require('scar');
const {render} = require('../../../src/_h5ai/public/js/lib/ext/preview/text-content');
const {loadImage} = require('../../../src/_h5ai/public/js/lib/ext/preview/image-loader');

test('text preview styles render plain text, sanitized Markdown, and highlighted code', () => {
    const plain = render('<b>text</b>', 1, window);
    assert.equal(plain[0].textContent, '<b>text</b>');
    assert.equal(plain[0].tagName, 'PRE');

    const markdown = render('# Title\n\n<script>alert(1)</script>safe', 2, window);
    assert.ok(markdown[0].querySelector('h1'));
    assert.equal(markdown[0].querySelector('script'), null);
    assert.ok(markdown[0].textContent.includes('safe'));

    const code = render('<script>code</script>', 3, window);
    assert.equal(code[0].querySelector('code').textContent, '<script>code</script>');
    assert.equal(code[0].querySelector('script'), null);
    const fallback = render('<b>literal</b>', 0, window);
    assert.equal(fallback[0].textContent, '<b>literal</b>');
    assert.equal(fallback[0].querySelector('b'), null);
});

test('image preview uses the original first and falls back to a generated sample', async () => {
    const calls = [];
    const createImage = href => {
        calls.push(['image', href]);
        return href === '/original.raw' ? Promise.reject(new Error('decode')) : Promise.resolve(href);
    };
    const requestSample = async href => {
        calls.push(['sample', href]);
        return '/sample.jpg';
    };

    assert.equal(await loadImage('/photo.jpg', 1000, requestSample, createImage), '/photo.jpg');
    assert.equal(await loadImage('/original.raw', 1000, requestSample, createImage), '/sample.jpg');
    assert.deepEqual(calls.map(call => call[0]), ['image', 'image', 'sample', 'image']);
});

test('image preview reports original and sample load failures', async () => {
    const requestSample = async () => null;
    const createImage = async () => {throw new Error('decode');};

    await assert.rejects(loadImage('/photo.raw', null, requestSample, createImage), /unable to load image/);
    await assert.rejects(loadImage('/photo.raw', 1000, requestSample, createImage), /unable to load image sample/);
});

test('markdown preview hides images that cannot load, such as badges blocked by the CSP', () => {
    const markdown = render('[![Badge](https://img.shields.io/badge/a-b-blue)](https://example.org) ![Local](shot.webp)', 2, window);
    const [badge, local] = markdown[0].querySelectorAll('img');

    badge.dispatchEvent(new window.Event('error'));

    assert.ok(badge.classList.contains('pv-md-img-failed'));
    assert.equal(local.classList.contains('pv-md-img-failed'), false);
});

const {addCopyButton} = require('../../../src/_h5ai/public/js/lib/ext/preview/text-copy');

// A window whose clipboard and copy command the test controls.
const copyWin = ({secure, writeText, execCommand}) => {
    const copied = [];
    const doc = window.document;
    const originalExec = doc.execCommand;
    doc.execCommand = command => {
        copied.push(['textarea', doc.querySelector('textarea').value]);
        // A browser's textarea.select() takes the selection; jsdom's does not.
        window.getSelection().removeAllRanges();
        return execCommand ? execCommand(command) : true;
    };
    const win = {
        document: doc,
        getSelection: () => window.getSelection(),
        setTimeout: () => 0,
        clearTimeout: () => {},
        isSecureContext: secure,
        navigator: {clipboard: writeText ? {writeText: text => {
            copied.push(['clipboard', text]);
            return writeText(text);
        }} : undefined}
    };
    return {win, copied, restore: () => { doc.execCommand = originalExec; }};
};

// Mounts the shown text and a preview bar, as the overlay holds them.
const mountCopy = (win, source, unload) => {
    const ownBar = !document.querySelector('#pv-buttons');
    if (ownBar) {
        document.body.insertAdjacentHTML('beforeend', '<ul id="pv-buttons"></ul>');
    }
    const el = render(source, 2, window)[0];
    el.unload = unload;
    document.body.appendChild(el);
    const copy = addCopyButton(el, source, win);
    const button = () => document.querySelector('#pv-bar-copy');
    const cleanup = () => {
        el.unload();
        el.remove();
        if (ownBar) {
            document.querySelector('#pv-buttons').remove();
        }
    };
    return {el, copy, button, cleanup};
};

test('text preview copy button selects the shown text and copies the file source', async () => {
    const {win, copied, restore} = copyWin({secure: true, writeText: async () => {}});
    const unloads = [];
    const {el, button, cleanup} = mountCopy(win, '# Title\n\n**bold**', () => unloads.push('content'));
    try {
        assert.equal(button().getAttribute('title'), 'Select all and copy');
        button().click();
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepEqual(copied, [['clipboard', '# Title\n\n**bold**']]);
        assert.equal(window.getSelection().toString().trim(), el.textContent.trim());
        assert.ok(button().classList.contains('copied'));
    } finally {
        cleanup();
        restore();
        window.getSelection().removeAllRanges();
    }
    assert.equal(document.querySelector('#pv-bar-copy'), null);
    assert.deepEqual(unloads, ['content']);
});

test('text preview copy falls back to a textarea without a secure context', async () => {
    const {win, copied, restore} = copyWin({secure: false, writeText: async () => {}});
    const {button, copy, cleanup} = mountCopy(win, 'plain text');
    try {
        assert.equal(await copy(), true);
        assert.deepEqual(copied, [['textarea', 'plain text']]);
        assert.equal(document.querySelector('textarea'), null);
        assert.equal(window.getSelection().toString().trim(), 'plain text');
        assert.ok(button().classList.contains('copied'));
    } finally {
        cleanup();
        restore();
        window.getSelection().removeAllRanges();
    }
});

test('text preview copy reports a failure when no way to copy works', async () => {
    const {win, copied, restore} = copyWin({
        secure: true,
        writeText: () => Promise.reject(new Error('denied')),
        execCommand: () => false
    });
    const {button, copy, cleanup} = mountCopy(win, 'text');
    try {
        assert.equal(await copy(), false);
        assert.deepEqual(copied.map(entry => entry[0]), ['clipboard', 'textarea']);
        assert.ok(button().classList.contains('copy-failed'));
        assert.equal(button().classList.contains('copied'), false);
    } finally {
        cleanup();
        restore();
        window.getSelection().removeAllRanges();
    }
});
