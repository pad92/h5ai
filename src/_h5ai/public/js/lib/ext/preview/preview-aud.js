/* eslint-disable no-bitwise, no-plusplus, no-use-before-define */
const {dom, each, compact, includes} = require('../../util');
const allsettings = require('../../core/settings');
const event = require('../../core/event');
const resource = require('../../core/resource');
const base = require('../../view/base');
const preview = require('./preview');

const settings = Object.assign({
    enabled: false,
    autoplay: true,
    types: ['aud']
}, allsettings['preview-aud']);
const videoSettings = Object.assign({
    types: []
}, allsettings['preview-vid']);

const NOTE_ICON = 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z';
const FILM_ICON = 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z';

let audio = null;
let queue = [];
let currentIndex = 0;
let currentTrack = null;
let isPlaying = false;
let isShuffle = false;
let isRepeat = 0; // 0 = off, 1 = repeat queue, 2 = repeat song
let isSeeking = false;
let lastVolume = 0.8;
// Tracks that failed in a row: stops auto-advance once the whole queue failed.
let failedInARow = 0;
// Whether the current track was meant to play: a failed track only moves
// the queue on when it was.
let playRequested = false;
// The queued video this player opened in the preview, if still shown there.
let openedVideo = null;

// MIME types asked to the browser before it takes over a click: a file it
// cannot decode (WMA, RealAudio, MIDI, AIFF outside Safari) keeps its plain
// link instead of silently failing in the player bar.
const MIME_BY_EXT = {
    aac: 'audio/aac',
    aif: 'audio/aiff',
    aiff: 'audio/aiff',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mid: 'audio/midi',
    mp3: 'audio/mpeg',
    mpa: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg; codecs=opus',
    ra: 'audio/x-realaudio',
    wav: 'audio/wav',
    weba: 'audio/webm',
    wma: 'audio/x-ms-wma'
};

const getExt = item => {
    const match = (/\.([a-z0-9]+)$/i).exec(item.label || '');
    return match ? match[1].toLowerCase() : '';
};

// Unknown extensions are tried: only a known type the browser rejects is skipped.
const canPlay = item => {
    const mime = MIME_BY_EXT[getExt(item)];
    return !mime || audio.canPlayType(mime) !== '';
};

const isAudioItem = item => !!item && includes(settings.types, item.type) && canPlay(item);

// Videos join the same queue; they play in the preview, which can show them
// only once an enabled preview-vid registered their type.
const isVideoItem = item => !!item && includes(videoSettings.types, item.type) && preview.canOpen(item);

const currentIsVideo = () => isVideoItem(currentTrack);

const isPreviewShown = () => {
    const $overlay = dom('#pv-overlay');
    return $overlay.length > 0 && !$overlay.isHidden();
};

// The element playing the current entry: the audio element, or the video
// element of the preview while it shows the queued video.
const queuedVideo = () => {
    if (!currentIsVideo() || openedVideo !== currentTrack || !isPreviewShown() || preview.item !== currentTrack) {
        return null;
    }
    return dom('#pv-content-vid')[0] || null;
};

const activeMedia = () => currentIsVideo() ? queuedVideo() : audio;

const closeOpenedVideo = () => {
    const shouldClose = !!openedVideo && isPreviewShown() && preview.item === openedVideo;
    // Cleared first: the preview's exit event must not pause the queue.
    openedVideo = null;
    if (shouldClose) {
        preview.close();
    }
};

