// What the browser can play, decided from the file extension.

// Asked to the browser before the player takes over a click: a file it
// cannot decode (WMA, RealAudio, MIDI, AIFF outside Safari) keeps its plain
// link instead of silently failing in the player bar.
const MIME_BY_EXT = {
    aac: 'audio/aac',
    aif: 'audio/aiff',
    aiff: 'audio/aiff',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mid: 'audio/midi',
    mp3: 'audio/mpeg',
    mpa: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg; codecs=opus',
    ra: 'audio/x-realaudio',
    wav: 'audio/wav',
    weba: 'audio/webm',
    wma: 'audio/x-ms-wma'
};

const getExt = item => {
    const match = (/\.([a-z0-9]+)$/i).exec(item.label || '');
    return match ? match[1].toLowerCase() : '';
};

// Unknown extensions are tried: only a known type the browser rejects is skipped.
const canPlay = (media, item) => {
    const mime = MIME_BY_EXT[getExt(item)];
    return !mime || media.canPlayType(mime) !== '';
};

module.exports = {
    getExt,
    canPlay
};
