import { CONFIG } from '../config/constants.js';

const AUDIO = CONFIG.AUDIO;
const MIN_GAIN = 0.0001;
const SOURCE_TAIL_S = 0.02;
const VOICE_TAIL_S = 0.05;
const MAX_DELAY_S = 2;
const NORMALIZED = Symbol('normalizedSoundSpec');

const WAVES = new Set(['sine', 'square', 'sawtooth', 'triangle']);
const NOISE_COLORS = new Set(['white', 'pink', 'brown']);
const LAYER_KINDS = new Set(['tone', 'noise', 'fm']);
const SWEEP_CURVES = new Set(['exp', 'lin']);
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass']);
const DEFAULT_ENVELOPE = Object.freeze({ attack: 0.002, decay: 0.05, sustain: 0.7, release: 0.05 });
const NOTE_OFFSETS = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

/**
 * Formato declarativo de um som sintetizado (tempos em segundos, frequências em Hz ou nota "A4"/"C#5"/"Eb3").
 *
 * @typedef {Object} SoundSpec
 * @property {Layer[]} layers                 camadas mixadas (ao menos 1)
 * @property {number} [duration=0.2]          duração base de cada nota
 * @property {string} [bus='sfx']             CONFIG.AUDIO.BUS.*
 * @property {number} [volume=1]              0..2
 * @property {number} [pan=0]                 -1 (esq.) .. 1 (dir.)
 * @property {number} [cooldown=0]            intervalo mínimo entre repetições (anti-spam)
 * @property {number} [pitchJitter=0]         variação aleatória de altura por disparo (± semitons)
 * @property {number} [volumeJitter=0]        variação aleatória de volume por disparo (0..1)
 * @property {Envelope} [envelope]            envelope padrão das camadas
 * @property {Filter} [filter]                filtro sobre a mixagem inteira
 * @property {number} [distortion=0]          saturação 0..1
 * @property {{ delay: number, feedback: number, mix: number }} [echo]
 * @property {{ at: number, semitones?: number, volume?: number, duration?: number }[]} [notes]
 * @property {{ step: number, semitones: number[], volumes?: number[] }} [sequence]  atalho para notes
 *
 * @typedef {Object} Layer
 * @property {'tone'|'noise'|'fm'} [kind='tone']
 * @property {number} [gain=1]
 * @property {number} [delay=0]               atraso da camada dentro da nota
 * @property {number} [duration]              padrão: duração da nota menos o atraso
 * @property {Envelope} [envelope]
 * @property {Filter} [filter]                filtro da camada (acompanha a transposição)
 * @property {string} [wave='sine']           tone/fm: sine | square | sawtooth | triangle
 * @property {number|string} [freq]           tone/fm (obrigatório)
 * @property {number|string} [freqEnd]        glissando até esta frequência
 * @property {number} [sweepTime]             padrão: duração da camada
 * @property {'exp'|'lin'} [sweepCurve='exp']
 * @property {number} [detune=0]              cents
 * @property {{ rate: number, depth: number }} [vibrato]  depth em cents
 * @property {{ rate: number, depth: number }} [tremolo]  depth 0..0.5
 * @property {number} [modRatio=2]            fm: frequência do modulador / portadora
 * @property {number} [modIndex=1]            fm: profundidade inicial
 * @property {number} [modIndexEnd]           fm: profundidade final
 * @property {'white'|'pink'|'brown'} [color='white']  noise
 * @property {number} [rate=1]                noise: velocidade de leitura (clareia/escurece)
 *
 * @typedef {{ attack: number, decay: number, sustain: number, release: number }} Envelope
 * @typedef {{ type: string, freq: number|string, freqEnd?: number|string, time?: number, q?: number, gain?: number }} Filter
 */

/** "A4" -> 440 Hz. Aceita sustenido (#) e bemol (b). */
export function noteToFreq(note) {
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note);
    if (!m) throw new Error(`nota inválida "${note}" (use ex.: "A4", "C#5", "Eb3")`);
    const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    const midi = NOTE_OFFSETS[m[1].toUpperCase()] + accidental + (Number(m[3]) + 1) * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

export function semitoneRatio(semitones) {
    return Math.pow(2, semitones / 12);
}

/** Leva um AudioParam até `value` em `seconds` (0 = instantâneo), partindo de `from`. */
export function rampParam(ctx, param, value, seconds, from = param.value) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    if (seconds > 0) {
        param.setValueAtTime(from, now);
        param.linearRampToValueAtTime(value, now + seconds);
    } else {
        param.setValueAtTime(value, now);
    }
}

