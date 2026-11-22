const {dom, onActivationKey, beforeUnload} = require('../../util');
const i18n = require('../../core/i18n');

const COPY_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const COPIED_MS = 1500;

// Selects everything the preview shows: the overlay drops mousedown and
// keydown, so neither a drag nor Ctrl+A can select the text there.
const selectAll = (el, win) => {
    const selection = win.getSelection();
    const range = win.document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
};

// Copies through a hidden textarea: the Clipboard API exists only in a secure
// context, and an h5ai on plain HTTP has none.
const copyWithTextarea = (text, win) => {
    const doc = win.document;
    // select() moves the focus: it goes back where it was, the copy button
    // for a keyboard user.
    const focused = doc.activeElement;
    const textarea = doc.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    doc.body.appendChild(textarea);
    try {
        textarea.select();
        return doc.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
        if (focused && typeof focused.focus === 'function') {
            focused.focus();
        }
    }
};

const copyText = (text, win) => {
    const clipboard = win.navigator && win.navigator.clipboard;
    if (win.isSecureContext && clipboard && typeof clipboard.writeText === 'function') {
        // Called within the click, not a later microtask, so the browser still
        // sees the user's gesture; a writeText that throws instead of
        // rejecting falls back the same way.
        let written;
        try {
            written = Promise.resolve(clipboard.writeText(text));
        } catch (err) {
            written = Promise.reject(err);
        }
        return written.then(() => true, () => copyWithTextarea(text, win));
    }
    return Promise.resolve(copyWithTextarea(text, win));
};

// A button in the preview bar that selects the shown text and copies the
// file's own text: the Markdown source, not its rendered HTML. It goes with
// the content: preview.js unloads the content when it moves on or closes.
const addCopyButton = (el, text, win) => {
    const $button = i18n.apply(dom('<li id="pv-bar-copy" class="bar-right bar-button l10n_title-selectAllCopy l10n_aria-selectAllCopy" role="button" tabindex="0"/>'))
        .html(COPY_ICON);
    let timeoutId = null;
    const copy = () => {
        // Selected once copied: the textarea copy replaces the selection.
        return copyText(text, win).then(ok => {
            selectAll(el, win);
            win.clearTimeout(timeoutId);
            $button.rmCls('copied').rmCls('copy-failed').addCls(ok ? 'copied' : 'copy-failed');
            timeoutId = win.setTimeout(() => $button.rmCls('copied').rmCls('copy-failed'), COPIED_MS);
            return ok;
        });
    };

    dom('#pv-buttons').app($button);
    $button.on('click', copy).on('keydown', onActivationKey(copy));

    beforeUnload(el, () => {
        win.clearTimeout(timeoutId);
        $button.rm();
    });
    return copy;
};

module.exports = {addCopyButton, copyText, selectAll};
