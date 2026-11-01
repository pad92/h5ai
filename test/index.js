if (!global.window) {
    const {JSDOM} = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
        url: 'http://localhost/'
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.DOMParser = dom.window.DOMParser;
}

const {test} = require('scar');
void test; // eslint-disable-line no-void
const {pin_html} = require('./util/pin');

require('./tests/premisses');
require('./tests/unit/core/event');
require('./tests/unit/core/format');
require('./tests/unit/util/naturalCmp');
require('./tests/unit/util/parsePattern');
require('./tests/unit/util/sanitizeHtml');
require('./tests/unit/util/media');
require('./tests/unit/preview-md');
require('./tests/unit/types-md');
require('./tests/unit/server');
require('./tests/unit/main/infoChecks');
require('./tests/unit/ext/tasksProgress');
require('./tests/unit/packageName');

pin_html();
