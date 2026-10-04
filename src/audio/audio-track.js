import { CONFIG } from '../config/constants.js';
import { rankSources } from './audio-sources.js';
import { rampParam } from './synth.js';

const TRACK_EVENTS = ['ended', 'error', 'loaded', 'timeupdate'];

function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * AudioTrack - arquivo de áudio tocado por streaming (<audio> -> Web Audio), com controle completo:
 * play/pause/resume/stop com fade, seek, tempo atual, duração, loop, velocidade e volume.
 *
 * Streaming em vez de decodeAudioData: uma música longa decodificada inteira ocuparia dezenas de MB
 * de PCM na memória do celular. O volume passa por um GainNode (element.volume é somente leitura no iOS).
 * Antes do 1º gesto do usuário, play() fica pendente e é disparado dentro do gesto (política de autoplay).
 */
export class AudioTrack {
    /**
     * @param {import('./audio-engine.js').AudioEngine} engine
     * @param {string|string[]} sources fontes em ordem de preferência (a 1ª suportada é usada)
     * @param {{ name?: string, loop?: boolean, volume?: number, bus?: string, optional?: boolean }} [options]
     *        optional: o arquivo pode ainda não existir — falha de carregamento é só aviso (`failed` = true)
     */
    constructor(engine, sources, { name = '', loop = false, volume = 1, bus = CONFIG.AUDIO.BUS.MUSIC, optional = false } = {}) {
        this.engine = engine;
        this.candidates = rankSources(sources);
        this.name = name || (this.candidates[0] || 'sem-fonte');
        this.bus = bus;
        this.volume = clamp01(volume);
        this.looping = loop;
        this.optional = optional;
        this.failed = false;

        this.element = null;
        this.mediaNode = null;
        this.gain = null;
        this.sourceIndex = -1;
        this.loadPromise = null;

        this.wantsPlay = false;
        this.pendingFadeIn = -1;
        this.resumeOnVisible = false;
        this.fadeTimer = 0;

        this.listeners = {};
        for (const event of TRACK_EVENTS) this.listeners[event] = [];
    }

    // --- Carregamento ------------------------------------------------------

    /**
     * Cria o elemento e começa a baixar a 1ª fonte suportada (idempotente).
     * @returns {Promise<boolean>} true quando dá para tocar; false se nenhuma fonte funcionou
     */
    load() {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = new Promise((resolve) => {
            if (this.candidates.length === 0) {
                this.failed = true;
                console[this.optional ? 'warn' : 'error'](`[AudioTrack:${this.name}] Nenhuma fonte suportada por este navegador.`);
                resolve(false);
                return;
            }
            const el = document.createElement('audio');
            el.preload = 'auto';
            el.crossOrigin = 'anonymous';
            el.loop = this.looping;
            this.element = el;

            el.addEventListener('canplay', () => {
                this.emit('loaded', this.duration);
                resolve(true);
            }, { once: true });
            el.addEventListener('error', () => this.handleSourceError(resolve));
            el.addEventListener('ended', () => {
                this.wantsPlay = false;
                this.emit('ended');
            });
            el.addEventListener('timeupdate', () => {
                if (this.listeners.timeupdate.length > 0) this.emit('timeupdate', el.currentTime);
            });

            this.trySource(0);
        });
        return this.loadPromise;
    }

    trySource(index) {
        this.sourceIndex = index;
        const url = this.candidates[index];
        console.log(`[AudioTrack:${this.name}] Carregando ${url}`);
        this.element.src = url;
    }

    handleSourceError(resolve) {
        const error = this.element.error;
        console.warn(`[AudioTrack:${this.name}] Falha na fonte ${this.candidates[this.sourceIndex]} (código ${error ? error.code : '?'}).`);
        if (this.sourceIndex + 1 < this.candidates.length) {
            this.trySource(this.sourceIndex + 1);
            if (this.wantsPlay && this.pendingFadeIn < 0) this.playElement(0);
            return;
        }
        this.failed = true;
        console[this.optional ? 'warn' : 'error'](`[AudioTrack:${this.name}] Todas as fontes falharam${this.optional ? ' (faixa opcional: ainda sem arquivo?)' : ''}.`);
        this.emit('error', error);
        resolve(false);
    }

    /** Liga o elemento ao grafo Web Audio (só pode ser feito uma vez por elemento). */
    connect() {
        if (this.mediaNode) return true;
        const ctx = this.engine.ensureContext();
        if (!ctx || !this.element) return false;
        this.mediaNode = ctx.createMediaElementSource(this.element);
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.mediaNode.connect(this.gain);
        this.gain.connect(this.engine.busNode(this.bus));
        return true;
    }

    // --- Transporte --------------------------------------------------------

    /**
     * @param {{ fadeIn?: number, from?: number }} [options] fadeIn em segundos; from = posição inicial
     */
    play({ fadeIn = 0, from } = {}) {
        if (this.failed) return this;
        this.load();
        if (from !== undefined) this.seek(from);
        this.wantsPlay = true;
        this.resumeOnVisible = false;
        clearTimeout(this.fadeTimer);

        if (!this.engine.isUnlocked()) {
            this.pendingFadeIn = fadeIn;
            console.log(`[AudioTrack:${this.name}] Aguardando o 1º gesto do usuário para tocar.`);
            return this;
        }
        this.start(fadeIn);
        return this;
    }

    /** Continua de onde parou. */
    resume({ fadeIn = 0 } = {}) {
        return this.play({ fadeIn });
    }

