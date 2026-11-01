const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {fresh} = require('../../../util/fresh');

const location = reqlib('core/location');

// Replaces the window timers and location.refresh with recorders.
const withAutorefresh = (settings, run) => {
    const saved = {setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, refresh: location.refresh};
    const calls = {set: [], cleared: [], refreshes: 0};
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
        run(loaded.emit, calls);
    } finally {
        cleanup();
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
