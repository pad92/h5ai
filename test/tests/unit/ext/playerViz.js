const {test, assert} = require('scar');
const reqlib = require('../../../util/reqlib');

const viz = reqlib('ext/player/vizmath');

test('visualizer math: log-spaced bands take their loudest bin', () => {
    const edges = viz.bandEdges(4);
    assert.equal(edges.length, 5);
    assert.equal(Math.round(edges[0]), 40);
    assert.equal(Math.round(edges[4]), 16000);
    assert.ok(edges[1] / edges[0] > 4 && edges[2] / edges[1] > 4, 'each band spans the same ratio');

    const freq = new Uint8Array(1024);
    freq[2] = 255; // ~47 Hz with 23.4 Hz bins: the first band
    freq[600] = 51; // ~14 kHz: the last band
    const levels = viz.bandLevels(freq, 23.4375, edges);
    assert.deepEqual(levels.map(level => Math.round(level * 10) / 10), [1, 0, 0, 0.2]);
});

test('visualizer math: bars fall fast, peaks hold then fall slower', () => {
    const state = viz.createFallState(1);
    assert.equal(viz.fall(state, [1], 0.03), true);
    assert.equal(state.bars[0], 1);
    assert.equal(state.peaks[0], 1);

    viz.fall(state, [0], 0.1);
    assert.ok(state.bars[0] < 1, 'the bar falls at once');
    assert.equal(state.peaks[0], 1, 'the peak holds');

    for (let i = 0; i < 40; i += 1) {
        viz.fall(state, [0], 0.1);
    }
    assert.equal(state.bars[0], 0);
    assert.equal(state.peaks[0], 0);
    assert.equal(viz.fall(state, [0], 0.1), false, 'all at rest: nothing left to draw');
});

test('visualizer math: the classic skin colours, green at the bottom', () => {
    assert.equal(viz.spectrumColor(0, 16), 'rgb(239,49,16)');
    assert.equal(viz.spectrumColor(15, 16), 'rgb(24,132,8)');
    assert.equal(viz.spectrumColor(39, 40), 'rgb(24,132,8)', 'taller bars stretch the same palette');
    assert.equal(viz.scopeColor(1), 'rgb(255,255,255)');
    assert.equal(viz.scopeColor(0), 'rgb(148,156,165)');
});

test('visualizer: a new one shows the cover, and a click loops through every mode', () => {
    const {createVisualizer, MODES} = reqlib('ext/player/visualizer');
    const saved = {AudioContext: window.AudioContext, requestAnimationFrame: window.requestAnimationFrame};
    window.AudioContext = class {};
    window.requestAnimationFrame = () => 1;
    try {
        const changes = [];
        const visualizer = createVisualizer({audio: {}, onModeChange: mode => changes.push(mode)});
        assert.equal(visualizer.mode, 'off', 'the cover first, whatever the motion preference');
        assert.equal(MODES.at(-1), 'off', 'the cycle ends on the cover');
        const cover = document.createElement('div');
        cover.appendChild(document.createElement('canvas'));
        visualizer.addSurface(cover, {bars: 2, rows: 7, isShown: () => false});
        assert.equal(cover.querySelector('canvas').width, 7, 'two 3-pixel bars and their gap');
        MODES.forEach(() => cover.click());
        assert.deepEqual(changes, ['spectrum', 'scope', 'plasma', 'kaleido', 'vortex', 'off']);
        assert.equal(visualizer.label, 'Cover (click to change)');
    } finally {
        window.AudioContext = saved.AudioContext;
        window.requestAnimationFrame = saved.requestAnimationFrame;
    }
});

test('visualizer math: the cycle, and reduced motion leaves the psychedelic modes out', () => {
    const walk = reduced => {
        const seen = [];
        let mode = 'off';
        do {
            mode = viz.nextMode(mode, reduced);
            seen.push(mode);
        } while (mode !== 'off' && seen.length < 10);
        return seen;
    };
    assert.deepEqual(walk(false), ['spectrum', 'scope', 'plasma', 'kaleido', 'vortex', 'off']);
    assert.deepEqual(walk(true), ['spectrum', 'scope', 'off']);
    assert.equal(viz.nextMode('plasma', true), 'spectrum', 'a mode left out restarts the cycle');
});