// --- Normalização (roda uma vez por preset, no registro) ---------------------

function num(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}

function toHz(value, where) {
    if (typeof value === 'string') return noteToFreq(value);
    if (Number.isFinite(value) && value > 0) return value;
    throw new Error(`${where}: frequência inválida (${value})`);
}

function optionalHz(value, where) {
    return value === undefined || value === null ? 0 : toHz(value, where);
}

function normEnvelope(env) {
    if (!env) return null;
    return Object.freeze({
        attack: Math.max(0, num(env.attack, DEFAULT_ENVELOPE.attack)),
        decay: Math.max(0, num(env.decay, DEFAULT_ENVELOPE.decay)),
        sustain: clamp(num(env.sustain, DEFAULT_ENVELOPE.sustain), 0, 1),
        release: Math.max(0, num(env.release, DEFAULT_ENVELOPE.release))
    });
}

function normFilter(filter, where) {
    if (!filter) return null;
    if (!FILTER_TYPES.has(filter.type)) throw new Error(`${where}.filter: tipo inválido "${filter.type}"`);
    return Object.freeze({
        type: filter.type,
        freq: toHz(filter.freq, `${where}.filter.freq`),
        freqEnd: optionalHz(filter.freqEnd, `${where}.filter.freqEnd`),
        time: Number.isFinite(filter.time) ? Math.max(0, filter.time) : -1,
        q: Math.max(0.0001, num(filter.q, 1)),
        gain: num(filter.gain, 0)
    });
}

function normModulation(mod, maxDepth) {
    if (!mod) return null;
    const rate = num(mod.rate, 0);
    if (rate <= 0) return null;
    return Object.freeze({ rate, depth: clamp(num(mod.depth, 0), 0, maxDepth) });
}

function normLayer(layer, where) {
    const kind = layer.kind || 'tone';
    if (!LAYER_KINDS.has(kind)) throw new Error(`${where}: kind inválido "${kind}"`);

    const base = {
        kind,
        gain: clamp(num(layer.gain, 1), 0, 4),
        delay: Math.max(0, num(layer.delay, 0)),
        duration: Number.isFinite(layer.duration) && layer.duration > 0 ? layer.duration : 0,
        envelope: normEnvelope(layer.envelope),
        filter: normFilter(layer.filter, where),
        vibrato: normModulation(layer.vibrato, 2400),
        tremolo: normModulation(layer.tremolo, 0.5),
        wave: 'sine',
        freq: 0,
        freqEnd: 0,
        sweepTime: -1,
        sweepCurve: 'exp',
        detune: 0,
        modRatio: 2,
        modIndex: 1,
        modIndexEnd: 1,
        modWave: 'sine',
        color: 'white',
        rate: 1
    };

    if (kind === 'noise') {
        const color = layer.color || 'white';
        if (!NOISE_COLORS.has(color)) throw new Error(`${where}: cor de ruído inválida "${color}"`);
        base.color = color;
        base.rate = clamp(num(layer.rate, 1), 0.05, 8);
        return Object.freeze(base);
    }

    const wave = layer.wave || 'sine';
    if (!WAVES.has(wave)) throw new Error(`${where}: forma de onda inválida "${wave}"`);
    const curve = layer.sweepCurve || 'exp';
    if (!SWEEP_CURVES.has(curve)) throw new Error(`${where}: sweepCurve inválida "${curve}"`);

    base.wave = wave;
    base.freq = toHz(layer.freq, `${where}.freq`);
    base.freqEnd = optionalHz(layer.freqEnd, `${where}.freqEnd`);
    base.sweepTime = Number.isFinite(layer.sweepTime) ? Math.max(0.001, layer.sweepTime) : -1;
    base.sweepCurve = curve;
    base.detune = num(layer.detune, 0);

    if (kind === 'fm') {
        const modWave = layer.modWave || 'sine';
        if (!WAVES.has(modWave)) throw new Error(`${where}: modWave inválida "${modWave}"`);
        base.modWave = modWave;
        base.modRatio = Math.max(0.01, num(layer.modRatio, 2));
        base.modIndex = Math.max(0, num(layer.modIndex, 1));
        base.modIndexEnd = Math.max(0, num(layer.modIndexEnd, base.modIndex));
    }
    return Object.freeze(base);
}

