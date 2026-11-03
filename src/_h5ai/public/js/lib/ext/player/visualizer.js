// Visualizers of the playing track, drawn in place of the large view's
// cover: Winamp's spectrum analyser with falling peaks and its oscilloscope,
// then three psychedelic ones, a plasma, a kaleidoscope and a vortex. Those
// turn their colours with the music but keep their brightness: a beat
// swells, it never flashes. They read the real sound through a Web Audio analyser and stay
// cheap: the FFT runs natively, the canvas is a few thousand pixels scaled up
// without smoothing, and nothing runs while paused, hidden, back on the cover
// or on a video.
const i18n = require('../../core/i18n');
const viz = require('./vizmath');

const {MODES, PSYCHEDELIC} = viz;
// "off" shows the cover, where the cycle starts and ends.
const MODE_LABELS = {
    spectrum: 'vizSpectrum',
    scope: 'vizScope',
    plasma: 'vizPlasma',
    kaleido: 'vizKaleido',
    vortex: 'vizVortex',
    off: 'vizCover'
};
const FRAME_MS = 1000 / 30;
// Each bar is 3 pixels wide with a 1-pixel gap, as in Winamp's 76x16 area.
const BAR_STEP = 4;
const BAR_WIDTH = 3;
// The kaleidoscope's mirrored sectors and bands, the vortex's ring points.
const SECTORS = 8;
const KALEIDO_BANDS = 16;
const RING_POINTS = 96;
// Trails: each frame keeps this much of the last one, turned and zoomed.
const TRAIL_KEEP = 0.88;
// Paused, the trails fade out for this long, then nothing runs.
const TRAIL_REST = 1;

