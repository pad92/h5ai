const {test, assert} = require('scar');

test('leaves a rejection behind', () => {
    Promise.reject(new Error('nobody waits for this'));
    assert.ok(true);
});
