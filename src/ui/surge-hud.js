import { CONFIG } from '../config/constants.js';
import { SFX } from '../config/sound-presets.js';
import { i18n } from '../i18n/index.js';
import { globalEvents } from '../core/event-bus.js';
import { surgeEffects } from '../systems/rules.js';

const { SURGE, SURGE_KIND, SURGE_EFFECT, ANIM } = CONFIG;

// Por evento: chaves i18n, símbolo do selo (não é texto traduzível) e a cor tema (--surge-color no CSS)
const SURGE_UI = Object.freeze({
    [SURGE_KIND.DOUBLE_DRAW]: Object.freeze({ name: 'SURGE_DOUBLE_DRAW', desc: 'SURGE_DESC_DOUBLE_DRAW', icon: '×2', color: '#4dd2ff' }),
    [SURGE_KIND.DISCOUNT]: Object.freeze({ name: 'SURGE_DISCOUNT', desc: 'SURGE_DESC_DISCOUNT', icon: '%', color: '#ffd23f' }),
    [SURGE_KIND.FRENZY]: Object.freeze({ name: 'SURGE_FRENZY', desc: 'SURGE_DESC_FRENZY', icon: '⚔', color: '#ff4040' }),
    [SURGE_KIND.ALL]: Object.freeze({ name: 'SURGE_ALL', desc: 'SURGE_DESC_ALL', icon: '★', color: '#d07bff' })
});
const ROULETTE = Object.freeze([SURGE_KIND.DOUBLE_DRAW, SURGE_KIND.DISCOUNT, SURGE_KIND.FRENZY, SURGE_KIND.ALL]);
const ROULETTE_STEPS = 14;

/**
 * SurgeHud - Evento da Arena na HUD (GAME_RULES §9): a roleta que sorteia o evento (cinemática), o selo com
 * o evento ativo e os turnos restantes, e os indicadores de cada efeito (vinheta do Frenesi, etiqueta de
 * desconto no botão da loja). O estado vem do snapshot (setState); a roleta vem do EVENT.SURGE.
 *
 * Desempenho: nenhuma animação CSS infinita (cada uma custaria recálculo de estilo em todo frame do jogo);
 * só transições/animações de uma vez em transform/opacity, e o DOM só é escrito quando o estado muda.
 */
export class SurgeHud {
    /** @param {import('../audio/audio-engine.js').AudioEngine} audio */
    constructor(audio) {
        this.audio = audio;
        const $ = (id) => document.getElementById(id);
        this.reveal = $('surge-reveal');
        this.card = this.reveal.querySelector('.surge-card');
        this.revealName = this.reveal.querySelector('.surge-name');
        this.revealDesc = this.reveal.querySelector('.surge-desc');
        this.revealTurns = this.reveal.querySelector('.surge-turns');
        this.badge = $('surge-badge');
        this.badgeIcon = this.badge.querySelector('.surge-badge-icon');
        this.badgeName = this.badge.querySelector('.surge-badge-name');
        this.badgeTurns = this.badge.querySelector('.surge-badge-turns');
        this.vignette = $('surge-frenzy');
        this.shopBtn = $('shop-btn');

        this.kind = SURGE_KIND.NONE;
        this.turns = 0;
        this.shownKind = -1;
        this.shownTurns = -1;
        this.revealing = false;
        this.timers = [];

        globalEvents.on('LANGUAGE_CHANGED', () => {
            this.shownKind = -1;
            this.applyState();
        });
    }

    /** Estado do snapshot. Durante a roleta o selo espera ela terminar (não entrega o resultado antes). */
    setState(kind, turns) {
        this.kind = kind;
        this.turns = turns;
        if (!this.revealing) this.applyState();
    }

