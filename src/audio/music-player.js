import { CONFIG } from '../config/constants.js';

const { BUS, DEFAULT_FADE_S } = CONFIG.AUDIO;

/**
 * MusicPlayer - faixas nomeadas com uma única música "atual". Trocar de faixa faz crossfade automático.
 * Cada faixa é um AudioTrack (acesso ao controle fino via get(name)).
 */
export class MusicPlayer {
    /** @param {import('./audio-engine.js').AudioEngine} engine */
    constructor(engine) {
        this.engine = engine;
        this.tracks = new Map();
        this.current = null;
        this.currentName = '';
    }

    /**
     * Registra sem baixar nada (o download começa no preload() ou no 1º play()).
     * @param {string} name
     * @param {string|string[]} sources
     * @param {{ loop?: boolean, volume?: number, optional?: boolean }} [options] loop padrão: true;
     *        optional: arquivo ainda pode não existir (falha vira aviso, não erro)
     * @returns {import('./audio-track.js').AudioTrack}
     */
    register(name, sources, options = {}) {
        const existing = this.tracks.get(name);
        if (existing) return existing;
        const track = this.engine.createTrack(sources, {
            name,
            loop: options.loop !== undefined ? options.loop : true,
            volume: options.volume !== undefined ? options.volume : 1,
            bus: BUS.MUSIC,
            optional: !!options.optional
        });
        this.tracks.set(name, track);
        return track;
    }

    /** @returns {import('./audio-track.js').AudioTrack|null} */
    get(name) {
        return this.tracks.get(name) || null;
    }

    /** @returns {Promise<boolean>} */
    preload(name) {
        const track = this.tracks.get(name);
        return track ? track.load() : Promise.resolve(false);
    }

    /**
     * Toca a faixa; se outra estiver tocando, as duas se cruzam em `fade` segundos.
     * @param {string} name
     * @param {{ fade?: number, from?: number, restart?: boolean }} [options]
     */
    play(name, { fade = DEFAULT_FADE_S, from, restart = false } = {}) {
        const track = this.tracks.get(name);
        if (!track) {
            console.warn(`[MusicPlayer] Faixa não registrada: "${name}"`);
            return null;
        }
        if (this.current && this.current !== track) this.current.pause({ fadeOut: fade });
        if (this.current !== track || !track.isPlaying || restart || from !== undefined) {
            console.log(`[MusicPlayer] Tocando "${name}" (fade ${fade}s).`);
        }
        this.current = track;
        this.currentName = name;
        track.play({ fadeIn: fade, from: restart ? 0 : from });
        return track;
    }

    pause({ fade = DEFAULT_FADE_S } = {}) {
        if (this.current) this.current.pause({ fadeOut: fade });
    }

    resume({ fade = DEFAULT_FADE_S } = {}) {
        if (this.current) this.current.play({ fadeIn: fade });
    }

    stop({ fade = DEFAULT_FADE_S } = {}) {
        if (!this.current) return;
        this.current.stop({ fadeOut: fade });
        this.current = null;
        this.currentName = '';
    }

    seek(seconds) {
        if (this.current) this.current.seek(seconds);
    }

    get currentTime() {
        return this.current ? this.current.currentTime : 0;
    }

    get duration() {
        return this.current ? this.current.duration : 0;
    }

    get isPlaying() {
        return !!this.current && this.current.isPlaying;
    }

    /** Volume do barramento de música inteiro (todas as faixas). */
    setVolume(value, seconds = 0) {
        this.engine.setVolume(BUS.MUSIC, value, seconds);
    }
}
