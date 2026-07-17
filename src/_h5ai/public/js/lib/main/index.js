require('../view/viewmode');

require('../ext/autorefresh');
require('../ext/contextmenu');
require('../ext/crumb');
require('../ext/custom');
require('../ext/download');
require('../ext/filter');
require('../ext/info');
require('../ext/l10n');
require('../ext/piwik-analytics');
require('../ext/search');
require('../ext/select');
require('../ext/sort');
require('../ext/thumbnails');
require('../ext/title');
require('../ext/tree');
require('../ext/theme');

const settings = require('../core/settings');
const previewKeys = ['preview-aud', 'preview-img', 'preview-txt', 'preview-vid'];
const previewEnabled = previewKeys.some(key => settings[key] && settings[key].enabled);
const previewReady = previewEnabled ? import('../ext/preview') : Promise.resolve();

const href = global.window.document.location.href;
previewReady
    .then(() => require('../core/location').setLocation(href, true))
    .catch(err => {
        // A failed optional preview chunk must not prevent directory browsing.
        // eslint-disable-next-line no-console
        console.error('Unable to load preview features:', err);
        require('../core/location').setLocation(href, true);
    });
