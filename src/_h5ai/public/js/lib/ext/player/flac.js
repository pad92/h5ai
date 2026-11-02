// Reads the cover picture and the Vorbis comments of a FLAC file's metadata
// blocks (https://xiph.org/flac/format.html).
const {pictureType, decode, cleanTags} = require('./bytes');

const BLOCK_VORBIS_COMMENT = 4;
const BLOCK_PICTURE = 6;
// FLAC picture types: 3 is the front cover; any other is a fallback.
const FRONT_COVER = 3;

const COMMENT_FIELDS = {
    TITLE: 'title',
    ARTIST: 'artist',
    ALBUMARTIST: 'albumArtist',
    ALBUM: 'album',
    DATE: 'year',
    YEAR: 'year',
    GENRE: 'genre',
    TRACKNUMBER: 'track'
};

// Vorbis comments: little-endian lengths, then KEY=value strings in UTF-8.
// Repeated keys (several artists) are joined.
const readComments = (view, arr, start, end) => {
    const values = {};
    let pos = start;
    const vendorLength = view.getUint32(pos, true);
    pos += 4 + vendorLength;
    const count = view.getUint32(pos, true);
    pos += 4;
    for (let i = 0; i < count && pos + 4 <= end; i += 1) {
        const length = view.getUint32(pos, true);
        pos += 4;
        if (pos + length > end) {
            break;
        }
        const comment = decode(arr.subarray(pos, pos + length), 'utf-8');
        pos += length;
        const eq = comment.indexOf('=');
        const field = COMMENT_FIELDS[comment.slice(0, eq).toUpperCase()];
        if (eq > 0 && field) {
            values[field] = values[field] ? `${values[field]} / ${comment.slice(eq + 1)}` : comment.slice(eq + 1);
        }
    }
    if (values.year) {
        values.year = values.year.slice(0, 4);
    }
    return values;
};

// A PICTURE block: big-endian picture type, MIME and description strings,
// four dimensions, then the data.
const readPictureBlock = (view, arr, start, end) => {
    let pos = start;
    const kind = view.getUint32(pos);
    pos += 4;
    pos += 4 + view.getUint32(pos);
    pos += 4 + view.getUint32(pos);
    pos += 16;
    const length = view.getUint32(pos);
    pos += 4;
    if (pos + length > end || length <= 10) {
        return null;
    }
    const bytes = arr.subarray(pos, pos + length);
    const type = pictureType(bytes);
    return type ? {kind, picture: {type, bytes}} : null;
};

// `buffer`: the start of the file. Returns {picture, tags} like readId3, or
// null when it is not a FLAC file. A block cut by the end of the buffer
// (a picture bigger than what was read) is left out.
const readFlac = buffer => {
    const arr = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (arr.length < 8 || String.fromCharCode(arr[0], arr[1], arr[2], arr[3]) !== 'fLaC') {
        return null;
    }

    let raw = {};
    let found = null;
    let pos = 4;
    let isLast = false;
    while (!isLast && pos + 4 <= arr.length) {
        isLast = (arr[pos] & 0x80) !== 0; // eslint-disable-line no-bitwise
        const type = arr[pos] & 0x7F; // eslint-disable-line no-bitwise
        const length = view.getUint32(pos) & 0xFFFFFF; // eslint-disable-line no-bitwise
        const start = pos + 4;
        const end = start + length;
        if (end > arr.length) {
            break;
        }
        try {
            if (type === BLOCK_VORBIS_COMMENT) {
                raw = readComments(view, arr, start, end);
            } else if (type === BLOCK_PICTURE && (!found || found.kind !== FRONT_COVER)) {
                found = readPictureBlock(view, arr, start, end) || found;
            }
        } catch {
            // A malformed block: the others may still be read.
        }
        pos = end;
    }
    return {picture: found ? found.picture : null, tags: cleanTags(raw)};
};

module.exports = {
    readFlac
};
