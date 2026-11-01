const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');
const config = reqlib('config');
const store = reqlib('core/store');
const resource = reqlib('core/resource');

test('store reads, writes, and recovers from malformed local storage', () => {
    const stored = window.localStorage.getItem('_h5ai');
    try {
        window.localStorage.clear();
        assert.equal(store.get('missing'), undefined);
        store.put('enabled', true);
        store.put('count', 0);
        assert.equal(store.get('enabled'), true);
        assert.equal(store.get('count'), 0);
        window.localStorage.setItem('_h5ai', '{broken');
        assert.equal(store.get('missing'), undefined);
        store.put('recovered', 'yes');
        assert.equal(store.get('recovered'), 'yes');
    } finally {
        if (stored === null) {
            window.localStorage.removeItem('_h5ai');
        } else {
            window.localStorage.setItem('_h5ai', stored);
        }
    }
});

test('resource paths resolve configured icons and fall back to generic icons', () => {
    config.theme['custom-type'] = 'custom.svg';
    assert.equal(resource.image('spinner'), '/images/ui/spinner.svg');
    assert.equal(resource.icon('folder'), '/images/themes/default/folder.svg');
    assert.equal(resource.icon('folder-parent'), '/images/themes/default/folder-parent.svg');
    assert.equal(resource.icon('unknown'), '/images/themes/default/file.svg');
    assert.equal(resource.icon('custom-type'), '/images/themes/custom.svg');
});
