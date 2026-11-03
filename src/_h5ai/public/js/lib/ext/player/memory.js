// The player's state kept in the browser (localStorage, through core/store):
// the queue, the current entry and its position, and the settings.
const store = require('../../core/store');
const {MODES} = require('./vizmath');

const win = global.window;

const STORE_KEY = 'ext/player';
// A longer saved queue is cut: the state is read on every page load.
const MAX_ENTRIES = 5000;
const REPEAT_MODES = [0, 1, 2];

// A path of this site. `//host/...` points to another one, and so do
// `/\host/...` and `/<tab>/host/...`: URL parsing reads a backslash as a
// slash and drops tabs and newlines. Such characters never occur in an
// encoded href, so they are refused before the origin is checked.
const isUnsafeChar = char => char === '\\' || char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f;
const isHref = value => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || [...value].some(isUnsafeChar)) {
        return false;
    }
    try {
        return new URL(value, win.location.href).origin === win.location.origin;
    } catch {
        return false;
    }
};
const isUnit = value => typeof value === 'number' && value >= 0 && value <= 1;

// Storage may be full or disabled (private browsing): the player then works
// as before, unsaved.
const save = state => {
    try {
        store.put(STORE_KEY, state);
    } catch {
        // Nothing to do: the next change tries again.
    }
};

// The saved state with every field checked, or null. The page's own
// storage, but edited by hand or by an older version just as well.
const load = () => {
    let raw;
    try {
        raw = store.get(STORE_KEY);
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const queue = Array.isArray(raw.queue) ? raw.queue.filter(isHref).slice(0, MAX_ENTRIES) : [];
    return {
        queue,
        current: isHref(raw.current) && queue.includes(raw.current) ? raw.current : null,
        time: Number.isFinite(raw.time) && raw.time > 0 ? raw.time : 0,
        volume: isUnit(raw.volume) ? raw.volume : null,
        lastVolume: isUnit(raw.lastVolume) && raw.lastVolume > 0 ? raw.lastVolume : null,
        muted: raw.muted === true,
        shuffle: raw.shuffle === true,
        repeat: REPEAT_MODES.includes(raw.repeat) ? raw.repeat : 0,
        visualizer: MODES.includes(raw.visualizer) ? raw.visualizer : null
    };
};

module.exports = {
    save,
    load
};
