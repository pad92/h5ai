const {dom} = require('../../util');
const allsettings = require('../../core/settings');
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
        if (child.isFolder()) {
            return;
        }

        if (absHref.startsWith(baseHref)) {
            const ext = absHref.substring(baseHref.length).toLowerCase();
            if (ext.endsWith('.srt') || ext.endsWith('.vtt')) {
                let label = 'Subtitles';
                let lang = 'en';
                const match = ext.match(/^[\._\-]([a-z]{2,3})(\.(srt|vtt))$/);
                if (match) {
                    lang = match[1];
                    label = lang.toUpperCase();
                } else {
                    const cleaned = ext.replace(/\.(srt|vtt)$/, '').replace(/^[\._\-]/, '');
                    if (cleaned) {
                        label = cleaned.toUpperCase();
                    }
                }
                tracks.push({
                    src: child.absHref,
                    label,
                    srclang: lang
                });
            }
        }
    });

    return tracks;
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

const addUnloadFn = el => {
    const originalUnload = el.unload;
    el.unload = () => {
        if (typeof originalUnload === 'function') {
            originalUnload();
        }
        try {
            el.pause();
        } catch {
            /* ignore */
        }

        if (el.tagName.toLowerCase() === 'movi-player' && typeof el.unload === 'function') {
            try {
                el.unload();
            } catch {
                /* ignore */
            }
        } else {
            try {
                el.src = '';
                el.load();
            } catch {
                /* ignore */
            }
        }
    };
};

const loadNativeVideo = item => {
    return new Promise(resolve => {
        const $el = dom('<video id="pv-content-vid"/>')
            .on('loadedmetadata', () => resolve($el))
            .attr('controls', 'controls');
        if (settings.autoplay) {
            $el.attr('autoplay', 'autoplay');
        }
        addUnloadFn($el[0]);
        $el.attr('src', item.absHref);
    });
};

const loadMoviVideo = item => {
    return new Promise(resolve => {
        const $el = dom('<movi-player id="pv-content-vid"/>')
            .attr('controls', 'controls');
        if (settings.autoplay) {
            $el.attr('autoplay', 'autoplay');
        }

        const subtitleTracks = findSubtitleTracks(item);
        subtitleTracks.forEach(track => {
            const $track = dom('<track/>')
                .attr('kind', 'subtitles')
                .attr('src', track.src)
                .attr('srclang', track.srclang)
                .attr('label', track.label);
            $el.app($track);
        });

        $el.attr('src', item.absHref);
        addUnloadFn($el[0]);

        $el.on('loadedmetadata', () => resolve($el));

        const timeoutId = setTimeout(() => {
            resolve($el);
        }, 1500);

        $el.on('loadedmetadata', () => clearTimeout(timeoutId));
    });
};

const load = item => {
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
