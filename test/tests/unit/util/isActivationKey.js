const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {isActivationKey} = reqlib('util');

test('util.isActivationKey()', () => {
    assert.equal(isActivationKey({key: 'Enter'}), true, 'Enter');
    assert.equal(isActivationKey({key: ' '}), true, 'Space');
    ['Escape', 'Tab', 'a', 'Spacebar', undefined].forEach(key => {
        assert.equal(isActivationKey({key}), false, String(key));
    });
    // A held key would toggle a panel open and shut, or start several downloads.
    assert.equal(isActivationKey({key: 'Enter', repeat: true}), false, 'held Enter');
    assert.equal(isActivationKey({key: ' ', repeat: true}), false, 'held Space');
});
