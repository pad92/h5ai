const event = require('../core/event');
const location = require('../core/location');
const allsettings = require('../core/settings');

const win = global.window;
const settings = Object.assign({
    enabled: false,
    interval: 5000
}, allsettings.autorefresh);
let timeoutId = null;
// A heartbeat fell while the tab was hidden: refresh once it is shown again.
let missed = false;


// A hidden tab sends no request, so a forgotten tab does not list its folder
// every few seconds for nothing.
const heartbeat = () => {
    if (win.document.hidden) {
        missed = true;
        return;
    }
    location.refresh();
};

const onVisibilityChange = () => {
    if (!win.document.hidden && missed) {
        missed = false;
        location.refresh();
    }
};

const before = () => {
    missed = false;
    win.clearTimeout(timeoutId);
};

const after = () => {
    win.clearTimeout(timeoutId);
    timeoutId = win.setTimeout(heartbeat, settings.interval);
};

const init = () => {
    if (!settings.enabled) {
        return;
    }

    settings.interval = Math.max(1000, settings.interval);

    event.sub('location.beforeChange', before);
    event.sub('location.beforeRefresh', before);
    event.sub('location.changed', after);
    event.sub('location.refreshed', after);
    win.document.addEventListener('visibilitychange', onVisibilityChange);
};


init();
