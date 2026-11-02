// What a track's file says about itself: its embedded cover and its tags
// (title, artist, album...). Read once per entry, from the start of the file.
const {getExt} = require('./formats');
const {readId3} = require('./id3');
const {readFlac} = require('./flac');

// MP3 tags and FLAC metadata blocks sit at the start of the file.
const READERS = {mp3: readId3, mpa: readId3, flac: readFlac};
const RANGE = 'bytes=0-524288';
const empty = () => ({tags: {}, pictureUrl: null});

// Entry -> {promise, result}; result is {tags, pictureUrl} once read. Kept
// here rather than on the shared item objects.
const entries = new Map();

const fetchStart = absHref => {
    return global.window.fetch(absHref, {headers: {Range: RANGE}})
        .then(response => {
            // A server ignoring Range answers 200 with the whole file: drop it
            // rather than download a full track for its tags.
            if (response.status !== 206) {
                if (response.body) {
                    response.body.cancel().catch(() => null);
                }
                return null;
            }
            return response.arrayBuffer();
        });
};

const toResult = parsed => {
    if (!parsed) {
        return empty();
    }
    const {picture, tags} = parsed;
    return {
        tags,
        pictureUrl: picture ? global.window.URL.createObjectURL(new global.window.Blob([picture.bytes], {type: picture.type})) : null
    };
};

// Whether the file's format carries tags the player reads.
const canRead = item => !!READERS[getExt(item)];

// Whether a read was already asked for.
const has = item => entries.has(item);

// The result once read, else undefined.
const known = item => entries.has(item) ? entries.get(item).result : undefined;

// Resolves with {tags, pictureUrl}; empty for other formats or on failure.
const read = item => {
    if (entries.has(item)) {
        return entries.get(item).promise;
    }
    const reader = READERS[getExt(item)];
    const entry = {result: undefined};
    entry.promise = (reader ? fetchStart(item.absHref).then(buffer => buffer ? toResult(reader(buffer)) : empty()) : Promise.resolve(empty()))
        .catch(empty)
        .then(result => {
            entry.result = result;
            return result;
        });
    entries.set(item, entry);
    return entry.promise;
};

const revoke = url => {
    try {
        global.window.URL.revokeObjectURL(url);
    } catch {
        // An already revoked URL: nothing left to release.
    }
};

// A picture that failed to load is not offered nor read again.
const markBroken = (item, url) => {
    const result = known(item);
    if (result && result.pictureUrl === url) {
        revoke(url);
        result.pictureUrl = null;
    }
};

// Releases the pictures of entries leaving the queue. Their tags and a known
// absence of picture are small and kept, so they are not read again.
const release = items => {
    items.forEach(item => {
        const result = known(item);
        if (result && result.pictureUrl) {
            revoke(result.pictureUrl);
            entries.delete(item);
        }
    });
};

module.exports = {
    canRead,
    has,
    known,
    read,
    markBroken,
    release
};
