const {dom} = require('../../util');
const allsettings = require('../../core/settings');
const {addUnloadFn} = require('../../util/media');
const preview = require('./preview');

const settings = Object.assign({
    enabled: false,
    autoplay: true,
    types: []
}, allsettings['preview-vid']);

const loadMoviPlayerScript = () => {
    if (global.window.customElements.get('movi-player')) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = global.window.document.createElement('script');
        script.type = 'module';
        script.src = allsettings.publicHref + 'ext/movi-player/element.js';
        script.onload = () => resolve();
        script.onerror = e => reject(e);
        global.window.document.head.appendChild(script);
    });
};

// A subtitle belongs to a video when its name is the video's name, optionally
// followed by a [._-] separated suffix: "movie.srt", "movie.fr.srt",
// "movie_en.forced.vtt". "Episode 10.srt" is not a subtitle of "Episode 1.mkv".
const SUBTITLE_RE = /^(?:[._-]([^/]+?))?\.(srt|vtt)$/i;
const LANG_RE = /^([a-z]{2,3})(?:[._-]|$)/i;

const findSubtitleTracks = item => {
    if (!item.parent || !item.parent.content) {
        return [];
    }

    const lastDotIdx = item.absHref.lastIndexOf('.');
    if (lastDotIdx === -1) {
        return [];
    }
    const baseHref = item.absHref.substring(0, lastDotIdx);

    const tracks = [];
    Object.keys(item.parent.content).forEach(absHref => {
        const child = item.parent.content[absHref];
        if (child.isFolder() || !absHref.startsWith(baseHref)) {
            return;
        }
        const match = SUBTITLE_RE.exec(absHref.substring(baseHref.length));
        if (!match) {
            return;
        }

        let suffix = match[1] || '';
        try {
            suffix = decodeURIComponent(suffix);
        } catch {/* keep the encoded suffix */}
        const langMatch = LANG_RE.exec(suffix);
        tracks.push({
            src: child.absHref,
            format: match[2].toLowerCase(),
            label: suffix ? suffix.toUpperCase() : 'Subtitles',
            // No language is guessed for an unsuffixed file.
            srclang: langMatch ? langMatch[1].toLowerCase() : ''
        });
    });

    return tracks;
};

const appendTracks = ($el, tracks) => {
    tracks.forEach(track => {
        const $track = dom('<track/>')
            .attr('kind', 'subtitles')
            .attr('src', track.src)
            .attr('label', track.label);
        if (track.srclang) {
            $track.attr('srclang', track.srclang);
        }
        $el.app($track);
    });
};

const updateGui = () => {
    const el = dom('#pv-content-vid')[0];
    if (!el) {
        return;
    }

    const elW = el.offsetWidth;
    const elVW = el.videoWidth || 0;
    const elVH = el.videoHeight || 0;

    preview.setLabels([
        preview.item.label,
        String(elVW) + 'x' + String(elVH),
        String((100 * elW / (elVW || 1)).toFixed(0)) + '%'
    ]);
};

// An undecodable file resolves too: the preview then shows the browser's
// broken-video state instead of a spinner that never ends.
const loadNativeVideo = item => {
    return new Promise(resolve => {
        const $el = dom('<video id="pv-content-vid"/>')
            .on('loadedmetadata', () => resolve($el))
            .on('error', () => resolve($el))
            .attr('controls', 'controls');
        if (settings.autoplay) {
            $el.attr('autoplay', 'autoplay');
            $el.on('loadeddata', () => {
                const isPlaying = $el[0].currentTime > 0 && !$el[0].paused && !$el[0].ended;
                if (!isPlaying) {
                    $el[0].play();
                }
            });
        }
        // The native element reads WebVTT only.
        appendTracks($el, findSubtitleTracks(item).filter(track => track.format === 'vtt'));
        addUnloadFn($el[0]);
        $el.attr('src', item.absHref);
    });
};

// movi-player starts loading only once connected, and the preview attaches
// the element after this promise resolves: waiting for its metadata here
// would only add a delay. The labels follow once the metadata is known.
const loadMoviVideo = item => {
    const $el = dom('<movi-player id="pv-content-vid"/>')
        .attr('controls', 'controls');
    if (settings.autoplay) {
        $el.attr('autoplay', 'autoplay');
    }

    appendTracks($el, findSubtitleTracks(item));

    $el.on('loadedmetadata', () => {
        if (preview.item === item) {
            updateGui();
        }
    });
    $el.attr('src', item.absHref);
    addUnloadFn($el[0]);
    return Promise.resolve($el);
};

const load = item => {
    preview.setControlType('vid');
    if (!global.window.crossOriginIsolated) {
        return loadNativeVideo(item);
    }
    return loadMoviPlayerScript()
        .then(() => {
            return loadMoviVideo(item);
        })
        .catch(err => {
            // eslint-disable-next-line no-console
            console.error('Failed to load movi-player, falling back to standard <video>:', err);
            return loadNativeVideo(item);
        });
};

const init = () => {
    if (settings.enabled) {
        preview.register(settings.types, load, updateGui);
    }
};

init();
