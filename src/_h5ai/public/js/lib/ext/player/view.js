/* eslint-disable no-bitwise */
// The player's DOM: the bar, the queue drawer, the row buttons and the
// playing marks in the listing. No playback logic: actions go to the
// handlers given to mount().
//
// The ids and classes keep their audio-era names (audio-player-bar, ap-*,
// aq-*): custom style sheets may target them.
const {dom, compact} = require('../../util');
const resource = require('../../core/resource');
const base = require('../../view/base');

const ICONS = {
    note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
    film: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    playNext: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.45 20 9.5V4h-5.5zm.38 10.17l-1.42 1.41 3.17 3.17L14.5 20H20v-5.5l-2.04 2.04-3.08-3.08z',
    previous: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6z',
    repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
    loud: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    muted: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
    queue: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z'
};

const svg = (path, attrs = '') => `<svg viewBox="0 0 24 24" ${attrs} fill="currentColor"><path d="${path}"/></svg>`;
const crossSvg = size => `<svg viewBox="0 0 24 24"${size ? ` width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const sized = size => `width="${size}" height="${size}"`;

const REPEAT_LABELS = ['Repeat (Off)', 'Repeat (Queue)', 'Repeat (Song)'];

const BAR_TPL = `
<div id="audio-player-bar">
    <div class="ap-track-info">
        <div class="ap-track-cover" id="ap-cover-gradient">
            <img class="ap-cover-img hidden" id="ap-cover-img" src="${resource.blankImage}" alt="cover"/>
            ${svg(ICONS.note, 'id="ap-cover-fallback"')}
        </div>
        <div class="ap-track-details">
            <p class="ap-track-name" id="ap-track-name-el">No Track</p>
            <p class="ap-track-folder" id="ap-track-folder-el">Unknown Folder</p>
        </div>
    </div>
    <div class="ap-controls-container">
        <div class="ap-control-buttons">
            <button class="ap-btn ap-btn-shuffle" id="ap-shuffle" title="Shuffle" aria-label="Shuffle">${svg(ICONS.shuffle, sized(16))}</button>
            <button class="ap-btn ap-btn-prev" id="ap-prev" title="Previous" aria-label="Previous">${svg(ICONS.previous, sized(18))}</button>
            <button class="ap-btn ap-btn-play-pause" id="ap-play-pause" title="Play/Pause" aria-label="Play/Pause">
                ${svg(ICONS.play, `class="play-icon" ${sized(20)}`)}
                ${svg(ICONS.pause, `class="pause-icon" ${sized(20)}`)}
            </button>
            <button class="ap-btn ap-btn-next" id="ap-next" title="Next" aria-label="Next">${svg(ICONS.next, sized(18))}</button>
            <button class="ap-btn ap-btn-repeat" id="ap-repeat" title="${REPEAT_LABELS[0]}" aria-label="${REPEAT_LABELS[0]}">${svg(ICONS.repeat, sized(16))}</button>
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
                ${svg(ICONS.loud, `class="loud-icon" ${sized(18)}`)}
                ${svg(ICONS.muted, `class="muted-icon" ${sized(18)}`)}
            </button>
            <div class="ap-volume-slider-wrapper">
                <div class="ap-volume-track"></div>
                <div class="ap-volume-fill" id="ap-vol-fill" style="width: 80%;"></div>
                <input type="range" class="ap-volume-slider" id="ap-volume" aria-label="Volume" min="0" max="100" value="80"/>
            </div>
        </div>
        <button class="ap-btn ap-btn-queue" id="ap-queue-btn" title="Toggle Queue" aria-label="Toggle Queue">${svg(ICONS.queue, sized(18))}</button>
        <button class="ap-btn ap-btn-close" id="ap-close-btn" title="Stop and close player" aria-label="Stop and close player">${crossSvg(16)}</button>
    </div>
</div>`;