    applyState() {
        const ui = this.turns > 0 ? SURGE_UI[this.kind] : null;
        const kind = ui ? this.kind : SURGE_KIND.NONE;
        if (kind === this.shownKind && this.turns === this.shownTurns) return;
        const changedKind = kind !== this.shownKind;
        this.shownKind = kind;
        this.shownTurns = this.turns;

        const effects = surgeEffects(kind);
        this.vignette.classList.toggle('on', (effects & SURGE_EFFECT.FRENZY) !== 0);
        const sale = (effects & SURGE_EFFECT.DISCOUNT) !== 0;
        this.shopBtn.classList.toggle('surge-sale', sale);
        if (sale) this.shopBtn.dataset.sale = `-${Math.round((1 - SURGE.DISCOUNT_RATIO) * 100)}%`;

        if (!ui) {
            this.badge.hidden = true;
            return;
        }
        this.badge.hidden = false;
        this.badge.style.setProperty('--surge-color', ui.color);
        this.badgeIcon.textContent = ui.icon;
        this.badgeName.textContent = i18n.t(ui.name);
        this.badgeTurns.textContent = String(this.turns);
        const label = `${i18n.t(ui.name)} — ${i18n.t('SURGE_TURNS', { n: this.turns })}`;
        this.badge.title = label;
        this.badge.setAttribute('aria-label', label);
        if (changedKind) {
            this.badge.classList.remove('pop');
            void this.badge.offsetWidth;
            this.badge.classList.add('pop');
        }
    }

    /**
     * A roleta: os nomes giram desacelerando (ANIM.SURGE_SPIN), cravam `kind`, a descrição aparece e, depois de
     * ANIM.SURGE_REVEAL, a carta some e o selo assume.
     * @param {number} kind CONFIG.SURGE_KIND
     * @param {number} turns
     * @param {() => void} [onLand] chamado no instante em que a roleta crava (partículas da cinemática)
     * @returns {Promise<void>}
     */
    playReveal(kind, turns, onLand) {
        const ui = SURGE_UI[kind];
        if (!ui) return Promise.resolve();
        this.cancel();
        this.revealing = true;
        const target = ROULETTE.indexOf(kind);
        const start = ((target - ROULETTE_STEPS) % ROULETTE.length + ROULETTE.length) % ROULETTE.length;

        this.card.classList.remove('landed');
        this.card.style.setProperty('--surge-color', SURGE_UI[ROULETTE[start]].color);
        this.revealName.textContent = i18n.t(SURGE_UI[ROULETTE[start]].name);
        this.revealDesc.textContent = this.describe(kind);
        this.revealTurns.textContent = i18n.t('SURGE_TURNS', { n: turns });
        this.reveal.hidden = false;
        void this.reveal.offsetWidth;
        this.reveal.classList.add('show');

        // Passo i em SPIN * (i/N)²: cada troca demora mais que a anterior (a roleta freia)
        for (let i = 1; i <= ROULETTE_STEPS; i++) {
            const at = ANIM.SURGE_SPIN * (i / ROULETTE_STEPS) * (i / ROULETTE_STEPS);
            const k = ROULETTE[(start + i) % ROULETTE.length];
            const last = i === ROULETTE_STEPS;
            this.later(() => {
                this.card.style.setProperty('--surge-color', SURGE_UI[k].color);
                this.revealName.textContent = i18n.t(SURGE_UI[k].name);
                if (!last) {
                    this.audio.play(SFX.SURGE_TICK);
                    return;
                }
                this.card.classList.add('landed');
                this.audio.play(SFX.SURGE_REVEAL);
                if (onLand) onLand(ui.color);
            }, at);
        }

        return new Promise((resolve) => {
            this.later(() => {
                this.reveal.classList.remove('show');
                this.revealing = false;
                this.applyState();
                this.later(() => {
                    this.reveal.hidden = true;
                    resolve();
                }, 260);
            }, ANIM.SURGE_SPIN + ANIM.SURGE_REVEAL);
        });
    }

    describe(kind) {
        const ui = SURGE_UI[kind];
        if (kind === SURGE_KIND.DISCOUNT) return i18n.t(ui.desc, { n: Math.round((1 - SURGE.DISCOUNT_RATIO) * 100) });
        if (kind === SURGE_KIND.FRENZY) return i18n.t(ui.desc, { n: Math.round((SURGE.FRENZY_DAMAGE_MULT - 1) * 100) });
        return i18n.t(ui.desc);
    }

    /** Cor tema de um evento (partículas e alertas). */
    colorOf(kind) {
        const ui = SURGE_UI[kind];
        return ui ? ui.color : '#ffffff';
    }

    later(fn, ms) {
        this.timers.push(setTimeout(fn, ms));
    }

    /** Interrompe a roleta (nova partida, reconexão): a carta some e o selo volta a seguir o snapshot. */
    cancel() {
        for (let i = 0; i < this.timers.length; i++) clearTimeout(this.timers[i]);
        this.timers.length = 0;
        this.reveal.classList.remove('show');
        this.reveal.hidden = true;
        if (this.revealing) {
            this.revealing = false;
            this.applyState();
        }
    }
}