const win = () => global.window;
const AudioContextClass = () => win().AudioContext || win().webkitAudioContext;
const isSupported = () => !!AudioContextClass() && typeof win().requestAnimationFrame === 'function';
const prefersReducedMotion = () => typeof win().matchMedia === 'function' && win().matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // Only while a display is shown: the view reduced, nothing is drawn, so
    // nothing is computed either; opening it calls refresh().
    const schedule = () => {
        if (!rafId && analyser && mode !== 'off' && isSupported() && surfaces.some(surface => surface.isShown())) {
            rafId = win().requestAnimationFrame(frame); // eslint-disable-line no-use-before-define
        }
    };

    // Connects the track to an analyser once the audio context runs: the
    // track would go silent through a suspended one. Only once a mode is
    // chosen: the connection cannot be undone, and until then the track
    // plays outside Web Audio. Asked again on each play and mode click, so
    // a context the browser held back starts with a later click, and one
    // it suspended later (a call, a locked screen) resumes.
    const activate = () => {
        if (mode === 'off' || !isSupported()) {
            return;
        }
        try {
            if (!context) {
                context = new (AudioContextClass())();
                context.addEventListener?.('statechange', () => {
                    if (isPlaying && context.state !== 'running') {
                        context.resume().catch(() => null);
                    }
                });
            }
            if (analyser) {
                if (context.state !== 'running') {
                    context.resume().catch(() => null);
                }
                return;
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

    const binHz = () => context.sampleRate / analyser.fftSize;

    // Keeps `TRAIL_KEEP` of the last frame, turned by `spin` and zoomed by
    // `zoom` around the centre: the colours smear into trails.
    const feedback = (surface, spin, zoom) => {
        const {ctx, width: size} = surface;
        if (!surface.buffer) {
            const canvas = win().document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            surface.buffer = {canvas, ctx: canvas.getContext('2d')};
        }
        const {buffer} = surface;
        buffer.ctx.clearRect(0, 0, size, size);
        buffer.ctx.drawImage(surface.canvas, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.globalAlpha = TRAIL_KEEP;
        ctx.translate(size / 2, size / 2);
        ctx.rotate(spin);
        ctx.scale(zoom, zoom);
        ctx.translate(-size / 2, -size / 2);
        ctx.drawImage(buffer.canvas, 0, 0);
        ctx.restore();
    };

    // The trip moves with the music while it plays; paused, the trails fade
    // for TRAIL_REST, then the drawing stops and is cleared.
    const tripStep = (surface, dt, isLive) => {
        const trip = surface.trip;
        if (isLive) {
            trip.rest = 0;
            viz.advanceTrip(trip, viz.energies(freq, binHz()), dt);
            return true;
        }
        trip.rest += dt;
        if (trip.rest >= TRAIL_REST) {
            surface.ctx.clearRect(0, 0, surface.width, surface.rows);
            return false;
        }
        return true;
    };

    // The plasma fills the square; paused, it stays as it is.
    const drawPlasma = (surface, dt, isLive) => {
        const {ctx, width: size, trip} = surface;
        if (!isLive && trip.drawn) {
            return false;
        }
        if (isLive) {
            viz.advanceTrip(trip, viz.energies(freq, binHz()), dt);
        }
        if (!surface.image) {
            surface.image = ctx.createImageData(size, size);
        }
        viz.plasmaPixels(surface.image.data, size, trip.t, trip.hue, trip.treble);
        ctx.putImageData(surface.image, 0, 0);
        trip.drawn = true;
        return false;
    };

    // The spectrum's bands as rays from the centre, mirrored into SECTORS,
    // over trails that turn with the mids and zoom out with the bass.
    const drawKaleido = (surface, dt, isLive) => {
        const {ctx, width: size, trip} = surface;
        const isMoving = tripStep(surface, dt, isLive);
        if (!isMoving) {
            return false;
        }
        feedback(surface, dt * (0.4 + trip.mid * 2), 1.015 + trip.bass * 0.03);
        if (!isLive) {
            return true;
        }
        const levels = viz.bandLevels(freq, binHz(), surface.kaleidoEdges);
        ctx.save();
        ctx.translate(size / 2, size / 2);
        for (let sector = 0; sector < SECTORS; sector += 1) {
            ctx.save();
            ctx.rotate(sector * 2 * Math.PI / SECTORS + trip.spin);
            if (sector % 2) {
                ctx.scale(1, -1);
            }
            levels.forEach((level, band) => {
                if (level > 0.05) {
                    ctx.fillStyle = viz.hueColor(trip.hue + band * 14);
                    ctx.fillRect(6 + band * 4, 0, 2 + level * 10, 1 + level * 3);
                }
            });
            ctx.restore();
        }
        ctx.restore();
        return true;
    };

    // The wave bent into a ring, sucked inwards by trails that shrink and
    // turn against the ring.
    const drawVortex = (surface, dt, isLive) => {
        const {ctx, width: size, trip} = surface;
        const isMoving = tripStep(surface, dt, isLive);
        if (!isMoving) {
            return false;
        }
        feedback(surface, -dt * (0.3 + trip.treble * 2), 0.95 - trip.bass * 0.03);
        if (!isLive) {
            return true;
        }
        viz.ringPoints(wave, RING_POINTS, size * 0.3, size * 0.15).forEach((point, idx) => {
            ctx.fillStyle = viz.hueColor(trip.hue + idx * 360 / RING_POINTS);
            ctx.fillRect(Math.round(size / 2 + point.x) - 1, Math.round(size / 2 + point.y) - 1, 2, 2);
        });
        return true;
    };

    const DRAW = {spectrum: drawSpectrum, scope: drawScope, plasma: drawPlasma, kaleido: drawKaleido, vortex: drawVortex};

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
            // The psychedelic modes draw over their own last frame.
            if (!PSYCHEDELIC.includes(mode)) {
                ctx.clearRect(0, 0, surface.width, surface.rows);
            }
            isMoving = DRAW[mode](surface, dt, isLive) || isMoving;
        });
        if (isLive || isMoving) {
            schedule();
        }
    }

    const describe = () => i18n.t('vizSwitch', i18n.t(MODE_LABELS[mode]));

    function resetTrip(surface) {
        surface.trip = Object.assign(viz.createTrip(), {rest: 0, drawn: false});
    }

    // Each mode starts on a clean canvas.
    function switchTo(value) {
        mode = value;
        clear();
        surfaces.forEach(resetTrip);
        schedule();
    }

    // `button`: holds the canvas and changes the mode on click; its owner
    // names it from `label`, and only once it is a button: a label on a plain
    // element is invalid HTML. `bars` 3-pixel bars of `rows` pixels;
    // `isShown()`: whether to draw it now.
    const addSurface = (button, {bars, rows, isShown}) => {
        const canvas = button.querySelector('canvas');
        const width = bars * BAR_STEP - 1;
        canvas.width = width;
        canvas.height = rows;
        const surface = {
            canvas,
            ctx: null,
            width,
            rows,
            isShown,
            edges: viz.bandEdges(bars),
            kaleidoEdges: viz.bandEdges(KALEIDO_BANDS),
            fall: viz.createFallState(bars),
            trip: null
        };
        resetTrip(surface);
        surfaces.push(surface);
        button.addEventListener('click', () => {
            if (!isSupported()) {
                return;
            }
            switchTo(viz.nextMode(mode, prefersReducedMotion()));
            // The click lets the browser start the audio context.
            if (isPlaying) {
                activate();
            }
            onModeChange(mode);
        });
    };

    const setPlaying = playing => {
        isPlaying = playing;
        schedule();
    };

    // A saved psychedelic mode gives way to the cover under reduced motion.
    const setMode = value => {
        if (MODES.includes(value)) {
            switchTo(PSYCHEDELIC.includes(value) && prefersReducedMotion() ? 'off' : value);
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
