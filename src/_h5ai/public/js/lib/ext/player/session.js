// The Media Session API: the current entry on the lock screen and in the
// notification, and the hardware media keys.

const getSession = () => {
    const nav = global.window.navigator;
    return nav && nav.mediaSession && typeof global.window.MediaMetadata === 'function' ? nav.mediaSession : null;
};

const setEntry = (item, artworkUrl) => {
    const session = getSession();
    if (!session || !item) {
        return;
    }
    session.metadata = new global.window.MediaMetadata({
        title: item.label,
        album: item.parent ? item.parent.label : '',
        artwork: artworkUrl ? [{src: artworkUrl}] : []
    });
};

const setPlaying = isPlaying => {
    const session = getSession();
    if (session) {
        session.playbackState = isPlaying ? 'playing' : 'paused';
    }
};

// `handlers`: {play, pause, previoustrack, nexttrack, seekto}.
const bindActions = handlers => {
    const session = getSession();
    if (!session) {
        return;
    }
    Object.keys(handlers).forEach(action => {
        try {
            session.setActionHandler(action, handlers[action]);
        } catch {
            // The browser does not know this action: the others still work.
        }
    });
};

module.exports = {
    setEntry,
    setPlaying,
    bindActions
};
