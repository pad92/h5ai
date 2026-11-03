// Interface strings. The English ones below are the defaults; ext/l10n
// replaces them with the current language through set(), and every key must
// also be in conf/l10n/en.json, which translators start from.
//
// Elements name their strings with classes, so a language change reaches
// them wherever they are: `l10n-KEY` sets the text, `l10n_ph-KEY` the
// placeholder, `l10n_title-KEY` the title, `l10n_aria-KEY` the aria-label
// and `l10n_alt-KEY` the alt text. An element built after the language was
// set calls apply() on itself; a string used outside the DOM calls t().
const event = require('./event');

const defaults = {
    isoCode: 'en',
    lang: 'english',
    dateFormat: 'YYYY-MM-DD HH:mm',

    // listing and sidebar
    details: 'details',
    download: 'download',
    empty: 'empty',
    files: 'files',
    filter: 'filter',
    folders: 'folders',
    grid: 'grid',
    icons: 'icons',
    indexPage: 'has index page',
    info: 'Info',
    language: 'Language',
    lastModified: 'Last modified',
    name: 'Name',
    noMatch: 'no match',
    parentDirectory: 'Parent Directory',
    qrCode: 'QR code of the link',
    search: 'search',
    selected: 'selected',
    sidebar: 'sidebar',
    size: 'Size',
    sortOrder: 'sort order',
    taskRefresh: 'folder sizes',
    taskThumbs: 'thumbnails',
    taskWarmer: 'cache warming',
    tasks: 'tasks in progress',
    theme: 'Toggle theme',
    tree: 'Tree',
    view: 'View',
    poweredBy: 'powered by h5ai',
    loadingFailed: 'loading failed',
    refreshFailed: 'refresh failed',

    // preview
    close: 'close',
    fullscreen: 'fullscreen',
    loading: 'loading',
    next: 'next',
    previous: 'previous',
    raw: 'raw',
    requestFailed: 'request failed',
    networkError: 'network error',
    requestTimedOut: 'request timed out',
    castToDevice: 'Cast to a device',
    subtitles: 'Subtitles',
    photoDetails: 'Photo Details',
    viewOnMap: 'View on Google Maps',
    focal: 'Focal',
    aperture: 'Aperture',
    shutter: 'Shutter',

    // audio player
    cover: 'cover',
    noTrack: 'No Track',
    unknownFolder: 'Unknown Folder',
    cannotPlay: 'Cannot play this file',
    shuffle: 'Shuffle',
    previousTrack: 'Previous',
    playPause: 'Play/Pause',
    nextTrack: 'Next',
    repeatOff: 'Repeat (Off)',
    repeatQueue: 'Repeat (Queue)',
    repeatTrack: 'Repeat (Song)',
    seek: 'Seek',
    mute: 'Mute',
    volume: 'Volume',
    toggleQueue: 'Toggle Queue',
    closePlayer: 'Stop and close player',
    playQueue: 'Play Queue',
    exportQueue: 'Export',
    exportQueueHint: 'Save the queue as a playlist for VLC, MPC or another player',
    clearQueue: 'Clear',
    closeQueue: 'Close queue',
    playNow: 'Play Now',
    playFolder: 'Play folder from here',
    playNext: 'Play Next',
    addToQueue: 'Add to Queue',
    removeFromQueue: 'Remove from queue',
    nowPlaying: 'Now playing',
    showNowPlaying: 'Show now playing',
    reduce: 'Reduce',
    genre: 'Genre',
    track: 'Track',
    albumArtist: 'Album artist',
    duration: 'Duration',
    format: 'Format',
    bitRate: 'Bit rate',
    file: 'File',
    vizSpectrum: 'Spectrum analyser',
    vizScope: 'Oscilloscope',
    vizPlasma: 'Plasma',
    vizKaleido: 'Kaleidoscope',
    vizVortex: 'Vortex',
    vizCover: 'Cover',
    // %s: the name of the current display, one of the viz* strings.
    vizSwitch: '%s (click to change)'
};

const SETTERS = [
    ['l10n-', (el, value) => {
        el.textContent = value;
    }],
    ['l10n_ph-', (el, value) => el.setAttribute('placeholder', value)],
    ['l10n_title-', (el, value) => el.setAttribute('title', value)],
    ['l10n_aria-', (el, value) => el.setAttribute('aria-label', value)],
    ['l10n_alt-', (el, value) => el.setAttribute('alt', value)]
];

let current = Object.assign({}, defaults);

// The string of `key` in the current language, English when the language
// lacks it. Each %s takes the next of `args`.
const t = (key, ...args) => {
    const value = Object.hasOwn(current, key) ? current[key] : defaults[key];
    const text = typeof value === 'string' ? value : key;
    // A function replacement, so `$&` or `$$` in an argument stay literal.
    return args.reduce((str, arg) => str.replace('%s', () => String(arg)), text);
};

const applyTo = el => {
    const classes = el.classList ? Array.from(el.classList) : [];
    classes.forEach(cls => {
        SETTERS.forEach(([prefix, setter]) => {
            if (cls.startsWith(prefix)) {
                const key = cls.slice(prefix.length);
                if (Object.hasOwn(defaults, key)) {
                    setter(el, t(key));
                }
            }
        });
    });
};

// Translates `root` (an element, a dom() wrapper or the document) and every
// marked element inside it.
const apply = root => {
    const roots = root && root.querySelectorAll ? [root] : Array.from(root || []);
    roots.forEach(node => {
        applyTo(node);
        node.querySelectorAll('[class*="l10n"]').forEach(applyTo);
    });
    return root;
};

// Marks `el` with `key` for each of `kinds` ('text', 'title', 'aria', 'alt')
// in place of its previous key of that kind, and translates it: for a label
// that changes with a state, such as the repeat button. A null `key` only
// drops the marks, before the element shows something else, such as a track
// name, that a language change must not overwrite.
const KIND_PREFIX = {text: 'l10n-', title: 'l10n_title-', aria: 'l10n_aria-', alt: 'l10n_alt-'};
const mark = (root, key, kinds) => {
    const els = root && root.classList ? [root] : Array.from(root || []);
    els.forEach(el => {
        kinds.forEach(kind => {
            const prefix = KIND_PREFIX[kind];
            Array.from(el.classList)
                .filter(cls => cls.startsWith(prefix))
                .forEach(cls => el.classList.remove(cls));
            if (key !== null) {
                el.classList.add(prefix + key);
            }
        });
        applyTo(el);
    });
    return root;
};

// `table`: the strings of a language, from conf/l10n/<code>.json.
const set = table => {
    current = Object.assign({}, defaults, table);
    if (global.window && global.window.document) {
        apply(global.window.document);
    }
    event.pub('l10n.changed', current.isoCode);
};

module.exports = {
    defaults,
    t,
    apply,
    mark,
    set,
    get isoCode() {
        return current.isoCode;
    },
    get dateFormat() {
        return current.dateFormat;
    }
};
