const {test, assert} = require('scar');
const exif = require('../../../src/_h5ai/public/js/lib/ext/preview/exif');

test('EXIF values format decimal and rational camera measurements', () => {
    assert.equal(exif.formatShutterSpeed(0.008), '1/125s');
    assert.equal(exif.formatShutterSpeed({numerator: 1, denominator: 2}), '1/2s');
    assert.equal(exif.formatShutterSpeed({numerator: 2, denominator: 1}), '2.0s');
    assert.equal(exif.formatAperture({numerator: 28, denominator: 10}), 'f/2.8');
    assert.equal(exif.formatFocalLength({numerator: 503, denominator: 10}), '50mm');
    assert.equal(exif.formatISO(400), 'ISO 400');
    assert.equal(exif.formatDateTime('2024:03:04 12:34:56'), '2024-03-04 12:34');
});

test('EXIF GPS converts rational coordinates and applies southern and western signs', () => {
    const tags = {
        GPSLatitude: [{numerator: 48, denominator: 1}, {numerator: 30, denominator: 1}, {numerator: 0, denominator: 1}],
        GPSLatitudeRef: 'S',
        GPSLongitude: [2, 15, 0],
        GPSLongitudeRef: 'W'
    };
    assert.equal(exif.getGPSLink(tags), 'https://www.google.com/maps/search/?api=1&query=-48.5,-2.25');
    assert.equal(exif.getGPSLink({GPSLatitude: [1, 2, 3]}), null);
});

test('EXIF HTML escapes metadata and includes available camera details', () => {
    const html = exif.buildExifHtml({
        Make: 'Cam <script>',
        Model: 'Cam <script> One',
        LensModel: 'Lens & Co',
        FocalLength: 50,
        FNumber: 2.8,
        ExposureTime: 0.01,
        ISO: 200
    }, 'photo <img src=x> & name.jpg');

    assert.ok(html.includes('photo &lt;img src=x&gt; &amp; name.jpg'));
    assert.ok(html.includes('Cam &lt;script&gt; One'));
    assert.ok(html.includes('Lens &amp; Co'));
    assert.ok(html.includes('50mm'));
    assert.ok(html.includes('f/2.8'));
    assert.ok(html.includes('1/100s'));
    assert.ok(html.includes('ISO 200'));
    assert.equal(html.includes('<script>'), false);
    assert.equal(exif.hasExifData(null), false);
    assert.equal(exif.hasExifData({}), false);
    assert.equal(exif.hasExifData({Model: 'Camera'}), true);
});