function normNotes(notes, sequence, where) {
    if (Array.isArray(notes) && notes.length > 0) {
        return Object.freeze(notes.map((n) => Object.freeze({
            at: Math.max(0, num(n.at, 0)),
            semitones: num(n.semitones, 0),
            volume: clamp(num(n.volume, 1), 0, 4),
            duration: Number.isFinite(n.duration) && n.duration > 0 ? n.duration : 0
        })));
    }
    if (sequence) {
        const steps = sequence.semitones;
        if (!Array.isArray(steps) || steps.length === 0) throw new Error(`${where}.sequence: semitones vazio`);
        const step = Math.max(0, num(sequence.step, 0.1));
        const volumes = Array.isArray(sequence.volumes) ? sequence.volumes : null;
        return Object.freeze(steps.map((semitones, i) => Object.freeze({
            at: i * step,
            semitones: num(semitones, 0),
            volume: clamp(num(volumes ? volumes[i] : 1, 1), 0, 4),
            duration: 0
        })));
    }
    return Object.freeze([Object.freeze({ at: 0, semitones: 0, volume: 1, duration: 0 })]);
}

/**
 * Valida e completa um SoundSpec. Lança Error com o caminho do campo inválido.
 * @param {string} name
 * @param {SoundSpec} raw
 */
export function normalizeSpec(name, raw) {
    if (raw && raw[NORMALIZED]) return raw;
    if (!raw || !Array.isArray(raw.layers) || raw.layers.length === 0) {
        throw new Error(`"${name}" precisa de ao menos 1 layer`);
    }
    const duration = num(raw.duration, 0.2);
    if (duration <= 0) throw new Error(`"${name}": duration deve ser > 0`);

    const echo = raw.echo ? Object.freeze({
        delay: clamp(num(raw.echo.delay, 0.15), 0.001, MAX_DELAY_S),
        feedback: clamp(num(raw.echo.feedback, 0.3), 0, 0.95),
        mix: clamp(num(raw.echo.mix, 0.3), 0, 1)
    }) : null;

    const spec = {
        name,
        bus: raw.bus || AUDIO.BUS.SFX,
        duration,
        volume: clamp(num(raw.volume, 1), 0, 2),
        pan: clamp(num(raw.pan, 0), -1, 1),
        cooldown: Math.max(0, num(raw.cooldown, 0)),
        pitchJitter: Math.max(0, num(raw.pitchJitter, 0)),
        volumeJitter: clamp(num(raw.volumeJitter, 0), 0, 1),
        envelope: normEnvelope(raw.envelope) || DEFAULT_ENVELOPE,
        filter: normFilter(raw.filter, name),
        distortion: clamp(num(raw.distortion, 0), 0, 1),
        echo,
        layers: Object.freeze(raw.layers.map((layer, i) => normLayer(layer || {}, `${name}.layers[${i}]`))),
        notes: normNotes(raw.notes, raw.sequence, name),
        [NORMALIZED]: true
    };
    return Object.freeze(spec);
}

// --- Renderização (grafo Web Audio por disparo) ------------------------------

/**
 * @typedef {{ volume: number, pitch: number, pan: number, delay: number, timeScale: number }} RenderOptions
 * @typedef {{ output: GainNode, nodes: AudioNode[], sources: AudioScheduledSourceNode[], endTime: number }} RenderedVoice
 */

/**
 * SynthRenderer - transforma um SoundSpec normalizado em nós Web Audio agendados no relógio do AudioContext.
 * Buffers de ruído e curvas de distorção são gerados uma vez e reaproveitados.
 */
