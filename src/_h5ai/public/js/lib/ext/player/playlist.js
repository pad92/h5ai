// The queue as an extended M3U playlist in UTF-8 (`.m3u8`), which VLC,
// MPC-HC, mpv, foobar2000 and Kodi open as is.

const FILE_NAME_FORBIDDEN = /[\\/:*?"<>|]+/g;

// `entries`: [{title, url}], urls absolute. Durations are unknown here, hence -1.
const toM3u = entries => {
    const lines = ['#EXTM3U'];
    entries.forEach(({title, url}) => {
        lines.push(`#EXTINF:-1,${String(title).replace(/[\r\n]+/g, ' ')}`, url);
    });
    return lines.join('\n') + '\n';
};

// `name` made safe as a file name on Windows, macOS and Linux.
const fileName = name => {
    const printable = [...String(name)].filter(char => char.charCodeAt(0) >= 0x20).join('');
    const safe = printable.replace(FILE_NAME_FORBIDDEN, ' ').trim();
    return (safe || 'queue') + '.m3u8';
};

module.exports = {
    toM3u,
    fileName
};
