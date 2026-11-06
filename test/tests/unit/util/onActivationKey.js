const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const {onActivationKey} = reqlib('util');

// A keydown on a child of `parent`; returns what the page and `parent` saw.
const press = (listener, init) => {
    const parent = document.createElement('div');
    const el = document.createElement('div');
    parent.appendChild(el);
    document.body.appendChild(parent);
    let bubbled = false;
    parent.addEventListener('keydown', () => {
        bubbled = true;
    });
    el.addEventListener('keydown', listener);
    const ev = new window.KeyboardEvent('keydown', Object.assign({bubbles: true, cancelable: true}, init));
    el.dispatchEvent(ev);
    parent.remove();
    return {prevented: ev.defaultPrevented, bubbled};
};

test('util.onActivationKey(): Enter and Space act once per press', () => {
    let calls = 0;
    const listener = onActivationKey(() => {
        calls += 1;
    });
    ['Enter', ' '].forEach(key => {
        const seen = press(listener, {key});
        assert.equal(seen.prevented, true, `${JSON.stringify(key)} does not scroll`);
        assert.equal(seen.bubbled, false, `${JSON.stringify(key)} stays with the element`);
    });
    assert.equal(calls, 2);
});

// A held key would toggle a panel open and shut; let through, its repeats
// would scroll the page, or reach the preview, which reads Enter as "next item".
test('util.onActivationKey(): held repeats do not act, and stay swallowed', () => {
    let calls = 0;
    const listener = onActivationKey(() => {
        calls += 1;
    });
    ['Enter', ' '].forEach(key => {
        const seen = press(listener, {key, repeat: true});
        assert.equal(seen.prevented, true, `held ${JSON.stringify(key)} does not scroll`);
        assert.equal(seen.bubbled, false, `held ${JSON.stringify(key)} stays with the element`);
    });
    assert.equal(calls, 0);
});

test('util.onActivationKey(): other keys pass untouched', () => {
    let calls = 0;
    const listener = onActivationKey(() => {
        calls += 1;
    });
    ['Escape', 'Tab', 'a', 'Spacebar', 'ArrowRight'].forEach(key => {
        const seen = press(listener, {key});
        assert.equal(seen.prevented, false, key);
        assert.equal(seen.bubbled, true, key);
    });
    assert.equal(calls, 0);
});
