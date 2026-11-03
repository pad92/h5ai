const {test, assert} = require('scar');
const {documentTool, videoTool} = require('../../../util/reqlib')('main/info-checks');

test('info page: document thumbs need pdftoppm, or magick, convert or opted-in gm with gs', () => {
    [
        [{HAS_CMD_PDFTOPPM: true, HAS_CMD_MAGICK: true}, null, 'pdftoppm', 'ImageMagick without gs does not count'],
        [{HAS_CMD_PDFTOPPM: true, HAS_CMD_MAGICK: true, HAS_CMD_GS: true}, null, 'pdftoppm, magick', 'poppler first'],
        [{HAS_CMD_MAGICK: true, HAS_CMD_CONVERT: true, HAS_CMD_GS: true}, null, 'magick', 'ImageMagick 7 first'],
        [{HAS_CMD_CONVERT: true, HAS_CMD_GS: true}, null, 'convert', 'ImageMagick 6'],
        [{HAS_CMD_GM: true, HAS_CMD_GS: true}, {allowGraphicsMagick: true}, 'gm', 'GraphicsMagick opted in'],
        [{HAS_CMD_GM: true, HAS_CMD_GS: true}, {allowGraphicsMagick: false}, null, 'GraphicsMagick not opted in'],
        [{HAS_CMD_GM: true, HAS_CMD_GS: true}, undefined, null, 'GraphicsMagick without thumbnail options'],
        [{HAS_CMD_MAGICK: true}, null, null, 'ImageMagick alone renders nothing'],
        [{}, {allowGraphicsMagick: true}, null, 'no renderer']
    ].forEach(([setup, thumbnails, expected, name]) => {
        assert.equal(documentTool(setup, thumbnails), expected, name);
    });
});

test('info page: video thumbs prefer ffmpeg over avconv', () => {
    assert.equal(videoTool({HAS_CMD_FFMPEG: true, HAS_CMD_AVCONV: true}), 'ffmpeg');
    assert.equal(videoTool({HAS_CMD_AVCONV: true}), 'avconv');
    assert.equal(videoTool({}), null);
});
