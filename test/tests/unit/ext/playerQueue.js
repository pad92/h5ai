const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');

const {createQueue} = reqlib('ext/player/queue');

// Entries are compared by identity, like the shared item objects.
const entries = (...names) => names.map(name => ({name}));
const names = list => list.map(entry => entry && entry.name);

// Runs `run` with Math.random always returning `value`.
const withRandom = (value, run) => {
    const random = Math.random;
    Math.random = () => value;
    try {
        run();
    } finally {
        Math.random = random;
    }
};

test('player queue: next and previous follow the queue, wrapping only when asked', () => {
    const [a, b, c] = entries('a', 'b', 'c');
    const queue = createQueue();
    assert.equal(queue.next(true), null, 'an empty queue has nothing next');

    queue.replace([a, b, c], b);
    assert.equal(queue.current, b);
    assert.equal(queue.next(false), c);
    queue.select(c);
    assert.equal(queue.next(false), null, 'the end without repeat');
    assert.equal(queue.next(true), a, 'the end with repeat');
    queue.select(a);
    assert.equal(queue.previous(), c, 'previous always wraps');
});

test('player queue: add, play next and remove keep the current entry in place', () => {
    const [a, b, c, d] = entries('a', 'b', 'c', 'd');
    const queue = createQueue();
    queue.replace([a, b], a);
    assert.equal(queue.add(b), false, 'no duplicate');
    assert.equal(queue.add(c), true);
    queue.insertNext(c);
    assert.deepEqual(names(queue.entries), ['a', 'c', 'b'], 'play next moves a queued entry');
    queue.insertNext(a);
    assert.deepEqual(names(queue.entries), ['a', 'c', 'b'], 'the current entry stays where it is');

    queue.select(b);
    assert.equal(queue.remove(a), b, 'removing another entry keeps the current one');
    assert.equal(queue.remove(d), b, 'an unknown entry changes nothing');
    assert.equal(queue.remove(b), c, 'the last current entry wraps to the first');
    assert.equal(queue.remove(c), null);
    assert.equal(queue.length, 0);

    queue.insertNext(d);
    assert.deepEqual(names(queue.entries), ['d'], 'play next into an empty queue');
});

test('player queue: shuffle plays every entry once, in an order that previous walks back', () => {
    const [a, b, c, d] = entries('a', 'b', 'c', 'd');
    const queue = createQueue();
    queue.replace([a, b, c, d], b);
    withRandom(0.99, () => queue.setShuffle(true));
    assert.equal(queue.isShuffled, true);

    const played = [queue.current];
    for (let next = queue.next(false); next; next = queue.next(false)) {
        queue.select(next);
        played.push(next);
    }
    assert.equal(played[0], b, 'the order starts with the current entry');
    assert.deepEqual(names(played).sort(), ['a', 'b', 'c', 'd'], 'each entry once, then the end');
    assert.equal(queue.previous(), played[2]);

    withRandom(0, () => {
        const first = queue.next(true);
        assert.notEqual(first, played[3], 'a new round never starts with the last entry');
    });

    queue.setShuffle(false);
    queue.select(b);
    assert.equal(queue.next(false), c, 'off again, the queue order is back');
});

test('player queue: entries added while shuffled join the order', () => {
    const [a, b, c, d] = entries('a', 'b', 'c', 'd');
    const queue = createQueue();
    queue.replace([a, b], a);
    withRandom(0, () => queue.setShuffle(true));
    queue.add(c);
    queue.insertNext(d);
    assert.equal(queue.next(false), d, 'play next comes right after the current entry');
    queue.select(d);
    assert.equal(queue.next(false), b);
    queue.select(b);
    assert.equal(queue.next(false), c, 'an added entry comes at the end');
    queue.replace([c, a], a);
    assert.equal(queue.current, a, 'a new queue keeps shuffle on, from its first entry');
    assert.equal(queue.isShuffled, true);
});
