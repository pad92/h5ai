const {test, assert} = require('scar');
const {documentTool, videoTool} = require('../../../util/reqlib')('main/info-checks');

test('info page: PDF thumbs need magick, convert or opted-in gm', () => {
    [
        [{HAS_CMD_MAGICK: true, HAS_CMD_CONVERT: true}, null, 'magick', 'ImageMagick 7 first'],
        [{HAS_CMD_CONVERT: true}, null, 'convert', 'ImageMagick 6'],
        [{HAS_CMD_GM: true}, {allowGraphicsMagick: true}, 'gm', 'GraphicsMagick opted in'],
        [{HAS_CMD_GM: true}, {allowGraphicsMagick: false}, null, 'GraphicsMagick not opted in'],
        [{HAS_CMD_GM: true}, undefined, null, 'GraphicsMagick without thumbnail options'],
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
