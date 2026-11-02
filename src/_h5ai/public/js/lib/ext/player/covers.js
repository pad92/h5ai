// Where an entry's cover comes from: the server thumbnail, the picture
// embedded in the file (MP3, FLAC), or an album image next to the track.
const metadata = require('./metadata');

const ALBUM_IMAGE_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'poster'];

// An image named like an album cover in the same folder. Any other image is
// a photo, not the album's cover: it is not used.
const findAlbumImage = item => {
    if (!item.parent || !item.parent.content) {
        return null;
    }
    const images = Object.values(item.parent.content)
        .filter(sibling => sibling && !sibling.isFolder() && sibling.type && sibling.type.startsWith('img'));
    for (const name of ALBUM_IMAGE_NAMES) {
        const found = images.find(image => {
            const label = image.label.toLowerCase();
            return label === name || label.startsWith(name + '.');
        });
        if (found) {
            return found.absHref;
        }
    }
    return null;
};

const embeddedOf = item => {
    const result = metadata.known(item);
    return result ? result.pictureUrl : null;
};

// The best cover known now for the bar and the queue, without any request.
// The small server thumbnail comes first. A video only uses its own
// thumbnail: a folder image is an album cover, not a video's.
const coverFor = (item, isVideo) => {
    if (item.thumbRational) {
        return item.thumbRational;
    }
    if (isVideo) {
        return null;
    }
    return embeddedOf(item) || findAlbumImage(item);
};

// The best cover for the large view, once the file was read: the full
// picture first, the thumbnail last.
const largeCoverFor = item => embeddedOf(item) || findAlbumImage(item) || item.thumbRational || null;

// Whether the file is worth a request for its picture: a tagged format
// without a server thumbnail, not read yet.
const needsLookup = item => !metadata.has(item) && !item.thumbRational && metadata.canRead(item);

module.exports = {
    coverFor,
    largeCoverFor,
    needsLookup,
    lookup: metadata.read,
    markBroken: metadata.markBroken,
    release: metadata.release
};
