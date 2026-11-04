const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh} = require('../../../util/fresh');

const location = reqlib('core/location');

// Replaces the window timers, location.refresh and document.hidden with
// recorders. run() gets show(hidden) to switch the tab's visibility.
const withAutorefresh = (settings, run) => {
    const saved = {
        setTimeout: window.setTimeout,
        clearTimeout: window.clearTimeout,
        refresh: location.refresh,
        hidden: Object.getOwnPropertyDescriptor(document, 'hidden'),
        addEventListener: document.addEventListener
    };
    const calls = {set: [], cleared: [], refreshes: 0};
    const listeners = [];
    let hidden = false;
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
    document.addEventListener = (type, listener) => listeners.push([type, listener]);
    const show = isHidden => {
        hidden = isHidden;
        listeners.filter(([type]) => type === 'visibilitychange').forEach(([, listener]) => listener());
    };
    let nextId = 0;
    window.setTimeout = (fn, delay) => {
        nextId += 1;
        calls.set.push({fn, delay, id: nextId});
        return nextId;
    };
    window.clearTimeout = id => calls.cleared.push(id);
    location.refresh = () => { calls.refreshes += 1; };
    let cleanup = () => undefined;
    try {
        const loaded = fresh('ext/autorefresh', {autorefresh: settings});
        cleanup = loaded.cleanup;
        document.addEventListener = saved.addEventListener;
        run(loaded.emit, calls, show);
    } finally {
        cleanup();
        document.addEventListener = saved.addEventListener;
        if (saved.hidden) {
            Object.defineProperty(document, 'hidden', saved.hidden);
        } else {
            delete document.hidden;
        }
        window.setTimeout = saved.setTimeout;
        window.clearTimeout = saved.clearTimeout;
        location.refresh = saved.refresh;
    }
};

test('autorefresh: disabled, location changes schedule nothing', () => {
    withAutorefresh({enabled: false}, (emit, calls) => {
        emit('location.changed', {});
        emit('location.refreshed', {});
        assert.deepEqual(calls.set, []);
    });
});

test('autorefresh: each change or refresh restarts one heartbeat', () => {
    withAutorefresh({enabled: true, interval: 3000}, (emit, calls) => {
        emit('location.changed', {});
        assert.equal(calls.set.length, 1);
        assert.equal(calls.set[0].delay, 3000);

        emit('location.refreshed', {});
        assert.equal(calls.set.length, 2);
        assert.deepEqual(calls.cleared, [null, 1], 'the previous heartbeat is dropped');

        calls.set[1].fn();
        assert.equal(calls.refreshes, 1);
    });
});

test('autorefresh: a navigation or a manual refresh cancels the heartbeat', () => {
    withAutorefresh({enabled: true, interval: 3000}, (emit, calls) => {
        emit('location.changed', {});
        emit('location.beforeChange');
        emit('location.beforeRefresh');
        assert.deepEqual(calls.cleared, [null, 1, 1]);
    });
});

test('autorefresh: intervals below one second are raised to one second', () => {
    withAutorefresh({enabled: true, interval: 10}, (emit, calls) => {
        emit('location.changed', {});
        assert.equal(calls.set[0].delay, 1000);
    });
});

test('autorefresh: a hidden tab skips the heartbeat and refreshes once when shown again', () => {
    withAutorefresh({enabled: true, interval: 3000}, (emit, calls, show) => {
        emit('location.changed', {});
        show(true);
        calls.set[0].fn();
        assert.equal(calls.refreshes, 0, 'no request while the tab is hidden');

        show(false);
        assert.equal(calls.refreshes, 1, 'the missed refresh runs when the tab is shown');
        show(true);
        show(false);
        assert.equal(calls.refreshes, 1, 'showing the tab again without a missed heartbeat does nothing');
    });
});

const listing = (...staleFlags) => ({
    content: Object.fromEntries(staleFlags.map((isSizeStale, index) => [`/f${index}/`, {isSizeStale}]))
});

test('autorefresh: disabled, a listing with expired sizes refreshes until they are recomputed', () => {
    withAutorefresh({enabled: false}, (emit, calls) => {
        emit('location.changed', listing(false, false));
        assert.deepEqual(calls.set, [], 'up-to-date sizes need no refresh');

        emit('location.changed', listing(false, true));
        assert.equal(calls.set.length, 1);
        assert.equal(calls.set[0].delay, 5000);
        calls.set[0].fn();
        assert.equal(calls.refreshes, 1);

        emit('location.refreshed', listing(true));
        assert.equal(calls.set.length, 2, 'still expired: one more refresh');
        emit('location.refreshed', listing(false));
        assert.equal(calls.set.length, 2, 'recomputed: the follow-up stops');
    });
});

test('autorefresh: disabled, the follow-up of expired sizes stops after five minutes per folder', () => {
    const savedNow = Date.now;
    let now = 1000000;
    Date.now = () => now;
    try {
        withAutorefresh({enabled: false}, (emit, calls) => {
            emit('location.changed', listing(true));
            now += 299000;
            emit('location.refreshed', listing(true));
            assert.equal(calls.set.length, 2);
            now += 1000;
            emit('location.refreshed', listing(true));
            assert.equal(calls.set.length, 2, 'five minutes after the first expired size, no more refreshes');

            emit('location.beforeChange');
            emit('location.changed', listing(true));
            assert.equal(calls.set.length, 3, 'another folder gets its own five minutes');
        });
    } finally {
        Date.now = savedNow;
    }
});
