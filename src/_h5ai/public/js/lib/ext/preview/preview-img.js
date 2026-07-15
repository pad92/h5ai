const {dom, escapeHtml} = require('../../util');
const allsettings = require('../../core/settings');
const preview = require('./preview');
const EXIF = require('exif-js');
const store = require('../../core/store');
const resource = require('../../core/resource');
const server = require('../../server');

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

const formatShutterSpeed = exposureTime => {
    if (!exposureTime) {
        return null;
    }
    if (typeof exposureTime === 'number') {
        if (exposureTime >= 1) {
            return exposureTime.toFixed(1) + 's';
        }
        const fraction = Math.round(1 / exposureTime);
        return `1/${fraction}s`;
    }
    if (exposureTime.denominator && exposureTime.numerator) {
        if (exposureTime.numerator >= exposureTime.denominator) {
            return (exposureTime.numerator / exposureTime.denominator).toFixed(1) + 's';
        }
        return `${exposureTime.numerator}/${exposureTime.denominator}s`;
    }
    return null;
};

const formatAperture = fNumber => {
    if (!fNumber) {
        return null;
    }
    if (typeof fNumber === 'number') {
        return `f/${fNumber}`;
    }
    if (fNumber.denominator && fNumber.numerator) {
        return `f/${(fNumber.numerator / fNumber.denominator).toFixed(1)}`;
    }
    return null;
};

const formatFocalLength = focalLength => {
    if (!focalLength) {
        return null;
    }
    if (typeof focalLength === 'number') {
        return `${focalLength}mm`;
    }
    if (focalLength.denominator && focalLength.numerator) {
        return `${Math.round(focalLength.numerator / focalLength.denominator)}mm`;
    }
    return null;
};

const formatISO = iso => {
    if (!iso) {
        return null;
    }
    return `ISO ${iso}`;
};

const formatDateTime = dt => {
    if (!dt) {
        return null;
    }
    const parts = dt.split(' ');
    if (parts.length === 2) {
        const datePart = parts[0].replace(/:/g, '-');
        const timePart = parts[1].substring(0, 5);
        return `${datePart} ${timePart}`;
    }
    return dt;
};

const convertDMSToDD = (dms, ref) => {
    if (!dms || dms.length < 3) {
        return null;
    }
    let d = dms[0];
    let m = dms[1];
    let s = dms[2];

    if (typeof d === 'object') {
        d = d.numerator / d.denominator;
    }
    if (typeof m === 'object') {
        m = m.numerator / m.denominator;
    }
    if (typeof s === 'object') {
        s = s.numerator / s.denominator;
    }

    let dd = d + m / 60 + s / 3600;
    if (ref === 'S' || ref === 'W') {
        dd = -dd;
    }
    return dd;
};

const getGPSLink = tags => {
    if (!tags.GPSLatitude || !tags.GPSLongitude) {
        return null;
    }
    const lat = convertDMSToDD(tags.GPSLatitude, tags.GPSLatitudeRef);
    const lng = convertDMSToDD(tags.GPSLongitude, tags.GPSLongitudeRef);
    if (lat !== null && lng !== null) {
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    return null;
};

const buildExifHtml = (tags, label) => {
    const make = tags.Make || '';
    const model = tags.Model || '';
    let camera = model;
    if (make && !model.toLowerCase().includes(make.toLowerCase())) {
        camera = `${make} ${model}`;
    }

    const focalLength = formatFocalLength(tags.FocalLength);
    const aperture = formatAperture(tags.FNumber);
    const shutterSpeed = formatShutterSpeed(tags.ExposureTime);
    const iso = formatISO(tags.ISOSpeedRatings || tags.ISO);
    const date = formatDateTime(tags.DateTimeOriginal);
    const gpsLink = getGPSLink(tags);
    const lens = tags.LensModel || tags.Lens || null;

    let html = '<div class="exif-header">Photo Details</div>';

    html += `<div class="exif-item"><span class="exif-icon">📄</span><span class="exif-value">${escapeHtml(label)}</span></div>`;

    if (camera) {
        html += `<div class="exif-item"><span class="exif-icon">📷</span><span class="exif-value">${escapeHtml(camera)}</span></div>`;
    }

    if (lens) {
        html += `<div class="exif-item"><span class="exif-icon">🔍</span><span class="exif-value">${escapeHtml(lens)}</span></div>`;
    }

    if (date) {
        html += `<div class="exif-item"><span class="exif-icon">📅</span><span class="exif-value">${escapeHtml(date)}</span></div>`;
    }

    if (gpsLink) {
        html += `<div class="exif-item"><span class="exif-icon">📍</span><span class="exif-value"><a href="${escapeHtml(gpsLink)}" target="_blank">View on Google Maps</a></span></div>`;
    }

    if (focalLength || aperture || shutterSpeed || iso) {
        html += '<div class="exif-grid">';
        if (focalLength) {
            html += `<div class="exif-grid-item"><span class="exif-grid-label">Focal</span><span class="exif-grid-value">${focalLength}</span></div>`;
        }
        if (aperture) {
            html += `<div class="exif-grid-item"><span class="exif-grid-label">Aperture</span><span class="exif-grid-value">${aperture}</span></div>`;
        }
        if (shutterSpeed) {
            html += `<div class="exif-grid-item"><span class="exif-grid-label">Shutter</span><span class="exif-grid-value">${shutterSpeed}</span></div>`;
        }
        if (iso) {
            html += `<div class="exif-grid-item"><span class="exif-grid-label">ISO</span><span class="exif-grid-value">${iso}</span></div>`;
        }
        html += '</div>';
    }

    return html;
};

const hasExifData = tags => {
    return !!(tags && (tags.Make || tags.Model || tags.FocalLength || tags.FNumber || tags.ExposureTime || tags.ISOSpeedRatings || tags.ISO || tags.DateTimeOriginal));
};

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
                } catch (e) {
                    if (e) {
                        resolve(null);
                    }
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
    return loadSrc(href).catch(() => {
        if (!settings.size) {
            throw new Error('unable to load image');
        }
        return requestSample(href).then(loadSrc);
    });
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
