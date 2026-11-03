// Plays the current entry: a track in the bar's own audio element, a video
// in the preview. The controller sees one media whatever the entry is.
const {dom} = require('../../util');
const event = require('../../core/event');
const preview = require('../preview/preview');

const MEDIA_EVENTS = ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'error'];

const isPreviewShown = () => {
    const $overlay = dom('#pv-overlay');
    return $overlay.length > 0 && !$overlay.isHidden();
};

// `isVideo(item)`: whether an entry plays in the preview.
// `on`: handlers for MEDIA_EVENTS and `volumechange`, called without argument.
const createEngine = ({isVideo, on}) => {
    const audio = new global.window.Audio();
    audio.volume = 0.8;

    let current = null;
    // The queued video this player opened in the preview, if still shown there.
    let openedVideo = null;

    const currentIsVideo = () => !!current && isVideo(current);

    const video = () => {
        if (!currentIsVideo() || openedVideo !== current || !isPreviewShown() || preview.item !== current) {
            return null;
        }
        return dom('#pv-content-vid')[0] || null;
    };

    // The element playing the current entry, or null while its video is not
    // shown.
    const media = () => currentIsVideo() ? video() : audio;

    // The preview shows the queued video alone: its own previous and next
    // stay on it, the queue decides what follows.
    const openVideo = () => {
        openedVideo = current;
        preview.open([current], 0);
    };

    const closeVideo = () => {
        const shouldClose = !!openedVideo && isPreviewShown() && preview.item === openedVideo;
        // Cleared first: the preview's exit event must not pause the queue.
        openedVideo = null;
        if (shouldClose) {
            preview.close();
        }
    };

    // A preview the user opened is not taken over by the queue moving on by
    // itself; a video the user starts (play, next, a queue or row button)
    // replaces it.
    const previewIsFree = () => !isPreviewShown() || !!openedVideo && preview.item === openedVideo;

    // Loads `item`, and starts it when `play`. A video replaces a preview the
    // user opened only with `takeOver`. Returns whether it was asked to
    // start, and for a track the promise of audio.play().
    const load = (item, play, takeOver = false) => {
        current = item;
        if (currentIsVideo()) {
            audio.pause();
            if (play && (takeOver || previewIsFree())) {
                openVideo();
                return {started: true, promise: null};
            }
            closeVideo();
            return {started: false, promise: null};
        }
        // Leaving a queued video for a track closes its preview.
        closeVideo();
        audio.src = item.absHref;
        return play ? {started: true, promise: audio.play()} : {started: false, promise: null};
    };

    // Starts or resumes the current entry; a closed video opens again, over
    // any preview: the bar's play button or a media key asks for it.
    const play = () => {
        if (!currentIsVideo()) {
            return audio.play();
        }
        const el = video();
        if (!el) {
            openVideo();
            return Promise.resolve();
        }
        return Promise.resolve(el.play());
    };

    const pause = () => {
        const el = media();
        if (el) {
            el.pause();
        }
    };

    const stop = () => {
        current = null;
        audio.pause();
        audio.src = '';
        closeVideo();
    };

    // The audio element's events count while a track is current; the queued
    // video's ones while it is shown. Media events do not bubble, but they
    // reach a capturing document listener.
    MEDIA_EVENTS.forEach(type => {
        audio.addEventListener(type, () => {
            if (current && !currentIsVideo()) {
                on[type]();
            }
        });
        global.window.document.addEventListener(type, ev => {
            if (ev.target === video()) {
                on[type]();
            }
        }, true);
    });
    audio.addEventListener('volumechange', () => on.volumechange());

    // The native preview loads its video before attaching it: a failure or
    // the duration known by then is picked up once it is shown.
    event.sub('preview.content', (item, el) => {
        if (!item || item !== current || item !== openedVideo || !el) {
            return;
        }
        if (el.error) {
            on.error();
            return;
        }
        on.durationchange();
        if (!el.paused) {
            on.play();
        }
    });

    // Closing the preview of the queued video pauses the queue: playing
    // again opens it.
    event.sub('preview.exit', item => {
        if (item && item === openedVideo) {
            openedVideo = null;
            if (item === current) {
                on.pause();
            }
        }
    });

    // Another player (a video preview) starting pauses the track.
    global.window.document.addEventListener('play', ev => {
        if (ev.target !== audio && !audio.paused) {
            audio.pause();
        }
    }, true);

    return {
        audio,
        media,
        load,
        play,
        pause,
        stop
    };
};

module.exports = {
    createEngine
};
