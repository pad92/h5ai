// Feature checks of the info page that combine several setup values. The
// order of preference follows Thumb (class-thumb.php).

// The video tool the thumbnailer uses: ffmpeg first, then avconv.
const videoTool = setup => {
    if (setup.HAS_CMD_FFMPEG) {
        return 'ffmpeg';
    }
    return setup.HAS_CMD_AVCONV ? 'avconv' : null;
};

// ImageMagick reads PDF and PostScript through Ghostscript, so it counts only
// with `gs`: `magick` on ImageMagick 7, `convert` on ImageMagick 6, or
// GraphicsMagick when the administrator opted in with
// thumbnails.allowGraphicsMagick.
const magickTool = (setup, thumbnails) => {
    if (!setup.HAS_CMD_GS) {
        return null;
    }
    if (setup.HAS_CMD_MAGICK) {
        return 'magick';
    }
    if (setup.HAS_CMD_CONVERT) {
        return 'convert';
    }
    return thumbnails && thumbnails.allowGraphicsMagick && setup.HAS_CMD_GM ? 'gm' : null;
};

// The document tools the thumbnailer uses, in its order: poppler's
// `pdftoppm` for PDF first, then ImageMagick for the rest and PostScript.
const documentTool = (setup, thumbnails) => {
    const tools = [setup.HAS_CMD_PDFTOPPM ? 'pdftoppm' : null, magickTool(setup, thumbnails)].filter(Boolean);
    return tools.length ? tools.join(', ') : null;
};

module.exports = {
    documentTool,
    videoTool
};
