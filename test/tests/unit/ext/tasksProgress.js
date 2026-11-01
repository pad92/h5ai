const {test, assert} = require('scar');
const {estimate, formatFigures, formatPercent, formatRemaining} = require('../../../util/reqlib')('ext/tasks-progress');

test('tasks: thumbnail progress is extrapolated from the elapsed time', () => {
    assert.deepEqual(estimate(25, 100, 0, 10000), {percent: 25, remaining: 30});
    assert.deepEqual(estimate(0, 100, 0, 10000), {percent: 0, remaining: null}, 'nothing done yet');
    assert.deepEqual(estimate(100, 100, 0, 10000), {percent: 99, remaining: 0}, 'never shown complete');
    assert.deepEqual(estimate(1, 0, 0, 10000), {percent: null, remaining: null}, 'unknown total');
});

test('tasks: figures read as short approximations', () => {
    assert.equal(formatPercent(42), '42 %');
    assert.equal(formatPercent(null), '…');
    assert.equal(formatRemaining(null), '…');
    assert.equal(formatRemaining(0.2), '~ 1 s');
    assert.equal(formatRemaining(45), '~ 45 s');
    assert.equal(formatRemaining(150), '~ 3 min');
    assert.equal(formatRemaining(3900), '~ 1 h 05');
    assert.equal(formatFigures(42, 150), '42 % · ~ 3 min');
    assert.equal(formatFigures(0, null), '0 % · …', 'a started task without a pace yet');
    assert.equal(formatFigures(null, null), '…', 'nothing to estimate: a single ellipsis');
});
