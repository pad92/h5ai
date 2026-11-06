const {dom, onActivationKey} = require('../../util');
const allsettings = require('../../core/settings');
const event = require('../../core/event');
const i18n = require('../../core/i18n');
const {addUnloadFn} = require('../../util/media');
const preview = require('./preview');

const CAST_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.92-11-11-11zm21-7H2c-1.1 0-2 .9-2 2v3h2V5h20v14h-9v2h9c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>';

const MOVI_CAST_ID = 'h5ai-cast';

// The browser owns device discovery and casting; h5ai only shows a button
// while the browser reports a reachable device. The Remote Playback API
// (Chrome, Edge, Safari) is preferred. Safari without it only has the AirPlay
// picker, which announces devices through its own event.
// Returns null when the browser offers no route, else {prompt, stop}.
const watchCastTargets = (media, onChange) => {
    const remote = media.remote;
    if (remote && typeof remote.prompt === 'function') {
        let watchId = null;
        let stopped = false;
        if (typeof remote.watchAvailability === 'function') {
            remote.watchAvailability(available => {
                if (!stopped) {
                    onChange(available);
                }
            }).then(id => {
                watchId = id;
                // The preview may have closed before the watch was registered.
                if (stopped && remote.cancelWatchAvailability) {
                    remote.cancelWatchAvailability(id).catch(() => {});
                }
            }).catch(() => {
                // The spec's advice when availability cannot be monitored
                // (Chrome on Android, data saver): show the button and let
                // prompt() report whether a device is there.
                if (!stopped) {
                    onChange(true);
                }
            });
        } else {
            onChange(true);
        }
        return {
            // prompt() rejects when the user dismisses the picker or no device
            // answers; the browser has already told the user, nothing to add.
            prompt: () => remote.prompt().catch(() => {}),
            stop: () => {
                stopped = true;
                if (watchId !== null && remote.cancelWatchAvailability) {
                    remote.cancelWatchAvailability(watchId).catch(() => {});
                }
            }
        };
    }

    if (typeof media.webkitShowPlaybackTargetPicker === 'function') {
        const onAvailability = ev => onChange(ev.availability === 'available');
        media.addEventListener('webkitplaybacktargetavailabilitychanged', onAvailability);
        return {
            prompt: () => media.webkitShowPlaybackTargetPicker(),
            stop: () => media.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvailability)
        };
    }

    return null;
};

const beforeUnload = (el, fn) => {
    const originalUnload = el.unload;
    el.unload = function unload() {
        fn();
        if (typeof originalUnload === 'function') {
            originalUnload.call(this);
        }
    };
};

// Native <video>: a button in the preview bar, next to the other bar buttons.
const addCastButton = el => {
    const $button = i18n.apply(dom('<li id="pv-bar-cast" class="bar-right bar-button hidden l10n_title-castToDevice l10n_aria-castToDevice" role="button" tabindex="0"/>'))
        .html(CAST_ICON);
    const cast = watchCastTargets(el, available => {
        if (available) {
            $button.rmCls('hidden');
        } else {
            $button.addCls('hidden');
        }
    });
    if (!cast) {
        return;
    }

    dom('#pv-buttons').app($button);
    $button.on('click', cast.prompt).on('keydown', onActivationKey(cast.prompt));
    beforeUnload(el, () => {
        cast.stop();
        $button.rm();
    });
};

// Movi: a control in its own bar, through its addControl() API. Only its
// native engine plays through the <video> in its shadow root; the WASM engine
// draws on a canvas and leaves that element without a source, so there is
// nothing to cast. Movi sets and removes that source when it switches engine,
// which the element announces with loadstart and emptied.
const addMoviCastControl = player => {
    const media = player.shadowRoot && player.shadowRoot.querySelector('video');
    if (!media) {
        return;
    }

    let deviceAvailable = false;
    let shown = false;
    let unloaded = false;
    let cast = null;
    const playsNatively = () => Boolean(media.currentSrc || media.getAttribute('src') || media.srcObject);
    const refresh = () => {
        const show = !unloaded && deviceAvailable && playsNatively();
        if (show === shown) {
            return;
        }
        shown = show;
        if (show) {
            player.addControl({
                id: MOVI_CAST_ID,
                label: i18n.t('castToDevice'),
                icon: CAST_ICON,
                // Movi's documented spot for a cast button: the top corner while
                // watching, and a named row in the context menu.
                placement: ['top', 'menu'],
                media: 'video',
                onSelect: () => cast.prompt()
            });
        } else {
            player.removeControl(MOVI_CAST_ID);
        }
    };
    cast = watchCastTargets(media, available => {
        deviceAvailable = available;
        refresh();
    });
    if (!cast) {
        return;
    }

    media.addEventListener('loadstart', refresh);
    media.addEventListener('emptied', refresh);
    refresh();

    beforeUnload(player, () => {
        unloaded = true;
        cast.stop();
        media.removeEventListener('loadstart', refresh);
        media.removeEventListener('emptied', refresh);
        refresh();
    });
};

// Movi's playback engines, by its own names.
const MOVI_ENGINES = ['wasm', 'native', 'shaka', 'dashjs', 'hlsjs'];

// The `engine` option as Movi's attribute: known names only, each once, in
// the given order. '' (the default, or nothing valid) keeps Movi's own
// order, which plays the most formats.
const moviEngine = value => {
    if (typeof value !== 'string') {
        return '';
    }
    return [...new Set(value.trim().split(/\s+/).filter(name => MOVI_ENGINES.includes(name)))].join(' ');
};

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
            label: suffix ? suffix.toUpperCase() : i18n.t('subtitles'),
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
    // Read as the video loads. "native wasm" puts the browser first, which
    // casting needs (addMoviCastControl): an option, as it gives up Movi's
    // decoding for every file the browser claims to play.
    const engine = moviEngine((allsettings['preview-vid'] || {}).engine);
    if (engine) {
        $el.attr('engine', engine);
    }
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

// Cast is wired once the element is in the preview: preview.js unloads only
// what it attached, so a video dropped while loading (the user moved on, or it
// never got its metadata) must not leave a button or a device watch behind.
const onContent = (item, el) => {
    if (!el || el.id !== 'pv-content-vid') {
        return;
    }
    if (el.tagName.toLowerCase() === 'movi-player') {
        addMoviCastControl(el);
    } else {
        addCastButton(el);
    }
};

const init = () => {
    if (settings.enabled) {
        preview.register(settings.types, load, updateGui);
        event.sub('preview.content', onContent);
    }
};

init();
