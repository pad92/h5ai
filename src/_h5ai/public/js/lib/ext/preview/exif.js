const {escapeHtml} = require('../../util');

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

const formatISO = iso => iso ? `ISO ${iso}` : null;

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

const hasExifData = tags => !!(tags && (tags.Make || tags.Model || tags.FocalLength || tags.FNumber ||
    tags.ExposureTime || tags.ISOSpeedRatings || tags.ISO || tags.DateTimeOriginal));

module.exports = {formatShutterSpeed, formatAperture, formatFocalLength, formatISO, formatDateTime, convertDMSToDD, getGPSLink, buildExifHtml, hasExifData};
