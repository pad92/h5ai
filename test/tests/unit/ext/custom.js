const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh, flush} = require('../../../util/fresh');
const {restore_html} = require('../../../util/pin');

const server = reqlib('server');

const withCustom = async (settings, response, run) => {
    const savedRequest = server.request;
    const requests = [];
    const content = document.createElement('div');
    content.id = 'content';
    document.body.appendChild(content);
    server.request = query => {
        requests.push(query);
        return typeof response === 'function' ? response() : response;
    };
    const {emit, cleanup} = fresh('ext/custom', {custom: settings});
    try {
        await run({emit, requests});
    } finally {
        cleanup();
        server.request = savedRequest;
        restore_html();
    }
};

const header = () => document.querySelector('#content-header');
const footer = () => document.querySelector('#content-footer');

test('custom: disabled, no header or footer is added', async () => {
    await withCustom({enabled: false}, Promise.resolve({}), ({emit, requests}) => {
        emit('location.changed', {absHref: '/a/'});
        assert.equal(header(), null);
        assert.equal(footer(), null);
        assert.deepEqual(requests, []);
    });
});

test('custom: Markdown is rendered, HTML is sanitized, both are shown', async () => {
    const response = Promise.resolve({custom: {
        header: {content: '# Welcome', type: 'MD'},
        footer: {content: '<b>bye</b><script>window.hacked = 1</script>', type: 'html'}
    }});
    await withCustom({enabled: true}, response, async ({emit, requests}) => {
        assert.ok(header().classList.contains('hidden'), 'hidden until content arrives');
        assert.equal(header().parentElement.firstElementChild, header(), 'header goes first');

        emit('location.changed', {absHref: '/a/'});
        await flush();

        assert.deepEqual(requests, [{action: 'get', custom: '/a/'}]);
        assert.equal(header().querySelector('h1').textContent, 'Welcome');
        assert.equal(header().classList.contains('hidden'), false);
        assert.equal(footer().querySelector('b').textContent, 'bye');
        assert.equal(footer().querySelector('script'), null);
        assert.equal(footer().classList.contains('hidden'), false);
    });
});

test('custom: the txt-md and markdown types are also rendered', async () => {
    const response = Promise.resolve({custom: {
        header: {content: '*a*', type: 'txt-md'},
        footer: {content: '*b*', type: 'markdown'}
    }});
    await withCustom({enabled: true}, response, async ({emit}) => {
        emit('location.changed', {absHref: '/'});
        await flush();
        assert.equal(header().querySelector('em').textContent, 'a');
        assert.equal(footer().querySelector('em').textContent, 'b');
    });
});

test('custom: missing content hides the block that has none', async () => {
    const response = Promise.resolve({custom: {header: {content: 'only header'}, footer: {content: ''}}});
    await withCustom({enabled: true}, response, async ({emit}) => {
        emit('location.changed', {absHref: '/'});
        await flush();
        assert.equal(header().textContent, 'only header', 'no type means raw HTML');
        assert.equal(header().classList.contains('hidden'), false);
        assert.ok(footer().classList.contains('hidden'));
    });
});

test('custom: a failed request hides header and footer', async () => {
    await withCustom({enabled: true}, () => Promise.reject(new Error('offline')), async ({emit}) => {
        header().classList.remove('hidden');
        emit('location.changed', {absHref: '/'});
        await flush();
        assert.ok(header().classList.contains('hidden'));
        assert.ok(footer().classList.contains('hidden'));
    });
});
