/* eslint-disable no-bitwise, no-plusplus */
// Finds the cover picture in an ID3v2.2, v2.3 or v2.4 tag.

// The picture type comes from its bytes, never from the tag: a tag claiming
// text/html would otherwise turn the cover's blob: URL into a same-origin page.
const getPictureType = data => {
    if (data[0] === 0xFF && data[1] === 0xD8) {
        return 'image/jpeg';
    }
    if (data[0] === 0x89 && data[1] === 0x50) {
        return 'image/png';
    }
    return null;
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

// The picture of an APIC (v2.3, v2.4) or PIC (v2.2) frame, or null.
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
    const type = getPictureType(bytes);
    return type ? {type, bytes} : null;
};

// `buffer`: the start of the file. Returns {type, bytes} for the first cover
// picture, or null when there is none, or none in a known image format.
const readPicture = buffer => {
    const arr = new Uint8Array(buffer);
    const view = new DataView(buffer);

    if (arr.length < 10 || arr[0] !== 0x49 || arr[1] !== 0x44 || arr[2] !== 0x33) {
        return null;
    }
    const version = arr[3];
    if (version !== 2 && version !== 3 && version !== 4) {
        return null;
    }

    const totalSize = Math.min(syncsafe(arr, 6) + 10, arr.length);
    let offset = 10;
    while (offset < totalSize - 10) {
        const frame = readFrameHeader(arr, view, version, offset);
        if (frame.size <= 0 || offset + frame.headerSize + frame.size > totalSize) {
            break;
        }
        if (frame.id === 'APIC' || frame.id === 'PIC') {
            const picture = readPictureFrame(arr, version, offset + frame.headerSize, frame.size);
            // An empty picture frame is skipped; a picture in an unknown
            // format ends the search.
            if (picture !== undefined) {
                return picture;
            }
        }
        offset += frame.headerSize + frame.size;
    }
    return null;
};

module.exports = {
    readPicture
};
