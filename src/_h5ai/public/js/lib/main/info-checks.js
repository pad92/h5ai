// Feature checks of the info page that combine several setup values. The
// order of preference follows Thumb (class-thumb.php).

// The video tool the thumbnailer uses: ffmpeg first, then avconv.
const videoTool = setup => {
    if (setup.HAS_CMD_FFMPEG) {
        return 'ffmpeg';
    }
    return setup.HAS_CMD_AVCONV ? 'avconv' : null;
};

// Document (PDF/PostScript) thumbnails need ImageMagick: `magick` on
// ImageMagick 7, `convert` on ImageMagick 6, or GraphicsMagick when the
// administrator opted in with thumbnails.allowGraphicsMagick.
const documentTool = (setup, thumbnails) => {
    if (setup.HAS_CMD_MAGICK) {
        return 'magick';
    }
    if (setup.HAS_CMD_CONVERT) {
        return 'convert';
    }
    return thumbnails && thumbnails.allowGraphicsMagick && setup.HAS_CMD_GM ? 'gm' : null;
};

module.exports = {
    documentTool,
    videoTool
};
