// Winamp-style visualizers of the playing track: a spectrum analyser with
// falling peaks, or an oscilloscope, drawn in place of the large view's
// cover. They read the real sound through a Web Audio analyser and stay
// cheap: the FFT runs natively, the canvas is a few thousand pixels scaled up
// without smoothing, and nothing runs while paused, hidden, back on the cover
// or on a video.
const viz = require('./vizmath');

const MODES = ['spectrum', 'scope', 'off'];
// "off" shows the cover: the cycle goes cover, spectrum, oscilloscope.
const MODE_LABELS = {spectrum: 'Spectrum analyser', scope: 'Oscilloscope', off: 'Cover'};
const FRAME_MS = 1000 / 30;
// Each bar is 3 pixels wide with a 1-pixel gap, as in Winamp's 76x16 area.
const BAR_STEP = 4;
const BAR_WIDTH = 3;

const win = () => global.window;
const AudioContextClass = () => win().AudioContext || win().webkitAudioContext;
const isSupported = () => !!AudioContextClass() && typeof win().requestAnimationFrame === 'function';

// `audio`: the track element. `onModeChange(mode)`: after a click changed it.
const createVisualizer = ({audio, onModeChange}) => {
    let context = null;
    let analyser = null;
    let freq = null;
    let wave = null;
    // The cover first: the visualizer is asked for with a click.
    let mode = 'off';
    let isPlaying = false;
    let rafId = 0;
    let last = 0;
    const surfaces = [];

    const schedule = () => {
        if (!rafId && analyser && mode !== 'off' && isSupported()) {
            rafId = win().requestAnimationFrame(frame); // eslint-disable-line no-use-before-define
        }
    };

    // Connects the track to an analyser once the audio context runs: the
    // track would go silent through a suspended one. Asked again on each
    // play, so a context the browser held back starts with a later click.
    const activate = () => {
        if (analyser || !isSupported()) {
            return;
        }
        try {
            if (!context) {
                context = new (AudioContextClass())();
            }
            const connect = () => {
                if (analyser || context.state !== 'running') {
                    return;
                }
                const node = context.createAnalyser();
                node.fftSize = 2048;
                node.minDecibels = -85;
                node.maxDecibels = -20;
                node.smoothingTimeConstant = 0.5;
                context.createMediaElementSource(audio).connect(node);
                node.connect(context.destination);
                freq = new Uint8Array(node.frequencyBinCount);
                wave = new Uint8Array(node.fftSize);
                analyser = node;
                schedule();
            };
            if (context.state === 'running') {
                connect();
            } else {
                context.resume().then(connect).catch(() => null);
            }
        } catch {
            // No visualizer: the track plays as before.
        }
    };

    const drawSpectrum = (surface, dt) => {
        const {ctx, rows} = surface;
        const levels = viz.bandLevels(freq, context.sampleRate / analyser.fftSize, surface.edges);
        const isMoving = viz.fall(surface.fall, levels, dt);
        ctx.fillStyle = surface.gradient;
        surface.fall.bars.forEach((level, idx) => {
            const height = Math.round(level * rows);
            if (height) {
                ctx.fillRect(idx * BAR_STEP, rows - height, BAR_WIDTH, height);
            }
        });
        ctx.fillStyle = viz.PEAK_COLOR;
        surface.fall.peaks.forEach((peak, idx) => {
            const top = rows - Math.round(peak * rows);
            if (peak > 0) {
                ctx.fillRect(idx * BAR_STEP, Math.min(rows - 1, top), BAR_WIDTH, 1);
            }
        });
        return isMoving;
    };

    // One column per pixel, joined to the previous one so the wave reads as
    // a line even where it jumps.
    const drawScope = surface => {
        const {ctx, rows, width} = surface;
        let previous = null;
        for (let x = 0; x < width; x += 1) {
            const sample = wave[Math.floor(x * wave.length / width)];
            const y = Math.round(sample / 255 * (rows - 1));
            const from = previous === null ? y : Math.min(previous, y);
            const to = previous === null ? y : Math.max(previous, y);
            ctx.fillStyle = viz.scopeColor(Math.abs(sample - 128) / 128);
            ctx.fillRect(x, from, 1, to - from + 1);
            previous = y;
        }
        return false;
    };

    const prepare = surface => {
        if (!surface.ctx) {
            surface.ctx = surface.canvas.getContext('2d');
            // Hard stops: one flat colour per pixel row, like the skin.
            const gradient = surface.ctx.createLinearGradient(0, 0, 0, surface.rows);
            for (let row = 0; row < surface.rows; row += 1) {
                const color = viz.spectrumColor(row, surface.rows);
                gradient.addColorStop(row / surface.rows, color);
                gradient.addColorStop((row + 1) / surface.rows, color);
            }
            surface.gradient = gradient;
        }
        return surface.ctx;
    };

    const clear = () => surfaces.forEach(surface => {
        if (surface.ctx) {
            surface.ctx.clearRect(0, 0, surface.width, surface.rows);
        }
    });

    function frame(now) {
        rafId = 0;
        if (!analyser || mode === 'off') {
            clear();
            return;
        }
        if (now - last < FRAME_MS) {
            schedule();
            return;
        }
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        const isLive = isPlaying && !win().document.hidden;
        if (isLive) {
            analyser.getByteFrequencyData(freq);
            analyser.getByteTimeDomainData(wave);
        } else {
            // Paused: the bars fall to rest, the wave goes flat.
            freq.fill(0);
            wave.fill(128);
        }
        let isMoving = false;
        surfaces.forEach(surface => {
            if (!surface.isShown()) {
                return;
            }
            const ctx = prepare(surface);
            if (!ctx) {
                return;
            }
            ctx.clearRect(0, 0, surface.width, surface.rows);
            isMoving = (mode === 'spectrum' ? drawSpectrum(surface, dt) : drawScope(surface)) || isMoving;
        });
        if (isLive || isMoving) {
            schedule();
        }
    }

    const describe = () => `${MODE_LABELS[mode]} (click to change)`;

    // `button`: holds the canvas and changes the mode on click. `bars` 3-pixel
    // bars of `rows` pixels; `isShown()`: whether to draw it now.
    const addSurface = (button, {bars, rows, isShown}) => {
        const canvas = button.querySelector('canvas');
        const width = bars * BAR_STEP - 1;
        canvas.width = width;
        canvas.height = rows;
        const surface = {canvas, ctx: null, width, rows, isShown, edges: viz.bandEdges(bars), fall: viz.createFallState(bars)};
        surfaces.push(surface);
        // Shown by the player only where Web Audio exists.
        button.setAttribute('title', describe());
        button.setAttribute('aria-label', describe());
        button.addEventListener('click', () => {
            if (!isSupported()) {
                return;
            }
            mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
            surfaces.forEach(each => {
                each.canvas.parentNode.setAttribute('title', describe());
                each.canvas.parentNode.setAttribute('aria-label', describe());
            });
            schedule();
            if (mode === 'off') {
                clear();
            }
            onModeChange(mode);
        });
    };

    const setPlaying = playing => {
        isPlaying = playing;
        schedule();
    };

    const setMode = value => {
        if (MODES.includes(value)) {
            mode = value;
            surfaces.forEach(surface => {
                surface.canvas.parentNode.setAttribute('title', describe());
                surface.canvas.parentNode.setAttribute('aria-label', describe());
            });
        }
    };

    win().document.addEventListener('visibilitychange', schedule);

    return {
        activate,
        addSurface,
        setPlaying,
        setMode,
        get mode() {
            return mode;
        },
        // What a click on a display does, for its title.
        get label() {
            return describe();
        },
        // Drawing again, for a view that just became shown.
        refresh: schedule
    };
};

module.exports = {
    MODES,
    isSupported,
    createVisualizer
};
