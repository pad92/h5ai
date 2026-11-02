/* eslint-disable no-bitwise, no-plusplus */
// Reads the cover picture and the text tags of an ID3v2.2, v2.3 or v2.4 tag.
const {pictureType, decode, cleanTags} = require('./bytes');

// Text frames -> tag fields, by version: v2.2 uses three-letter ids.
const TEXT_FRAMES = {
    TIT2: 'title', TT2: 'title',
    TPE1: 'artist', TP1: 'artist',
    TPE2: 'albumArtist', TP2: 'albumArtist',
    TALB: 'album', TAL: 'album',
    TYER: 'year', TYE: 'year', TDRC: 'year',
    TCON: 'genre', TCO: 'genre',
    TRCK: 'track', TRK: 'track'
};

const syncsafe = (arr, at) => (arr[at] & 0x7F) << 21 |
    (arr[at + 1] & 0x7F) << 14 |
    (arr[at + 2] & 0x7F) << 7 |
    arr[at + 3] & 0x7F;

const readFrameHeader = (arr, view, version, offset) => {
    if (version === 2) {
        return {
            id: String.fromCharCode(arr[offset], arr[offset + 1], arr[offset + 2]),
            size: arr[offset + 3] << 16 | arr[offset + 4] << 8 | arr[offset + 5],
            headerSize: 6
        };
    }
    return {
        id: String.fromCharCode(arr[offset], arr[offset + 1], arr[offset + 2], arr[offset + 3]),
        // v2.4 frame sizes are syncsafe, v2.3 ones plain.
        size: version === 3 ? view.getUint32(offset + 4) : syncsafe(arr, offset + 4),
        headerSize: 10
    };
};

// The end of a null-terminated string: one zero byte, or two aligned zero
// bytes for UTF-16 (encodings 1 and 2).
const skipString = (arr, start, end, encoding) => {
    let pos = start;
    if (encoding === 1 || encoding === 2) {
        while (pos < end - 1) {
            if (arr[pos] === 0 && arr[pos + 1] === 0) {
                return pos + 2;
            }
            pos += 2;
        }
        return pos;
    }
    while (pos < end) {
        if (arr[pos] === 0) {
            return pos + 1;
        }
        pos++;
    }
    return pos;
};

// Encoding byte 0: ISO-8859-1, 1: UTF-16 with a byte order mark, 2: UTF-16BE,
// 3: UTF-8. v2.4 separates several values with NUL: they are joined.
const readText = bytes => {
    const encoding = bytes[0];
    let data = bytes.subarray(1);
    let label = 'iso-8859-1';
    if (encoding === 1) {
        const isBigEndian = data[0] === 0xFE && data[1] === 0xFF;
        if (isBigEndian || data[0] === 0xFF && data[1] === 0xFE) {
            data = data.subarray(2);
        }
        label = isBigEndian ? 'utf-16be' : 'utf-16le';
    } else if (encoding === 2) {
        label = 'utf-16be';
    } else if (encoding === 3) {
        label = 'utf-8';
    }
    return decode(data, label).split('\0').filter(Boolean).join(' / ');
};

// A genre as text: ID3v1 references such as "(17)" or "17" are dropped.
const readGenre = text => {
    const genre = text.replace(/^(\(\d+\))+/, '').trim();
    return (/^\d+$/).test(genre) ? '' : genre;
};

// The picture of an APIC (v2.3, v2.4) or PIC (v2.2) frame; undefined for an
// empty one, null for one in an unknown image format.
const readPictureFrame = (arr, version, start, size) => {
    const end = start + size;
    const encoding = arr[start];
    let descStart;
    if (version === 2) {
        // 3-byte image format, then the picture type.
        descStart = start + 5;
    } else {
        // Null-terminated MIME string, then the picture type.
        let mimeEnd = start + 1;
        while (mimeEnd < end && arr[mimeEnd] !== 0) {
            mimeEnd++;
        }
        descStart = mimeEnd + 2;
    }
    const dataStart = skipString(arr, descStart, end, encoding);
    if (end - dataStart <= 10) {
        return undefined;
    }
    const bytes = arr.subarray(dataStart, end);
    const type = pictureType(bytes);
    return type ? {type, bytes} : null;
};

// `buffer`: the start of the file. Returns {picture, tags}: the first cover
// picture as {type, bytes}, or null when there is none or none in a known
// image format, and the text fields found. Null when there is no ID3v2 tag.
const readId3 = buffer => {
    const arr = new Uint8Array(buffer);
    const view = new DataView(buffer);

    if (arr.length < 10 || arr[0] !== 0x49 || arr[1] !== 0x44 || arr[2] !== 0x33) {
        return null;
    }
    const version = arr[3];
    if (version !== 2 && version !== 3 && version !== 4) {
        return null;
    }

    const raw = {};
    // undefined: none seen yet; null: one in an unknown format ends the search.
    let picture;
    const totalSize = Math.min(syncsafe(arr, 6) + 10, arr.length);
    let offset = 10;
    while (offset < totalSize - 10) {
        const frame = readFrameHeader(arr, view, version, offset);
        if (frame.size <= 0 || offset + frame.headerSize + frame.size > totalSize) {
            break;
        }
        const start = offset + frame.headerSize;
        const field = TEXT_FRAMES[frame.id];
        if (field && !raw[field]) {
            const text = readText(arr.subarray(start, start + frame.size));
            raw[field] = field === 'genre' ? readGenre(text) : text;
        } else if ((frame.id === 'APIC' || frame.id === 'PIC') && picture === undefined) {
            picture = readPictureFrame(arr, version, start, frame.size);
        }
        offset += frame.headerSize + frame.size;
    }
    if (raw.year) {
        // TDRC is a timestamp: 2001-05-04T12:00 shows as 2001.
        raw.year = raw.year.slice(0, 4);
    }
    return {picture: picture || null, tags: cleanTags(raw)};
};

module.exports = {
    readId3
};
