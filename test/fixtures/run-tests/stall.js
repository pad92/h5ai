const {test, assert} = require('scar');

// Its own timeout of 0 turns the runner's timeout off: the event loop
// empties while it waits, and the run stops before the suite ends.
test('never settles, without a timeout', {timeout: 0}, () => new Promise(() => {}));
test('never runs', () => assert.ok(true));
