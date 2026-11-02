// Minimal headless Chrome driver over the DevTools Protocol, for the README
// screenshots. Uses only Node built-ins (fetch, WebSocket), so `make
// screenshots` needs no npm package beyond the build ones.

import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const DEBUG_PORT = 9333;
const STARTUP_TRIES = 50;
const NETWORK_IDLE_MS = 800;

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Starts Chrome and returns a session on its first tab. `hostRules` is passed
// to --host-resolver-rules, to show a readable host name in the pages.
export const launch = async ({binary, hostRules}) => {
    const profile = mkdtempSync(join(tmpdir(), 'h5ai-chrome-'));
    const args = [
        '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
        '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'
    ];
    if (hostRules) {
        args.push(`--host-resolver-rules=${hostRules}`);
    }
    const chrome = spawn(binary, [...args, 'about:blank'], {stdio: 'ignore'});
    const exited = new Promise(resolve => chrome.once('exit', resolve));

    let wsUrl;
    for (let i = 0; i < STARTUP_TRIES && !wsUrl; i += 1) {
        await sleep(200);
        try {
            const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
            wsUrl = targets.find(t => t.type === 'page')?.webSocketDebuggerUrl;
        } catch {
            // Chrome is not listening yet.
        }
    }
    if (!wsUrl) {
        chrome.kill();
        throw new Error(`Chrome (${binary}) did not open its DevTools port ${DEBUG_PORT}`);
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, {once: true});
        ws.addEventListener('error', reject, {once: true});
    });

    let lastId = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        } else if (msg.method) {
            listeners.forEach(fn => fn(msg));
        }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        lastId += 1;
        pending.set(lastId, msg => {
            if (msg.error) {
                reject(new Error(`${method}: ${msg.error.message}`));
            } else {
                resolve(msg.result);
            }
        });
        ws.send(JSON.stringify({id: lastId, method, params}));
    });

    // Requests in flight, without media streams that stay open while playing.
    const inflight = new Set();
    listeners.add(({method, params}) => {
        if (method === 'Network.requestWillBeSent' && params.type !== 'Media') {
            inflight.add(params.requestId);
        } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
            inflight.delete(params.requestId);
        }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    const evaluate = async expression => {
        const res = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
        if (res.exceptionDetails) {
            throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        }
        return res.result.value;
    };

    // Resolves once no request has been in flight for NETWORK_IDLE_MS, so
    // thumbnails generated on demand are on screen.
    const networkIdle = async (timeoutMs = 60000) => {
        const end = Date.now() + timeoutMs;
        let quietSince = Date.now();
        while (Date.now() < end) {
            await sleep(100);
            if (inflight.size) {
                quietSince = Date.now();
            } else if (Date.now() - quietSince >= NETWORK_IDLE_MS) {
                return;
            }
        }
        throw new Error(`network still busy after ${timeoutMs} ms`);
    };

    const navigate = async url => {
        inflight.clear();
        await send('Page.navigate', {url});
        await networkIdle();
    };

    const viewport = (width, height, {scale = 1, mobile = false} = {}) =>
        send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: scale, mobile});

    const mouse = (type, x, y, extra = {}) =>
        send('Input.dispatchMouseEvent', {type, x, y, button: 'left', ...extra});

    // A real mouse click: h5ai ignores some synthetic DOM clicks.
    const click = async selector => {
        const [x, y] = await evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
            const r = el.getBoundingClientRect();
            return [r.x + r.width / 2, r.y + r.height / 2];
        })()`);
        await mouse('mousePressed', x, y, {clickCount: 1});
        await mouse('mouseReleased', x, y, {clickCount: 1});
    };

    const drag = async (x1, y1, x2, y2, steps = 10) => {
        await mouse('mousePressed', x1, y1, {clickCount: 1});
        for (let i = 1; i <= steps; i += 1) {
            await mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, {buttons: 1});
        }
        await mouse('mouseReleased', x2, y2, {clickCount: 1});
    };

    const screenshot = async () => {
        const {data} = await send('Page.captureScreenshot', {format: 'png'});
        return Buffer.from(data, 'base64');
    };

    const close = async () => {
        ws.close();
        chrome.kill();
        await exited;
        rmSync(profile, {recursive: true, force: true});
    };

    return {send, evaluate, navigate, networkIdle, viewport, click, drag, mouse, screenshot, close};
};
