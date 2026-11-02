const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');

const {readId3} = reqlib('ext/player/id3');
const {readFlac} = reqlib('ext/player/flac');

const JPEG = [0xFF, 0xD8, ...new Array(12).fill(1)];
const PNG = [0x89, 0x50, ...new Array(12).fill(2)];
const ascii = text => [...text].map(c => c.charCodeAt(0));
const utf8 = text => [...new TextEncoder().encode(text)];
const be = (value, count) => Array.from({length: count}, (unused, idx) => Math.floor(value / 256 ** (count - 1 - idx)) % 256);
const le = (value, count) => be(value, count).reverse();
const syncsafe = size => Array.from({length: 4}, (unused, idx) => Math.floor(size / 128 ** (3 - idx)) % 128);

const id3 = (version, frames) => {
    const body = [].concat(...frames.map(([id, data]) => {
        if (version === 2) {
            return [...ascii(id), ...be(data.length, 3), ...data];
        }
        const size = version === 3 ? be(data.length, 4) : syncsafe(data.length);
        return [...ascii(id), ...size, 0, 0, ...data];
    }), new Array(10).fill(0));
    return Uint8Array.from([...ascii('ID3'), version, 0, 0, ...syncsafe(body.length), ...body]).buffer;
};
const latin1 = text => [0, ...ascii(text)];
const utf16 = text => [1, 0xFF, 0xFE, ...[].concat(...[...text].map(c => [c.charCodeAt(0) % 256, Math.floor(c.charCodeAt(0) / 256)]))];

test('player tags: ID3 v2.3 and v2.4 text frames, in every encoding', () => {
    const v24 = readId3(id3(4, [
        ['TIT2', [3, ...utf8('Été indien')]],
        ['TPE1', utf16('Joe Dassin')],
        ['TALB', latin1('Le Jardin')],
        ['TDRC', latin1('1975-06-01')],
        ['TCON', latin1('(12)Chanson')],
        ['TRCK', latin1('3/12')],
        ['TPE2', [2, ...[].concat(...[...'Various'].map(c => [0, c.charCodeAt(0)]))]],
        ['APIC', [0, ...ascii('image/jpeg'), 0, 3, 0, ...JPEG]]
    ]));
    assert.deepEqual(v24.tags, {
        title: 'Été indien',
        artist: 'Joe Dassin',
        albumArtist: 'Various',
        album: 'Le Jardin',
        year: '1975',
        genre: 'Chanson',
        track: '3/12'
    });
    assert.equal(v24.picture.type, 'image/jpeg');

    const v23 = readId3(id3(3, [
        ['TIT2', latin1('A\0B')],
        ['TCON', latin1('(17)')],
        ['TYER', latin1('2001')]
    ]));
    assert.deepEqual(v23.tags, {title: 'A / B', year: '2001'}, 'several values join, a numeric genre goes');
    assert.equal(v23.picture, null);
});

test('player tags: ID3 v2.2 frames, and a picture in an unknown format', () => {
    const v22 = readId3(id3(2, [
        ['TT2', latin1('Old')],
        ['PIC', [0, ...ascii('PNG'), 3, 0, ...ascii('<html>not an image</html>')]],
        ['TP1', latin1('Band')]
    ]));
    assert.deepEqual(v22.tags, {title: 'Old', artist: 'Band'}, 'tags after the picture are still read');
    assert.equal(v22.picture, null);
    assert.equal(readId3(Uint8Array.from(ascii('RIFF....WAVE')).buffer), null);
});

// A FLAC file start: STREAMINFO, then the given blocks, the last one flagged.
const flac = blocks => {
    const all = [[0, new Array(34).fill(0)], ...blocks];
    const bytes = [...ascii('fLaC')];
    all.forEach(([type, data], idx) => {
        bytes.push((idx === all.length - 1 ? 0x80 : 0) + type, ...be(data.length, 3), ...data);
    });
    return Uint8Array.from(bytes).buffer;
};
const comments = list => [
    ...le(6, 4), ...ascii('vendor'),
    ...le(list.length, 4),
    ...[].concat(...list.map(text => [...le(utf8(text).length, 4), ...utf8(text)]))
];
const picture = (kind, data) => [
    ...be(kind, 4),
    ...be(10, 4), ...ascii('image/jpeg'),
    ...be(0, 4),
    ...new Array(16).fill(0),
    ...be(data.length, 4), ...data
];

test('player tags: FLAC Vorbis comments and the front cover picture', () => {
    const read = readFlac(flac([
        [4, comments(['TITLE=Clair de lune', 'artist=Debussy', 'ARTIST=Pires', 'DATE=1905-01-01', 'TRACKNUMBER=3', 'NOEQUALS'])],
        [6, picture(4, PNG)],
        [6, picture(3, JPEG)]
    ]));
    assert.deepEqual(read.tags, {title: 'Clair de lune', artist: 'Debussy / Pires', year: '1905', track: '3'});
    assert.equal(read.picture.type, 'image/jpeg', 'the front cover wins over another picture');

    const backOnly = readFlac(flac([[6, picture(4, PNG)]]));
    assert.equal(backOnly.picture.type, 'image/png', 'any picture is better than none');

    const cut = flac([[6, picture(3, JPEG)]]);
    assert.equal(readFlac(cut.slice(0, cut.byteLength - 4)).picture, null, 'a picture cut by the read is left out');
    assert.equal(readFlac(Uint8Array.from(ascii('OggS....')).buffer), null);
});
