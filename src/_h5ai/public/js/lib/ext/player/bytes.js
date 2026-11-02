// Helpers shared by the tag readers.

// The picture type comes from its bytes, never from the tag: a tag claiming
// text/html would otherwise turn the cover's blob: URL into a same-origin page.
const pictureType = data => {
    if (data[0] === 0xFF && data[1] === 0xD8) {
        return 'image/jpeg';
    }
    if (data[0] === 0x89 && data[1] === 0x50) {
        return 'image/png';
    }
    return null;
};

const decoders = {};

// `encoding`: a WHATWG label ('utf-8', 'utf-16le', 'utf-16be', 'iso-8859-1').
// Trailing NUL characters, which tags often keep, are dropped.
const decode = (bytes, encoding) => {
    if (!decoders[encoding]) {
        decoders[encoding] = new global.window.TextDecoder(encoding);
    }
    return decoders[encoding].decode(bytes).replace(/\0+$/, '');
};

// The tag fields the player shows, trimmed; empty ones left out.
const FIELDS = ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'track'];

const cleanTags = raw => {
    const tags = {};
    FIELDS.forEach(field => {
        const value = typeof raw[field] === 'string' ? raw[field].trim() : '';
        if (value) {
            tags[field] = value;
        }
    });
    return tags;
};

module.exports = {
    pictureType,
    decode,
    cleanTags
};
