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
const config = require('../src/_h5ai/public/js/lib/config');
config.setup = {PUBLIC_HREF: '/', ROOT_HREF: '/', VERSION: 'test'};
config.options = {
    view: {fastBrowsing: true, modeToggle: 'next', modes: ['details', 'grid', 'icons'], sizes: [20, 40, 80]},
    select: {enabled: true, clickndrag: true, checkboxes: true},
    sort: {enabled: true, column: 0, reverse: false, ignorecase: true, natural: true, folders: 0},
    title: {enabled: true},
    crumb: {enabled: true},
    info: {enabled: true, show: false, qrcode: false},
    tree: {enabled: true, show: true, maxSubfolders: 50, naturalSort: true, ignorecase: true},
    contextmenu: {enabled: true},
    'preview-aud': {enabled: true, autoplay: true, types: ['aud']},
    'preview-img': {enabled: true, size: 1000, types: ['img']},
    tasks: {enabled: true, interval: 3000, idleInterval: 30000},
    download: {enabled: true, type: 'shell-zip', packageName: 'selected'},
    search: {enabled: true, advanced: true, debounceTime: 0, ignorecase: true},
    filter: {enabled: true, advanced: true, debounceTime: 0, ignorecase: true},
    l10n: {enabled: true, lang: 'fr', useBrowserLang: false},
    'preview-vid': {enabled: true, autoplay: false, types: ['vid']},
    'preview-txt': {enabled: true, styles: {txt: 1}},
    thumbnails: {enabled: true, delay: 0, chunksize: 2, img: ['img']}
};
config.types = {
    'txt-md': {glob: ['*.md']},
    image: {glob: ['*.png', '*.jpg']}
};
config.langs = {en: 'english', fr: 'français'};
config.theme = {};
const {pin_html} = require('./util/pin');

require('./tests/premisses');
require('./tests/unit/core/event');
require('./tests/unit/core/format');
require('./tests/unit/core/location');
require('./tests/unit/core/locationNavigation');
require('./tests/unit/core/store-resource');
require('./tests/unit/model/item');
require('./tests/unit/util/naturalCmp');
require('./tests/unit/util/parsePattern');
require('./tests/unit/util/sanitizeHtml');
require('./tests/unit/util/media');
require('./tests/unit/preview-md');
require('./tests/unit/preview-exif');
require('./tests/unit/preview-content');
require('./tests/unit/types-md');
require('./tests/unit/server');
require('./tests/unit/main/infoChecks');
require('./tests/unit/main/info');
require('./tests/unit/ext/custom');
require('./tests/unit/ext/piwikAnalytics');
require('./tests/unit/ext/autorefresh');
require('./tests/unit/ext/previewControls');
require('./tests/unit/ext/tasksProgress');
require('./tests/unit/ext/select');
require('./tests/unit/packageName');

pin_html();
