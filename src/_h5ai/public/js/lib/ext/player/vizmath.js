// The visualizer's numbers, apart from any canvas or audio API so they can
// be tested: frequency bands, falling bars and peaks, the colours and styles
// of the classic Winamp skin, and the psychedelic modes' motion and pixels.
// The meters' numbers are in vizmeters.js.

// The classic skin's spectrum colours (viscolor.txt), from the top of a bar
// to its bottom: red, orange, yellow, then green.
const SPECTRUM_COLORS = [
    [239, 49, 16], [206, 41, 16], [214, 90, 0], [214, 102, 0],
    [214, 115, 0], [198, 123, 8], [222, 165, 24], [214, 181, 33],
    [189, 222, 41], [148, 222, 33], [41, 206, 16], [50, 190, 16],
    [57, 181, 16], [49, 156, 8], [41, 148, 0], [24, 132, 8]
];
const PEAK_COLOR = [150, 150, 150];
// The oscilloscope, brighter where the wave swings wider.
const SCOPE_COLORS = [[255, 255, 255], [214, 214, 222], [181, 189, 189], [160, 170, 175], [148, 156, 165]];

const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;

// The colour of a bar's pixel row `row` (0 at the top) out of `rows`.
const spectrumColor = (row, rows) => rgb(SPECTRUM_COLORS[Math.min(SPECTRUM_COLORS.length - 1, Math.floor(row * SPECTRUM_COLORS.length / rows))]);

// Winamp's three analyser styles, as the row of the palette that colours the
// pixel at row `row` of a bar whose top is at row `top`, out of `rows`:
// "normal" colours by height on the screen, "fire" starts the palette at the
// top of each bar, "line" paints the whole bar in the colour of its top.
const ANALYSER_STYLES = ['normal', 'fire', 'line'];
const paletteRow = (style, row, top, rows) => {
    if (style === 'fire') {
        return Math.min(rows - 1, row - top);
    }
    return style === 'line' ? top : row;
};

const scopeColor = swing => rgb(SCOPE_COLORS[Math.min(SCOPE_COLORS.length - 1, Math.floor((1 - swing) * SCOPE_COLORS.length))]);

const LOW_HZ = 40;
const HIGH_HZ = 16000;

// Band edges in Hz, spaced evenly on a log scale like the ear hears them:
// bass gets as many bars as treble.
const bandEdges = count => Array.from({length: count + 1}, (unused, idx) => LOW_HZ * (HIGH_HZ / LOW_HZ) ** (idx / count));

// The analyser's FFT: 4096 samples, 93 ms at 44.1 kHz, bins of 10.8 Hz. A
// longer one would tell the bass apart better but smear every beat.
const FFT_SIZE = 4096;

// `freq`: the analyser's byte magnitudes (0-255), bin `k` centred on
// `k * binHz`. Each band takes the loudest bin centred inside it, 0..1. A
// bass band narrower than a bin has none: it reads the spectrum between the
// two bins around its middle, so neighbouring bars never move as one.
const bandLevels = (freq, binHz, edges) => {
    const last = freq.length - 1;
    const levels = [];
    for (let band = 0; band < edges.length - 1; band += 1) {
        const from = Math.ceil(edges[band] / binHz);
        const to = Math.min(last, Math.ceil(edges[band + 1] / binHz) - 1);
        let level = 0;
        if (from <= to) {
            for (let bin = from; bin <= to; bin += 1) {
                level = Math.max(level, freq[bin]);
            }
        } else {
            const at = Math.min(last, Math.sqrt(edges[band] * edges[band + 1]) / binHz);
            const below = Math.floor(at);
            const above = Math.min(last, below + 1);
            level = freq[below] + (freq[above] - freq[below]) * (at - below);
        }
        levels.push(level / 255);
    }
    return levels;
};

// Bars rise at once and fall at `BAR_FALL` per second; a peak stays up for
// `PEAK_HOLD` seconds, then falls slower: the Winamp look.
const BAR_FALL = 2.2;
const PEAK_HOLD = 0.35;
const PEAK_FALL = 0.9;

// Updates `state` ({bars, peaks, holds}, arrays of the levels' length) by
// `dt` seconds; returns whether anything is still above zero.
const fall = (state, levels, dt) => {
    let isMoving = false;
    levels.forEach((level, idx) => {
        state.bars[idx] = Math.max(level, (state.bars[idx] || 0) - BAR_FALL * dt);
        if (state.bars[idx] >= (state.peaks[idx] || 0)) {
            state.peaks[idx] = state.bars[idx];
            state.holds[idx] = PEAK_HOLD;
        } else if (state.holds[idx] > 0) {
            state.holds[idx] -= dt;
        } else {
            state.peaks[idx] = Math.max(0, state.peaks[idx] - PEAK_FALL * dt);
        }
        isMoving = isMoving || state.bars[idx] > 0 || state.peaks[idx] > 0;
    });
    return isMoving;
};

const createFallState = count => ({
    bars: new Array(count).fill(0),
    peaks: new Array(count).fill(0),
    holds: new Array(count).fill(0)
});

