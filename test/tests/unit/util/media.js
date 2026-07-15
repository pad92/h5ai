const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {addUnloadFn} = reqlib('util/media');

test('media unload calls the original custom-element cleanup once', () => {
    let originalCalls = 0;
    let removeCalls = 0;
    const el = {
        tagName: 'MOVI-PLAYER',
        unload() {
            originalCalls += 1;
            assert.equal(this, el);
        },
        pause() {},
        removeAttribute(name) {
            assert.equal(name, 'src');
            removeCalls += 1;
        }
    };

    addUnloadFn(el);
    el.unload();

    assert.equal(originalCalls, 1);
    assert.equal(removeCalls, 1);
});
