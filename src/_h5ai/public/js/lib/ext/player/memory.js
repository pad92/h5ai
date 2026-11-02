// The player's state kept in the browser (localStorage, through core/store):
// the queue, the current entry and its position, and the settings.
const store = require('../../core/store');

const STORE_KEY = 'ext/player';
// A longer saved queue is cut: the state is read on every page load.
const MAX_ENTRIES = 5000;
const REPEAT_MODES = [0, 1, 2];

// A path of this site: `//host/...` would point to another one.
const isHref = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
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
        repeat: REPEAT_MODES.includes(raw.repeat) ? raw.repeat : 0
    };
};

module.exports = {
    save,
    load
};