export class SynthRenderer {
    /** @param {AudioContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.maxHz = (ctx.sampleRate / 2) * 0.98;
        this.noiseBuffers = new Map();
        this.curves = new Map();
    }

    clampHz(hz) {
        return hz < 1 ? 1 : hz > this.maxHz ? this.maxHz : hz;
    }

    noiseBuffer(color) {
        const cached = this.noiseBuffers.get(color);
        if (cached) return cached;

        const ctx = this.ctx;
        const length = Math.floor(ctx.sampleRate * AUDIO.NOISE_BUFFER_S);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        if (color === 'pink') {
            // Filtro de Paul Kellet (aproximação -3 dB/oitava)
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.969 * b2 + white * 0.153852;
                b3 = 0.8665 * b3 + white * 0.3104856;
                b4 = 0.55 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.016898;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
            }
        } else if (color === 'brown') {
            let last = 0;
            for (let i = 0; i < length; i++) {
                last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
                data[i] = last * 3.5;
            }
        } else {
            for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        }

        this.noiseBuffers.set(color, buffer);
        return buffer;
    }

    /** Curva de saturação normalizada (pico = 1), cacheada em passos de 0.05. */
    distortionCurve(amount) {
        const key = Math.max(1, Math.round(amount * 20));
        const cached = this.curves.get(key);
        if (cached) return cached;

        const k = key * 5;
        const n = 2048;
        const deg = Math.PI / 180;
        const curve = new Float32Array(n);
        const peak = ((3 + k) * 20 * deg) / (Math.PI + k);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x)) / peak;
        }
        this.curves.set(key, curve);
        return curve;
    }

    /**
     * @param {SoundSpec} spec normalizado
     * @param {RenderOptions} opts
     * @param {AudioNode} destination barramento
     * @returns {RenderedVoice}
     */
    render(spec, opts, destination) {
        const ctx = this.ctx;
        const ts = opts.timeScale;
        const t0 = ctx.currentTime + AUDIO.START_LOOKAHEAD_S + opts.delay;
        const nodes = [];
        const sources = [];

        const jitter = spec.pitchJitter > 0 ? (Math.random() * 2 - 1) * spec.pitchJitter : 0;
        const baseRatio = semitoneRatio(opts.pitch + jitter);
        const volume = spec.volume * opts.volume * (1 - Math.random() * spec.volumeJitter);

        const output = ctx.createGain();
        output.gain.value = volume;
        const mix = ctx.createGain();
        nodes.push(output, mix);

        let tail = mix;
        if (spec.filter) {
            const filter = this.createFilter(spec.filter, t0, spec.duration * ts, ts, 1);
            tail.connect(filter);
            tail = filter;
            nodes.push(filter);
        }
        if (spec.distortion > 0) {
            const shaper = ctx.createWaveShaper();
            shaper.curve = this.distortionCurve(spec.distortion);
            shaper.oversample = '2x';
            tail.connect(shaper);
            tail = shaper;
            nodes.push(shaper);
        }
        const pan = clamp(spec.pan + opts.pan, -1, 1);
        if (pan !== 0) {
            const panner = ctx.createStereoPanner();
            panner.pan.value = pan;
            tail.connect(panner);
            tail = panner;
            nodes.push(panner);
        }
        tail.connect(output);

        let echoTail = 0;
        if (spec.echo) {
            const delayTime = Math.min(MAX_DELAY_S, spec.echo.delay * ts);
            const delay = ctx.createDelay(MAX_DELAY_S);
            const feedback = ctx.createGain();
            const wet = ctx.createGain();
            delay.delayTime.value = delayTime;
            feedback.gain.value = spec.echo.feedback;
            wet.gain.value = spec.echo.mix;
            tail.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(wet);
            wet.connect(output);
            nodes.push(delay, feedback, wet);
            // Tempo até o eco cair ~60 dB
            const repeats = spec.echo.feedback > 0 ? Math.log(0.001) / Math.log(spec.echo.feedback) : 1;
            echoTail = Math.min(AUDIO.MAX_ECHO_TAIL_S, delayTime * (repeats + 1));
        }
        output.connect(destination);

        let end = t0;
        const notes = spec.notes;
        const layers = spec.layers;
        for (let n = 0; n < notes.length; n++) {
            const note = notes[n];
            const noteStart = t0 + note.at * ts;
            const ratio = baseRatio * semitoneRatio(note.semitones);
            for (let l = 0; l < layers.length; l++) {
                const layer = layers[l];
                const start = noteStart + layer.delay * ts;
                const rawDuration = note.duration || layer.duration || Math.max(0.01, spec.duration - layer.delay);
                const layerEnd = this.renderLayer(spec, layer, start, rawDuration * ts, ts, ratio, note.volume, mix, nodes, sources);
                if (layerEnd > end) end = layerEnd;
            }
        }

        return { output, nodes, sources, endTime: end + echoTail + VOICE_TAIL_S };
    }

    renderLayer(spec, layer, start, duration, ts, ratio, noteVolume, destination, nodes, sources) {
        const ctx = this.ctx;
        const stopAt = start + duration + SOURCE_TAIL_S;

        const amp = ctx.createGain();
        nodes.push(amp);
        applyEnvelope(amp.gain, start, duration, layer.envelope || spec.envelope, ts, layer.gain * noteVolume);
        amp.connect(destination);

        let input = amp;
        if (layer.filter) {
            const filter = this.createFilter(layer.filter, start, duration, ts, ratio);
            filter.connect(input);
            input = filter;
            nodes.push(filter);
        }
        if (layer.tremolo) {
            const tremolo = ctx.createGain();
            tremolo.gain.value = 1 - layer.tremolo.depth;
            tremolo.connect(input);
            input = tremolo;
            nodes.push(tremolo);
            this.createLfo(layer.tremolo.rate, layer.tremolo.depth, tremolo.gain, start, stopAt, nodes, sources);
        }

        if (layer.kind === 'noise') {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseBuffer(layer.color);
            noise.loop = true;
            noise.playbackRate.value = layer.rate * ratio;
            noise.connect(input);
            noise.start(start, Math.random() * noise.buffer.duration);
            noise.stop(stopAt);
            nodes.push(noise);
            sources.push(noise);
            return stopAt;
        }

        const osc = ctx.createOscillator();
        osc.type = layer.wave;
        osc.detune.value = layer.detune;
        const endHz = this.scheduleFrequency(osc.frequency, layer, start, duration, ts, ratio, 1);
        if (layer.vibrato) this.createLfo(layer.vibrato.rate, layer.vibrato.depth, osc.detune, start, stopAt, nodes, sources);
        osc.connect(input);
        osc.start(start);
        osc.stop(stopAt);
        nodes.push(osc);
        sources.push(osc);

        if (layer.kind === 'fm') {
            const modulator = ctx.createOscillator();
            const depth = ctx.createGain();
            modulator.type = layer.modWave;
            this.scheduleFrequency(modulator.frequency, layer, start, duration, ts, ratio, layer.modRatio);
            const startHz = this.clampHz(layer.freq * ratio);
            depth.gain.setValueAtTime(layer.modIndex * startHz * layer.modRatio, start);
            depth.gain.linearRampToValueAtTime(layer.modIndexEnd * endHz * layer.modRatio, start + duration);
            modulator.connect(depth);
            depth.connect(osc.frequency);
            modulator.start(start);
            modulator.stop(stopAt);
            nodes.push(modulator, depth);
            sources.push(modulator);
        }
        return stopAt;
    }

    /** @returns {number} frequência final da portadora (para acompanhar o índice de FM) */
    scheduleFrequency(param, layer, start, duration, ts, ratio, multiplier) {
        const startHz = this.clampHz(layer.freq * ratio * multiplier);
        param.setValueAtTime(startHz, start);
        if (!layer.freqEnd) return this.clampHz(layer.freq * ratio);

        const endHz = this.clampHz(layer.freqEnd * ratio * multiplier);
        const sweep = layer.sweepTime > 0 ? Math.min(layer.sweepTime * ts, duration) : duration;
        if (layer.sweepCurve === 'lin') param.linearRampToValueAtTime(endHz, start + sweep);
        else param.exponentialRampToValueAtTime(endHz, start + sweep);
        return this.clampHz(layer.freqEnd * ratio);
    }

    createFilter(filter, start, duration, ts, tracking) {
        const node = this.ctx.createBiquadFilter();
        node.type = filter.type;
        node.Q.value = filter.q;
        node.gain.value = filter.gain;
        node.frequency.setValueAtTime(this.clampHz(filter.freq * tracking), start);
        if (filter.freqEnd) {
            const sweep = filter.time >= 0 ? filter.time * ts : duration;
            node.frequency.exponentialRampToValueAtTime(this.clampHz(filter.freqEnd * tracking), start + Math.max(0.001, sweep));
        }
        return node;
    }

    createLfo(rate, depth, target, start, stopAt, nodes, sources) {
        const lfo = this.ctx.createOscillator();
        const amount = this.ctx.createGain();
        lfo.frequency.value = rate;
        amount.gain.value = depth;
        lfo.connect(amount);
        amount.connect(target);
        lfo.start(start);
        lfo.stop(stopAt);
        nodes.push(lfo, amount);
        sources.push(lfo);
    }
}

/**
 * ADSR que sempre cabe na duração: se attack+decay+release passar dela, os três encolhem proporcionalmente.
 */
function applyEnvelope(param, start, duration, env, ts, peak) {
    let attack = env.attack * ts;
    let decay = env.decay * ts;
    let release = env.release * ts;
    const total = attack + decay + release;
    if (total > duration) {
        const k = duration / total;
        attack *= k;
        decay *= k;
        release *= k;
    }

    const top = Math.max(MIN_GAIN, peak);
    const sustain = Math.max(MIN_GAIN, top * env.sustain);

    if (attack > 0) {
        param.setValueAtTime(MIN_GAIN, start);
        param.linearRampToValueAtTime(top, start + attack);
    } else {
        param.setValueAtTime(top, start);
    }
    if (decay > 0) param.exponentialRampToValueAtTime(sustain, start + attack + decay);
    else param.setValueAtTime(sustain, start + attack);

    const releaseStart = start + duration - release;
    param.setValueAtTime(sustain, releaseStart);
    if (release > 0) param.exponentialRampToValueAtTime(MIN_GAIN, start + duration);
    else param.setValueAtTime(MIN_GAIN, start + duration);
}
