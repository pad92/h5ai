const {dom} = require('../../util');
const allsettings = require('../../core/settings');
const preview = require('./preview');
const EXIF = require('exif-js');
const store = require('../../core/store');
const resource = require('../../core/resource');
const server = require('../../server');
const {buildExifHtml, hasExifData} = require('./exif');
const {loadImage} = require('./image-loader');

const settings = Object.assign({
    enabled: false,
    size: null,
    types: []
}, allsettings['preview-img']);
const tpl = '<img id="pv-content-img"/>';

let $infoBtn = null;
let $exifCard = null;
let showExifPanel = store.get('preview-exif-visible') || false;
let currentHref = null;

const getExif = href => {
    return new Promise(resolve => {
        const win = global.window;
        const xhr = new win.XMLHttpRequest();
        xhr.open('GET', href, true);
        xhr.responseType = 'arraybuffer';
        xhr.setRequestHeader('Range', 'bytes=0-131072');
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 206) {
                try {
                    const tags = EXIF.readFromBinaryFile(xhr.response);
                    resolve(tags || null);
                } catch {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        };
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve(null);
        xhr.timeout = 10000;
        xhr.send();
    });
};

const updateExifUi = () => {
    if (showExifPanel) {
        $infoBtn.addCls('active');
        $exifCard.addCls('visible').show();
    } else {
        $infoBtn.rmCls('active');
        $exifCard.rmCls('visible').hide();
    }
};

const toggleExifPanel = () => {
    showExifPanel = !showExifPanel;
    store.put('preview-exif-visible', showExifPanel);
    updateExifUi();
};

const updateGui = () => {
    const el = dom('#pv-content-img')[0];
    if (!el) {
        return;
    }

    const elW = el.offsetWidth;

    const labels = [preview.item.label];
    const elNW = el.naturalWidth;
    const elNH = el.naturalHeight;
    labels.push(String(elNW) + 'x' + String(elNH));
    labels.push(String((100 * elW / elNW).toFixed(0)) + '%');

    preview.setLabels(labels);
};

const getPreviewSize = () => {
    const win = global.window;
    // Calculate 80% of the screen/viewport size (whichever is larger, width or height)
    const size = Math.max(win.innerWidth, win.innerHeight) * 0.8;
    return Math.round(size);
};

const requestSample = href => {
    const previewSize = getPreviewSize();
    return server.request({
        action: 'get',
        thumbs: [{
            type: 'img',
            href,
            width: previewSize,
            height: 0
        }]
    }).then(json => {
        return json && json.thumbs && json.thumbs[0] ? json.thumbs[0] : null;
    }).catch(() => null);
};

const load = item => {
    const href = item.absHref;
    currentHref = href;

    if ($infoBtn) {
        $infoBtn.hide();
    }
    if ($exifCard) {
        $exifCard.hide().rmCls('visible');
    }

    getExif(href).then(tags => {
        if (currentHref !== href) {
            return;
        }

        if (hasExifData(tags)) {
            const html = buildExifHtml(tags, item.label);
            $exifCard.html(html);
            $infoBtn.show();
            updateExifUi();
        }
    });

    const loadSrc = src => new Promise((resolve, reject) => {
        const $el = dom(tpl)
            .on('load', () => resolve($el))
            .on('error', () => reject($el))
            .attr('src', src);
    });

    // Display the original photo. Fall back to a server-generated sample only
    // when the browser cannot decode the original (e.g. camera RAW formats).
    return loadImage(href, settings.size, requestSample, loadSrc);
};

const init = () => {
    if (settings.enabled) {
        $infoBtn = dom(`<li id="pv-bar-info" class="bar-right bar-button"><img src="${resource.image('info-toggle')}"/></li>`)
            .hide()
            .appTo('#pv-buttons');

        $exifCard = dom('<div id="pv-exif-card" class="hof"></div>')
            .hide()
            .appTo('#pv-overlay');

        $infoBtn.on('click', ev => {
            ev.stopPropagation();
            toggleExifPanel();
        });

        dom('#pv-overlay').on('click', ev => {
            if (ev.target.id === 'pv-overlay' || ev.target.id === 'pv-container') {
                if ($exifCard) {
                    $exifCard.hide().rmCls('visible');
                }
            }
        });

        // Monkey-patch setLabels to hide info elements on item change or close
        const originalSetLabels = preview.setLabels;
        preview.setLabels = labels => {
            if ($infoBtn) {
                $infoBtn.hide();
            }
            if ($exifCard) {
                $exifCard.hide().rmCls('visible');
            }
            originalSetLabels(labels);
        };

        preview.register(settings.types, load, updateGui);
    }
};

init();
