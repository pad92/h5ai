// The player: plays the queue through the engine and keeps the view, the
// covers and the Media Session in step with it.
const {includes} = require('../../util');
const Item = require('../../model/item');
const event = require('../../core/event');
const viewBase = require('../../view/base');
const preview = require('../preview/preview');
const {createQueue} = require('./queue');
const {createEngine} = require('./engine');
const {canPlay} = require('./formats');
const covers = require('./covers');
const session = require('./session');
const nowPlaying = require('./nowplaying');
const {createVisualizer, isSupported: hasVisualizer} = require('./visualizer');
const memory = require('./memory');
const playlist = require('./playlist');
const view = require('./view');
const metadata = require('./metadata');

const REPEAT_OFF = 0;
const REPEAT_QUEUE = 1;
const REPEAT_SONG = 2;
const DEFAULT_VOLUME = 0.8;
// Back from further than this replays the entry instead of the previous one.
const RESTART_THRESHOLD = 3;
// While playing, the position is saved at most this often (ms).
const SAVE_INTERVAL = 5000;

// `audioTypes` and `videoTypes`: item types of tracks and videos.
const createPlayer = ({audioTypes, videoTypes}) => {
    const queue = createQueue();
    let engine = null;
    let visualizer = null;
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
    let savedAt = 0;

    // Videos play in the preview, which shows them only once an enabled
    // preview-vid registered their type.
    const isVideo = item => !!item && includes(videoTypes, item.type) && preview.canOpen(item);
    const isTrack = item => !!item && includes(audioTypes, item.type) && canPlay(engine.audio, item);

    const coverFor = item => covers.coverFor(item, isVideo(item));

    const isTrackLoaded = () => !!loaded && !isVideo(loaded);

    // The large view of the loaded track: what is known now, then the tags
    // and the full cover once the file was read.
    const renderNowPlaying = () => {
        const item = loaded;
        const media = engine.media();
        const duration = media && media.duration;
        const show = result => nowPlaying.render({
            item,
            tags: result ? result.tags : {},
            coverUrl: result ? covers.largeCoverFor(item) : coverFor(item),
            background: view.gradientFor(item.label),
            duration
        });
        show(metadata.known(item));
        metadata.read(item).then(result => {
            if (item === loaded && nowPlaying.isOpen()) {
                show(result);
            }
        });
    };

    // The cover, or the visualizer in its place where Web Audio exists:
    // checked as the view shows, as a saved mode may come from elsewhere.
    const syncVisualizer = () => {
        nowPlaying.setSwitchable(hasVisualizer(), visualizer.label);
        nowPlaying.showVisualizer(hasVisualizer() ? visualizer.mode : 'off');
    };

    const syncExpandable = () => {
        view.setExpandable(isTrackLoaded(), isTrackLoaded() && nowPlaying.isOpen());
        visualizer.refresh();
    };

    const toggleNowPlaying = () => {
        if (nowPlaying.isOpen()) {
            nowPlaying.close();
            return;
        }
        if (isTrackLoaded()) {
            renderNowPlaying();
            syncVisualizer();
            nowPlaying.open();
            syncExpandable();
        }
    };

    // Follows the queue while open: a new track replaces the view, a video
    // or a stop closes it.
    const updateNowPlaying = () => {
        if (nowPlaying.isOpen()) {
            if (isTrackLoaded()) {
                renderNowPlaying();
            } else {
                nowPlaying.close();
            }
        }
        syncExpandable();
    };

    // Kept in the browser, so a new page or a reload picks up where it was.
    const persist = () => {
        savedAt = Date.now();
        const {audio} = engine;
        memory.save({
            queue: queue.entries.map(item => item.absHref),
            current: queue.current ? queue.current.absHref : null,
            time: loaded && !isVideo(loaded) ? audio.currentTime || 0 : 0,
            volume: audio.volume,
            lastVolume,
            muted: audio.muted,
            shuffle: queue.isShuffled,
            repeat,
            visualizer: visualizer.mode
        });
    };

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
        // A play follows a click, so the audio context may start now.
        if (playing && isTrackLoaded()) {
            visualizer.activate();
        }
        visualizer.setPlaying(playing && isTrackLoaded());
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
        updateNowPlaying();

        const {started, promise} = engine.load(item, shouldPlay);
        persist();
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
        updateNowPlaying();
        persist();
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
        if (isTrackLoaded()) {
            visualizer.activate();
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
    // Replaces the queue with `entries`, from `item`.
    const playFrom = (entries, item, shouldPlay) => {
        covers.release(queue.entries);
        failedInARow = 0;
        queue.replace(entries, item);
        loadCurrent(shouldPlay);
    };

    // The entry alone: Play next and Add to queue build a queue around it.
    const playOne = (item, shouldPlay = true) => playFrom([item], item, shouldPlay);

    // The entries of its kind listed in its folder, from this one on.
    const playFolder = (item, shouldPlay = true) => {
        const siblings = view.listedItems(isVideo(item) ? isVideo : isTrack);
        playFrom(siblings.includes(item) ? siblings : [item], item, shouldPlay);
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
        persist();
    };

    const playNext = item => {
        queue.insertNext(item);
        view.showBar();
        renderQueue();
        startIfIdle(item);
        persist();
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
        persist();
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
        if (Date.now() - savedAt > SAVE_INTERVAL) {
            persist();
        }
    };

    const onDurationChange = () => {
        const media = engine.media();
        if (media && media.duration) {
            view.setDuration(media.duration);
            if (nowPlaying.isOpen()) {
                renderNowPlaying();
            }
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
        persist();
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
        persist();
    };

    // The queue as a playlist file for an external player. Absolute URLs:
    // the file is opened outside this page.
    const exportQueue = () => {
        const entries = queue.entries;
        if (!entries.length) {
            return;
        }
        const base = global.window.location.href;
        const folders = new Set(entries.map(item => item.parent ? item.parent.label : ''));
        const name = folders.size === 1 ? [...folders][0] : '';
        const text = playlist.toM3u(entries.map(item => ({
            title: item.label,
            url: new global.window.URL(item.absHref, base).href
        })));
        view.download(playlist.fileName(name), text, 'audio/x-mpegurl');
    };

    // Applies a state saved by an earlier page, `memory.load()`'s shape. The
    // entry comes back paused at its position: a browser starts no sound
    // without a click. Only an idle player takes it.
    const restore = state => {
        if (!state || loaded) {
            return;
        }
        const {audio} = engine;
        if (state.volume !== null) {
            audio.volume = state.volume;
        }
        if (state.lastVolume !== null) {
            lastVolume = state.lastVolume;
        }
        audio.muted = state.muted;
        view.setVolume(audio.volume, audio.muted);
        showMuted();
        repeat = state.repeat;
        view.setRepeat(repeat);
        if (state.visualizer) {
            visualizer.setMode(state.visualizer);
        }
        queue.setShuffle(state.shuffle);
        view.setShuffle(state.shuffle);

        // Entries that no longer exist fail once played, and are skipped.
        const entries = state.queue
            .map(href => Item.get(href))
            .filter(item => item && (isTrack(item) || isVideo(item)));
        if (!entries.length) {
            return;
        }
        const current = entries.find(item => item.absHref === state.current) || entries[0];
        queue.replace(entries, current);
        loadCurrent(false);
        if (!isVideo(current) && state.time) {
            audio.currentTime = state.time;
            view.setProgress(state.time, 0);
        }
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
                persist();
            },
            cycleRepeat: () => {
                repeat = (repeat + 1) % 3;
                view.setRepeat(repeat);
                persist();
            },
            seek: percent => seekTo(durationOf() * percent / 100),
            previewSeek: percent => durationOf() ? durationOf() * percent / 100 : null,
            setVolume,
            toggleMute,
            queueToggled: renderQueue,
            exportQueue,
            clear,
            close: clear,
            toggleNowPlaying
        });
        nowPlaying.mount({close: syncExpandable});

        // Twice Winamp's 19 bars, in a square canvas that takes the cover's place.
        visualizer = createVisualizer({
            audio: engine.audio,
            onModeChange: () => {
                syncVisualizer();
                persist();
            }
        });
        visualizer.addSurface(global.window.document.getElementById('np-cover'), {
            bars: 38,
            rows: 38 * 4 - 1,
            isShown: () => isTrackLoaded() && nowPlaying.isOpen()
        });

        // A video shown in the preview takes over: the track pauses, the
        // large view closes and the bar hides until the preview shows
        // something else or closes. A queued video keeps its place in the
        // queue: its end still moves the queue on.
        const setVideoShown = isShown => {
            if (!isShown) {
                viewBase.$root.rmCls('ap-video-shown');
                return;
            }
            viewBase.$root.addCls('ap-video-shown');
            nowPlaying.close();
            if (!engine.audio.paused) {
                engine.audio.pause();
            }
        };
        event.sub('preview.content', (item, el) => setVideoShown(!!el && el.id === 'pv-content-vid'));
        // The cover's label is built from strings, not marked in the page;
        // a closed view gets it again when it opens.
        event.sub('l10n.changed', () => {
            if (nowPlaying.isOpen()) {
                nowPlaying.setSwitchable(hasVisualizer(), visualizer.label);
            }
        });
        event.sub('preview.exit', () => setVideoShown(false));

        session.bindActions({
            play: () => !isPlaying && togglePlay(),
            pause: () => isPlaying && togglePlay(),
            previoustrack: previous,
            nexttrack: next,
            seekto: details => seekTo(details.seekTime)
        });

        // The position as the page is left, whatever the last save.
        global.window.addEventListener('pagehide', () => {
            if (loaded) {
                persist();
            }
        });
    };

    // A row click opens the player like a preview: `autoplay` decides
    // whether it also starts. The row buttons always start.
    const rowActions = {
        play: item => playOne(item),
        folder: item => playFolder(item),
        next: playNext,
        queue: enqueue
    };

    return {
        init,
        isTrack,
        isVideo,
        playOne,
        playFolder,
        restore,
        rowActions,
        refreshListing: () => view.markListing(loaded, isPlaying)
    };
};

module.exports = {
    createPlayer
};
