// The large "now playing" view of a track: its cover in full over a blurred
// copy of it, and what the file says about itself. It opens from the bar's
// cover, above the listing, and leaves the bar below for the controls.
const {dom} = require('../../util');
const format = require('../../core/format');
const resource = require('../../core/resource');
const base = require('../../view/base');
const {getExt} = require('./formats');

const NOTE_ICON = 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z';
const COLLAPSE_ICON = 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z';

const TPL = `
<div id="player-now-playing" class="np-panel" role="region" aria-label="Now playing" inert="inert">
    <div class="np-backdrop" id="np-backdrop"></div>
    <button class="np-collapse" id="np-collapse" title="Reduce" aria-label="Reduce">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="${COLLAPSE_ICON}"/></svg>
    </button>
    <div class="np-content">
        <div class="np-cover" id="np-cover">
            <img class="np-cover-img hidden" id="np-cover-img" src="${resource.blankImage}" alt=""/>
            <svg class="np-cover-fallback" id="np-cover-fallback" viewBox="0 0 24 24" fill="currentColor"><path d="${NOTE_ICON}"/></svg>
        </div>
        <div class="np-info">
            <p class="np-kicker">Now playing</p>
            <h2 class="np-title" id="np-title"></h2>
            <p class="np-artist" id="np-artist"></p>
            <p class="np-album" id="np-album"></p>
            <dl class="np-details" id="np-details"></dl>
            <button class="np-viz" id="np-viz"><canvas></canvas></button>
        </div>
    </div>
</div>`;

let isOpen = false;
let onClose = () => null;

const nameWithoutExt = label => label.replace(/\.[a-z0-9]+$/i, '');

// "3/12" reads "3 of 12".
const formatTrack = track => track.replace(/^(\d+)\s*\/\s*(\d+)$/, '$1 of $2');

const formatDuration = seconds => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '';
    }
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const mins = Math.floor(total % 3600 / 60);
    const secs = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(mins).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
};

// The average bit rate from the file size: close enough for a constant or
// a variable rate, and known before any tag says it.
const formatBitrate = (size, duration) => {
    if (!Number.isFinite(size) || !Number.isFinite(duration) || size <= 0 || duration <= 0) {
        return '';
    }
    return `${Math.round(size * 8 / duration / 1000)} kbps`;
};

const setText = (selector, text) => {
    const $el = dom(selector).text(text || '');
    if (text) {
        $el.show();
    } else {
        $el.hide();
    }
};

const showCover = (url, background) => {
    const $img = dom('#np-cover-img');
    const $fallback = dom('#np-cover-fallback');
    const $backdrop = dom('#np-backdrop');
    if (!url) {
        $img.hide().attr('src', resource.blankImage);
        $fallback.show();
        $backdrop.css({backgroundImage: background});
        return;
    }
    $img[0].onerror = () => showCover(null, background);
    $img.attr('src', url).show();
    $fallback.hide();
    // The cover itself, blurred by the style sheet, colours the background.
    // Paths come encoded already: only quotes and backslashes need escaping.
    $backdrop.css({backgroundImage: `url("${url.replace(/["\\]/g, '\\$&')}")`});
};

// `view`: {item, tags, coverUrl, background, duration}. Missing fields are
// left out, never shown empty.
const render = ({item, tags, coverUrl, background, duration}) => {
    setText('#np-title', tags.title || nameWithoutExt(item.label));
    setText('#np-artist', tags.artist || tags.albumArtist);
    const folder = item.parent ? item.parent.label : '';
    setText('#np-album', [tags.album || folder, tags.year].filter(Boolean).join(' · '));

    const rows = [
        ['Genre', tags.genre],
        ['Track', tags.track && formatTrack(tags.track)],
        ['Album artist', tags.albumArtist !== tags.artist && tags.albumArtist],
        ['Duration', formatDuration(duration)],
        ['Format', getExt(item).toUpperCase()],
        ['Bit rate', formatBitrate(item.size, duration)],
        ['Size', format.formatSize(item.size)],
        ['File', item.label]
    ].filter(([, value]) => value);
    const $details = dom('#np-details').clr();
    rows.forEach(([term, value]) => {
        $details.app(dom('<dt/>').text(term));
        $details.app(dom('<dd/>').text(value));
    });

    showCover(coverUrl, background);
};

const open = () => {
    isOpen = true;
    dom('#player-now-playing').addCls('active').rmAttr('inert');
    base.$root.addCls('np-open');
    dom('#np-collapse')[0].focus();
};

const close = () => {
    if (!isOpen) {
        return;
    }
    isOpen = false;
    const panel = dom('#player-now-playing')[0];
    // Focus inside a view becoming inert would be lost: it goes back to the
    // bar's cover, which opened it.
    const hadFocus = panel.contains(global.window.document.activeElement);
    dom(panel).rmCls('active').attr('inert', 'inert');
    base.$root.rmCls('np-open');
    onClose();
    if (hadFocus) {
        dom('#ap-cover-gradient')[0].focus();
    }
};

// `on.close`: called once the view closed, whatever closed it.
const mount = on => {
    onClose = on.close;
    base.$root.app(TPL);
    dom('#np-collapse').on('click', close);
    dom(global.window).on('keydown', ev => {
        // The preview, when open above, handles its own Escape.
        const previewIsOpen = dom('#pv-overlay').length && !dom('#pv-overlay').isHidden();
        if (isOpen && ev.key === 'Escape' && !previewIsOpen) {
            ev.preventDefault();
            close();
        }
    });
};

module.exports = {
    mount,
    render,
    open,
    close,
    isOpen: () => isOpen
};