const QUEUE_TPL = `
<div class="audio-queue-panel" id="audio-queue-panel">
    <div class="aq-header">
        <h2>Play Queue</h2>
        <div class="aq-header-actions">
            <button class="aq-btn-export" id="aq-export" title="Save the queue as a playlist for VLC, MPC or another player" disabled="disabled">Export</button>
            <button class="aq-btn-clear" id="aq-clear">Clear</button>
            <button class="aq-btn-close" id="aq-close" aria-label="Close queue">&times;</button>
        </div>
    </div>
    <div class="aq-list-container">
        <ul class="aq-list" id="aq-list-el"></ul>
    </div>
</div>`;

const ROW_ACTIONS_TPL = `
<span class="ap-item-actions">
    <button class="ap-row-btn ap-row-play" title="Play Now" aria-label="Play Now">${svg(ICONS.play)}</button>
    <button class="ap-row-btn ap-row-next" title="Play Next" aria-label="Play Next">${svg(ICONS.playNext)}</button>
    <button class="ap-row-btn ap-row-queue" title="Add to Queue" aria-label="Add to Queue">${svg(ICONS.add)}</button>
</span>`;

const EQUALIZER_TPL = '<span class="ap-playing-equalizer"><span></span><span></span><span></span><span></span></span>';

let isSeeking = false;