test('visualizer math: hues keep their lightness, energies split the spectrum', () => {
    assert.deepEqual(viz.hueRgb(0), [244, 37, 37]);
    assert.deepEqual(viz.hueRgb(120), [37, 244, 37]);
    assert.deepEqual(viz.hueRgb(240), [37, 37, 244]);
    assert.deepEqual(viz.hueRgb(360), viz.hueRgb(0));
    assert.deepEqual(viz.hueRgb(-120), viz.hueRgb(240));

    // 1024 bins of 23.4 Hz: bins 1 to 9 hold 40 to 250 Hz, the bass.
    const freq = new Uint8Array(1024);
    freq.fill(255, 1, 10);
    const levels = viz.energies(freq, 48000 / 2048);
    assert.equal(levels.bass, 1, 'the bass band, 40 to 250 Hz, is loud');
    assert.equal(levels.mid, 0);
    assert.equal(levels.treble, 0);
});

test('visualizer math: a beat swells over a few frames, never in one', () => {
    const frame = 1 / 30;
    assert.ok(viz.follow(0, 1, frame) < 0.21, 'one frame moves a fifth of the way at most');
    assert.ok(Math.abs(viz.follow(0, 1, 0.15) - (1 - Math.exp(-1))) < 1e-9);
    let level = 0;
    for (let i = 0; i < 30; i += 1) {
        level = viz.follow(level, 1, frame);
    }
    assert.ok(level > 0.99, 'and gets there within a second');
});

test('visualizer math: the vortex ring follows the wave around its circle', () => {
    const flat = new Uint8Array(64).fill(128);
    viz.ringPoints(flat, 8, 40, 20).forEach(point => {
        assert.ok(Math.abs(Math.hypot(point.x, point.y) - 40) < 1e-9);
    });
    const full = new Uint8Array(64).fill(255);
    const silent = new Uint8Array(64).fill(1);
    assert.ok(Math.abs(Math.hypot(...Object.values(viz.ringPoints(full, 4, 40, 20)[0])) - 59.84) < 0.01);
    assert.ok(Math.abs(Math.hypot(...Object.values(viz.ringPoints(silent, 4, 40, 20)[1])) - 20.16) < 0.01);
});

// WCAG relative luminance of an sRGB colour.
const luminance = (r, g, b) => {
    const lin = value => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const meanLuminance = pixels => {
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        sum += luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
    }
    return sum / (pixels.length / 4);
};

test('visualizer math: the plasma moves with the music but never flashes (WCAG 2.3.1)', () => {
    const size = 48;
    const frame = 1 / 30;
    const trip = viz.createTrip();
    const pixels = new Uint8ClampedArray(size * size * 4);
    const means = [];
    let first = null;
    // Three seconds of the worst music for it: every band jumps between
    // silence and full scale on every frame.
    for (let i = 0; i < 90; i += 1) {
        const level = i % 2;
        viz.advanceTrip(trip, {bass: level, mid: level, treble: level}, frame);
        viz.plasmaPixels(pixels, size, trip.t, trip.hue, trip.treble);
        if (!first) {
            first = Uint8ClampedArray.from(pixels);
        }
        means.push(meanLuminance(pixels));
    }
    const changed = pixels.some((value, idx) => value !== first[idx]);
    assert.ok(changed, 'the plasma does move');
    // A flash needs a luminance swing of 10% within a third of a second.
    let widest = 0;
    for (let start = 0; start + 10 <= means.length; start += 1) {
        const window = means.slice(start, start + 10);
        widest = Math.max(widest, Math.max(...window) - Math.min(...window));
    }
    assert.ok(widest < 0.1, `mean luminance swings ${widest.toFixed(3)} within 1/3 s`);
});

test('visualizer: under reduced motion, a saved psychedelic mode shows the cover', () => {
    const {createVisualizer} = reqlib('ext/player/visualizer');
    const saved = {AudioContext: window.AudioContext, requestAnimationFrame: window.requestAnimationFrame, matchMedia: window.matchMedia};
    window.AudioContext = class {};
    window.requestAnimationFrame = () => 1;
    window.matchMedia = query => ({matches: query === '(prefers-reduced-motion: reduce)'});
    try {
        const visualizer = createVisualizer({audio: {}, onModeChange: () => null});
        visualizer.setMode('plasma');
        assert.equal(visualizer.mode, 'off');
        visualizer.setMode('scope');
        assert.equal(visualizer.mode, 'scope', 'the Winamp modes stay');
    } finally {
        window.AudioContext = saved.AudioContext;
        window.requestAnimationFrame = saved.requestAnimationFrame;
        window.matchMedia = saved.matchMedia;
    }
});
