const {test, assert} = require('scar');
const {canRenderDocuments} = require('../../../util/reqlib')('main/info-checks');

test('info page: PDF thumbs need magick, convert or opted-in gm', () => {
    [
        [{HAS_CMD_MAGICK: true}, null, true, 'ImageMagick 7'],
        [{HAS_CMD_CONVERT: true}, null, true, 'ImageMagick 6'],
        [{HAS_CMD_GM: true}, {allowGraphicsMagick: true}, true, 'GraphicsMagick opted in'],
        [{HAS_CMD_GM: true}, {allowGraphicsMagick: false}, false, 'GraphicsMagick not opted in'],
        [{HAS_CMD_GM: true}, undefined, false, 'GraphicsMagick without thumbnail options'],
        [{}, {allowGraphicsMagick: true}, false, 'no renderer']
    ].forEach(([setup, thumbnails, expected, name]) => {
        assert.equal(canRenderDocuments(setup, thumbnails), expected, name);
    });
});
