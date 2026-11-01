const {test, assert} = require('scar');
const {dom} = require('../../../../src/_h5ai/public/js/lib/util/dom');

test('DOM class toggling preserves independent selection state', () => {
    const el = document.createElement('div');
    const $el = dom(el);
    $el.addCls('selected');
    $el.tglCls('selected');
    assert.equal($el.hasCls('selected'), false);
    $el.tglCls('selected');
    assert.equal($el.hasCls('selected'), true);
});
