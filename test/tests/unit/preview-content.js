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