    /** @param {{ fadeOut?: number }} [options] */
    pause({ fadeOut = 0 } = {}) {
        this.halt(fadeOut, false);
        return this;
    }

    /** Pausa e volta para o início. */
    stop({ fadeOut = 0 } = {}) {
        this.halt(fadeOut, true);
        return this;
    }

    /** @param {number} seconds */
    seek(seconds) {
        if (!this.element) this.load();
        if (!this.element) return this;
        const duration = this.duration;
        let target = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
        if (duration > 0) target = Math.min(target, duration);
        this.element.currentTime = target;
        return this;
    }

    start(fadeIn) {
        this.pendingFadeIn = -1;
        if (!this.element) return;
        if (this.connect()) {
            const fromSilence = !this.element || this.element.paused;
            const param = this.gain.gain;
            rampParam(this.engine.ctx, param, this.volume, fadeIn, fromSilence && fadeIn > 0 ? 0 : param.value);
        } else if (this.element) {
            this.element.volume = this.volume;
        }
        this.playElement(fadeIn);
    }

    playElement(fadeIn) {
        const promise = this.element.play();
        if (!promise) return;
        promise.catch((err) => {
            if (err.name === 'NotAllowedError') {
                this.pendingFadeIn = fadeIn;
                console.warn(`[AudioTrack:${this.name}] Reprodução bloqueada pelo navegador. Tentará no próximo toque.`);
            } else if (err.name !== 'AbortError') {
                console[this.optional ? 'warn' : 'error'](`[AudioTrack:${this.name}] Erro ao tocar:`, err);
            }
        });
    }

    halt(fadeOut, rewind) {
        this.wantsPlay = false;
        this.pendingFadeIn = -1;
        this.resumeOnVisible = false;
        clearTimeout(this.fadeTimer);
        const el = this.element;
        if (!el) return;

        const finish = () => {
            if (this.wantsPlay) return;
            el.pause();
            if (rewind) el.currentTime = 0;
        };
        if (fadeOut > 0 && this.gain && !el.paused) {
            rampParam(this.engine.ctx, this.gain.gain, 0, fadeOut);
            this.fadeTimer = setTimeout(finish, fadeOut * 1000);
        } else {
            finish();
        }
    }

    // --- Parâmetros --------------------------------------------------------

    /**
     * @param {number} value 0..1
     * @param {number} [seconds=0] tempo de transição
     */
    setVolume(value, seconds = 0) {
        this.volume = clamp01(value);
        if (this.gain && this.wantsPlay) rampParam(this.engine.ctx, this.gain.gain, this.volume, seconds);
        else if (!this.gain && this.element) this.element.volume = this.volume;
        return this;
    }

    fadeTo(value, seconds = CONFIG.AUDIO.DEFAULT_FADE_S) {
        return this.setVolume(value, seconds);
    }

    /**
     * @param {number} rate 0.25..4
     * @param {boolean} [preservePitch=true] false = acelera e afina junto (efeito "fita")
     */
    setPlaybackRate(rate, preservePitch = true) {
        if (!this.element) this.load();
        if (!this.element) return this;
        this.element.playbackRate = Math.min(4, Math.max(0.25, rate));
        this.element.preservesPitch = preservePitch;
        return this;
    }

    get loop() {
        return this.looping;
    }

    set loop(value) {
        this.looping = !!value;
        if (this.element) this.element.loop = this.looping;
    }

    get currentTime() {
        return this.element ? this.element.currentTime : 0;
    }

    get duration() {
        const d = this.element ? this.element.duration : 0;
        return Number.isFinite(d) ? d : 0;
    }

    /** 0..1 */
    get progress() {
        const d = this.duration;
        return d > 0 ? this.currentTime / d : 0;
    }

    get isPlaying() {
        return this.wantsPlay && !!this.element && !this.element.paused;
    }

    get isPending() {
        return this.wantsPlay && this.pendingFadeIn >= 0;
    }

    // --- Eventos -----------------------------------------------------------

    /**
     * @param {'ended'|'error'|'loaded'|'timeupdate'} event
     * @param {Function} callback
     * @returns {() => void} cancela a inscrição
     */
    on(event, callback) {
        const list = this.listeners[event];
        if (!list) throw new Error(`[AudioTrack] Evento desconhecido: ${event}`);
        list.push(callback);
        return () => {
            const i = list.indexOf(callback);
            if (i > -1) list.splice(i, 1);
        };
    }

    emit(event, value) {
        const list = this.listeners[event];
        for (let i = 0; i < list.length; i++) {
            try {
                list[i](value, this);
            } catch (err) {
                console.error(`[AudioTrack:${this.name}] Erro no listener de ${event}:`, err);
            }
        }
    }

    // --- Ciclo de vida (chamado pelo AudioEngine) -----------------------------

    onUnlock() {
        if (this.wantsPlay && this.pendingFadeIn >= 0) this.start(this.pendingFadeIn);
    }

    onHidden() {
        if (!this.element || this.element.paused) return;
        this.resumeOnVisible = true;
        this.element.pause();
    }

    onVisible() {
        if (!this.resumeOnVisible || !this.wantsPlay) return;
        this.resumeOnVisible = false;
        this.start(0);
    }

    destroy() {
        this.halt(0, false);
        if (this.mediaNode) this.mediaNode.disconnect();
        if (this.gain) this.gain.disconnect();
        if (this.element) {
            this.element.removeAttribute('src');
            this.element.load();
        }
        this.engine.forgetTrack(this);
    }
}
