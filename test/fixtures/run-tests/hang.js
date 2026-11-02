const {test, assert} = require('scar');

test('passes', () => assert.ok(true));
test('never settles', () => new Promise(() => {}));
test('runs after the timeout', () => assert.ok(true));
