import { CONFIG } from '../config/constants.js';
import { SFX } from '../config/sound-presets.js';
import { i18n } from '../i18n/index.js';
import { CARD_CATEGORY, cardCategory, cardNameKey, cardTypeName, isPaintable } from '../systems/rules.js';

const { CARD_DIMENSIONS, CARD_VISUALS, COLOR_HEX } = CONFIG;
// Tem que bater com a largura de .card-info-card no CSS (a carta é desenhada em 100x150 unidades)
const CARD_CSS_WIDTH = 116;
const CLOSE_MS = 220;
const HINT_MS = 2400;
const MAX_DPR = 2;

// Rótulo e cor de cada categoria (a cor pinta o selo e o destaque do nome)
const CATEGORY_UI = Object.freeze({
    [CARD_CATEGORY.ATTACK]: Object.freeze({ key: 'CATEGORY_ATTACK', color: '#ff7a59' }),
    [CARD_CATEGORY.SPECIAL_ATTACK]: Object.freeze({ key: 'CATEGORY_SPECIAL_ATTACK', color: '#b98cff' }),
    [CARD_CATEGORY.CONSUMABLE]: Object.freeze({ key: 'CATEGORY_CONSUMABLE', color: '#4fe3c1' })
});

/**
 * CardInfoPanel - o campo "?" (canto inferior esquerdo, só do jogador local) e o painel de informações.
 * Soltar uma carta da mão sobre o campo abre, na frente de tudo, a carta (desenhada pelo mesmo pintor do
 * jogo, animada), a categoria, o nome e a descrição da loja. Só UI local: nada vai pra rede.
 *
 * Desempenho: o laço de redesenho da prévia só roda com o painel aberto; CSS anima só transform/opacity.
 */
export class CardInfoPanel {
    /**
     * @param {{ audio: import('../audio/audio-engine.js').AudioEngine, viewport: import('../core/viewport.js').Viewport }} deps
     */
    constructor({ audio, viewport }) {
        this.audio = audio;
        this.viewport = viewport;
        /** @type {((ctx, type, color, power, seed, density) => void)|null} pintor do renderer (ligado no start) */
        this.painter = null;

        const $ = (id) => document.getElementById(id);
        this.zone = $('card-info-zone');
        this.root = $('card-info');
        this.panel = this.root.querySelector('.card-info-panel');
        this.canvas = this.root.querySelector('.card-info-card');
        this.ctx = this.canvas.getContext('2d');
        this.nameEl = this.root.querySelector('.card-info-name');
        this.descEl = this.root.querySelector('.card-info-desc');
        this.categoryEl = this.root.querySelector('.card-info-category');
        this.foilEl = this.root.querySelector('.card-info-foil');

        this.isOpen = false;
        this.dragState = 'idle';
        this.face = { type: 0, color: 0, power: 0, seed: 0 };
        this.density = 1;
        this.closeTimer = 0;
        this.hintTimer = 0;
        this.rafId = 0;
        this._loop = () => this.loop();

        this.root.querySelector('.card-info-backdrop').addEventListener('click', () => this.hide());
        this.root.querySelector('.card-info-close').addEventListener('click', () => this.hide());
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.hide();
        });
        // Clique sem arrastar: ensina o uso
        this.zone.addEventListener('click', () => this.showHint());
    }

    /** Retângulo do campo "?" em px de tela (lido 1x por arrasto, nunca por frame). */
    zoneRect() {
        return this.zone.getBoundingClientRect();
    }

    /** @param {'idle'|'armed'|'hover'} state armed = arrastando uma carta; hover = carta sobre o campo */
    setDragState(state) {
        if (state === this.dragState) return;
        this.dragState = state;
        this.zone.classList.toggle('armed', state === 'armed');
        this.zone.classList.toggle('hover', state === 'hover');
        if (state !== 'idle') this.zone.classList.remove('hint');
    }

    showHint() {
        this.audio.play(SFX.CLICK);
        this.zone.classList.remove('hint');
        void this.zone.offsetWidth;
        this.zone.classList.add('hint');
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => this.zone.classList.remove('hint'), HINT_MS);
    }

    /**
     * Abre o painel com a face da carta (a carta volta pra mão; nada muda no jogo).
     * @param {number} type @param {number} color @param {number} power @param {number} seed id da carta
     */
    show(type, color, power, seed = 0) {
        const name = cardTypeName(type);
        if (!name) return;
        const category = CATEGORY_UI[cardCategory(type)];
        const visual = CARD_VISUALS[type];
        // Carta com cor (números, Block, Relâmpago...) destaca na própria cor; sem cor, na cor da categoria
        const accent = isPaintable(color) ? COLOR_HEX[color] : category.color;

        this.face.type = type;
        this.face.color = color;
        this.face.power = power;
        this.face.seed = seed;
        this.nameEl.textContent = i18n.t(cardNameKey(type), { n: power });
        this.descEl.textContent = i18n.t(`DESC_${name}`, { n: power });
        this.categoryEl.textContent = i18n.t(category.key);
        this.foilEl.hidden = !(visual && visual.fx && visual.fx.startsWith('FOIL_'));
        this.panel.style.setProperty('--category', category.color);
        this.panel.style.setProperty('--accent', accent);
        console.log(`[CardInfo] Mostrando ${name}${type === CONFIG.CARD_TYPES.NUMBER ? ` ${power}` : ''}.`);

        clearTimeout(this.closeTimer);
        this.root.classList.remove('closing');
        // Voltar de display:none reinicia a animação de entrada mesmo se já estava aberto
        this.root.hidden = true;
        void this.root.offsetWidth;
        this.root.hidden = false;
        this.resizeCanvas();
        if (!this.isOpen) this.audio.play(SFX.SHOP_OPEN);
        this.isOpen = true;
        cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(this._loop);
    }

    hide() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.audio.play(SFX.SHOP_CLOSE);
        cancelAnimationFrame(this.rafId);
        this.root.classList.add('closing');
        clearTimeout(this.closeTimer);
        this.closeTimer = setTimeout(() => {
            this.root.hidden = true;
            this.root.classList.remove('closing');
        }, CLOSE_MS);
    }

    /** Resolução da prévia = tamanho em CSS x escala da HUD x densidade da tela (nítida em qualquer zoom). */
    resizeCanvas() {
        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        this.density = (CARD_CSS_WIDTH / CARD_DIMENSIONS.WIDTH) * (this.viewport.uiScale * 1.5) * dpr;
        const w = Math.round(CARD_DIMENSIONS.WIDTH * this.density);
        const h = Math.round(CARD_DIMENSIONS.HEIGHT * this.density);
        if (this.canvas.width !== w) this.canvas.width = w;
        if (this.canvas.height !== h) this.canvas.height = h;
    }

    /** Redesenha a prévia a cada frame só enquanto aberto (laminados e efeitos vivos continuam animando). */
    loop() {
        if (!this.isOpen) return;
        const f = this.face;
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.painter) {
            ctx.setTransform(this.density, 0, 0, this.density, 0, 0);
            this.painter(ctx, f.type, f.color, f.power, f.seed, this.density);
        }
        this.rafId = requestAnimationFrame(this._loop);
    }
}
