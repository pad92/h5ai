const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const event = reqlib('core/event');

test('core.event', () => {
    assert.equal(typeof event, 'object', 'is object');
    assert.deepEqual(Object.keys(event).sort(), ['pub', 'sub', 'unsub']);
    assert.equal(typeof event.sub, 'function');
    assert.equal(typeof event.unsub, 'function');
    assert.equal(typeof event.pub, 'function');
});

test('core.event ignores invalid subscriptions and publishes valid listeners', () => {
    const topic = `coverage-${Date.now()}`;
    const calls = [];
    function listener(value) {
        calls.push([this, value]);
    }

    event.sub(null, listener);
    event.sub(topic, null);
    event.pub(topic, 'ignored');
    assert.deepEqual(calls, []);

    event.sub(topic, listener);
    event.pub(topic, 'first');
    event.unsub(topic, listener);
    event.pub(topic, 'second');
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0][0]), topic);
    assert.equal(calls[0][1], 'first');
});
