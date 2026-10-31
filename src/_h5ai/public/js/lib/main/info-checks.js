// Feature checks of the info page that combine several setup values.

// Document (PDF/PostScript) thumbnails need ImageMagick: `magick` on
// ImageMagick 7, `convert` on ImageMagick 6, or GraphicsMagick when the
// administrator opted in with thumbnails.allowGraphicsMagick.
const canRenderDocuments = (setup, thumbnails) => {
    return Boolean(setup.HAS_CMD_MAGICK || setup.HAS_CMD_CONVERT ||
        thumbnails && thumbnails.allowGraphicsMagick && setup.HAS_CMD_GM);
};

module.exports = {
    canRenderDocuments
};
