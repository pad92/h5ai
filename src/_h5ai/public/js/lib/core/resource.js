const {includes} = require('../util');
const config = require('../config');
const settings = require('./settings');

const imagesHref = settings.publicHref + 'images/';
const uiHref = imagesHref + 'ui/';
const themesHref = imagesHref + 'themes/';
const defaultThemeHref = themesHref + 'default/';
const defaultIcons = ['file', 'folder', 'folder-page', 'folder-parent', 'ar', 'aud', 'bin', 'img', 'txt', 'vid', 'x'];


const image = id => uiHref + id + '.svg';

const icon = id => {
    const baseId = (id || '').split('-')[0];
    const href = config.theme[id] || config.theme[baseId];

    if (href) {
        return themesHref + href;
    }

    if (includes(defaultIcons, id)) {
        return defaultThemeHref + id + '.svg';
    }

    if (includes(defaultIcons, baseId)) {
        return defaultThemeHref + baseId + '.svg';
    }

    return defaultThemeHref + 'file.svg';
};


// A transparent 1x1 GIF for <img> elements that have nothing to show yet: an
// img without src, or with an empty one, is invalid HTML. data: images are
// allowed by the Docker image's Content-Security-Policy.
const blankImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';


module.exports = {
    image,
    icon,
    blankImage
};
