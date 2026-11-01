const {test, assert} = require('scar');
const {fresh, flush} = require('../../../util/fresh');
const {restore_html} = require('../../../util/pin');

const SETTINGS = {enabled: true, baseURL: 'stats.example', idSite: 3};

const item = (...labels) => ({getCrumb: () => labels.map(label => ({label}))});

const withPiwik = async (settings, piwik, run) => {
    const saved = window.Piwik;
    window.Piwik = piwik;
    const {emit, cleanup} = fresh('ext/piwik-analytics', {'piwik-analytics': settings});
    try {
        await run(emit);
    } finally {
        cleanup();
        window.Piwik = saved;
        restore_html();
    }
};

const fakePiwik = () => {
    const calls = {tracker: [], linkTracking: 0, views: []};
    const piwik = {
        getTracker: (...args) => {
            calls.tracker.push(args);
            return {
                enableLinkTracking: () => { calls.linkTracking += 1; },
                trackPageView: title => calls.views.push(title)
            };
        }
    };
    return {piwik, calls};
};

const script = () => document.querySelector('script[src$="piwik.js"]');

test('piwik: disabled, no script is loaded', async () => {
    const {piwik, calls} = fakePiwik();
    await withPiwik({enabled: false}, piwik, async emit => {
        emit('location.changed', item('host'));
        await flush();
        assert.equal(script(), null);
        assert.deepEqual(calls.tracker, []);
    });
});

test('piwik: views before the tracker loads are queued, later ones are sent', async () => {
    const {piwik, calls} = fakePiwik();
    await withPiwik(SETTINGS, piwik, async emit => {
        assert.equal(script().getAttribute('src'), 'http://stats.example/piwik.js');

        emit('location.changed', item('host', 'music'));
        emit('location.changed', item('host', 'music', 'live'));
        assert.deepEqual(calls.views, [], 'nothing sent before the page load');

        await flush();
        assert.deepEqual(calls.tracker, [['http://stats.example/piwik.php', 3]]);
        assert.equal(calls.linkTracking, 1);
        assert.deepEqual(calls.views, ['host > music', 'host > music > live']);

        emit('location.changed', item('host'));
        assert.deepEqual(calls.views, ['host > music', 'host > music > live', 'host']);
    });
});

test('piwik: without a Piwik global, views stay queued and nothing fails', async () => {
    await withPiwik(SETTINGS, undefined, async emit => {
        await flush();
        emit('location.changed', item('host'));
        assert.ok(script());
    });
});
