const event = require('../core/event');
const location = require('../core/location');
const allsettings = require('../core/settings');
const {values} = require('../util');

const win = global.window;
const settings = Object.assign({
    enabled: false,
    interval: 5000
}, allsettings.autorefresh);
let timeoutId = null;
// A heartbeat fell while the tab was hidden: refresh once it is shown again.
let missed = false;
// Without autorefresh, a listing that shows expired folder sizes still
// refreshes until they are recomputed and stop blinking, for at most
// STALE_FOLLOW_UP ms per folder (the server takes over a refresh request
// left for five minutes).
const STALE_INTERVAL = 5000;
const STALE_FOLLOW_UP = 300000;
let staleSince = null;


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

const hasStaleSizes = item => values(item && item.content || {}).some(child => child.isSizeStale);

const leaveFolder = () => {
    staleSince = null;
    before();
};

const followStaleSizes = item => {
    win.clearTimeout(timeoutId);
    if (!hasStaleSizes(item)) {
        staleSince = null;
        return;
    }
    const now = Date.now();
    staleSince = staleSince === null ? now : staleSince;
    if (now - staleSince < STALE_FOLLOW_UP) {
        timeoutId = win.setTimeout(heartbeat, STALE_INTERVAL);
    }
};

const init = () => {
    win.document.addEventListener('visibilitychange', onVisibilityChange);
    if (!settings.enabled) {
        event.sub('location.beforeChange', leaveFolder);
        event.sub('location.beforeRefresh', before);
        event.sub('location.changed', followStaleSizes);
        event.sub('location.refreshed', followStaleSizes);
        return;
    }

    settings.interval = Math.max(1000, settings.interval);

    event.sub('location.beforeChange', before);
    event.sub('location.beforeRefresh', before);
    event.sub('location.changed', after);
    event.sub('location.refreshed', after);
};


init();
