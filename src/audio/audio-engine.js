import { CONFIG } from '../config/constants.js';
import { SOUND_PRESETS } from '../config/sound-presets.js';
import { SynthRenderer, normalizeSpec, rampParam, semitoneRatio } from './synth.js';
import { AudioTrack } from './audio-track.js';
import { MusicPlayer } from './music-player.js';
import { rankSources } from './audio-sources.js';

const AUDIO = CONFIG.AUDIO;
const { BUS } = AUDIO;
// pointerdown de toque NÃO conta como ativação do usuário; pointerup/touchend/click contam
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
const EMPTY_OPTIONS = Object.freeze({});

function num(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * @typedef {Object} PlayOptions
 * @property {number} [volume=1]        multiplicador do volume do preset
 * @property {number} [pitch=0]         transposição em semitons (+12 = uma oitava acima)
 * @property {number} [pan=0]           -1..1 somado ao pan do preset
 * @property {number} [delay=0]         atraso em segundos (agendado no relógio de áudio, preciso)
 * @property {'SHORT'|'MEDIUM'|'LONG'} [length]  escala de tempo nomeada (CONFIG.AUDIO.LENGTH_SCALE)
 * @property {number} [timeScale]       escala de tempo livre (tem prioridade sobre length)
 * @property {string} [bus]             sobrescreve o barramento do preset
 *
 * @typedef {Object} SampleOptions
 * @property {number} [volume=1]
 * @property {number} [pitch=0]         semitons
 * @property {number} [rate=1]          velocidade (multiplica com pitch)
 * @property {number} [pan=0]
 * @property {number} [delay=0]
 * @property {number} [offset=0]        começa a partir deste ponto do arquivo (s)
 * @property {boolean} [loop=false]     loop sem emenda (gapless), até stop(id)
 * @property {number} [fadeIn=0]
 * @property {string} [bus='sfx']
 */

/**
 * AudioEngine - fachada única de áudio do jogo.
 *
 *  - Sons sintetizados em tempo real a partir de presets declarativos (SOUND_PRESETS / SoundSpec):
 *    play(SFX.CLASH), play(SFX.CLASH, { length: 'LONG', pitch: -3 }), playSpec({...}) para sons ad hoc.
 *  - Samples curtos decodificados em memória: loadSample(name, urls) + playSample(name, opts).
 *  - Arquivos longos por streaming com controle total: createTrack(urls) ou music.play(name).
 *  - Barramentos master/music/sfx/ui com volume e mute; limitador no master evita clipping.
 *  - Teto de vozes simultâneas (a mais antiga é cortada com fade curto) e cooldown por preset.
 *  - Autoplay: nada soa antes do 1º gesto; música pedida antes disso começa dentro do gesto.
 *  - Aba escondida: suspende tudo (bateria) e retoma ao voltar. Interrupções do iOS se recuperam no próximo toque.
 *
 * Custo: cada disparo cria um pequeno grafo de nós nativos (a API exige nós novos por disparo). Os disparos
 * são por evento, nunca por frame; buffers de ruído e curvas de distorção são gerados uma vez só.
 */
export class AudioEngine {
    /** @param {Record<string, import('./synth.js').SoundSpec>} [presets] */
    constructor(presets = SOUND_PRESETS) {
        this.supported = typeof window !== 'undefined' && typeof window.AudioContext === 'function';
        this.ctx = null;
        this.synth = null;
        this.buses = null;
        this.limiter = null;

        this.volumes = {
            [BUS.MASTER]: AUDIO.VOLUME.MASTER,
            [BUS.MUSIC]: AUDIO.VOLUME.MUSIC,
            [BUS.SFX]: AUDIO.VOLUME.SFX,
            [BUS.UI]: AUDIO.VOLUME.UI
        };
        // "100%" de referência pros controles de volume do jogador: os padrões acima, de CONFIG.AUDIO.VOLUME
        this.baseVolumes = { ...this.volumes };
        this.muted = false;

        this.specs = new Map();
        this.lastPlayedAt = new WeakMap();
        this.warned = new Set();
        this.samples = new Map();
        this.sampleLoads = new Map();
        this.sampleVolumes = new Map();

        this.voices = [];
        this.nextVoiceId = 1;
        this.optionScratch = { volume: 1, pitch: 0, pan: 0, delay: 0, timeScale: 1 };

        this.tracks = new Set();
        this.music = new MusicPlayer(this);

        this.initialized = false;
        this.gestureSeen = false;
        this.hiddenSuspended = false;
        this.onGesture = () => this.unlock();
        this.onVisibilityChange = () => this.handleVisibility();

        this.registerAll(presets);
    }

    // --- Ciclo de vida -----------------------------------------------------

    /** Instala os ouvintes de gesto/visibilidade, registra as músicas de CONFIG.AUDIO.MUSIC e pré-carrega CONFIG.AUDIO.SAMPLES. */
    init() {
        if (this.initialized) return this;
        this.initialized = true;
        if (!this.supported) {
            console.warn('[Audio] Web Audio API indisponível neste navegador: áudio desativado.');
            return this;
        }
        if (navigator.audioSession && AUDIO.SESSION_TYPE) navigator.audioSession.type = AUDIO.SESSION_TYPE;

        for (const type of GESTURE_EVENTS) {
            window.addEventListener(type, this.onGesture, { capture: true, passive: true });
        }
        document.addEventListener('visibilitychange', this.onVisibilityChange);

        for (const name in AUDIO.MUSIC) {
            const track = AUDIO.MUSIC[name];
            this.music.register(name, track.sources, { volume: track.volume, loop: track.loop, optional: track.optional });
        }
        for (const name in AUDIO.SAMPLES) {
            const sample = AUDIO.SAMPLES[name];
            if (sample.volume !== undefined) this.sampleVolumes.set(name, sample.volume);
            this.loadSample(name, sample.sources);
        }
        console.log(`[Audio] Motor pronto: ${this.specs.size} sons sintetizados, ${this.music.tracks.size} música(s), ${Object.keys(AUDIO.SAMPLES).length} sample(s). Aguardando o 1º gesto.`);
        return this;
    }

    /** Cria o AudioContext e o mixer sob demanda. */
    ensureContext() {
        if (this.ctx || !this.supported) return this.ctx;
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ctx = ctx;

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.2;
        limiter.connect(ctx.destination);
        this.limiter = limiter;

        const master = ctx.createGain();
        master.connect(limiter);
        this.buses = { [BUS.MASTER]: master };
        for (const bus of [BUS.MUSIC, BUS.SFX, BUS.UI]) {
            const node = ctx.createGain();
            node.connect(master);
            this.buses[bus] = node;
        }
        for (const bus in this.buses) this.applyVolume(bus, 0);

        this.synth = new SynthRenderer(ctx);
        ctx.addEventListener('statechange', () => console.log(`[Audio] AudioContext: ${ctx.state}`));
        console.log(`[Audio] AudioContext criado (${ctx.sampleRate} Hz, estado: ${ctx.state}).`);
        return ctx;
    }

    /** Chamado em todo gesto do usuário: libera o áudio e dispara músicas pendentes dentro do gesto. */
    unlock() {
        if (!this.supported) return;
        const ctx = this.ensureContext();
        if (!this.gestureSeen) {
            this.gestureSeen = true;
            console.log('[Audio] 1º gesto do usuário: áudio liberado.');
        }
        if (ctx.state !== 'running' && !this.hiddenSuspended) {
            ctx.resume().catch((err) => console.warn('[Audio] Não foi possível retomar o AudioContext:', err));
        }
        for (const track of this.tracks) track.onUnlock();
    }

    isUnlocked() {
        return this.gestureSeen && !!this.ctx;
    }

    /** true quando sons disparados agora realmente soam. */
    isRunning() {
        return !!this.ctx && this.ctx.state === 'running';
    }

    handleVisibility() {
        if (!AUDIO.SUSPEND_WHEN_HIDDEN || !this.ctx) return;
        if (document.hidden) {
            this.hiddenSuspended = true;
            for (const track of this.tracks) track.onHidden();
            this.stopAll({ fade: 0 });
            this.ctx.suspend().catch(() => {});
            console.log('[Audio] Aba oculta: áudio suspenso.');
            return;
        }
        if (!this.hiddenSuspended) return;
        this.hiddenSuspended = false;
        // Sem gesto o iOS pode recusar: o próximo toque retoma (unlock)
        this.ctx.resume().catch(() => {});
        for (const track of this.tracks) track.onVisible();
        console.log('[Audio] Aba visível: áudio retomado.');
    }

    destroy() {
        this.stopAll({ fade: 0 });
        for (const track of [...this.tracks]) track.destroy();
        for (const type of GESTURE_EVENTS) window.removeEventListener(type, this.onGesture, { capture: true });
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.ctx) this.ctx.close().catch(() => {});
        this.ctx = null;
        this.buses = null;
        this.synth = null;
    }

    // --- Mixer -------------------------------------------------------------

    /** @param {string} bus CONFIG.AUDIO.BUS.* */
    busNode(bus) {
        const node = this.buses && this.buses[bus];
        if (node) return node;
        this.warnOnce(`bus:${bus}`, `[Audio] Barramento desconhecido "${bus}", usando "${BUS.SFX}".`);
        return this.buses[BUS.SFX];
    }

    /**
     * @param {string} bus CONFIG.AUDIO.BUS.*
     * @param {number} value 0..1
     * @param {number} [seconds=0]
     */
    setVolume(bus, value, seconds = 0) {
        if (!(bus in this.volumes)) {
            console.warn(`[Audio] setVolume: barramento desconhecido "${bus}".`);
            return;
        }
        this.volumes[bus] = Math.min(1, Math.max(0, num(value, 0)));
        this.applyVolume(bus, seconds);
    }

    getVolume(bus) {
        return this.volumes[bus] ?? 0;
    }

    /**
     * Volume do barramento como fração do padrão de CONFIG.AUDIO.VOLUME (o "100%" do controle de volume).
     * @param {string} bus CONFIG.AUDIO.BUS.*
     * @returns {number} 0..1
     */
    getVolumeFraction(bus) {
        const base = this.baseVolumes[bus];
        return base > 0 ? Math.min(1, this.getVolume(bus) / base) : 0;
    }

    /**
     * @param {string} bus CONFIG.AUDIO.BUS.*
     * @param {number} fraction 0..1 (1 = 100% = volume padrão de CONFIG.AUDIO.VOLUME)
     * @param {number} [seconds=0]
     */
    setVolumeFraction(bus, fraction, seconds = 0) {
        const base = this.baseVolumes[bus];
        if (base === undefined) {
            console.warn(`[Audio] setVolumeFraction: barramento desconhecido "${bus}".`);
            return;
        }
        this.setVolume(bus, base * Math.min(1, Math.max(0, num(fraction, 0))), seconds);
    }

    setMuted(muted, seconds = 0.1) {
        this.muted = !!muted;
        this.applyVolume(BUS.MASTER, seconds);
        console.log(`[Audio] ${this.muted ? 'Mudo' : 'Som ligado'}.`);
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    applyVolume(bus, seconds) {
        if (!this.buses) return;
        const target = bus === BUS.MASTER && this.muted ? 0 : this.volumes[bus];
        rampParam(this.ctx, this.buses[bus].gain, target, seconds);
    }

    // --- Sons sintetizados ---------------------------------------------------

    /**
     * Registra (ou substitui) um preset. Valida na hora: erro de autoria aparece no carregamento, não no meio da partida.
     * @param {string} name
     * @param {import('./synth.js').SoundSpec} spec
     */
    register(name, spec) {
        this.specs.set(name, normalizeSpec(name, spec));
        return this;
    }

    registerAll(presets) {
        for (const name in presets) {
            try {
                this.register(name, presets[name]);
            } catch (err) {
                console.error(`[Audio] Preset "${name}" inválido: ${err.message}`);
            }
        }
    }

    has(name) {
        return this.specs.has(name);
    }

    /**
     * @param {string} name chave de SOUND_PRESETS (use SFX.*)
     * @param {PlayOptions} [options]
     * @returns {number} id da voz (0 = não tocou: desconhecido, bloqueado, mudo por cooldown ou antes do 1º gesto)
     */
    play(name, options = EMPTY_OPTIONS) {
        const spec = this.specs.get(name);
        if (!spec) {
            this.warnOnce(`sfx:${name}`, `[Audio] Som desconhecido: "${name}".`);
            return 0;
        }
        return this.playSpec(spec, options);
    }

    /**
     * Toca um SoundSpec ad hoc (normalizado a cada chamada; para uso frequente prefira register()).
     * @param {import('./synth.js').SoundSpec} spec
     * @param {PlayOptions} [options]
     */
    playSpec(spec, options = EMPTY_OPTIONS) {
        if (!this.isRunning()) {
            if (AUDIO.DEBUG_LOG) console.log('[Audio] Som ignorado: áudio ainda não liberado/suspenso.');
            return 0;
        }
        let normalized;
        try {
            normalized = normalizeSpec(spec.name || 'adhoc', spec);
        } catch (err) {
            console.error(`[Audio] SoundSpec inválido: ${err.message}`);
            return 0;
        }

        const now = this.ctx.currentTime;
        if (normalized.cooldown > 0) {
            const last = this.lastPlayedAt.get(normalized);
            if (last !== undefined && now - last < normalized.cooldown) return 0;
            this.lastPlayedAt.set(normalized, now);
        }

        const bus = options.bus || normalized.bus;
        const rendered = this.synth.render(normalized, this.resolveOptions(options), this.busNode(bus));
        const voice = this.addVoice(rendered, false, bus);
        if (AUDIO.DEBUG_LOG) console.log(`[Audio] ▶ ${normalized.name} (voz ${voice.id}, ${this.voices.length} ativas)`);
        return voice.id;
    }

    resolveOptions(options) {
        const o = this.optionScratch;
        o.volume = Math.max(0, num(options.volume, 1));
        o.pitch = num(options.pitch, 0);
        o.pan = num(options.pan, 0);
        o.delay = Math.max(0, num(options.delay, 0));
        if (options.timeScale > 0) o.timeScale = options.timeScale;
        else if (options.length) o.timeScale = AUDIO.LENGTH_SCALE[String(options.length).toUpperCase()] || 1;
        else o.timeScale = 1;
        return o;
    }

    // --- Samples (arquivos curtos em memória) --------------------------------

    /**
     * Baixa e decodifica um arquivo curto (efeito gravado). Nunca rejeita: resolve null em caso de falha.
     * Chamar antes do 1º gesto cria o AudioContext suspenso (ok; ele só soa depois do gesto).
     * @param {string} name
     * @param {string|string[]} sources
     * @returns {Promise<AudioBuffer|null>}
     */
    loadSample(name, sources) {
        const pending = this.sampleLoads.get(name);
        if (pending) return pending;
        if (!this.supported) return Promise.resolve(null);

        const promise = this.decodeFirst(rankSources(sources))
            .then((buffer) => {
                this.samples.set(name, buffer);
                console.log(`[Audio] Sample "${name}" pronto (${buffer.duration.toFixed(2)}s).`);
                return buffer;
            })
            .catch((err) => {
                this.sampleLoads.delete(name);
                console.error(`[Audio] Falha ao carregar o sample "${name}":`, err);
                return null;
            });
        this.sampleLoads.set(name, promise);
        return promise;
    }

    async decodeFirst(urls) {
        const ctx = this.ensureContext();
        let lastError = new Error('nenhuma fonte suportada por este navegador');
        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await ctx.decodeAudioData(await response.arrayBuffer());
            } catch (err) {
                lastError = err;
                console.warn(`[Audio] Fonte falhou (${url}): ${err.message}`);
            }
        }
        throw lastError;
    }

    /**
     * @param {string} name
     * @param {SampleOptions} [options]
     * @returns {number} id da voz (0 = não tocou)
     */
    playSample(name, options = EMPTY_OPTIONS) {
        const buffer = this.samples.get(name);
        if (!buffer) {
            this.warnOnce(`sample:${name}`, `[Audio] Sample "${name}" não carregado.`);
            return 0;
        }
        if (!this.isRunning()) return 0;

        const ctx = this.ctx;
        const bus = options.bus || BUS.SFX;
        const loop = !!options.loop;
        const rate = Math.max(0.05, num(options.rate, 1)) * semitoneRatio(num(options.pitch, 0));
        const defaultVolume = this.sampleVolumes.has(name) ? this.sampleVolumes.get(name) : 1;
        const volume = Math.max(0, num(options.volume, defaultVolume));
        const offset = Math.min(buffer.duration, Math.max(0, num(options.offset, 0)));
        const fadeIn = Math.max(0, num(options.fadeIn, 0));
        const start = ctx.currentTime + AUDIO.START_LOOKAHEAD_S + Math.max(0, num(options.delay, 0));

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = rate;
        const output = ctx.createGain();
        const nodes = [source, output];

        let tail = source;
        const pan = Math.min(1, Math.max(-1, num(options.pan, 0)));
        if (pan !== 0) {
            const panner = ctx.createStereoPanner();
            panner.pan.value = pan;
            tail.connect(panner);
            tail = panner;
            nodes.push(panner);
        }
        tail.connect(output);
        output.connect(this.busNode(bus));

        if (fadeIn > 0) {
            output.gain.setValueAtTime(0, start);
            output.gain.linearRampToValueAtTime(volume, start + fadeIn);
        } else {
            output.gain.value = volume;
        }
        source.start(start, offset);

        const endTime = loop ? Infinity : start + (buffer.duration - offset) / rate;
        return this.addVoice({ output, nodes, sources: [source], endTime }, loop, bus).id;
    }

    // --- Arquivos longos (streaming) -----------------------------------------

    /**
     * Cria uma faixa com controle total (play/pause/seek/volume/loop/velocidade/eventos).
     * @param {string|string[]} sources
     * @param {{ name?: string, loop?: boolean, volume?: number, bus?: string }} [options]
     * @returns {AudioTrack}
     */
    createTrack(sources, options = {}) {
        const track = new AudioTrack(this, sources, options);
        this.tracks.add(track);
        return track;
    }

    forgetTrack(track) {
        this.tracks.delete(track);
    }

    // --- Vozes ---------------------------------------------------------------

    addVoice(rendered, loop, bus) {
        if (this.voices.length >= AUDIO.MAX_VOICES) this.stealVoice();
        const voice = {
            id: this.nextVoiceId++,
            bus,
            loop,
            output: rendered.output,
            nodes: rendered.nodes,
            sources: rendered.sources,
            timer: 0,
            released: false
        };
        this.voices.push(voice);
        if (!loop) {
            const ms = Math.max(0, (rendered.endTime - this.ctx.currentTime) * 1000);
            voice.timer = setTimeout(() => this.releaseVoice(voice), ms);
        }
        return voice;
    }

    /** Prefere cortar a voz mais antiga que não seja loop. */
    stealVoice() {
        let victim = this.voices[0];
        for (let i = 0; i < this.voices.length; i++) {
            if (!this.voices[i].loop) {
                victim = this.voices[i];
                break;
            }
        }
        if (AUDIO.DEBUG_LOG) console.log(`[Audio] Limite de ${AUDIO.MAX_VOICES} vozes: cortando a voz ${victim.id}.`);
        this.fadeOutVoice(victim, AUDIO.STEAL_FADE_S);
    }

    /**
     * @param {number} id retornado por play()/playSample()
     * @param {number} [fade=0.05]
     */
    stop(id, fade = 0.05) {
        for (let i = 0; i < this.voices.length; i++) {
            if (this.voices[i].id === id) {
                this.fadeOutVoice(this.voices[i], fade);
                return true;
            }
        }
        return false;
    }

    /** @param {{ bus?: string, fade?: number }} [options] sem bus = todas as vozes */
    stopAll({ bus, fade = 0.05 } = {}) {
        for (let i = this.voices.length - 1; i >= 0; i--) {
            const voice = this.voices[i];
            if (!bus || voice.bus === bus) this.fadeOutVoice(voice, fade);
        }
    }

    fadeOutVoice(voice, fade) {
        const index = this.voices.indexOf(voice);
        if (index > -1) this.voices.splice(index, 1);
        clearTimeout(voice.timer);

        if (this.ctx) {
            const now = this.ctx.currentTime;
            rampParam(this.ctx, voice.output.gain, 0, fade);
            for (const source of voice.sources) {
                try {
                    source.stop(now + fade + 0.01);
                } catch (err) {
                    // fonte já encerrada: nada a fazer
                }
            }
        }
        voice.timer = setTimeout(() => this.releaseVoice(voice), fade * 1000 + 50);
    }

    releaseVoice(voice) {
        if (voice.released) return;
        voice.released = true;
        clearTimeout(voice.timer);
        for (const node of voice.nodes) node.disconnect();
        const index = this.voices.indexOf(voice);
        if (index > -1) this.voices.splice(index, 1);
    }

    get activeVoices() {
        return this.voices.length;
    }

    warnOnce(key, message) {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        console.warn(message);
    }
}
