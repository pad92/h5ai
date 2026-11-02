// Creates the sample share shown in the README screenshots: drawn
// landscapes, gradients, music with a cover, short videos, documents and
// code. Everything is generated, so the screenshots carry no third-party
// content. Needs Chrome, ffmpeg and ImageMagick (`magick`).
//
// Usage: node demo-share.mjs <empty-dir>   (CHROME selects the browser)

import {spawnSync} from 'node:child_process';
import {mkdirSync, readdirSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {launch} from './chrome.mjs';

const root = process.argv[2];
if (!root) {
    console.error('usage: node demo-share.mjs <dir>');
    process.exit(2);
}

// Fixed modification time, so the listings in the screenshots do not change
// from one run to the next.
const MTIME = new Date('2026-10-28T09:30:00Z');
const PHOTO = {width: 1600, height: 1000};

const run = (cmd, args) => {
    const res = spawnSync(cmd, args, {stdio: ['ignore', 'inherit', 'inherit']});
    if (res.error || res.status !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} failed: ${res.error?.message || `exit ${res.status}`}`);
    }
};
const ffmpeg = args => run('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args]);
const write = (path, content) => {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), content);
};
const dir = path => {
    mkdirSync(join(root, path), {recursive: true});
    return join(root, path);
};

// Deterministic pseudo-random numbers in [0, 1) (Park-Miller generator).
const rng = seed => {
    let state = 1 + seed % 2147483646;
    return () => {
        state = state * 16807 % 2147483647;
        return (state - 1) / 2147483646;
    };
};

const mix = (a, b, t) => {
    const ch = (s, i) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
    const c = [0, 1, 2].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
    return `rgb(${c.join(',')})`;
};

// A flat-design landscape: sky gradient, optional stars, a sun with a glow and
// five mountain ridges going from the far colour to the near one.
const landscapeSvg = ({sky, far, near, sun, stars}, seed) => {
    const {width: W, height: H} = PHOTO;
    const rand = rng(seed);
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`,
        `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>`,
        '<radialGradient id="glow"><stop offset="0.3" stop-color="#fff0c8" stop-opacity="0.55"/><stop offset="1" stop-color="#fff0c8" stop-opacity="0"/></radialGradient></defs>',
        `<rect width="${W}" height="${H}" fill="url(#sky)"/>`
    ];
    if (stars) {
        for (let i = 0; i < 260; i += 1) {
            parts.push(`<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H * 0.6).toFixed(0)}" r="${rand() < 0.75 ? 0.8 : 1.4}" fill="#fff"/>`);
        }
    }
    const [sx, sy, sr] = sun;
    parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr * 3}" fill="url(#glow)"/>`);
    parts.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="#fff5dc"/>`);
    for (let layer = 0; layer < 5; layer += 1) {
        const waves = Array.from({length: 5}, () => [0.5 + rand() * 3.5, rand() * 6.3, 0.2 + rand() * 0.8]);
        const base = H * (0.48 + 0.11 * layer);
        const amp = 260 - 30 * layer;
        const pts = [];
        for (let x = 0; x <= W; x += 8) {
            const y = waves.reduce((acc, [f, p, a]) => acc - amp * a * Math.sin(x / W * f * Math.PI + p) / 2.5, base);
            pts.push(`${x},${y.toFixed(1)}`);
        }
        pts.push(`${W},${H}`, `0,${H}`);
        parts.push(`<polygon points="${pts.join(' ')}" fill="${mix(far, near, layer / 4)}"/>`);
    }
    parts.push('</svg>');
    return parts.join('');
};

const LANDSCAPES = {
    Aurora: {sky: ['#0b1d3a', '#1f6f78'], far: '#2a8c82', near: '#071a2c', sun: [1180, 230, 46], stars: true},
    Glacier: {sky: ['#a8d8ff', '#eaf6ff'], far: '#9cc3e0', near: '#2d4f6c', sun: [1250, 260, 70]},
    Lagoon: {sky: ['#2b5876', '#4e4376'], far: '#6a5b9a', near: '#1b1435', sun: [400, 380, 80]},
    Basalt: {sky: ['#3a3a52', '#d77a61'], far: '#8a5a6a', near: '#1e1a26', sun: [800, 520, 110]},
    Geyser: {sky: ['#ffecd2', '#fcb69f'], far: '#e08e79', near: '#5b3a4a', sun: [1200, 330, 90]},
    Fjord: {sky: ['#134e5e', '#71b280'], far: '#4e8a6e', near: '#0c2b2e', sun: [300, 260, 60]},
    'Midnight sun': {sky: ['#ff9a8b', '#ffd36e'], far: '#e9765b', near: '#5a2a3a', sun: [820, 470, 120]},
    Highlands: {sky: ['#355c7d', '#c06c84'], far: '#8a5b8a', near: '#2a1f3d', sun: [1300, 420, 70]}
};

const drawLandscapes = async () => {
    const out = dir('Photos/Landscapes');
    const chrome = await launch({binary: process.env.CHROME || 'google-chrome-stable'});
    try {
        await chrome.viewport(PHOTO.width, PHOTO.height);
        let seed = 0;
        for (const [name, spec] of Object.entries(LANDSCAPES)) {
            seed += 1;
            const html = `<body style="margin:0">${landscapeSvg(spec, seed)}</body>`;
            await chrome.navigate('data:text/html;base64,' + Buffer.from(html).toString('base64'));
            const png = join(out, `${name}.png`);
            writeFileSync(png, await chrome.screenshot());
            run('magick', [png, '-strip', '-quality', '90', join(out, `${name}.jpg`)]);
            run('rm', [png]);
        }
    } finally {
        await chrome.close();
    }
};

const drawWallpapers = () => {
    const out = dir('Photos/Wallpapers');
    for (const [a, b] of [['0f2027', '2c5364'], ['ff7e5f', 'feb47b'], ['6a11cb', '2575fc'], ['11998e', '38ef7d'], ['fc466b', '3f5efb'], ['f7971e', 'ffd200']]) {
        run('magick', ['-size', '1920x1080', `gradient:#${a}-#${b}`, '-swirl', '60', '-strip', join(out, `gradient-${a}.webp`)]);
    }
};

