// The player: plays the queue through the engine and keeps the view, the
// covers and the Media Session in step with it.
const {includes} = require('../../util');
const preview = require('../preview/preview');
const {createQueue} = require('./queue');
const {createEngine} = require('./engine');
const {canPlay} = require('./formats');
const covers = require('./covers');
const session = require('./session');
const view = require('./view');

const REPEAT_OFF = 0;
const REPEAT_QUEUE = 1;
const REPEAT_SONG = 2;
const DEFAULT_VOLUME = 0.8;
// Back from further than this replays the entry instead of the previous one.
const RESTART_THRESHOLD = 3;

// `audioTypes` and `videoTypes`: item types of tracks and videos.
const createPlayer = ({audioTypes, videoTypes}) => {
    const queue = createQueue();
    let engine = null;
    // The entry loaded into the engine; null once stopped.
    let loaded = null;
    let isPlaying = false;
    let repeat = REPEAT_OFF;
    let lastVolume = DEFAULT_VOLUME;
    // Entries that failed in a row: stops moving on once all of them failed.
    let failedInARow = 0;
    // Whether the current entry was meant to play: a failure only moves the
    // queue on when it was.
    let playRequested = false;

    // Videos play in the preview, which shows them only once an enabled
    // preview-vid registered their type.
    const isVideo = item => !!item && includes(videoTypes, item.type) && preview.canOpen(item);
    const isTrack = item => !!item && includes(audioTypes, item.type) && canPlay(engine.audio, item);

    const coverFor = item => covers.coverFor(item, isVideo(item));

    const renderQueue = () => view.renderQueue(queue.entries, {
        current: queue.current,
        isVideo,
        coverFor,
        onSelect: item => jumpTo(item), // eslint-disable-line no-use-before-define
        onRemove: item => remove(item) // eslint-disable-line no-use-before-define
    });

    const setPlaying = playing => {
        isPlaying = playing;
        view.setPlaying(playing);
        view.markListing(loaded, playing);
        session.setPlaying(playing);
    };

    // Shows `url` once it loads, or the next best cover, or the gradient.
    const displayCover = (item, url, isRetry) => {
        if (item !== loaded) {
            return;
        }
        if (!url) {
            view.showCoverFallback(item, isVideo(item));
            return;
        }
        const probe = new global.window.Image();
        probe.onload = () => {
            if (item === loaded) {
                view.showCover(url);
                session.setEntry(item, url);
            }
        };
        probe.onerror = () => {
            if (item !== loaded) {
                return;
            }
            if (!isRetry) {
                covers.markBroken(item, url);
                const other = coverFor(item);
                if (other && other !== url) {
                    displayCover(item, other, true);
                    return;
                }
            }
            view.showCoverFallback(item, isVideo(item));
        };
        probe.src = url;
    };

    // The lookup may finish after the user moved on: its result stays with
    // the entry that asked for it.
    const showCover = item => {
        displayCover(item, coverFor(item));
        if (covers.needsLookup(item)) {
            covers.lookup(item).then(() => {
                displayCover(item, coverFor(item));
                renderQueue();
            });
        }
    };

    // Loads the queue's current entry; `shouldPlay` false leaves it paused.
    const loadCurrent = (shouldPlay = true) => {
        const item = queue.current;
        if (!item) {
            return;
        }
        loaded = item;
        playRequested = shouldPlay;

        view.setError(false);
        view.showBar();
        view.setEntry(item);
        view.resetProgress();
        session.setEntry(item, null);
        showCover(item);
        renderQueue();

        const {started, promise} = engine.load(item, shouldPlay);
        if (!promise) {
            playRequested = started;
            setPlaying(false);
            return;
        }
        promise
            .then(() => {
                failedInARow = 0;
                setPlaying(true);
            })
            .catch(err => {
                // A blocked autoplay waits for the play button; an undecodable
                // file is reported by the media's error event.
                // eslint-disable-next-line no-console
                console.warn('Playback did not start:', err);
                setPlaying(false);
            });
    };

    const goTo = (item, shouldPlay = true) => {
        if (!item) {
            return false;
        }
        queue.select(item);
        loadCurrent(shouldPlay);
        return true;
    };

    const stop = () => {
        engine.stop();
        loaded = null;
        failedInARow = 0;
        setPlaying(false);
        view.setError(false);
        view.hideBar();
    };

    const jumpTo = item => goTo(item);

    const next = () => goTo(queue.next(true));

    const previous = () => {
        const media = engine.media();
        if (media && media.currentTime > RESTART_THRESHOLD) {
            media.currentTime = 0;
        } else {
            goTo(queue.previous());
        }
    };

    const togglePlay = () => {
        if (!loaded) {
            const tracks = view.listedItems(isTrack);
            if (tracks.length) {
                queue.replace(tracks, tracks[0]);
                loadCurrent();
            }
            return;
        }
        const media = engine.media();
        if (media && !media.paused) {
            engine.pause();
            return;
        }
        engine.play()
            .then(() => {
                if (!isVideo(loaded)) {
                    setPlaying(true);
                }
            })
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error('Play error:', err);
            });
    };

    // Plays `item` with the listed entries of its kind (tracks or videos) as
    // the queue, or alone when it is not listed.
    const playFolder = (item, shouldPlay = true) => {
        covers.release(queue.entries);
        failedInARow = 0;
        const siblings = view.listedItems(isVideo(item) ? isVideo : isTrack);
        queue.replace(siblings.includes(item) ? siblings : [item], item);
        loadCurrent(shouldPlay);
    };

    // An idle player starts with the entry it is given.
    const startIfIdle = item => {
        if (!loaded) {
            goTo(item);
        }
    };

    const enqueue = item => {
        queue.add(item);
        view.showBar();
        renderQueue();
        startIfIdle(item);
    };

    const playNext = item => {
        queue.insertNext(item);
        view.showBar();
        renderQueue();
        startIfIdle(item);
    };

    const remove = item => {
        covers.release([item]);
        const wasCurrent = item === queue.current;
        const following = queue.remove(item);
        if (wasCurrent) {
            if (following) {
                loadCurrent();
            } else {
                stop();
            }
        }
        renderQueue();
    };

    const clear = () => {
        covers.release(queue.entries);
        queue.clear();
        stop();
        renderQueue();
    };

    const onEnded = () => {
        if (repeat === REPEAT_SONG) {
            const media = engine.media();
            if (media) {
                media.currentTime = 0;
                Promise.resolve(media.play()).catch(err => {
                    // eslint-disable-next-line no-console
                    console.error('Replay error:', err);
                });
            }
            return;
        }
        if (!goTo(queue.next(repeat === REPEAT_QUEUE))) {
            setPlaying(false);
        }
    };

    // A failed entry is shown as such and the queue moves on, until every
    // entry failed in a row.
    const onError = () => {
        failedInARow += 1;
        setPlaying(false);
        view.showBar();
        view.setError(true);
        if (playRequested && failedInARow < queue.length) {
            goTo(queue.next(repeat === REPEAT_QUEUE));
        }
    };

    const onTimeUpdate = () => {
        const media = engine.media();
        if (!media) {
            return;
        }
        if (media.currentTime > 0) {
            // Real progress: the entry plays, whatever failed before. Also
            // catches up a start missed while the video was not attached.
            failedInARow = 0;
            if (!media.paused && !isPlaying) {
                setPlaying(true);
            }
        }
        if (media.duration && !view.isSeeking()) {
            view.setProgress(media.currentTime, media.duration);
        }
    };

    const onDurationChange = () => {
        const media = engine.media();
        if (media && media.duration) {
            view.setDuration(media.duration);
        }
    };

    const seekTo = time => {
        const media = engine.media();
        if (media && media.duration && Number.isFinite(time)) {
            media.currentTime = time;
        }
    };

    const durationOf = () => {
        const media = engine.media();
        return media && media.duration ? media.duration : 0;
    };

    // Track volume only: videos keep their own controls.
    const setVolume = volume => {
        engine.audio.volume = volume;
        engine.audio.muted = volume === 0;
    };

    const showMuted = () => view.setMutedIcon(engine.audio.muted || engine.audio.volume === 0);

    const toggleMute = () => {
        const {audio} = engine;
        if (audio.muted) {
            audio.muted = false;
            audio.volume = lastVolume;
        } else {
            lastVolume = audio.volume > 0 ? audio.volume : DEFAULT_VOLUME;
            audio.muted = true;
        }
        view.setVolume(audio.volume, audio.muted);
        showMuted();
    };

    const init = () => {
        engine = createEngine({
            isVideo,
            on: {
                timeupdate: onTimeUpdate,
                durationchange: onDurationChange,
                play: () => setPlaying(true),
                pause: () => setPlaying(false),
                ended: onEnded,
                error: () => {
                    if (loaded) {
                        onError();
                    }
                },
                volumechange: showMuted
            }
        });

        view.mount({
            togglePlay,
            next,
            previous,
            toggleShuffle: () => {
                queue.setShuffle(!queue.isShuffled);
                view.setShuffle(queue.isShuffled);
            },
            cycleRepeat: () => {
                repeat = (repeat + 1) % 3;
                view.setRepeat(repeat);
            },
            seek: percent => seekTo(durationOf() * percent / 100),
            previewSeek: percent => durationOf() ? durationOf() * percent / 100 : null,
            setVolume,
            toggleMute,
            queueToggled: renderQueue,
            clear,
            close: clear
        });

        session.bindActions({
            play: () => !isPlaying && togglePlay(),
            pause: () => isPlaying && togglePlay(),
            previoustrack: previous,
            nexttrack: next,
            seekto: details => seekTo(details.seekTime)
        });
    };

    // A row click opens the player like a preview: `autoplay` decides
    // whether it also starts. The row buttons always start.
    const rowActions = {
        play: item => playFolder(item),
        next: playNext,
        queue: enqueue
    };

    return {
        init,
        isTrack,
        isVideo,
        playFolder,
        rowActions,
        refreshListing: () => view.markListing(loaded, isPlaying)
    };
};

module.exports = {
    createPlayer
};
