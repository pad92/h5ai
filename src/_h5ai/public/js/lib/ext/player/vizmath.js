// The visualizer's numbers, apart from any canvas or audio API so they can
// be tested: frequency bands, falling bars and peaks, and the colours of the
// classic Winamp skin.

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

const scopeColor = swing => rgb(SCOPE_COLORS[Math.min(SCOPE_COLORS.length - 1, Math.floor((1 - swing) * SCOPE_COLORS.length))]);

const LOW_HZ = 40;
const HIGH_HZ = 16000;

// Band edges in Hz, spaced evenly on a log scale like the ear hears them:
// bass gets as many bars as treble.
const bandEdges = count => Array.from({length: count + 1}, (unused, idx) => LOW_HZ * (HIGH_HZ / LOW_HZ) ** (idx / count));

// `freq`: the analyser's byte magnitudes (0-255), `binHz`: the width of one
// bin. Each band takes its loudest bin, 0..1. A band narrower than a bin
// still reads the bin it falls in.
const bandLevels = (freq, binHz, edges) => {
    const levels = [];
    for (let band = 0; band < edges.length - 1; band += 1) {
        const from = Math.min(freq.length - 1, Math.floor(edges[band] / binHz));
        const to = Math.min(freq.length - 1, Math.max(from, Math.ceil(edges[band + 1] / binHz) - 1));
        let max = 0;
        for (let bin = from; bin <= to; bin += 1) {
            max = Math.max(max, freq[bin]);
        }
        levels.push(max / 255);
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

module.exports = {
    PEAK_COLOR: rgb(PEAK_COLOR),
    spectrumColor,
    scopeColor,
    bandEdges,
    bandLevels,
    fall,
    createFallState
};
