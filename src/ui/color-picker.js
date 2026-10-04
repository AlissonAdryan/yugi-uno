import { CONFIG } from '../config/constants.js';
import { SFX } from '../config/sound-presets.js';
import { colorBit } from '../systems/rules.js';
import { i18n } from '../i18n/index.js';

const { COLOR } = CONFIG;
const CLOSE_MS = 260;

// Mesma disposição do círculo desenhado na carta Trocar Cor (Canvas2DRenderer.drawColorWheel).
// Ordem do DOM = ordem da grade 2x2: cima-esquerda, cima-direita, baixo-esquerda, baixo-direita.
const WHEEL_SLOTS = Object.freeze([
    { color: COLOR.RED, corner: 'tl' },
    { color: COLOR.BLUE, corner: 'tr' },
    { color: COLOR.YELLOW, corner: 'bl' },
    { color: COLOR.GREEN, corner: 'br' }
]);

/**
 * ColorPicker - escolha da cor da próxima rodada pelo perdedor (fase CHOOSING_COLOR).
 * Só visual: a escolha vira INPUT.CHOOSE_COLOR no GameClient e o servidor valida tudo.
 * Cores fora da máscara (não comuns aos dois jogadores) ficam cinza e desabilitadas.
 */
export class ColorPicker {
    /** @param {import('../audio/audio-engine.js').AudioEngine} audio */
    constructor(audio) {
        this.audio = audio;
        this.root = document.getElementById('color-picker');
        this.wheel = document.getElementById('color-wheel');
        this.title = this.root.querySelector('.color-picker-title');
        this.onPick = null;
        this.onCancel = null;
        this.visible = false;
        this.locked = false;
        this.mask = -1;
        this.mode = '';
        this.closeTimer = 0;
        this.showTime = 0;

        this.root.style.setProperty('--choice-ms', `${CONFIG.TIMINGS.COLOR_CHOICE_TIMEOUT}ms`);
        this.slices = WHEEL_SLOTS.map(({ color, corner }) => this.createSlice(color, corner));

        // Clique no fundo escurecido (fora da carta): só cancela nos modos que permitem (ex.: Pintar)
        this.root.addEventListener('click', (e) => {
            if (Date.now() - this.showTime < 400) return; // Impede que o 'click' (ou touch end) da seleção da carta feche o menu imediatamente
            if (e.target !== this.root || this.locked || !this.onCancel) return;
            const cancel = this.onCancel;
            this.audio.play(SFX.CLICK);
            this.hide();
            cancel();
        });
    }

    createSlice(color, corner) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `wheel-slice wheel-slice--${corner}`;
        btn.style.setProperty('--slice-color', CONFIG.COLOR_HEX[color]);
        btn.addEventListener('pointerenter', (e) => {
            if (e.pointerType === 'mouse' && !btn.disabled && !this.locked) this.audio.play(SFX.HOVER);
        });
        btn.addEventListener('click', () => {
            if (Date.now() - this.showTime < 400) return; // Proteção contra ghost clicks do touch
            this.pick(color, btn);
        });
        this.wheel.appendChild(btn);
        return { color, btn };
    }

    /**
     * Abre (ou mantém aberto) o seletor. Chamar de novo com a mesma máscara e modo não reinicia nada.
     * @param {number} mask cores disponíveis (bits de rules.colorBit)
     * @param {(color: number) => void} onPick
     * @param {{ mode?: string, title?: string, timed?: boolean, onCancel?: () => void }} [options]
     *        mode: '' (escolha da rodada) | 'paint' (Pintar); timed: mostra o cronômetro do servidor;
     *        onCancel: permite fechar clicando fora da carta
     */
    show(mask, onPick, { mode = '', title = i18n.t('CHOOSE_COLOR'), timed = true, onCancel = null } = {}) {
        this.onPick = onPick;
        this.onCancel = onCancel;
        if (this.visible && mask === this.mask && mode === this.mode) return;

        clearTimeout(this.closeTimer);
        this.showTime = Date.now();
        this.mask = mask;
        this.mode = mode;
        this.locked = false;
        this.title.textContent = title;
        this.root.classList.toggle('untimed', !timed);
        this.root.classList.toggle('paint-mode', mode === 'paint');
        this.wheel.classList.remove('locked');
        for (const { color, btn } of this.slices) {
            btn.disabled = (mask & colorBit(color)) === 0;
            btn.classList.remove('chosen');
            // Reaplica a cada abertura (não só na criação): pega a troca de idioma feita nas configurações
            btn.setAttribute('aria-label', i18n.t(CONFIG.COLOR_NAME_KEYS[color]));
        }

        // Voltar de display:none reinicia as animações de entrada (virar a carta e o cronômetro)
        this.root.classList.remove('closing');
        this.root.hidden = true;
        void this.root.offsetWidth;
        this.root.hidden = false;
        this.visible = true;
        this.audio.play(SFX.SPARKLE);
    }

    pick(color, btn) {
        if (this.locked || btn.disabled || !this.onPick) return;
        this.locked = true;
        btn.classList.add('chosen');
        this.wheel.classList.add('locked');
        this.audio.play(SFX.CONFIRM);
        this.onPick(color);
    }

    /** O servidor recusou a escolha: libera o seletor para tentar de novo. */
    unlock() {
        if (!this.visible) return;
        this.locked = false;
        this.wheel.classList.remove('locked');
        for (const { btn } of this.slices) btn.classList.remove('chosen');
    }

    isOpen(mode) {
        return this.visible && this.mode === mode;
    }

    hide() {
        if (!this.visible) return;
        this.visible = false;
        this.mask = -1;
        this.mode = '';
        this.onCancel = null;
        this.root.classList.add('closing');
        clearTimeout(this.closeTimer);
        this.closeTimer = setTimeout(() => {
            this.root.hidden = true;
            this.root.classList.remove('closing');
        }, CLOSE_MS);
    }
}
