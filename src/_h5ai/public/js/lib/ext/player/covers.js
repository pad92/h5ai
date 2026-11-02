// Where a queue entry's cover comes from: the server thumbnail, the picture
// embedded in an MP3, or an album image next to the track.
const {readPicture} = require('./id3');
const {mayHaveId3} = require('./formats');

const ID3_RANGE = 'bytes=0-524288';
const ALBUM_IMAGE_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'poster'];

// Entry -> object URL of its embedded picture, or null once none was found.
// Kept here rather than on the shared item objects.
const embedded = new Map();

const fetchPicture = absHref => {
    return global.window.fetch(absHref, {headers: {Range: ID3_RANGE}})
        .then(response => {
            // A server ignoring Range answers 200 with the whole file: drop it
            // rather than download a full track for its cover.
            if (response.status !== 206) {
                if (response.body) {
                    response.body.cancel().catch(() => null);
                }
                return null;
            }
            return response.arrayBuffer().then(readPicture);
        })
        .then(picture => picture ? global.window.URL.createObjectURL(new global.window.Blob([picture.bytes], {type: picture.type})) : null)
        .catch(() => null);
};

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

// The best cover known now, without any request. A video only uses its own
// thumbnail: a folder image is an album cover, not a video's.
const coverFor = (item, isVideo) => {
    if (item.thumbRational) {
        return item.thumbRational;
    }
    if (isVideo) {
        return null;
    }
    return embedded.get(item) || findAlbumImage(item);
};

// Whether the embedded picture is worth a request: an MP3 without a server
// thumbnail, not looked at yet.
const needsLookup = item => !embedded.has(item) && !item.thumbRational && mayHaveId3(item);

// Resolves with the embedded picture's URL, or null.
const lookup = item => fetchPicture(item.absHref).then(url => {
    embedded.set(item, url);
    return url;
});

const revoke = url => {
    try {
        global.window.URL.revokeObjectURL(url);
    } catch {
        // An already revoked URL: nothing left to release.
    }
};

// A picture that failed to load is not offered nor looked up again.
const markBroken = (item, url) => {
    if (embedded.get(item) === url) {
        revoke(url);
        embedded.set(item, null);
    }
};

// Releases the embedded pictures of entries leaving the queue; a track known
// to have none is not looked up again.
const release = items => {
    items.forEach(item => {
        const url = embedded.get(item);
        if (url) {
            revoke(url);
            embedded.delete(item);
        }
    });
};

module.exports = {
    coverFor,
    needsLookup,
    lookup,
    markBroken,
    release
};
