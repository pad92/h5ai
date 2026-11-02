// Saves the DOM h5ai builds in the browser, for the W3C check of
// test-w3c.sh: the listings, the image, Markdown and audio previews, and the
// info page, each after its scripts have run. Uses the Chrome driver of the
// screenshot scripts.
//
// Usage: node dump-dom.mjs <base-url> <out-dir>   (CHROME selects the browser)

import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {launch, sleep} from '../../scripts/screenshots/chrome.mjs';

const [baseUrl, outDir] = process.argv.slice(2);
if (!baseUrl || !outDir) {
    console.error('usage: node dump-dom.mjs <base-url> <out-dir>');
    process.exit(2);
}

const SETTLE_MS = 1500;
const item = name => `#items .item a[href$="${name}"]`;

// Paths and clicks refer to test/docker/fixtures/.
const PAGES = [
    {name: 'listing-root', path: '/'},
    {name: 'listing-images', path: '/images/'},
    {name: 'preview-image', path: '/images/', click: item('photo.jpg')},
    {name: 'preview-markdown', path: '/texts/', click: item('readme.md')},
    {name: 'preview-audio', path: '/audio/', click: item('audio.mp3')},
    {name: 'info', path: '/_h5ai/public/index.php'}
];

const chrome = await launch({binary: process.env.CHROME || 'google-chrome-stable'});
try {
    await chrome.viewport(1280, 900);
    for (const page of PAGES) {
        await chrome.navigate(baseUrl + page.path);
        if (page.click) {
            await chrome.click(page.click);
            await chrome.networkIdle();
        }
        await sleep(SETTLE_MS);
        const html = await chrome.evaluate("'<!DOCTYPE html>\\n' + document.documentElement.outerHTML");
        writeFileSync(join(outDir, `${page.name}.html`), html);
        console.log(`dumped ${page.name}`);
    }
} finally {
    await chrome.close();
}