// The modes as the menu groups them, "off" being the cover. Their names are
// saved: keep them. The psychedelic ones keep moving and are left out when
// the system asks for reduced motion; the meters only move with the sound.
const GROUPS = [
    {name: 'winamp', modes: ['spectrum', 'spectrumFire', 'spectrumLine', 'spectrumThin', 'scope', 'scopeDots', 'scopeSolid']},
    {name: 'meters', modes: ['spectrogram', 'vu', 'vectorscope']},
    {name: 'trips', modes: ['plasma', 'kaleido', 'vortex']}
];
const PSYCHEDELIC = GROUPS[2].modes;
const MODES = [...GROUPS.flatMap(group => group.modes), 'off'];

// The modes a viewer may pick.
const allowedModes = reducedMotion => MODES.filter(mode => !reducedMotion || !PSYCHEDELIC.includes(mode));

// The mean level, 0..1, of the bins from `lowHz` up to, not including,
// `highHz`: next to each other, two bands never share a bin.
const bandEnergy = (freq, binHz, lowHz, highHz) => {
    const from = Math.min(freq.length - 1, Math.floor(lowHz / binHz));
    const to = Math.min(freq.length - 1, Math.max(from, Math.floor(highHz / binHz) - 1));
    let sum = 0;
    for (let bin = from; bin <= to; bin += 1) {
        sum += freq[bin];
    }
    return sum / (to - from + 1) / 255;
};

const energies = (freq, binHz) => ({
    bass: bandEnergy(freq, binHz, 40, 250),
    mid: bandEnergy(freq, binHz, 250, 2000),
    treble: bandEnergy(freq, binHz, 2000, 16000)
});

// Moves `current` towards `target` with a time constant of `seconds`: a beat
// swells over a tenth of a second instead of flashing in one frame.
const FOLLOW_SECONDS = 0.15;
const follow = (current, target, dt, seconds = FOLLOW_SECONDS) => current + (target - current) * (1 - Math.exp(-dt / seconds));

// A colour of fixed saturation and lightness: the hue turns, the brightness
// never jumps. `hue` in degrees, any value.
const hueRgb = (hue, sat = 0.9, light = 0.55) => {
    const h = (hue % 360 + 360) % 360 / 60;
    const chroma = (1 - Math.abs(2 * light - 1)) * sat;
    const x = chroma * (1 - Math.abs(h % 2 - 1));
    const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(h) % 6];
    const m = light - chroma / 2;
    return [r, g, b].map(value => Math.round((value + m) * 255));
};

const hueColor = hue => rgb(hueRgb(hue));

// The psychedelic modes' clock: `state` {t, hue, spin, bass, mid, treble}
// follows the smoothed energies; louder music turns the colours faster and
// winds the patterns, it never changes their brightness.
const createTrip = () => ({t: 0, hue: 0, spin: 0, bass: 0, mid: 0, treble: 0});

const advanceTrip = (state, levels, dt) => {
    state.bass = follow(state.bass, levels.bass, dt);
    state.mid = follow(state.mid, levels.mid, dt);
    state.treble = follow(state.treble, levels.treble, dt);
    state.t += dt * (0.5 + state.bass * 1.5);
    state.hue += dt * (20 + state.bass * 70);
    state.spin += dt * (0.3 + state.mid * 1.8);
    return state;
};

// The vortex's ring: `count` points around a circle of `radius`, pushed out
// or in by `amp` with the wave (bytes, 128 at rest). Centred on 0, 0.
const ringPoints = (wave, count, radius, amp) => Array.from({length: count}, (unused, idx) => {
    const swing = (wave[Math.floor(idx * wave.length / count)] - 128) / 128;
    const angle = idx / count * 2 * Math.PI;
    const r = radius + swing * amp;
    return {x: Math.cos(angle) * r, y: Math.sin(angle) * r};
});

// A demoscene plasma: three sine fields, the last one circling, summed into
// 0..1 and coloured by a hue band that turns with `hue`. `warp` (0..1, the
// treble) tightens the waves. Fills `pixels`, RGBA bytes of a `size` square.
const PLASMA_ALPHA = 235;
const plasmaPixels = (pixels, size, t, hue, warp) => {
    const palette = Array.from({length: 256}, (unused, idx) => hueRgb(hue + idx / 255 * 240));
    const k = 10 * (1 + warp * 0.5);
    const sinA = Math.sin(t / 2);
    const cosB = Math.cos(t / 3);
    const cx = 0.5 * Math.sin(t / 5);
    const cy = 0.5 * Math.cos(t / 3);
    let offset = 0;
    for (let y = 0; y < size; y += 1) {
        const v = y / size;
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const dx = u - 0.5 + cx;
            const dy = v - 0.5 + cy;
            const sum = Math.sin(u * k + t) +
                Math.sin(k * (u * sinA + v * cosB) + t) +
                Math.sin(Math.sqrt(k * k * (dx * dx + dy * dy) + 1) + t);
            const [r, g, b] = palette[Math.round((sum + 3) / 6 * 255)];
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
            pixels[offset + 3] = PLASMA_ALPHA;
            offset += 4;
        }
    }
};

module.exports = {
    FFT_SIZE,
    MODES,
    GROUPS,
    PSYCHEDELIC,
    allowedModes,
    ANALYSER_STYLES,
    paletteRow,
    energies,
    follow,
    hueRgb,
    hueColor,
    createTrip,
    advanceTrip,
    ringPoints,
    plasmaPixels,
    rgb,
    PEAK_COLOR: rgb(PEAK_COLOR),
    spectrumColor,
    scopeColor,
    bandEdges,
    bandLevels,
    fall,
    createFallState
};
