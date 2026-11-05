// The numbers of the measuring displays, apart from any canvas or audio API
// so they can be tested: a scrolling spectrogram, a pair of VU meters and a
// stereo vectorscope (goniometer).
const {follow} = require('./vizmath');

// The spectrogram's colours from silence to full scale: near black, blue,
// magenta, orange, then pale yellow.
const SPECTROGRAM_STOPS = [
    [0, [6, 6, 18]],
    [0.25, [40, 20, 110]],
    [0.5, [170, 30, 110]],
    [0.75, [245, 120, 30]],
    [1, [255, 245, 190]]
];

// 256 RGB colours, one per byte level.
const spectrogramPalette = () => Array.from({length: 256}, (unused, idx) => {
    const level = idx / 255;
    const upper = SPECTROGRAM_STOPS.findIndex(([at]) => at >= level);
    if (upper <= 0) {
        return SPECTROGRAM_STOPS[0][1].slice();
    }
    const [lowAt, low] = SPECTROGRAM_STOPS[upper - 1];
    const [highAt, high] = SPECTROGRAM_STOPS[upper];
    const mix = (level - lowAt) / (highAt - lowAt);
    return low.map((value, channel) => Math.round(value + (high[channel] - value) * mix));
});

// Moves the `width` x `height` RGBA `pixels` one column to the left and
// writes `levels` (0..1, one per row, the lowest band first) as the new
// right-hand column, bass at the bottom. One column a frame: the picture
// never changes all at once, whatever the music does.
const scrollSpectrogram = (pixels, width, height, levels, palette) => {
    const rowBytes = width * 4;
    for (let y = 0; y < height; y += 1) {
        const row = y * rowBytes;
        pixels.copyWithin(row, row + 4, row + rowBytes);
        const level = Math.max(0, Math.min(1, levels[height - 1 - y] || 0));
        const [r, g, b] = palette[Math.round(level * 255)];
        const offset = row + rowBytes - 4;
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = 255;
    }
};

// A VU meter, as standardised (IEC 60268-17): 0 VU is the broadcast
// alignment level, -18 dBFS (EBU R68); the scale runs from -20 to +3 VU and,
// like a real one, is linear in voltage, so 0 VU sits at 71 % of the arc.
const VU_REFERENCE_DBFS = -18;
const VU_MAX = 3;
const VU_MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
// The needle reaches 99 % of a new level in 300 ms. A real needle overshoots
// by about 1 %; this one follows a first-order curve and never does.
const VU_RISE_SECONDS = 0.3;
const VU_TIME_CONSTANT = VU_RISE_SECONDS / Math.log(100);

// The RMS level of float samples (-1..1) in dBFS, -Infinity for silence.
const rmsDbfs = samples => {
    let sum = 0;
    for (let idx = 0; idx < samples.length; idx += 1) {
        sum += samples[idx] * samples[idx];
    }
    const rms = Math.sqrt(sum / (samples.length || 1));
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
};

// Where a level of `vu` VU sits on the scale: 0 at the far left, 1 at +3 VU.
const vuPosition = vu => Math.max(0, Math.min(1, 10 ** ((vu - VU_MAX) / 20)));

// The needle's next position after `dt` seconds of `samples`.
const vuNeedle = (position, samples, dt) => follow(position, vuPosition(rmsDbfs(samples) - VU_REFERENCE_DBFS), dt, VU_TIME_CONSTANT);

// The needle's angle in radians from straight up, for a position 0..1: the
// arc spans 100 degrees.
const VU_ARC = 100 * Math.PI / 180;
const vuAngle = position => (position - 0.5) * VU_ARC;

// The vectorscope: the last `count` samples of both channels, rotated 45
// degrees so that the middle (L + R) is vertical and the sides (L - R)
// horizontal. Mono draws a vertical line, the left channel alone the
// up-left diagonal, a channel out of phase a horizontal line. Screen
// coordinates around 0, 0, `radius` for full scale.
const vectorPoints = (left, right, count, radius) => {
    const length = Math.min(left.length, right.length);
    const take = Math.min(count, length);
    const scale = radius / Math.SQRT2;
    const points = [];
    for (let idx = length - take; idx < length; idx += 1) {
        points.push({
            x: (right[idx] - left[idx]) * scale,
            y: -(left[idx] + right[idx]) * scale
        });
    }
    return points;
};

module.exports = {
    spectrogramPalette,
    scrollSpectrogram,
    VU_MARKS,
    rmsDbfs,
    vuPosition,
    vuNeedle,
    vuAngle,
    vectorPoints
};
