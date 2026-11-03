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

test('visualizer math: at the analyser\'s real resolution, every bass bar reads its own part of the spectrum', () => {
    // A spectrum falling bin after bin up to 1.4 kHz: each bar must read
    // lower than the one before. Bars sharing a bin would read the same and
    // move as one.
    const binHz = 44100 / viz.FFT_SIZE;
    const freq = new Uint8Array(viz.FFT_SIZE / 2);
    for (let bin = 0; bin < 128; bin += 1) {
        freq[bin] = 255 - bin * 2;
    }
    const edges = viz.bandEdges(38);
    const levels = viz.bandLevels(freq, binHz, edges);
    const bass = edges.filter(edge => edge < 127 * binHz).length - 1;
    assert.ok(bass > 15, `${bass} bars below 1.4 kHz`);
    for (let bar = 0; bar + 1 < bass; bar += 1) {
        assert.ok(levels[bar] > levels[bar + 1], `bar ${bar} reads above bar ${bar + 1}`);
    }

    // A tone of about 100 Hz, spread over three bins as the analyser's
    // window does: the bar holding its frequency is the loudest.
    const tone = new Uint8Array(viz.FFT_SIZE / 2);
    const at = Math.round(100 / binHz);
    const toneHz = at * binHz;
    tone[at - 1] = 200;
    tone[at] = 255;
    tone[at + 1] = 200;
    const toneLevels = viz.bandLevels(tone, binHz, edges);
    const loudest = toneLevels.indexOf(Math.max(...toneLevels));
    assert.ok(edges[loudest] <= toneHz && toneHz < edges[loudest + 1], `bar ${loudest} spans ${Math.round(edges[loudest])}-${Math.round(edges[loudest + 1])} Hz, the tone ${Math.round(toneHz)} Hz`);
    assert.equal(toneLevels[loudest + 6], 0, 'and the treble stays dark');
});

test('visualizer math: Winamp\'s three analyser styles colour a bar differently', () => {
    const rows = 16;
    // A bar from row 12 to the bottom (15), four pixels high.
    assert.deepEqual([12, 15].map(row => viz.paletteRow('normal', row, 12, rows)), [12, 15], 'normal: by height on the screen, a short bar is green');
    assert.deepEqual([12, 15].map(row => viz.paletteRow('fire', row, 12, rows)), [0, 3], 'fire: red at the top of any bar');
    assert.deepEqual([12, 15].map(row => viz.paletteRow('line', row, 12, rows)), [12, 12], 'line: one colour, the top\'s');
    assert.deepEqual(viz.ANALYSER_STYLES, ['normal', 'fire', 'line']);
});

