// Takes the README screenshots of an h5ai instance serving the share made by
// demo-share.mjs, and writes them as WebP. Needs Chrome and ImageMagick.
//
// Usage: node shoot.mjs <base-url> <out-dir>
// CHROME selects the browser, H5AI_ADMIN_PASSWORD logs in the admin page.

import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launch, sleep} from './chrome.mjs';

const [baseUrl, outDir] = process.argv.slice(2);
if (!baseUrl || !outDir) {
    console.error('usage: node shoot.mjs <base-url> <out-dir>');
    process.exit(2);
}

// Pages are opened under this name, so the breadcrumb shows a neutral host.
const HOST = 'files.example.org';
const ORIGIN = `http://${HOST}`;
const READY_TRIES = 60;
const WEBP_QUALITY = '88';
const TASKS_TIMEOUT_MS = 180000;

const run = (cmd, args) => {
    const res = spawnSync(cmd, args, {stdio: ['ignore', 'inherit', 'inherit']});
    if (res.error || res.status !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} failed: ${res.error?.message || `exit ${res.status}`}`);
    }
};

const waitForServer = async () => {
    for (let i = 0; i < READY_TRIES; i += 1) {
        try {
            if ((await fetch(baseUrl + '/')).ok) {
                return;
            }
        } catch {
            // Not up yet.
        }
        await sleep(1000);
    }
    throw new Error(`${baseUrl} did not answer`);
};

// The toolbar shows a gear while background tasks (cache warmer, thumbnails)
// run, which a fresh container starts. Waits for it to go, so every shot has
// the same toolbar.
const waitForIdleTasks = async chrome => {
    const end = Date.now() + TASKS_TIMEOUT_MS;
    while (Date.now() < end) {
        const idle = await chrome.evaluate(`(() => {
            const el = document.querySelector('#tasks');
            return !el || getComputedStyle(el).display === 'none';
        })()`);
        if (idle) {
            return;
        }
        await sleep(1000);
    }
    throw new Error('background tasks still running');
};

const item = name => `#items .item a[href$="${encodeURIComponent(name).replace(/'/g, '%27')}"]`;

// Each shot: page, viewport, stored view settings, then actions.
const SHOTS = [
    {name: 'hero-light', path: '/Photos/Landscapes/', size: [1280, 880], view: {mode: 'icons', size: 220}},
    {name: 'hero-dark', path: '/Photos/Landscapes/', size: [1280, 880], view: {mode: 'icons', size: 220}, theme: 'dark'},
    {name: 'details-root', path: '/', size: [1280, 600]},
    {name: 'preview-image', path: '/Photos/Landscapes/', size: [1280, 760], view: {mode: 'icons', size: 220}, theme: 'dark',
        act: async c => {
            await c.click(item('Aurora.jpg'));
            await c.networkIdle();
            await c.mouse('mouseMoved', 640, 380);
        }},
    {name: 'preview-markdown', path: '/Documents/', size: [1280, 760], act: c => c.click(item('README.md'))},
    {name: 'preview-code', path: '/Projects/', size: [1280, 760], theme: 'dark', act: c => c.click(item('backup.py'))},
    {name: 'preview-audio', path: '/Music/Night%20Drive/', size: [1280, 760], theme: 'dark',
        act: c => c.click(item('01 - Neon Avenue.mp3'))},
    {name: 'preview-video', path: '/Videos/', size: [1280, 760], theme: 'dark', act: c => c.click(item('Mandelbrot zoom.mp4'))},
    {name: 'search', path: '/', size: [1280, 600],
        act: async c => {
            await c.click('#search img');
            await c.evaluate(`(() => {
                const input = document.querySelector('#search input');
                input.value = 'jpg';
                input.dispatchEvent(new KeyboardEvent('keyup'));
            })()`);
        }},
    {name: 'select-download', path: '/Photos/Landscapes/', size: [1280, 600], act: c => c.drag(1240, 190, 700, 400)},
    {name: 'info', path: '/_h5ai/public/index.php', size: [1280, 1000],
        act: c => c.evaluate(`(() => {
            const pass = document.querySelector('#pass');
            if (!pass) throw new Error('admin login form not found');
            pass.value = ${JSON.stringify(process.env.H5AI_ADMIN_PASSWORD || '')};
            document.querySelector('#login').requestSubmit();
        })()`)}
];

const shoot = async (chrome, workDir) => {
    for (const shot of SHOTS) {
        await chrome.viewport(...shot.size);
        // h5ai reads the view mode, tree state and theme from localStorage.
        await chrome.navigate(ORIGIN + '/');
        const store = {view: shot.view || {mode: 'details', size: 40}, 'ext/tree': true};
        await chrome.evaluate(`localStorage.setItem('_h5ai', ${JSON.stringify(JSON.stringify(store))});
            localStorage.setItem('h5ai_theme', ${JSON.stringify(shot.theme || 'light')});`);
        await chrome.navigate(ORIGIN + shot.path);
        if (shot.path.endsWith('/')) {
            await waitForIdleTasks(chrome);
        }
        if (shot.act) {
            await shot.act(chrome);
            await chrome.networkIdle();
        }
        // Park the pointer on the empty tree area, away from hover effects.
        await chrome.mouse('mouseMoved', 100, shot.size[1] - 150);
        // Let transitions and media players settle.
        await sleep(1500);
        writeFileSync(join(workDir, `${shot.name}.png`), await chrome.screenshot());
        console.log(`shot ${shot.name}`);
    }
};

// The hero shows the same folder in both themes, split by a diagonal.
const composeHero = workDir => {
    const mask = join(workDir, 'mask.png');
    const darkCut = join(workDir, 'dark-cut.png');
    run('magick', ['-size', '1280x880', 'xc:black', '-fill', 'white', '-draw', 'polygon 760,0 1280,0 1280,880 520,880', mask]);
    run('magick', [join(workDir, 'hero-dark.png'), mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', darkCut]);
    run('magick', [join(workDir, 'hero-light.png'), darkCut, '-compose', 'over', '-composite', join(workDir, 'hero.png')]);
};

const exportWebp = workDir => {
    mkdirSync(outDir, {recursive: true});
    for (const name of ['hero', ...SHOTS.map(s => s.name).filter(n => !n.startsWith('hero-'))]) {
        run('magick', [join(workDir, `${name}.png`), '-strip', '-quality', WEBP_QUALITY, '-define', 'webp:method=6', join(outDir, `${name}.webp`)]);
    }
};

const url = new URL(baseUrl);
await waitForServer();
const workDir = mkdtempSync(join(tmpdir(), 'h5ai-shots-'));
const chrome = await launch({
    binary: process.env.CHROME || 'google-chrome-stable',
    hostRules: `MAP ${HOST} ${url.hostname}:${url.port || 80}`
});
try {
    await shoot(chrome, workDir);
} finally {
    await chrome.close();
}
composeHero(workDir);
exportWebp(workDir);
rmSync(workDir, {recursive: true, force: true});
console.log(`screenshots written to ${outDir}`);
