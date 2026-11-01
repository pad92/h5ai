const {test, assert} = require('scar');
const fs = require('fs');
const path = require('path');

const PAGES = path.join(__dirname, '../../../../src/_h5ai/private/php/pages');
const read = name => fs.readFileSync(path.join(PAGES, name), 'utf8');

// ext/theme appends its toggle to #toolbar: without one the info page has no
// way to switch themes.
test('page templates: the info page has a toolbar for the theme toggle', () => {
    assert.ok((/^\s*div#toolbar\b/m).test(read('info.php.pug')));
});

// The hint shows whenever h5ai fails to start, not only in old browsers, and
// browsehappy.com is gone.
test('page templates: the start failure hint links to no dead site', () => {
    const tpl = read('page.tpl.pug');
    assert.ok(!tpl.includes('browsehappy'));
    assert.ok((/span\.noBrowserMsg .*could not start/).test(tpl));
});
