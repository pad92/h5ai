// The changelog, opened from the version in the top bar. The build copies
// CHANGELOG.md next to public/ (_h5ai/CHANGELOG.md), where the web server
// serves it as a static file. Only the dialog's own labels are translated;
// the file itself stays in English.
const rawMarked = require('marked');
const marked = typeof rawMarked === 'function' ? rawMarked : rawMarked.parse;
const {dom, sanitizeHtml} = require('../util');
const allsettings = require('../core/settings');
const i18n = require('../core/i18n');

const win = global.window;
const doc = win.document;
const REQUEST_TIMEOUT = 30000;

const TPL_DIALOG =
        `<dialog id="changelog" aria-labelledby="changelog-title">
            <div id="changelog-head">
                <h2 id="changelog-title" class="l10n-changelog">Changelog</h2>
                <button type="button" id="changelog-close" class="l10n_aria-close l10n_title-close" aria-label="close" title="close">&times;</button>
            </div>
            <div id="changelog-body"></div>
        </dialog>`;

const changelogHref = () => allsettings.publicHref + '../CHANGELOG.md';

const requestText = href => new Promise((resolve, reject) => {
    const xhr = new win.XMLHttpRequest();
    xhr.open('GET', href, true);
    xhr.timeout = REQUEST_TIMEOUT;
    xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText || '');
        } else {
            reject(new Error(`HTTP ${xhr.status}`));
        }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.ontimeout = () => reject(new Error('request timed out'));
    xhr.send();
});

// The file only changes with a new build, so one successful load is kept.
let loaded = null;

const load = () => {
    if (!loaded) {
        loaded = requestText(changelogHref()).catch(err => {
            loaded = null;
            throw err;
        });
    }
    return loaded;
};

const isOpen = dialog => dialog.hasAttribute('open');

const close = () => {
    const dialog = doc.getElementById('changelog');
    if (!dialog || !isOpen(dialog)) {
        return;
    }
    if (typeof dialog.close === 'function') {
        dialog.close();
    } else {
        dialog.removeAttribute('open');
    }
};

// showModal() closes on Escape by itself; without it the dialog listens.
const onKeydown = ev => {
    if (ev.key === 'Escape') {
        close();
    }
};

const createDialog = () => {
    const $dialog = dom(TPL_DIALOG);
    const dialog = $dialog[0];
    $dialog.find('#changelog-close').on('click', close);
    // A click on the backdrop lands on the dialog itself, not on its content.
    $dialog.on('click', ev => {
        if (ev.target === dialog) {
            close();
        }
    });
    $dialog.on('keydown', onKeydown);
    dom('body').app($dialog);
    i18n.apply(dialog);
    return dialog;
};

const show = dialog => {
    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
};

const open = () => {
    const dialog = doc.getElementById('changelog') || createDialog();
    const $body = dom(dialog).find('#changelog-body');
    if (!isOpen(dialog)) {
        show(dialog);
    }
    $body.clr().app(dom('<p class="changelog-status"></p>').text(i18n.t('loading')));
    return load()
        .then(text => {
            $body.html(sanitizeHtml(marked(text)));
        })
        .catch(err => {
            $body.clr().app(dom('<p class="changelog-status"></p>')
                .text(`[${i18n.t('requestFailed')}] ${err.message}`));
        });
};

module.exports = {changelogHref, open, close};