// Dynamic gradient cover color based on track name hash
const getGradientForTrack = name => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash % 360);
    const h2 = (h1 + 60) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 70%, 65%), hsl(${h2}, 80%, 55%))`;
};

// Format seconds into minutes:seconds
const formatTime = seconds => {
    if (isNaN(seconds) || seconds === Infinity) {
        return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// The listed files accepted by `isKind`, in listing order
const getListedItems = isKind => {
    return compact(dom('#items .item').map(el => {
        const matchedItem = el._item;
        return matchedItem && isKind(matchedItem) ? matchedItem : null;
    }));
};

// Only MP3 files carry an ID3v2 tag at their start.
const ID3_EXTS = ['mp3', 'mpa'];
const ID3_RANGE = 'bytes=0-524288';

// The picture type comes from its bytes, never from the tag: a tag claiming
// text/html would otherwise turn the cover's blob: URL into a same-origin page.
const getPictureType = data => {
    if (data[0] === 0xFF && data[1] === 0xD8) {
        return 'image/jpeg';
    }
    if (data[0] === 0x89 && data[1] === 0x50) {
        return 'image/png';
    }
    return null;
};

// Extract embedded cover art from MP3 ID3v2 metadata
const getEmbeddedCover = url => {
    return global.window.fetch(url, {headers: {Range: ID3_RANGE}})
        .then(response => {
            // A server ignoring Range answers 200 with the whole file: drop it
            // rather than download a full track for its cover.
            if (response.status !== 206) {
                if (response.body) {
                    response.body.cancel().catch(() => null);
                }
                throw new Error('Range fetch failed');
            }
            return response.arrayBuffer();
        })
        .then(buffer => {
            const arr = new Uint8Array(buffer);
            const view = new DataView(buffer);

            // Must start with "ID3"
            if (arr.length < 10 || arr[0] !== 0x49 || arr[1] !== 0x44 || arr[2] !== 0x33) {
                return null;
            }

            const version = arr[3];
            if (version !== 2 && version !== 3 && version !== 4) {
                return null;
            }

            // Syncsafe size of tag
            const tagSize = (arr[6] & 0x7F) << 21 |
                            (arr[7] & 0x7F) << 14 |
                            (arr[8] & 0x7F) << 7 |
                            arr[9] & 0x7F;

            const totalSize = Math.min(tagSize + 10, arr.length);
            let offset = 10;

            while (offset < totalSize - 10) {
                let frameId = '';
                let frameSize = 0;
                let headerSize = 10;

                if (version === 2) {
                    frameId = String.fromCharCode(arr[offset], arr[offset + 1], arr[offset + 2]);
                    frameSize = arr[offset + 3] << 16 | arr[offset + 4] << 8 | arr[offset + 5];
                    headerSize = 6;
                } else {
                    frameId = String.fromCharCode(arr[offset], arr[offset + 1], arr[offset + 2], arr[offset + 3]);
                    if (version === 3) {
                        frameSize = view.getUint32(offset + 4);
                    } else { // v2.4 syncsafe size
                        frameSize = (arr[offset + 4] & 0x7F) << 21 |
                                    (arr[offset + 5] & 0x7F) << 14 |
                                    (arr[offset + 6] & 0x7F) << 7 |
                                    arr[offset + 7] & 0x7F;
                    }
                    headerSize = 10;
                }

                if (frameSize <= 0 || offset + headerSize + frameSize > totalSize) {
                    break;
                }

                // APIC (v2.3/v2.4) or PIC (v2.2)
                if (frameId === 'APIC' || frameId === 'PIC') {
                    const frameDataOffset = offset + headerSize;
                    const textEncoding = arr[frameDataOffset];

                    let descOffset = 0;

                    if (version === 2) {
                        // 3-byte image format, then the picture type.
                        descOffset = frameDataOffset + 5;
                    } else {
                        // Null-terminated MIME string, then the picture type.
                        let mimeEnd = frameDataOffset + 1;
                        while (mimeEnd < frameDataOffset + frameSize && arr[mimeEnd] !== 0) {
                            mimeEnd++;
                        }
                        descOffset = mimeEnd + 2;
                    }

                    // Skip description field
                    let descEnd = descOffset;
                    if (textEncoding === 1 || textEncoding === 2) { // UTF-16
                        while (descEnd < frameDataOffset + frameSize - 1) {
                            if (arr[descEnd] === 0 && arr[descEnd + 1] === 0) {
                                descEnd += 2;
                                break;
                            }
                            descEnd += 2;
                        }
                    } else { // ASCII / UTF-8
                        while (descEnd < frameDataOffset + frameSize) {
                            if (arr[descEnd] === 0) {
                                descEnd++;
                                break;
                            }
                            descEnd++;
                        }
                    }

                    const picDataOffset = descEnd;
                    const picDataSize = frameDataOffset + frameSize - picDataOffset;

                    if (picDataSize > 10) {
                        const pictureData = arr.subarray(picDataOffset, picDataOffset + picDataSize);
                        const pictureType = getPictureType(pictureData);
                        if (!pictureType) {
                            return null;
                        }
                        const blob = new global.window.Blob([pictureData], {type: pictureType});
                        return global.window.URL.createObjectURL(blob);
                    }
                }

                offset += headerSize + frameSize;
            }
            return null;
        })
        .catch(() => null);
};

// Try to locate cover art for the track (local folders or metadata)
const getTrackCover = item => {
    if (!item) {
        return null;
    }
    // 1. The server thumbnail: small, and extracted by ffmpeg for every format
    if (item.thumbRational) {
        return item.thumbRational;
    }

    // A folder image is an album cover, not a video's.
    if (isVideoItem(item)) {
        return null;
    }

    // 2. Use metadata cover if loaded and found
    if (item.embeddedCoverUrl && item.embeddedCoverUrl !== 'none') {
        return item.embeddedCoverUrl;
    }

    // 3. Search sibling items in the parent folder content for cover images
    if (item.parent && item.parent.content) {
        const siblingKeys = Object.keys(item.parent.content);
        const imageItems = siblingKeys
            .map(key => item.parent.content[key])
            .filter(sibling => sibling && !sibling.isFolder() && sibling.type && sibling.type.startsWith('img'));

        const preferredNames = ['cover', 'folder', 'front', 'album', 'albumart', 'poster'];
        for (const name of preferredNames) {
            const found = imageItems.find(imgItem => {
                const labelLower = imgItem.label.toLowerCase();
                return labelLower.startsWith(name + '.') || labelLower === name;
            });
            if (found) {
                return found.absHref;
            }
        }
        // Any other image is a photo, not the album's cover: it is not used.
    }

    return null;
};

// The root class makes room for the fixed bar below the listing.
const showPlayerBar = () => {
    dom('#audio-player-bar').addCls('active');
    base.$root.addCls('ap-bar-visible');
};

const hidePlayerBar = () => {
    dom('#audio-player-bar').rmCls('active');
    base.$root.rmCls('ap-bar-visible');
};

const isQueueOpen = () => dom('#audio-queue-panel').hasCls('active');

const showTrackError = isError => {
    const $bar = dom('#audio-player-bar');
    if (isError) {
        $bar.addCls('ap-error');
        dom('#ap-track-folder-el').text('Cannot play this file');
    } else {
        $bar.rmCls('ap-error');
    }
};

const getMediaSession = () => {
    const nav = global.window.navigator;
    return nav && nav.mediaSession && typeof global.window.MediaMetadata === 'function' ? nav.mediaSession : null;
};

// Feeds the lock screen, notification and hardware media keys.
const updateMediaSession = (item, artworkUrl) => {
    const session = getMediaSession();
    if (!session || !item) {
        return;
    }
    const artwork = artworkUrl ? [{src: artworkUrl}] : [];
    session.metadata = new global.window.MediaMetadata({
        title: item.label,
        album: item.parent ? item.parent.label : '',
        artwork
    });
};

const updatePlayPauseButton = () => {
    const $btn = dom('#ap-play-pause');
    if (isPlaying) {
        $btn.addCls('playing');
    } else {
        $btn.rmCls('playing');
    }
};

const updateVolumeIcon = () => {
    const $btn = dom('#ap-volume-btn');
    if (audio.muted || audio.volume === 0) {
        $btn.addCls('muted');
    } else {
        $btn.rmCls('muted');
    }
};

const updateListVisuals = () => {
    dom('#items .item').each(el => {
        const item = el._item;
        const $el = dom(el);

        $el.find('.ap-playing-equalizer').rm();
        $el.rmCls('ap-active-playing', 'ap-active-paused');

        if (item && currentTrack && item.absHref === currentTrack.absHref) {
            if (isPlaying) {
                $el.addCls('ap-active-playing');
                const $eq = dom(`
                    <span class="ap-playing-equalizer">
                        <span></span><span></span><span></span><span></span>
                    </span>
                `);
                $el.find('.icon.square').app($eq);
            } else {
                $el.addCls('ap-active-paused');
            }
        }
    });
};

// The drawer is rebuilt only while it is open: opening it renders it again.
const renderQueue = () => {
    const $list = dom('#aq-list-el');
    $list.clr();
    if (!isQueueOpen()) {
        return;
    }

    queue.forEach((item, idx) => {
        const isActive = idx === currentIndex;
        const coverUrl = getTrackCover(item);
        const gradient = getGradientForTrack(item.label);

        const $li = dom(`
            <li class="aq-item${isActive ? ' active' : ''}${isVideoItem(item) ? ' aq-video' : ''}">
                <div class="aq-item-cover" style="background: ${gradient}">
                    <svg class="aq-cover-fallback" viewBox="0 0 24 24" fill="currentColor"><path d="${isVideoItem(item) ? FILM_ICON : NOTE_ICON}"/></svg>
                </div>
                <div class="aq-item-details">
                    <p class="aq-item-name"></p>
                    <p class="aq-item-folder"></p>
                </div>
                <button class="aq-item-remove" title="Remove from queue" aria-label="Remove from queue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </li>
        `);

        if (coverUrl) {
            const $cover = $li.find('.aq-item-cover');
            const img = new global.window.Image();
            img.onload = () => {
                $cover.find('.aq-cover-fallback').rm();
                $cover.css({background: 'none'});
                const $img = dom('<img class="aq-cover-img" style="width: 100%; height: 100%; object-fit: cover;" alt="cover"/>');
                $img.attr('src', coverUrl);
                $cover.app($img);
            };
            img.src = coverUrl;
        }

        $li.find('.aq-item-name').text(item.label);
        $li.find('.aq-item-folder').text(item.parent ? item.parent.label : 'Folder');

        $li.on('click', ev => {
            if (ev.target.closest('.aq-item-remove')) {
                return;
            }
            currentIndex = idx;
            loadAndPlayCurrent();
            renderQueue();
        });

        $li.find('.aq-item-remove').on('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            removeFromQueue(idx);
        });

        $list.app($li);
    });
};

const revokeItemBlob = item => {
    if (item && item.embeddedCoverUrl && item.embeddedCoverUrl.startsWith('blob:')) {
        try {
            global.window.URL.revokeObjectURL(item.embeddedCoverUrl);
        } catch {
            // ignore
        }
        delete item.embeddedCoverUrl;
    }
};

const clearQueueBlobs = () => {
    queue.forEach(revokeItemBlob);
};

const removeFromQueue = idx => {
    const item = queue[idx];
    revokeItemBlob(item);

    if (idx === currentIndex) {
        queue.splice(idx, 1);
        if (queue.length === 0) {
            audio.pause();
            audio.src = '';
            closeOpenedVideo();
            currentTrack = null;
            isPlaying = false;
            currentIndex = 0;
            showTrackError(false);
            hidePlayerBar();
            updateListVisuals();
        } else {
            if (currentIndex >= queue.length) {
                currentIndex = 0;
            }
            loadAndPlayCurrent();
        }
    } else {
        queue.splice(idx, 1);
        if (idx < currentIndex) {
            currentIndex -= 1;
        }
    }
    renderQueue();
};

const clearQueue = () => {
    audio.pause();
    audio.src = '';
    closeOpenedVideo();

    clearQueueBlobs();

    queue = [];
    currentTrack = null;
    isPlaying = false;
    currentIndex = 0;
    failedInARow = 0;
    showTrackError(false);
    hidePlayerBar();
    updateListVisuals();
    renderQueue();
};

const showCoverFallback = item => {
    const $img = dom('#ap-cover-img');
    const $fallback = dom('#ap-cover-fallback');
    $img.hide().attr('src', resource.blankImage);
    $fallback.find('path').attr('d', isVideoItem(item) ? FILM_ICON : NOTE_ICON);
    $fallback.show();
    dom('#ap-cover-gradient').css({background: getGradientForTrack(item.label)});
};

const loadCoverImage = (item, url, isFallback) => {
    const $img = dom('#ap-cover-img');
    const $fallback = dom('#ap-cover-fallback');
    const img = new global.window.Image();

    img.onload = () => {
        if (!currentTrack || currentTrack.absHref !== item.absHref) {
            return;
        }
        $img.attr('src', url).show();
        $fallback.hide();
        dom('#ap-cover-gradient').css({background: 'none'});
        updateMediaSession(item, url);
    };
    img.onerror = () => {
        if (!currentTrack || currentTrack.absHref !== item.absHref) {
            return;
        }
        if (!isFallback) {
            if (item.embeddedCoverUrl === url) {
                item.embeddedCoverUrl = 'none';
            }
            const fallback = getTrackCover(item);
            if (fallback && fallback !== url) {
                loadCoverImage(item, fallback, true);
                return;
            }
        }
        showCoverFallback(item);
    };
    img.src = url;
};

const updateCoverUI = (item, coverUrl) => {
    if (!currentTrack || currentTrack.absHref !== item.absHref) {
        return;
    }

    if (coverUrl && coverUrl !== 'none') {
        loadCoverImage(item, coverUrl);
    } else {
        const folderCover = getTrackCover(item);
        if (folderCover) {
            loadCoverImage(item, folderCover);
        } else {
            showCoverFallback(item);
        }
    }
};

// Only an MP3 without a server thumbnail is read for an ID3 cover.
const needsEmbeddedCover = item => !item.embeddedCoverUrl && !item.thumbRational && includes(ID3_EXTS, getExt(item));

// `shouldPlay` false loads the track into the bar, paused (autoplay off).
const loadAndPlayCurrent = (shouldPlay = true) => {
    if (queue.length === 0 || currentIndex >= queue.length) {
        return;
    }

    currentTrack = queue[currentIndex];
    playRequested = shouldPlay;

    showTrackError(false);
    showPlayerBar();
    dom('#ap-track-name-el').text(currentTrack.label).attr('title', currentTrack.label);
    dom('#ap-track-folder-el').text(currentTrack.parent ? currentTrack.parent.label : 'Folder');
    updateMediaSession(currentTrack, null);

    if (!needsEmbeddedCover(currentTrack)) {
        updateCoverUI(currentTrack, currentTrack.embeddedCoverUrl);
    } else {
        // The lookup may finish after the user moved on: keep its result on
        // the track that asked for it.
        const track = currentTrack;
        updateCoverUI(track, null);
        getEmbeddedCover(track.absHref).then(url => {
            track.embeddedCoverUrl = url || 'none';
            updateCoverUI(track, track.embeddedCoverUrl);
            renderQueue();
        });
    }

    renderQueue();

    resetProgress();

    if (currentIsVideo()) {
        audio.pause();
        isPlaying = false;
        updatePlayPauseButton();
        updateListVisuals();
        if (shouldPlay && previewIsFree()) {
            openCurrentVideo();
        } else {
            playRequested = false;
            closeOpenedVideo();
        }
        return;
    }

    // Leaving a queued video for a track closes its preview.
    closeOpenedVideo();
    audio.src = currentTrack.absHref;

    if (!shouldPlay) {
        isPlaying = false;
        updatePlayPauseButton();
        updateListVisuals();
        return;
    }

    audio.play()
        .then(() => {
            isPlaying = true;
            failedInARow = 0;
            updatePlayPauseButton();
            updateListVisuals();
        })
        .catch(err => {
            // A blocked autoplay waits for the play button; an undecodable
            // file is reported by the element's error event.
            // eslint-disable-next-line no-console
            console.warn('Playback did not start:', err);
            isPlaying = false;
            updatePlayPauseButton();
            updateListVisuals();
        });
};

// The preview shows the queued video alone: its own previous and next stay
// on it, the queue decides what follows.
const openCurrentVideo = () => {
    openedVideo = currentTrack;
    preview.open([currentTrack], 0);
};

// A preview the user opened is never taken over: the video waits, paused,
// for the bar's play button.
const previewIsFree = () => !isPreviewShown() || !!openedVideo && preview.item === openedVideo;

const resetProgress = () => {
    dom('#ap-seek').val(0);
    dom('#ap-prog-fill').css({width: '0%'});
    dom('#ap-time-cur').text('0:00');
    dom('#ap-time-dur').text('0:00');
};

const getNextIndex = () => {
    if (queue.length <= 1) {
        return 0;
    }
    if (isShuffle) {
        let rand;
        do {
            rand = Math.floor(Math.random() * queue.length);
        } while (rand === currentIndex && queue.length > 1);
        return rand;
    }
    return (currentIndex + 1) % queue.length;
};

const getPrevIndex = () => {
    if (queue.length <= 1) {
        return 0;
    }
    if (isShuffle) {
        let rand;
        do {
            rand = Math.floor(Math.random() * queue.length);
        } while (rand === currentIndex && queue.length > 1);
        return rand;
    }
    return (currentIndex - 1 + queue.length) % queue.length;
};

const nextTrack = () => {
    if (queue.length === 0) {
        return;
    }
    currentIndex = getNextIndex();
    loadAndPlayCurrent();
};

const prevTrack = () => {
    if (queue.length === 0) {
        return;
    }
    const media = activeMedia();
    if (media && media.currentTime > 3) {
        media.currentTime = 0;
    } else {
        currentIndex = getPrevIndex();
        loadAndPlayCurrent();
    }
};

const playTrack = (item, shouldPlay = true) => {
    clearQueueBlobs();
    failedInARow = 0;
    // The folder queue holds the files of the clicked one's kind.
    const folderItems = getListedItems(isVideoItem(item) ? isVideoItem : isAudioItem);
    const idx = folderItems.findIndex(x => x.absHref === item.absHref);

    if (idx === -1) {
        queue = [item];
        currentIndex = 0;
    } else {
        queue = folderItems;
        currentIndex = idx;
    }

    loadAndPlayCurrent(shouldPlay);
};

const addToQueue = item => {
    const idx = queue.findIndex(x => x.absHref === item.absHref);
    if (idx === -1) {
        queue.push(item);
    }
    renderQueue();
    showPlayerBar();
    if (audio.paused && !currentTrack) {
        currentIndex = queue.length - 1;
        loadAndPlayCurrent();
    }
};

const playNext = item => {
    const idx = queue.findIndex(x => x.absHref === item.absHref);
    if (idx !== -1) {
        queue.splice(idx, 1);
        if (idx < currentIndex) {
            currentIndex -= 1;
        }
    }

    if (queue.length === 0) {
        queue.push(item);
        currentIndex = 0;
    } else {
        queue.splice(currentIndex + 1, 0, item);
    }

    renderQueue();
    showPlayerBar();
    if (audio.paused && !currentTrack) {
        loadAndPlayCurrent();
    }
};

const injectItemActions = item => {
    if (item.$view) {
        // The buttons go next to the item's link, not inside it: HTML does
        // not allow a button within an <a>. The <li> is the positioned box.
        if (item.$view.find('.ap-item-actions').length > 0) {
            return;
        }

        const $actions = dom(`
            <span class="ap-item-actions">
                <button class="ap-row-btn ap-row-play" title="Play Now" aria-label="Play Now">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button class="ap-row-btn ap-row-next" title="Play Next" aria-label="Play Next">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
                </button>
                <button class="ap-row-btn ap-row-queue" title="Add to Queue" aria-label="Add to Queue">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                </button>
            </span>
        `);

        $actions.find('.ap-row-play').on('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            playTrack(item);
        });

        $actions.find('.ap-row-next').on('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            playNext(item);
        });

        $actions.find('.ap-row-queue').on('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            addToQueue(item);
        });

        item.$view.app($actions);
    }
};

const initItem = item => {
    // A video keeps its click on the preview; it only gets the row actions.
    if (item.$view && isVideoItem(item)) {
        injectItemActions(item);
        return;
    }
    if (item.$view && isAudioItem(item)) {
        injectItemActions(item);

        // A click opens the player like a preview; autoplay decides whether
        // it also starts. The row's play button always starts.
        const onclick = ev => {
            ev.preventDefault();
            playTrack(item, settings.autoplay);
        };

        if (item.click_callback) {
            item.$view.find('a').off('click', item.click_callback);
        }
        item.click_callback = onclick;
        item.click_callback.type = item.type;
        item.$view.find('a').on('click', onclick);
    } else if (item.$view && item.click_callback && includes(settings.types, item.click_callback.type)) {
        item.$view.find('a').off('click', item.click_callback);
        delete item.click_callback;
    }
};

const togglePlayPause = () => {
    if (!currentTrack) {
        const folderItems = getListedItems(isAudioItem);
        if (folderItems.length > 0) {
            queue = folderItems;
            currentIndex = 0;
            loadAndPlayCurrent();
        }
        return;
    }

    if (currentIsVideo()) {
        const video = queuedVideo();
        if (!video) {
            openCurrentVideo();
        } else if (video.paused) {
            Promise.resolve(video.play()).catch(err => {
                // eslint-disable-next-line no-console
                console.error('Video play error:', err);
            });
        } else {
            video.pause();
        }
        return;
    }

    if (isPlaying) {
        audio.pause();
        isPlaying = false;
    } else {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayPauseButton();
            updateListVisuals();
        }).catch(err => {
            // eslint-disable-next-line no-console
            console.error('Audio play error:', err);
        });
    }
    updatePlayPauseButton();
    updateListVisuals();
};

const initUI = () => {
    const PLAYER_BAR_TPL = `
    <div id="audio-player-bar">
        <div class="ap-track-info">
            <div class="ap-track-cover" id="ap-cover-gradient">
                <img class="ap-cover-img hidden" id="ap-cover-img" src="${resource.blankImage}" alt="cover"/>
                <svg id="ap-cover-fallback" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            </div>
            <div class="ap-track-details">
                <p class="ap-track-name" id="ap-track-name-el">No Track</p>
                <p class="ap-track-folder" id="ap-track-folder-el">Unknown Folder</p>
            </div>
        </div>
        
        <div class="ap-controls-container">
            <div class="ap-control-buttons">
                <button class="ap-btn ap-btn-shuffle" id="ap-shuffle" title="Shuffle" aria-label="Shuffle">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.45 20 9.5V4h-5.5zm.38 10.17l-1.42 1.41 3.17 3.17L14.5 20H20v-5.5l-2.04 2.04-3.08-3.08z"/></svg>
                </button>
                <button class="ap-btn ap-btn-prev" id="ap-prev" title="Previous" aria-label="Previous">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                <button class="ap-btn ap-btn-play-pause" id="ap-play-pause" title="Play/Pause" aria-label="Play/Pause">
                    <svg class="play-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <svg class="pause-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <button class="ap-btn ap-btn-next" id="ap-next" title="Next" aria-label="Next">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6z"/></svg>
                </button>
                <button class="ap-btn ap-btn-repeat" id="ap-repeat" title="Repeat (Off)" aria-label="Repeat (Off)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
                </button>
            </div>
            
            <div class="ap-progress-bar-container">
                <span class="ap-time-current" id="ap-time-cur">0:00</span>
                <div class="ap-progress-slider-wrapper">
                    <div class="ap-progress-track"></div>
                    <div class="ap-progress-fill" id="ap-prog-fill"></div>
                    <input type="range" class="ap-progress-slider" id="ap-seek" aria-label="Seek" min="0" max="100" value="0"/>
                </div>
                <span class="ap-time-duration" id="ap-time-dur">0:00</span>
            </div>
        </div>
        
        <div class="ap-extra-controls">
            <div class="ap-volume-container">
                <button class="ap-btn-volume" id="ap-volume-btn" title="Mute" aria-label="Mute">
                    <svg class="loud-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                    <svg class="muted-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                </button>
                <div class="ap-volume-slider-wrapper">
                    <div class="ap-volume-track"></div>
                    <div class="ap-volume-fill" id="ap-vol-fill" style="width: 80%;"></div>
                    <input type="range" class="ap-volume-slider" id="ap-volume" aria-label="Volume" min="0" max="100" value="80"/>
                </div>
            </div>
            <button class="ap-btn ap-btn-queue" id="ap-queue-btn" title="Toggle Queue" aria-label="Toggle Queue">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
            </button>
            <button class="ap-btn ap-btn-close" id="ap-close-btn" title="Stop and close player" aria-label="Stop and close player">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    </div>
    `;

    const QUEUE_PANEL_TPL = `
    <div class="audio-queue-panel" id="audio-queue-panel">
        <div class="aq-header">
            <h2>Play Queue</h2>
            <div class="aq-header-actions">
                <button class="aq-btn-clear" id="aq-clear">Clear</button>
                <button class="aq-btn-close" id="aq-close" aria-label="Close queue">&times;</button>
            </div>
        </div>
        <div class="aq-list-container">
            <ul class="aq-list" id="aq-list-el"></ul>
        </div>
    </div>
    `;

    base.$root.app(PLAYER_BAR_TPL);
    base.$root.app(QUEUE_PANEL_TPL);

    // Controls listeners
    dom('#ap-play-pause').on('click', togglePlayPause);
    dom('#ap-next').on('click', nextTrack);
    dom('#ap-prev').on('click', prevTrack);

    dom('#ap-shuffle').on('click', () => {
        isShuffle = !isShuffle;
        dom('#ap-shuffle').tglCls('active');
    });

    dom('#ap-repeat').on('click', () => {
        isRepeat = (isRepeat + 1) % 3;
        const $rep = dom('#ap-repeat');
        if (isRepeat === 0) {
            $rep.rmCls('active').attr('title', 'Repeat (Off)').attr('aria-label', 'Repeat (Off)');
        } else if (isRepeat === 1) {
            $rep.addCls('active').attr('title', 'Repeat (Queue)').attr('aria-label', 'Repeat (Queue)');
        } else {
            $rep.addCls('active').attr('title', 'Repeat (Song)').attr('aria-label', 'Repeat (Song)');
        }
    });

    // Seek events
    dom('#ap-seek')
        .on('mousedown', () => { isSeeking = true; })
        .on('mouseup', () => { isSeeking = false; })
        .on('touchstart', () => { isSeeking = true; })
        .on('touchend', () => { isSeeking = false; })
        .on('input', ev => {
            const percent = parseFloat(ev.target.value);
            const media = activeMedia();
            dom('#ap-prog-fill').css({width: `${percent}%`});
            if (media && media.duration) {
                dom('#ap-time-cur').text(formatTime(media.duration * (percent / 100)));
            }
        })
        .on('change', ev => {
            const percent = parseFloat(ev.target.value);
            const media = activeMedia();
            if (media && media.duration) {
                media.currentTime = media.duration * (percent / 100);
            }
        });

    // Volume events
    dom('#ap-volume').on('input', ev => {
        const val = parseFloat(ev.target.value);
        const vol = val / 100;
        audio.volume = vol;
        audio.muted = vol === 0;
        dom('#ap-vol-fill').css({width: `${val}%`});
    });

    dom('#ap-volume-btn').on('click', () => {
        if (audio.muted) {
            audio.muted = false;
            audio.volume = lastVolume;
            dom('#ap-volume').val(lastVolume * 100);
            dom('#ap-vol-fill').css({width: `${lastVolume * 100}%`});
        } else {
            lastVolume = audio.volume > 0 ? audio.volume : 0.8;
            audio.muted = true;
            dom('#ap-volume').val(0);
            dom('#ap-vol-fill').css({width: '0%'});
        }
        updateVolumeIcon();
    });

    // Queue drawer events
    dom('#ap-queue-btn').on('click', () => {
        dom('#audio-queue-panel').tglCls('active');
        dom('#ap-queue-btn').tglCls('active');
        renderQueue();
    });

    dom('#aq-close').on('click', () => {
        dom('#audio-queue-panel').rmCls('active');
        dom('#ap-queue-btn').rmCls('active');
    });

    dom('#aq-clear').on('click', clearQueue);

    dom('#ap-close-btn').on('click', () => {
        dom('#audio-queue-panel').rmCls('active');
        dom('#ap-queue-btn').rmCls('active');
        clearQueue();
    });
};

const setPlaybackState = state => {
    const session = getMediaSession();
    if (session) {
        session.playbackState = state;
    }
};

const initAudio = () => {
    audio = new global.window.Audio();
    audio.volume = 0.8;

    // The same handlers serve the audio element and the queued video; the
    // audio element's events are ignored while a video is the current entry.
    const handlers = {
        timeupdate: onTimeUpdate,
        durationchange: onDurationChange,
        play: onPlay,
        pause: onPause,
        ended: onEnded,
        error: onMediaError
    };
    Object.keys(handlers).forEach(type => {
        audio.addEventListener(type, () => {
            if (!currentIsVideo()) {
                handlers[type]();
            }
        });
        global.window.document.addEventListener(type, ev => {
            if (ev.target === queuedVideo()) {
                handlers[type]();
            }
        }, true);
    });

    // The native preview loads its video before attaching it: a failure or
    // the duration known by then is picked up once it is shown.
    event.sub('preview.content', (item, el) => {
        if (!item || item !== currentTrack || item !== openedVideo || !el) {
            return;
        }
        if (el.error) {
            onMediaError();
            return;
        }
        onDurationChange();
        if (!el.paused) {
            onPlay();
        }
    });

    // Closing the preview of the queued video pauses the queue: the play
    // button opens it again.
    event.sub('preview.exit', item => {
        if (item && item === openedVideo) {
            openedVideo = null;
            if (item === currentTrack) {
                onPause();
            }
        }
    });

    audio.addEventListener('volumechange', () => {
        updateVolumeIcon();
    });

    // Another player (a video preview) starting pauses the bar: media
    // events do not bubble, but they reach a capturing document listener.
    global.window.document.addEventListener('play', ev => {
        if (ev.target !== audio && !audio.paused) {
            audio.pause();
        }
    }, true);

    initMediaSessionActions();
};

const onTimeUpdate = () => {
    const media = activeMedia();
    if (media && media.currentTime > 0) {
        // Real progress: the entry plays, whatever happened before.
        failedInARow = 0;
        if (!media.paused && !isPlaying) {
            onPlay();
        }
    }
    if (media && !isSeeking && media.duration) {
        dom('#ap-time-dur').text(formatTime(media.duration));
        const percent = media.currentTime / media.duration * 100;
        dom('#ap-seek').val(percent);
        dom('#ap-prog-fill').css({width: `${percent}%`});
        dom('#ap-time-cur').text(formatTime(media.currentTime));
    }
};

const onDurationChange = () => {
    const media = activeMedia();
    if (media && media.duration) {
        dom('#ap-time-dur').text(formatTime(media.duration));
    }
};

const onPlay = () => {
    setPlaybackState('playing');
    isPlaying = true;
    updatePlayPauseButton();
    updateListVisuals();
};

const onPause = () => {
    setPlaybackState('paused');
    isPlaying = false;
    updatePlayPauseButton();
    updateListVisuals();
};

const onEnded = () => {
    const media = activeMedia();
    if (isRepeat === 2 && media) {
        media.currentTime = 0;
        Promise.resolve(media.play()).catch(err => {
            // eslint-disable-next-line no-console
            console.error('Replay error:', err);
        });
    } else if (isRepeat === 1 || isShuffle) {
        nextTrack();
    } else if (currentIndex < queue.length - 1) {
        currentIndex += 1;
        loadAndPlayCurrent();
    } else {
        onPause();
    }
};

// A track the browser cannot decode is shown as failed, and the queue moves
// on; it stops once every track of the queue failed in a row.
const onMediaError = () => {
    if (!currentTrack) {
        return;
    }
    failedInARow += 1;
    isPlaying = false;
    showPlayerBar();
    showTrackError(true);
    updatePlayPauseButton();
    updateListVisuals();
    if (playRequested && failedInARow < queue.length && (isRepeat === 1 || isShuffle || currentIndex < queue.length - 1)) {
        currentIndex = getNextIndex();
        loadAndPlayCurrent();
    }
};

const initMediaSessionActions = () => {
    const session = getMediaSession();
    if (!session) {
        return;
    }
    const handlers = {
        play: () => !isPlaying && togglePlayPause(),
        pause: () => isPlaying && togglePlayPause(),
        previoustrack: prevTrack,
        nexttrack: nextTrack,
        seekto: details => {
            const media = activeMedia();
            if (media && media.duration && Number.isFinite(details.seekTime)) {
                media.currentTime = details.seekTime;
            }
        }
    };
    Object.keys(handlers).forEach(action => {
        try {
            session.setActionHandler(action, handlers[action]);
        } catch {
            // The browser does not know this action: the others still work.
        }
    });
};

const init = () => {
    if (settings.enabled) {
        initAudio();
        initUI();

        // Register event hooks to capture audio files in listing
        event.sub('view.changed', added => {
            each(added, initItem);
            updateListVisuals();
        });
        event.sub('item.changed', changed => {
            initItem(changed);
            updateListVisuals();
        });
    }
};

init();