// A stable gradient per name, for entries without a cover.
const gradientFor = name => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash % 360);
    const h2 = (h1 + 60) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 70%, 65%), hsl(${h2}, 80%, 55%))`;
};

const formatTime = seconds => {
    if (!Number.isFinite(seconds)) {
        return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const folderLabel = item => item.parent ? item.parent.label : 'Folder';

const isQueueOpen = () => dom('#audio-queue-panel').hasCls('active');

const setQueueOpen = isOpen => {
    if (isOpen) {
        dom('#audio-queue-panel').addCls('active');
        dom('#ap-queue-btn').addCls('active');
    } else {
        dom('#audio-queue-panel').rmCls('active');
        dom('#ap-queue-btn').rmCls('active');
    }
};

// The root class makes room for the fixed bar below the listing.
const showBar = () => {
    dom('#audio-player-bar').addCls('active');
    base.$root.addCls('ap-bar-visible');
};

const hideBar = () => {
    dom('#audio-player-bar').rmCls('active');
    base.$root.rmCls('ap-bar-visible');
};

const setEntry = item => {
    dom('#ap-track-name-el').text(item.label).attr('title', item.label);
    dom('#ap-track-folder-el').text(folderLabel(item));
};

const setError = isError => {
    if (isError) {
        dom('#audio-player-bar').addCls('ap-error');
        dom('#ap-track-folder-el').text('Cannot play this file');
    } else {
        dom('#audio-player-bar').rmCls('ap-error');
    }
};

const setPlaying = isPlaying => {
    if (isPlaying) {
        dom('#ap-play-pause').addCls('playing');
    } else {
        dom('#ap-play-pause').rmCls('playing');
    }
};

const setShuffle = isOn => {
    if (isOn) {
        dom('#ap-shuffle').addCls('active');
    } else {
        dom('#ap-shuffle').rmCls('active');
    }
};

// `mode`: 0 off, 1 queue, 2 song.
const setRepeat = mode => {
    const $btn = dom('#ap-repeat').attr('title', REPEAT_LABELS[mode]).attr('aria-label', REPEAT_LABELS[mode]);
    if (mode) {
        $btn.addCls('active');
    } else {
        $btn.rmCls('active');
    }
};

const setDuration = duration => dom('#ap-time-dur').text(formatTime(duration));

const setProgress = (time, duration) => {
    const percent = duration ? time / duration * 100 : 0;
    dom('#ap-seek').val(percent);
    dom('#ap-prog-fill').css({width: `${percent}%`});
    dom('#ap-time-cur').text(formatTime(time));
    setDuration(duration);
};

const resetProgress = () => setProgress(0, 0);

// `volume` 0..1, shown as 0 while muted.
const setVolume = (volume, isMuted) => {
    const percent = isMuted ? 0 : volume * 100;
    dom('#ap-volume').val(percent);
    dom('#ap-vol-fill').css({width: `${percent}%`});
};

const setMutedIcon = isMuted => {
    if (isMuted) {
        dom('#ap-volume-btn').addCls('muted');
    } else {
        dom('#ap-volume-btn').rmCls('muted');
    }
};

// The bar's cover opens the large view of a track: a button then, plain for
// a video.
const setExpandable = (isExpandable, isExpanded) => {
    const $cover = dom('#ap-cover-gradient');
    if (isExpandable) {
        $cover.addCls('ap-cover-expandable')
            .attr('role', 'button')
            .attr('tabindex', '0')
            .attr('title', isExpanded ? 'Reduce' : 'Show now playing')
            .attr('aria-label', isExpanded ? 'Reduce' : 'Show now playing')
            .attr('aria-expanded', isExpanded ? 'true' : 'false');
    } else {
        $cover.rmCls('ap-cover-expandable')
            .rmAttr('role')
            .rmAttr('tabindex')
            .rmAttr('title')
            .rmAttr('aria-label')
            .rmAttr('aria-expanded');
    }
};

const showCover = url => {
    dom('#ap-cover-img').attr('src', url).show();
    dom('#ap-cover-fallback').hide();
    dom('#ap-cover-gradient').css({background: 'none'});
};

const showCoverFallback = (item, isVideo) => {
    dom('#ap-cover-img').hide().attr('src', resource.blankImage);
    dom('#ap-cover-fallback').show().find('path').attr('d', isVideo ? ICONS.film : ICONS.note);
    dom('#ap-cover-gradient').css({background: gradientFor(item.label)});
};

// The drawer is rebuilt only while it is open: opening it renders it again.
// `opts`: {current, isVideo(item), coverFor(item), onSelect(item), onRemove(item)}.
const renderQueue = (entries, opts) => {
    const $list = dom('#aq-list-el').clr();
    dom('#aq-export').prop('disabled', entries.length === 0);
    if (!isQueueOpen()) {
        return;
    }
    entries.forEach(item => {
        const isVideo = opts.isVideo(item);
        const $li = dom(`
            <li class="aq-item${item === opts.current ? ' active' : ''}${isVideo ? ' aq-video' : ''}">
                <div class="aq-item-cover" style="background: ${gradientFor(item.label)}">${svg(isVideo ? ICONS.film : ICONS.note, 'class="aq-cover-fallback"')}</div>
                <div class="aq-item-details">
                    <p class="aq-item-name"></p>
                    <p class="aq-item-folder"></p>
                </div>
                <button class="aq-item-remove" title="Remove from queue" aria-label="Remove from queue">${crossSvg()}</button>
            </li>`);
        $li.find('.aq-item-name').text(item.label);
        $li.find('.aq-item-folder').text(folderLabel(item));

        const coverUrl = opts.coverFor(item);
        if (coverUrl) {
            const $cover = $li.find('.aq-item-cover');
            const probe = new global.window.Image();
            probe.onload = () => {
                $cover.find('.aq-cover-fallback').rm();
                $cover.css({background: 'none'});
                $cover.app(dom('<img class="aq-cover-img" style="width: 100%; height: 100%; object-fit: cover;" alt="cover"/>').attr('src', coverUrl));
            };
            probe.src = coverUrl;
        }

        $li.on('click', ev => {
            if (!ev.target.closest('.aq-item-remove')) {
                opts.onSelect(item);
            }
        });
        $li.find('.aq-item-remove').on('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            opts.onRemove(item);
        });
        $list.app($li);
    });
};

// The buttons go next to the item's link, not inside it: HTML does not
// allow a button within an <a>. The <li> is the positioned box.
// `actions`: {play, next, queue}, each called with the item.
const addRowActions = (item, actions) => {
    if (item.$view.find('.ap-item-actions').length > 0) {
        return;
    }
    const $actions = dom(ROW_ACTIONS_TPL);
    Object.keys(actions).forEach(name => {
        $actions.find(`.ap-row-${name}`).on('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            actions[name](item);
        });
    });
    item.$view.app($actions);
};

const markListing = (current, isPlaying) => {
    dom('#items .item').each(el => {
        const $el = dom(el);
        $el.find('.ap-playing-equalizer').rm();
        $el.rmCls('ap-active-playing', 'ap-active-paused');
        if (el._item && current && el._item.absHref === current.absHref) {
            if (isPlaying) {
                $el.addCls('ap-active-playing');
                $el.find('.icon.square').app(dom(EQUALIZER_TPL));
            } else {
                $el.addCls('ap-active-paused');
            }
        }
    });
};

// Saves `text` as a file: the browser downloads it under `name`.
const download = (name, text, type) => {
    const url = global.window.URL.createObjectURL(new global.window.Blob([text], {type}));
    const link = dom('<a/>').attr('href', url).attr('download', name).appTo('body');
    link[0].click();
    link.rm();
    // Left a moment to the browser before the URL goes.
    global.window.setTimeout(() => global.window.URL.revokeObjectURL(url), 1000);
};

// The listed items accepted by `accepts`, in listing order.
const listedItems = accepts => compact(dom('#items .item').map(el => el._item && accepts(el._item) ? el._item : null));

// `on`: {togglePlay, next, previous, toggleShuffle, cycleRepeat,
// seek(percent), previewSeek(percent) -> time or null, setVolume(volume),
// toggleMute, queueToggled, exportQueue, clear, close, toggleNowPlaying}.
const mount = on => {
    base.$root.app(BAR_TPL);
    base.$root.app(QUEUE_TPL);

    dom('#ap-play-pause').on('click', on.togglePlay);
    const $cover = dom('#ap-cover-gradient');
    $cover.on('click', () => {
        if ($cover.hasCls('ap-cover-expandable')) {
            on.toggleNowPlaying();
        }
    });
    $cover.on('keydown', ev => {
        if ($cover.hasCls('ap-cover-expandable') && (ev.key === 'Enter' || ev.key === ' ')) {
            ev.preventDefault();
            on.toggleNowPlaying();
        }
    });
    dom('#ap-next').on('click', on.next);
    dom('#ap-prev').on('click', on.previous);
    dom('#ap-shuffle').on('click', on.toggleShuffle);
    dom('#ap-repeat').on('click', on.cycleRepeat);

    dom('#ap-seek')
        .on('mousedown', () => { isSeeking = true; })
        .on('mouseup', () => { isSeeking = false; })
        .on('touchstart', () => { isSeeking = true; })
        .on('touchend', () => { isSeeking = false; })
        .on('input', ev => {
            const percent = parseFloat(ev.target.value);
            dom('#ap-prog-fill').css({width: `${percent}%`});
            const time = on.previewSeek(percent);
            if (time !== null) {
                dom('#ap-time-cur').text(formatTime(time));
            }
        })
        .on('change', ev => on.seek(parseFloat(ev.target.value)));

    dom('#ap-volume').on('input', ev => {
        const percent = parseFloat(ev.target.value);
        dom('#ap-vol-fill').css({width: `${percent}%`});
        on.setVolume(percent / 100);
    });
    dom('#ap-volume-btn').on('click', on.toggleMute);

    dom('#ap-queue-btn').on('click', () => {
        setQueueOpen(!isQueueOpen());
        on.queueToggled();
    });
    dom('#aq-close').on('click', () => setQueueOpen(false));
    dom('#aq-export').on('click', on.exportQueue);
    dom('#aq-clear').on('click', on.clear);
    dom('#ap-close-btn').on('click', () => {
        setQueueOpen(false);
        on.close();
    });
};

module.exports = {
    mount,
    isSeeking: () => isSeeking,
    showBar,
    hideBar,
    setEntry,
    setError,
    setPlaying,
    setShuffle,
    setRepeat,
    setDuration,
    setProgress,
    resetProgress,
    setVolume,
    setMutedIcon,
    setExpandable,
    gradientFor,
    showCover,
    showCoverFallback,
    renderQueue,
    addRowActions,
    markListing,
    listedItems,
    download
};
