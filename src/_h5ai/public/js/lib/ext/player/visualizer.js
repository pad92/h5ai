// Visualizers of the playing track, drawn in place of the large view's
// cover. Winamp's: the spectrum analyser in its three styles and with thin
// bands, with falling peaks, and its oscilloscope as lines, dots or solid.
// Measuring ones: a scrolling spectrogram, two VU meters and a stereo
// vectorscope. Then three psychedelic ones, a plasma, a kaleidoscope and a
// vortex, which turn their colours with the music but keep their
// brightness: a beat swells, it never flashes. They read the real sound
// through Web Audio analysers and stay cheap: the FFT runs natively, the
// canvas is a few thousand pixels scaled up without smoothing, and nothing
// runs while paused, hidden, back on the cover or on a video.
const i18n = require('../../core/i18n');
const viz = require('./vizmath');
const meters = require('./vizmeters');

const {MODES, GROUPS, PSYCHEDELIC} = viz;
const MODE_LABELS = {
    spectrum: 'vizSpectrum',
    spectrumFire: 'vizSpectrumFire',
    spectrumLine: 'vizSpectrumLine',
    spectrumThin: 'vizSpectrumThin',
    scope: 'vizScope',
    scopeDots: 'vizScopeDots',
    scopeSolid: 'vizScopeSolid',
    spectrogram: 'vizSpectrogram',
    vu: 'vizVu',
    vectorscope: 'vizVectorscope',
    plasma: 'vizPlasma',
    kaleido: 'vizKaleido',
    vortex: 'vizVortex',
    off: 'vizCover'
};
const GROUP_LABELS = {winamp: 'vizGroupWinamp', meters: 'vizGroupMeters', trips: 'vizGroupTrips'};
// What a click on the cover shows when nothing was chosen yet.
const DEFAULT_MODE = 'spectrum';
const FRAME_MS = 1000 / 30;
// Each bar is 3 pixels wide with a 1-pixel gap, as in Winamp's 76x16 area;
// thin bands are 1 pixel wide with no gap.
const BAR_STEP = 4;
const BAR_WIDTH = 3;
// The oscilloscope shows this many samples: 46 ms at 44.1 kHz.
const SCOPE_SAMPLES = 2048;
// The two channels only feed the meters: their FFT size is their window.
const CHANNEL_SAMPLES = 2048;
// The kaleidoscope's mirrored sectors and bands, the vortex's ring points.
const SECTORS = 8;
const KALEIDO_BANDS = 16;
const RING_POINTS = 96;
// Trails: each frame keeps this much of the last one, turned and zoomed.
const TRAIL_KEEP = 0.88;
// Paused, the trails fade out for this long, then nothing runs.
const TRAIL_REST = 1;
// The vectorscope: the points of a frame, and how much of the last frame's
// glow a new one wipes, like a phosphor screen.
const VECTOR_POINTS = 1024;
const PHOSPHOR_FADE = 0.25;
const VECTOR_COLOR = 'rgb(120,255,140)';
// The VU meters' face, scale, red zone above 0 VU, and needle.
const VU_FACE = 'rgb(36,26,10)';
const VU_SCALE = 'rgb(255,179,64)';
const VU_RED = 'rgb(255,74,42)';
const VU_NEEDLE = 'rgb(242,242,242)';
// Below this, a needle is at rest.
const VU_REST = 0.002;

const win = () => global.window;
const AudioContextClass = () => win().AudioContext || win().webkitAudioContext;
const isSupported = () => !!AudioContextClass() && typeof win().requestAnimationFrame === 'function';
const prefersReducedMotion = () => typeof win().matchMedia === 'function' && win().matchMedia('(prefers-reduced-motion: reduce)').matches;