test('visualizer math: the menu groups every mode once, and reduced motion leaves the psychedelic ones out', () => {
    const grouped = viz.GROUPS.flatMap(group => group.modes);
    assert.deepEqual([...grouped, 'off'], viz.MODES, 'each mode in one group, the cover apart');
    assert.equal(new Set(viz.MODES).size, viz.MODES.length, 'no mode twice');
    ['spectrum', 'scope', 'plasma', 'kaleido', 'vortex', 'off'].forEach(mode => {
        assert.ok(viz.MODES.includes(mode), `${mode}, saved by older versions, is still a mode`);
    });
    assert.deepEqual(viz.allowedModes(false), viz.MODES);
    assert.deepEqual(viz.allowedModes(true).filter(mode => viz.PSYCHEDELIC.includes(mode)), []);
    assert.ok(viz.allowedModes(true).includes('spectrogram') && viz.allowedModes(true).includes('vu'), 'the meters move only with the sound');
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

const vizMeters = reqlib('ext/player/vizmeters');

test('visualizer meters: the spectrogram scrolls one column a frame, bass at the bottom', () => {
    const palette = vizMeters.spectrogramPalette();
    const lum = ([r, g, b]) => luminance(r, g, b);
    for (let level = 1; level < 256; level += 1) {
        assert.ok(lum(palette[level]) >= lum(palette[level - 1]), `level ${level} is no darker than the one below`);
    }
    assert.ok(lum(palette[255]) - lum(palette[0]) > 0.7, 'silence dark, full scale bright');

    const width = 4;
    const height = 3;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const pixel = (x, y) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    vizMeters.scrollSpectrogram(pixels, width, height, [1, 0, 0], palette);
    assert.deepEqual(pixel(3, 2), [...palette[255], 255], 'the loud bass, bottom right');
    assert.deepEqual(pixel(3, 0), [...palette[0], 255], 'the silent treble, top right');
    assert.deepEqual(pixel(2, 2), [0, 0, 0, 0], 'nothing yet on its left');
    vizMeters.scrollSpectrogram(pixels, width, height, [0, 0, 1], palette);
    assert.deepEqual(pixel(2, 2), [...palette[255], 255], 'the last column moved one pixel left');
    assert.deepEqual(pixel(3, 0), [...palette[255], 255], 'the new one is on the right');
});

test('visualizer meters: the spectrogram never flashes, whatever the music (WCAG 2.3.1)', () => {
    const size = 151;
    const palette = vizMeters.spectrogramPalette();
    const pixels = new Uint8ClampedArray(size * size * 4);
    const loud = new Array(size).fill(1);
    const silent = new Array(size).fill(0);
    const means = [];
    // Three seconds of full scale and silence swapped on every frame.
    for (let i = 0; i < 90; i += 1) {
        vizMeters.scrollSpectrogram(pixels, size, size, i % 2 ? loud : silent, palette);
        means.push(meanLuminance(pixels));
    }
    assert.ok(means[89] > means[0], 'the picture does change');
    let widest = 0;
    for (let start = 0; start + 10 <= means.length; start += 1) {
        const window = means.slice(start, start + 10);
        widest = Math.max(widest, Math.max(...window) - Math.min(...window));
    }
    assert.ok(widest < 0.1, `mean luminance swings ${widest.toFixed(3)} within 1/3 s`);
});

// `seconds` of a sine of `amplitude` (peak), 48 kHz.
const sine = (amplitude, seconds = 0.05) => Float32Array.from({length: Math.round(48000 * seconds)}, (unused, idx) => amplitude * Math.sin(2 * Math.PI * 1000 * idx / 48000));

test('visualizer meters: a VU meter reads 0 VU at -18 dBFS, on a scale linear in voltage', () => {
    // RMS -18 dBFS: a sine peaking 3 dB higher.
    const reference = sine(10 ** (-18 / 20) * Math.SQRT2);
    assert.ok(Math.abs(vizMeters.rmsDbfs(reference) + 18) < 0.01, `${vizMeters.rmsDbfs(reference).toFixed(3)} dBFS`);
    assert.equal(vizMeters.rmsDbfs(new Float32Array(64)), -Infinity, 'silence');
    assert.ok(Math.abs(vizMeters.vuPosition(0) - 0.708) < 0.001, '0 VU at 71 % of the arc, as on a real meter');
    assert.ok(Math.abs(vizMeters.vuPosition(-20) - 0.0708) < 0.001, '-20 VU, a tenth of that voltage');
    assert.equal(vizMeters.vuPosition(3), 1);
    assert.equal(vizMeters.vuPosition(12), 1, 'pinned at the right end');
    assert.equal(vizMeters.vuPosition(-Infinity), 0);
    assert.ok(vizMeters.vuAngle(0) < 0 && vizMeters.vuAngle(1) > 0 && vizMeters.vuAngle(0.5) === 0, 'left to right through straight up');
});

test('visualizer meters: a VU needle takes 300 ms to reach a new level, and falls back to rest', () => {
    const frame = 1 / 30;
    const reference = sine(10 ** (-18 / 20) * Math.SQRT2);
    const target = vizMeters.vuPosition(0);
    let position = 0;
    // 3 frames: 0.1 s, then 6 more: 0.3 s.
    for (let i = 0; i < 3; i += 1) {
        position = vizMeters.vuNeedle(position, reference, frame);
    }
    assert.ok(position < 0.9 * target, `still rising after 0.1 s: ${(position / target).toFixed(2)}`);
    for (let i = 0; i < 6; i += 1) {
        position = vizMeters.vuNeedle(position, reference, frame);
    }
    assert.ok(position >= 0.985 * target && position <= target, `at 300 ms: ${(position / target).toFixed(3)} of the level`);
    for (let i = 0; i < 30; i += 1) {
        position = vizMeters.vuNeedle(position, new Float32Array(64), frame);
    }
    assert.ok(position < 0.01, 'a second of silence brings it back');
});

test('visualizer meters: the vectorscope draws mono upright and each side on its diagonal', () => {
    const wave = Float32Array.from([0.5, -0.25, 1]);
    const silence = new Float32Array(3);
    const negate = arr => arr.map(value => -value);
    const close = (a, b) => Math.abs(a - b) < 1e-9;

    const mono = vizMeters.vectorPoints(wave, wave, 8, 100);
    assert.equal(mono.length, 3);
    assert.ok(mono.every(point => close(point.x, 0)), 'mono: a vertical line');
    assert.ok(close(mono[2].y, -100 * Math.SQRT2), 'full scale on both reaches past the radius: louder than one side');
    assert.ok(mono[0].y < 0, 'a positive sample goes up');

    vizMeters.vectorPoints(wave, silence, 8, 100).forEach(point => assert.ok(close(point.x, point.y), 'the left alone: up and to the left'));
    vizMeters.vectorPoints(silence, wave, 8, 100).forEach(point => assert.ok(close(point.x, -point.y), 'the right alone: up and to the right'));
    vizMeters.vectorPoints(wave, negate(wave), 8, 100).forEach(point => assert.ok(close(point.y, 0), 'out of phase: a horizontal line'));
    assert.deepEqual(vizMeters.vectorPoints(wave, wave, 1, 100).map(point => Math.round(point.y)), [Math.round(-100 * Math.SQRT2)], 'the latest samples only');
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