const makeMusic = () => {
    const out = dir('Music/Night Drive');
    const cover = join(root, 'cover.jpg');
    run('magick', [join(root, 'Photos/Landscapes/Basalt.jpg'), '-gravity', 'center', '-crop', '1000x1000+0+0', '+repage', '-resize', '600x600', '-strip', cover]);
    ['Neon Avenue', 'Overpass', 'Last Exit', 'Afterglow'].forEach((title, i) => {
        ffmpeg(['-f', 'lavfi', '-t', '20', '-i', `sine=frequency=${290 + 70 * i}`, '-i', cover,
            '-map', '0', '-map', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-c:v', 'copy',
            '-disposition:v', 'attached_pic', '-id3v2_version', '3', '-map_metadata', '-1',
            '-metadata', `title=${title}`, '-metadata', 'artist=Demo Band', '-metadata', 'album=Night Drive',
            join(out, `0${i + 1} - ${title}.mp3`)]);
    });
    run('rm', [cover]);
};

const makeVideos = () => {
    const out = dir('Videos');
    const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-map_metadata', '-1'];
    ffmpeg(['-f', 'lavfi', '-t', '8', '-i', 'mandelbrot=size=1280x720:rate=25', ...x264, '-crf', '28', join(out, 'Mandelbrot zoom.mp4')]);
    ffmpeg(['-f', 'lavfi', '-t', '6', '-i', 'life=size=1280x720:mold=10:rate=25:ratio=0.1:seed=7:death_color=#C83232:life_color=#00ff00',
        '-c:v', 'libvpx-vp9', '-b:v', '1M', '-pix_fmt', 'yuv420p', join(out, 'Game of life.webm')]);
    ffmpeg(['-f', 'lavfi', '-t', '6', '-i', 'cellauto=s=1280x720:rule=110:seed=7', ...x264, join(out, 'Rule 110.mkv')]);
};

const writeDocuments = () => {
    write('Documents/README.md', `# Team handbook

Welcome aboard. This folder holds everything you need in your first week.

## Getting started

1. Read the **onboarding checklist** below.
2. Grab the slides from \`Documents/\` and the code from \`Projects/\`.
3. Ask questions in the team channel.

## Onboarding checklist

| Day | Task | Owner |
| --- | --- | --- |
| Mon | Laptop and accounts | IT |
| Tue | Architecture walkthrough | Tech lead |
| Wed | First pull request | You |

> Tip: press \`Esc\` to close this preview, and use the arrow keys to move
> to the next file.
`);
    write('Documents/meeting-notes.txt', `Weekly sync

- Release is out, Docker image published.
- Next: screenshots for the README.
- Action: everyone tries the background task indicator.
`);
    write('Documents/stats.csv', 'month,visitors,downloads\nJul,1200,340\nAug,1530,410\nSep,1710,520\nOct,2050,640\n');
    run('magick', ['-size', '1240x1754', 'xc:white', '-fill', '#263238', '-pointsize', '64', '-annotate', '+120+220', 'Quarterly report',
        '-pointsize', '32', '-fill', '#607d8b', '-annotate', '+120+290', 'Q3',
        '(', join(root, 'Photos/Landscapes/Fjord.jpg'), '-resize', '1000x', ')', '-geometry', '+120+380', '-composite',
        '-pointsize', '28', '-fill', '#37474f', '-annotate', '+120+1100', 'Visitors grew 34% over the quarter.',
        join(root, 'Documents/Quarterly-report.pdf')]);
};

const writeProjects = () => {
    write('Projects/website/index.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello, world</h1>
  <script src="app.js"></script>
</body>
</html>
`);
    write('Projects/website/style.css', `:root { --accent: #42a5f5; }
body { font-family: system-ui, sans-serif; margin: 2rem; }
h1 { color: var(--accent); }
`);
    write('Projects/website/app.js', `// Greets the visitor with the local time.
const hour = new Date().getHours();
const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
document.querySelector('h1').textContent = \`\${greeting}, world\`;
`);
    write('Projects/backup.py', `#!/usr/bin/env python3
"""Copies the share to a dated backup folder."""
import shutil
from datetime import date
from pathlib import Path

SOURCE = Path("/srv/share")
TARGET = Path("/srv/backups") / date.today().isoformat()


def main() -> None:
    shutil.copytree(SOURCE, TARGET, dirs_exist_ok=True)
    print(f"Backup written to {TARGET}")


if __name__ == "__main__":
    main()
`);
};

// Placeholder release files: fixed-size, deterministic filler bytes.
const writeSoftware = () => {
    const filler = (size, seed) => {
        const rand = rng(seed);
        return Buffer.from(Array.from({length: size}, () => Math.floor(rand() * 256)));
    };
    write('Software/tool-v2.1.0-linux-amd64.tar.gz', filler(3000000, 1));
    write('Software/tool-v2.1.0-windows.zip', filler(2200000, 2));
    write('Software/SHA256SUMS', 'placeholder checksums\n');
};

const setTimes = path => {
    for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
            setTimes(full);
        }
        utimesSync(full, MTIME, MTIME);
    }
};

await drawLandscapes();
drawWallpapers();
makeMusic();
makeVideos();
writeDocuments();
writeProjects();
writeSoftware();
setTimes(root);
console.log(`demo share written to ${root}`);