// `audio`: the track element. `onModeChange(mode)`: after the viewer changed it.
const createVisualizer = ({audio, onModeChange}) => {
    let context = null;
    let analyser = null;
    // The left and right channels, or null where they could not be split:
    // the meters then read the mixed wave in both.
    let channels = null;
    let freq = null;
    let wave = null;
    const left = new Float32Array(CHANNEL_SAMPLES);
    const right = new Float32Array(CHANNEL_SAMPLES);
    // The cover first: the visualizer is asked for by the viewer.
    let mode = 'off';
    // What a click on the cover brings back.
    let lastShown = DEFAULT_MODE;
    let isPlaying = false;
    let rafId = 0;
    let last = 0;
    const surfaces = [];
    const palette = meters.spectrogramPalette();

    // Only while a display is shown: the view reduced, nothing is drawn, so
    // nothing is computed either; opening it calls refresh().
    const schedule = () => {
        if (!rafId && analyser && mode !== 'off' && isSupported() && surfaces.some(surface => surface.isShown())) {
            rafId = win().requestAnimationFrame(frame); // eslint-disable-line no-use-before-define
        }
    };

    // The two channels, each to its own analyser. A mono track is spread to
    // both first: a splitter alone would leave the right one silent.
    const splitChannels = source => {
        try {
            const stereo = context.createGain();
            stereo.channelCount = 2;
            stereo.channelCountMode = 'explicit';
            stereo.channelInterpretation = 'speakers';
            const splitter = context.createChannelSplitter(2);
            source.connect(stereo);
            stereo.connect(splitter);
            return [0, 1].map(channel => {
                const node = context.createAnalyser();
                node.fftSize = CHANNEL_SAMPLES;
                splitter.connect(node, channel);
                return node;
            });
        } catch {
            return null;
        }
    };

    // Connects the track to an analyser once the audio context runs: the
    // track would go silent through a suspended one. Only once a mode is
    // chosen: the connection cannot be undone, and until then the track
    // plays outside Web Audio. Asked again on each play and mode change, so
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
                node.fftSize = viz.FFT_SIZE;
                node.minDecibels = -85;
                node.maxDecibels = -20;
                node.smoothingTimeConstant = 0.5;
                const source = context.createMediaElementSource(audio);
                source.connect(node);
                node.connect(context.destination);
                channels = splitChannels(source);
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

    const binHz = () => context.sampleRate / analyser.fftSize;

    // The wave of the last SCOPE_SAMPLES, bytes with 128 at rest.
    const scopeWave = () => wave.subarray(Math.max(0, wave.length - SCOPE_SAMPLES));

    // `style`: one of viz.ANALYSER_STYLES; `layout`: thick or thin bands.
    const drawSpectrum = (surface, dt, style, layout) => {
        const {ctx, rows} = surface;
        const levels = viz.bandLevels(freq, binHz(), layout.edges);
        const isMoving = viz.fall(layout.fall, levels, dt);
        layout.fall.bars.forEach((level, idx) => {
            const height = Math.round(level * rows);
            if (!height) {
                return;
            }
            const x = idx * layout.step;
            const top = rows - height;
            if (style === 'line') {
                ctx.fillStyle = surface.rowColors[viz.paletteRow(style, top, top, rows)];
                ctx.fillRect(x, top, layout.width, height);
            } else if (style === 'fire') {
                // The gradient moves with the bar: its top is always red.
                ctx.save();
                ctx.translate(0, top);
                ctx.fillStyle = surface.gradient;
                ctx.fillRect(x, 0, layout.width, height);
                ctx.restore();
            } else {
                ctx.fillStyle = surface.gradient;
                ctx.fillRect(x, top, layout.width, height);
            }
        });
        ctx.fillStyle = viz.PEAK_COLOR;
        layout.fall.peaks.forEach((peak, idx) => {
            const top = rows - Math.round(peak * rows);
            if (peak > 0) {
                ctx.fillRect(idx * layout.step, Math.min(rows - 1, top), layout.width, 1);
            }
        });
        return isMoving;
    };

    // One column per pixel. "lines" joins each sample to the previous one so
    // the wave reads as a line even where it jumps, "dots" draws the samples
    // alone, "solid" fills from the middle line to the wave.
    const drawScope = (surface, style) => {
        const {ctx, rows, width} = surface;
        const samples = scopeWave();
        const middle = Math.round((rows - 1) / 2);
        let previous = null;
        for (let x = 0; x < width; x += 1) {
            const sample = samples[Math.floor(x * samples.length / width)];
            const y = Math.round(sample / 255 * (rows - 1));
            let from = y;
            let to = y;
            if (style === 'solid') {
                from = Math.min(middle, y);
                to = Math.max(middle, y);
            } else if (style === 'lines' && previous !== null) {
                from = Math.min(previous, y);
                to = Math.max(previous, y);
            }
            ctx.fillStyle = viz.scopeColor(Math.abs(sample - 128) / 128);
            ctx.fillRect(x, from, 1, to - from + 1);
            previous = y;
        }
        return false;
    };

    // Time runs while it plays; paused, the picture fades for TRAIL_REST,
    // then the drawing stops and is cleared. `onLive(dt)`: the step of a
    // playing frame.
    const restStep = (surface, dt, isLive, onLive) => {
        const trip = surface.trip;
        if (isLive) {
            trip.rest = 0;
            onLive(dt);
            return true;
        }
        trip.rest += dt;
        if (trip.rest >= TRAIL_REST) {
            surface.ctx.clearRect(0, 0, surface.width, surface.rows);
            return false;
        }
        return true;
    };

    // The trip moves with the music while it plays.
    const tripStep = (surface, dt, isLive) => restStep(surface, dt, isLive, step => {
        viz.advanceTrip(surface.trip, viz.energies(freq, binHz()), step);
    });

    // One new column a frame, bass at the bottom; paused, it stands still.
    const drawSpectrogram = (surface, dt, isLive) => {
        const {ctx, width, rows} = surface;
        if (!isLive) {
            return false;
        }
        if (!surface.spectrogram) {
            surface.spectrogram = ctx.createImageData(width, rows);
        }
        const levels = viz.bandLevels(freq, binHz(), surface.rowEdges);
        meters.scrollSpectrogram(surface.spectrogram.data, width, rows, levels, palette);
        ctx.putImageData(surface.spectrogram, 0, 0);
        return false;
    };

    // One meter on the `top` half-height band of the surface, its needle at
    // `position`, its channel named `name`.
    const drawMeter = (surface, top, height, position, name) => {
        const {ctx, width} = surface;
        const pivotX = width / 2;
        const pivotY = top + height * 1.3;
        const radius = height * 1.15;
        const pointAt = (angle, distance) => [pivotX + Math.sin(angle) * distance, pivotY - Math.cos(angle) * distance];
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, width, height);
        ctx.clip();
        ctx.fillStyle = VU_FACE;
        ctx.fillRect(0, top, width, height);
        ctx.lineWidth = 1;
        meters.VU_MARKS.forEach(mark => {
            const angle = meters.vuAngle(meters.vuPosition(mark));
            ctx.strokeStyle = mark > 0 ? VU_RED : VU_SCALE;
            ctx.beginPath();
            ctx.moveTo(...pointAt(angle, radius * 0.86));
            ctx.lineTo(...pointAt(angle, radius * (mark % 5 ? 0.92 : 0.96)));
            ctx.stroke();
        });
        ctx.strokeStyle = VU_NEEDLE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(...pointAt(meters.vuAngle(position), radius * 0.98));
        ctx.stroke();
        ctx.fillStyle = VU_SCALE;
        ctx.font = '9px monospace';
        ctx.fillText(name, 4, top + height - 4);
        ctx.restore();
    };

    // The left channel above, the right one below.
    const drawVu = (surface, dt) => {
        const half = Math.floor(surface.rows / 2);
        surface.vu = surface.vu.map((position, channel) => meters.vuNeedle(position, channel ? right : left, dt));
        drawMeter(surface, 0, half, surface.vu[0], 'L');
        drawMeter(surface, surface.rows - half, half, surface.vu[1], 'R');
        return surface.vu.some(position => position > VU_REST);
    };

    // The channels as points over the glow of the last frames.
    const drawVectorscope = (surface, dt, isLive) => {
        const {ctx, width, rows} = surface;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${PHOSPHOR_FADE})`;
        ctx.fillRect(0, 0, width, rows);
        ctx.restore();
        return restStep(surface, dt, isLive, () => {
            ctx.fillStyle = VECTOR_COLOR;
            meters.vectorPoints(left, right, VECTOR_POINTS, width * 0.45).forEach(point => {
                ctx.fillRect(Math.round(width / 2 + point.x), Math.round(rows / 2 + point.y), 1, 1);
            });
        });
    };

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
        viz.ringPoints(scopeWave(), RING_POINTS, size * 0.3, size * 0.15).forEach((point, idx) => {
            ctx.fillStyle = viz.hueColor(trip.hue + idx * 360 / RING_POINTS);
            ctx.fillRect(Math.round(size / 2 + point.x) - 1, Math.round(size / 2 + point.y) - 1, 2, 2);
        });
        return true;
    };

    // Each mode's drawing, `(surface, dt, isLive)` to whether it still moves.
    const DRAW = {
        spectrum: (surface, dt) => drawSpectrum(surface, dt, 'normal', surface.thick),
        spectrumFire: (surface, dt) => drawSpectrum(surface, dt, 'fire', surface.thick),
        spectrumLine: (surface, dt) => drawSpectrum(surface, dt, 'line', surface.thick),
        spectrumThin: (surface, dt) => drawSpectrum(surface, dt, 'normal', surface.thin),
        scope: surface => drawScope(surface, 'lines'),
        scopeDots: surface => drawScope(surface, 'dots'),
        scopeSolid: surface => drawScope(surface, 'solid'),
        spectrogram: drawSpectrogram,
        vu: drawVu,
        vectorscope: drawVectorscope,
        plasma: drawPlasma,
        kaleido: drawKaleido,
        vortex: drawVortex
    };
    // These draw over their own last frame; the others start from a clear one.
    const KEEPS_CANVAS = [...PSYCHEDELIC, 'spectrogram', 'vectorscope'];
    const USES_CHANNELS = ['vu', 'vectorscope'];

    const prepare = surface => {
        if (!surface.ctx) {
            surface.ctx = surface.canvas.getContext('2d');
            // Hard stops: one flat colour per pixel row, like the skin.
            const gradient = surface.ctx.createLinearGradient(0, 0, 0, surface.rows);
            surface.rowColors = [];
            for (let row = 0; row < surface.rows; row += 1) {
                const color = viz.spectrumColor(row, surface.rows);
                gradient.addColorStop(row / surface.rows, color);
                gradient.addColorStop((row + 1) / surface.rows, color);
                surface.rowColors.push(color);
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

    // The channels as floats, or the mixed wave in both where they could
    // not be split; silence while paused.
    const readChannels = isLive => {
        if (!isLive) {
            left.fill(0);
            right.fill(0);
        } else if (channels) {
            channels[0].getFloatTimeDomainData(left);
            channels[1].getFloatTimeDomainData(right);
        } else {
            const offset = wave.length - CHANNEL_SAMPLES;
            for (let idx = 0; idx < CHANNEL_SAMPLES; idx += 1) {
                left[idx] = (wave[offset + idx] - 128) / 128;
                right[idx] = left[idx];
            }
        }
    };

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
        if (USES_CHANNELS.includes(mode)) {
            readChannels(isLive);
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
            if (!KEEPS_CANVAS.includes(mode)) {
                ctx.clearRect(0, 0, surface.width, surface.rows);
            }
            isMoving = DRAW[mode](surface, dt, isLive) || isMoving;
        });
        if (isLive || isMoving) {
            schedule();
        }
    }

    function resetSurface(surface) {
        surface.trip = Object.assign(viz.createTrip(), {rest: 0, drawn: false});
        surface.spectrogram = null;
        surface.vu = [0, 0];
    }

    const isAllowed = value => viz.allowedModes(prefersReducedMotion()).includes(value);

    // Each mode starts on a clean canvas.
    function switchTo(value) {
        mode = value;
        if (value !== 'off') {
            lastShown = value;
        }
        clear();
        surfaces.forEach(resetSurface);
        schedule();
    }

    // A change by the viewer: shown, connected if the track plays (the
    // click or the menu lets the browser start the audio context), saved.
    const change = value => {
        if (!isSupported() || !isAllowed(value) || value === mode) {
            return;
        }
        switchTo(value);
        if (isPlaying) {
            activate();
        }
        onModeChange(mode);
    };

    // The cover's click: the last display shown, or the cover again.
    const toggle = () => change(mode === 'off' ? isAllowed(lastShown) && lastShown || DEFAULT_MODE : 'off');

    const layoutOf = (bars, step, width) => ({bars, step, width, edges: viz.bandEdges(bars), fall: viz.createFallState(bars)});

    // `button`: holds the canvas and shows or hides the display on click;
    // its owner names it from `label`, and only once it is a button: a label
    // on a plain element is invalid HTML. `bars` 3-pixel bars of `rows`
    // pixels; `isShown()`: whether to draw it now.
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
            thick: layoutOf(bars, BAR_STEP, BAR_WIDTH),
            thin: layoutOf(width, 1, 1),
            rowEdges: viz.bandEdges(rows),
            kaleidoEdges: viz.bandEdges(KALEIDO_BANDS)
        };
        resetSurface(surface);
        surfaces.push(surface);
        button.addEventListener('click', toggle);
    };

    const setPlaying = playing => {
        isPlaying = playing;
        schedule();
    };

    // A saved mode; a psychedelic one gives way to the cover under reduced
    // motion.
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
        // The viewer's pick in the menu.
        choose: change,
        get mode() {
            return mode;
        },
        // What a click on the display does, for its title.
        get label() {
            return mode === 'off' ? i18n.t('vizShow', i18n.t(MODE_LABELS[isAllowed(lastShown) ? lastShown : DEFAULT_MODE])) : i18n.t('vizShowCover');
        },
        // The menu: the cover, then each group's allowed modes, translated.
        get choices() {
            const allowed = viz.allowedModes(prefersReducedMotion());
            const option = value => ({value, label: i18n.t(MODE_LABELS[value])});
            return [
                {label: null, options: [option('off')]},
                ...GROUPS.map(group => ({
                    label: i18n.t(GROUP_LABELS[group.name]),
                    options: group.modes.filter(value => allowed.includes(value)).map(option)
                })).filter(group => group.options.length)
            ];
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
