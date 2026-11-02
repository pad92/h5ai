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
        assert.deepEqual(MODES, ['spectrum', 'scope', 'off']);
        const cover = document.createElement('div');
        cover.appendChild(document.createElement('canvas'));
        visualizer.addSurface(cover, {bars: 2, rows: 7, isShown: () => false});
        assert.equal(cover.querySelector('canvas').width, 7, 'two 3-pixel bars and their gap');
        [1, 2, 3].forEach(() => cover.click());
        assert.deepEqual(changes, ['spectrum', 'scope', 'off']);
        assert.equal(visualizer.label, 'Cover (click to change)');
    } finally {
        window.AudioContext = saved.AudioContext;
        window.requestAnimationFrame = saved.requestAnimationFrame;
    }
});

