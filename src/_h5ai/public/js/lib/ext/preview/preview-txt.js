const {keys, dom} = require('../../util');
const allsettings = require('../../core/settings');
const i18n = require('../../core/i18n');
const preview = require('./preview');
const event = require('../../core/event');
const {render} = require('./text-content');
const {addCopyButton} = require('./text-copy');

const win = global.window;
const XHR = win.XMLHttpRequest;
const settings = Object.assign({
    enabled: false,
    styles: {}
}, allsettings['preview-txt']);

const updateGui = () => {
    const el = dom('#pv-content-txt')[0];
    if (!el) {
        return;
    }

    const container = dom('#pv-container')[0];
    el.style.height = container.offsetHeight + 'px';

    preview.setLabels([
        preview.item.label,
        preview.item.size + ' bytes'
    ]);
};

const requestTextContent = href => {
    return new Promise((resolve, reject) => {
        const xhr = new XHR();
        const callback = () => {
            if (xhr.readyState === XHR.DONE) {
                if (xhr.status === 0) {
                    return;
                }
                try {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.responseText || '');
                    } else {
                        reject(`HTTP ${xhr.status}`);
                    }
                } catch (err) {
                    reject(String(err));
                }
            }
        };

        xhr.open('GET', href, true);
        xhr.onreadystatechange = callback;
        xhr.onerror = () => reject(i18n.t('networkError'));
        xhr.ontimeout = () => reject(i18n.t('requestTimedOut'));
        xhr.timeout = 30000;
        xhr.send();
    });
};

// The file's text, by the element that shows it, for the copy button.
const texts = new WeakMap();

const load = item => {
    return requestTextContent(item.absHref)
        .then(content => {
            const $content = render(content, settings.styles[item.type], win);
            texts.set($content[0], content);
            return $content;
        }, err => render(`[${i18n.t('requestFailed')}] ${err}`, settings.styles[item.type], win));
};

// The button is added once the content shows: a load the user moved past is
// never attached, so it must not leave a button behind.
const onContent = (item, el) => {
    if (el && texts.has(el)) {
        addCopyButton(el, texts.get(el), win);
    }
};

const init = () => {
    if (settings.enabled) {
        const typesToRegister = keys(settings.styles);
        // Fallback: ensure markdown types are always registered
        if (!typesToRegister.includes('txt-md')) {
            typesToRegister.push('txt-md');
        }
        if (!typesToRegister.includes('txt-readme')) {
            typesToRegister.push('txt-readme');
        }
        preview.register(typesToRegister, load, updateGui);
        event.sub('preview.content', onContent);
    }
};

init();
