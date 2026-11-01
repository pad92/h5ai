const {keys, dom} = require('../../util');
const allsettings = require('../../core/settings');
const preview = require('./preview');
const {render} = require('./text-content');

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
        xhr.onerror = () => reject('network error');
        xhr.ontimeout = () => reject('request timed out');
        xhr.timeout = 30000;
        xhr.send();
    });
};

const load = item => {
    return requestTextContent(item.absHref)
        .catch(err => '[request failed] ' + err)
        .then(content => render(content, settings.styles[item.type], win));
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
    }
};

init();
