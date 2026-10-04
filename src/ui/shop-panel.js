import { CONFIG } from '../config/constants.js';
import { SFX } from '../config/sound-presets.js';
import { i18n } from '../i18n/index.js';
import { globalEvents } from '../core/event-bus.js';
import { ParticleSystem, PARTICLE_TYPES } from '../render/particle-system.js';
import { cardNameKey, cardTypeName, purchaseBlockReason } from '../systems/rules.js';
import { EVENT, INPUT } from '../network/protocol.js';

const { CARD_TYPES, SHOP, SHOP_ITEM_FLAGS, COLOR_HEX, ANIM } = CONFIG;
const SLOTS = SHOP.SLOTS;
// Tem que bater com a largura de .shop-card no CSS (a carta é desenhada em 100x150 unidades)
const CARD_CSS_WIDTH = 115;
// Borda transparente (px CSS) em volta da prévia: bate com o margin -3px de .shop-card no CSS
const PREVIEW_PAD_CSS = 3;
const PREVIEW_MIN_FRAME_MS = CONFIG.VIEW.SHOP_PREVIEW_MIN_FRAME_MS;
const CARD_UNITS = CONFIG.CARD_DIMENSIONS;
const MOTE_COUNT = 16;
// Raios dourados do fundo (bate com .shop-rays no CSS): leque de RAY_COUNT fatias de RAY_ARC_DEG a cada
// 360/RAY_COUNT graus, esmaecendo do centro (RAY_FADE_FROM) até sumir (RAY_FADE_TO) no raio do canto mais distante
const RAYS_CSS_SIZE = 1100;
const RAY_COUNT = 18;
const RAY_ARC_DEG = 7;
const RAY_ALPHA = 0.055;
const RAY_FADE_FROM = 0.1;
const RAY_FADE_TO = 0.65;
const RAYS_MAX_PX = 2048;

// Lista da vitrine alternativa: números 0..9 e depois cada tipo de carta, na ordem de CARD_TYPES
const ALT_PLAIN = new Set(CONFIG.COLORLESS_SPECIALS);
function buildAltList() {
    const list = [];
    for (let n = CONFIG.NUMBER_RANGE.MIN; n <= CONFIG.NUMBER_RANGE.MAX; n++) list.push({ type: CARD_TYPES.NUMBER, power: n });
    const types = Object.values(CARD_TYPES).filter((t) => t !== CARD_TYPES.NUMBER && t !== CARD_TYPES.HIDDEN).sort((a, b) => a - b);
    for (const type of types) list.push({ type, power: 0 });
    return list;
}

let fontReady = false;
/** A fonte das faces (Righteous) já carregou? Depois de pronta não volta atrás: o resultado fica em cache. */
function previewFontReady() {
    if (!fontReady) fontReady = document.fonts.check('50px Righteous');
    return fontReady;
}
const CLOSE_MS = 260;
const FLIP_OUT_MS = 170;
const PENDING_TIMEOUT_MS = 4000;
const MESSAGE_MS = 2200;

// Cor de destaque por tipo (números usam a própria cor da carta)
const ACCENT = Object.freeze({
    PLUS2: '#b36bff', PLUS4: '#9b59b6', BLOCK: '#ff5b5b', REVERSE: '#1abc9c', CHANGE_COLOR: '#f39c12',
    HEAL: '#2ecc71', SHIELD: '#00e5ff', REVIVE: '#ffd700', PAINT: '#9b84ff', GUARD_SWAP: '#7fdbff', LIGHTNING: '#fff3a0',
    GHOST: '#b388ff', MIRROR: '#c9c3dd', AMBUSH: '#39ff14', CURSE: '#c77dff', DEATH: '#ff2a3d'
});

// Motivo de recusa do servidor/cliente -> chave de tradução da mensagem
const REASON_KEYS = Object.freeze({
    NOT_ENOUGH_COINS: 'SHOP_NO_COINS',
    HAND_FULL: 'SHOP_HAND_FULL',
    ITEM_UNAVAILABLE: 'SHOP_UNAVAILABLE',
    NO_CARDS_AVAILABLE: 'SHOP_UNAVAILABLE',
    INVALID_SLOT: 'SHOP_UNAVAILABLE',
    SHOP_CLOSED: 'SHOP_ONLY_PREP',
    WRONG_PHASE: 'SHOP_ONLY_PREP',
    FREEZE_LIMIT: 'SHOP_FREEZE_LIMIT'
});

const ITEM_TEMPLATE = `
    <div class="shop-item-tilt">
        <div class="shop-item-glow"></div>
        <span class="shop-deal"></span>
        <div class="shop-card-wrap">
            <div class="shop-card-body"><canvas class="shop-card"></canvas></div>
            <div class="shop-frost"><svg><use href="#ico-snow"/></svg></div>
        </div>
        <h3 class="shop-name"></h3>
        <p class="shop-desc"></p>
        <div class="shop-price"><s class="shop-price-old"></s><svg class="ico-coin"><use href="#ico-coin"/></svg><b class="shop-price-now"></b></div>
        <div class="shop-actions">
            <button class="shop-buy" type="button"><span></span></button>
            <button class="shop-freeze" type="button"><svg><use href="#ico-snow"/></svg></button>
        </div>
        <span class="shop-stamp"></span>
    </div>`;

/**
 * ShopPanel - interface da economia: botão do carrinho + carteira (moedas, só o dono vê) e a janela
 * da loja. Só mostra e pede: toda compra/renovação/congelamento vira INPUT validado pelo servidor
 * (Pilar 11), e o estado real sempre chega pelo snapshot (sync).
 *
 * Desempenho: o loop de animação (partículas + prévias animadas das cartas) só roda com a loja aberta;
 * tudo que é CSS anima só transform/opacity.
 */
export class ShopPanel {
    /**
     * @param {{ audio: import('../audio/audio-engine.js').AudioEngine, viewport: import('../core/viewport.js').Viewport }} deps
     */
    constructor({ audio, viewport }) {
        this.audio = audio;
        this.viewport = viewport;

        const $ = (id) => document.getElementById(id);
        this.root = $('shop');
        this.button = $('shop-btn');
        this.wallet = this.button.querySelector('.wallet');
        this.walletCoins = $('wallet-coins');
        this.fxCanvas = this.root.querySelector('.shop-fx');
        this.fxCtx = this.fxCanvas.getContext('2d');
        /** O canvas de partículas ocupa a tela toda: só é limpo/reenviado à GPU enquanto há partícula viva */
        this.fxDirty = false;
        this.raysCanvas = this.root.querySelector('.shop-rays');
        this.raysPx = 0;
        this.itemsEl = this.root.querySelector('.shop-items');
        this.shopWallet = this.root.querySelector('.shop-wallet');
        this.shopCoins = this.root.querySelector('.shop-coins');
        this.refreshEl = this.root.querySelector('.shop-refresh');
        this.refreshText = this.root.querySelector('.shop-refresh-text');
        this.messageEl = this.root.querySelector('.shop-message');
        this.rerollBtn = this.root.querySelector('.shop-reroll');
        this.rerollCostEl = this.root.querySelector('.shop-reroll-cost b');
        this.closeBtn = this.root.querySelector('.shop-close');

        /** Desenha uma carta num contexto (fornecido pelo renderer do jogo). */
        this.painter = null;
        /** Atlas de laminado das prévias ({ begin(), prepare(type, color, seed) }, fornecido pelo renderer) */
        this.foils = null;
        /** Callbacks para o GameClient transformar em INPUT */
        this.onBuy = null;
        this.onReroll = null;
        this.onFreeze = null;
        this.onAltBuy = null;

        this.isOpen = false;
        this.available = false;
        // Vitrine alternativa (mesma janela): lista fixa percorrida de SLOTS em SLOTS
        this.alt = false;
        this.altList = null;
        this.altPos = 0;
        this.baseItems = null;
        this.synced = false;
        this.coins = 0;
        this.shownCoins = 0;
        this.handSize = 0;
        this.rerollCost = SHOP.REROLL_BASE_COST;
        this.roundsLeft = SHOP.REFRESH_EVERY_ROUNDS;
        this.items = new Array(SLOTS).fill(null);
        this.slots = [];
        this.pendingBuy = -1;
        this.pendingReroll = false;
        this.pendingTimer = 0;
        this.forceFlipMask = 0;
        this.flipTimers = new Array(SLOTS).fill(0);
        /** Prévia estática (sem laminado/efeito vivo) já desenhada: não precisa repintar a cada frame */
        this.previewDrawn = new Uint8Array(SLOTS);
        this.cardDensity = 1;
        this.previewPad = 0;
        this.previewAcc = 0;

        this.particles = new ParticleSystem(800);
        this.loopId = 0;
        this.lastFrame = 0;
        this.closeTimer = 0;
        this.messageTimer = 0;
        this.coinTween = 0;
        this.pulseTimers = new WeakMap();
        this._frame = (now) => this.frame(now);

        this.buildItems();
        this.buildMotes();
        this.bindEvents();
        this.setupMusic();
    }

    // --- Montagem ------------------------------------------------------------

    buildItems() {
        for (let slot = 0; slot < SLOTS; slot++) {
            const el = document.createElement('div');
            el.className = 'shop-item';
            el.style.setProperty('--i', String(slot));
            el.innerHTML = ITEM_TEMPLATE;
            this.itemsEl.appendChild(el);
            const q = (sel) => el.querySelector(sel);
            this.slots.push({
                el,
                tilt: q('.shop-item-tilt'),
                canvas: q('.shop-card'),
                ctx: q('.shop-card').getContext('2d'),
                deal: q('.shop-deal'),
                name: q('.shop-name'),
                desc: q('.shop-desc'),
                oldPrice: q('.shop-price-old'),
                price: q('.shop-price-now'),
                priceBox: q('.shop-price'),
                buy: q('.shop-buy'),
                buyLabel: q('.shop-buy span'),
                freeze: q('.shop-freeze'),
                stamp: q('.shop-stamp'),
                rect: null
            });
        }
    }

    /** Poeirinha dourada subindo no fundo da loja (CSS puro, posições sorteadas uma vez). */
    buildMotes() {
        const box = this.root.querySelector('.shop-motes');
        for (let i = 0; i < MOTE_COUNT; i++) {
            const mote = document.createElement('i');
            mote.style.setProperty('--x', `${(Math.random() * 100).toFixed(1)}%`);
            mote.style.setProperty('--s', `${(2 + Math.random() * 3).toFixed(1)}px`);
            mote.style.setProperty('--d', `${(5 + Math.random() * 6).toFixed(2)}s`);
            mote.style.setProperty('--delay', `${(-Math.random() * 10).toFixed(2)}s`);
            mote.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 90)}px`);
            box.appendChild(mote);
        }
    }

    bindEvents() {
        this.button.addEventListener('click', () => {
            if (this.isOpen) this.close();
            else this.open();
        });
        this.closeBtn.addEventListener('click', () => this.close());
        this.root.querySelector('.shop-backdrop').addEventListener('click', () => this.close());
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
        this.rerollBtn.addEventListener('click', () => this.tryReroll());

        for (let slot = 0; slot < SLOTS; slot++) {
            const s = this.slots[slot];
            s.buy.addEventListener('click', () => this.tryBuy(slot));
            s.freeze.addEventListener('click', () => this.tryFreeze(slot));
            s.el.addEventListener('pointerenter', () => {
                s.rect = s.tilt.getBoundingClientRect();
                if (this.hasItem(slot)) this.audio.play(SFX.HOVER);
            });
            s.el.addEventListener('pointermove', (e) => this.tilt(s, e));
            s.el.addEventListener('pointerleave', () => {
                s.rect = null;
                s.tilt.style.setProperty('--rx', '0deg');
                s.tilt.style.setProperty('--ry', '0deg');
            });
        }

        this.viewport.onChange(() => {
            if (this.isOpen) this.resizeCanvases();
        });
        globalEvents.on('LANGUAGE_CHANGED', () => {
            for (let slot = 0; slot < SLOTS; slot++) this.renderSlot(slot);
            this.renderFooter();
        });
    }

    /** Inclinação 3D seguindo o ponteiro (só escreve variáveis CSS usadas num transform). */
    tilt(s, e) {
        const r = s.rect;
        if (!r) return;
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        s.tilt.style.setProperty('--rx', `${(-ny * 10).toFixed(2)}deg`);
        s.tilt.style.setProperty('--ry', `${(nx * 14).toFixed(2)}deg`);
    }

    /** Música da loja: pausa a principal (mantendo a posição) e retoma a da loja de onde parou, com fade. */
    setupMusic() {
        this.music = this.audio.music;
        this.shopTrack = this.music ? this.music.get('SHOP_THEME') : null;
        if (this.shopTrack) {
            this.shopTrack.on('error', () => {
                // Arquivo ainda não existe: volta pra música principal em vez de deixar a loja muda
                if (this.music.currentName === 'SHOP_THEME') this.music.play('MAIN_THEME', { fade: ANIM.MUSIC_FADE_S });
            });
        }
    }

    // --- Abrir / fechar ------------------------------------------------------

    open(keepAlt = false) {
        if (this.alt && !keepAlt) this.leaveAlt();
        if (this.isOpen) return;
        if (!this.available) {
            this.audio.play(SFX.SHOP_DENY);
            this.pulse(this.button, 'deny-btn', 400);
            this.toast(i18n.t('SHOP_ONLY_PREP'));
            return;
        }
        console.log('[Shop] Abrindo a loja.');
        clearTimeout(this.closeTimer);
        this.isOpen = true;
        this.root.hidden = false;
        this.root.classList.remove('closing');
        this.button.classList.remove('has-new');
        this.resizeCanvases();
        for (let slot = 0; slot < SLOTS; slot++) this.renderSlot(slot);
        this.renderFooter();
        this.audio.play(SFX.SHOP_OPEN);
        if (this.shopTrack && !this.shopTrack.failed) this.music.play('SHOP_THEME', { fade: ANIM.MUSIC_FADE_S });

        // Explosão dourada de boas-vindas saindo do centro da janela
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.particles.emitBurst(w / 2, h / 2, '#ffd700', 60, 700, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(w / 2, h / 2, '#fff3b0', 30, 450, PARTICLE_TYPES.CIRCLE);
        this.startLoop();
    }

    close() {
        if (!this.isOpen) return;
        console.log('[Shop] Fechando a loja.');
        this.isOpen = false;
        this.root.classList.add('closing');
        this.audio.play(SFX.SHOP_CLOSE);
        if (this.music && this.music.currentName === 'SHOP_THEME') this.music.play('MAIN_THEME', { fade: ANIM.MUSIC_FADE_S });
        clearTimeout(this.closeTimer);
        this.closeTimer = setTimeout(() => {
            this.root.hidden = true;
            this.root.classList.remove('closing');
            this.stopLoop();
            if (this.alt) this.leaveAlt();
        }, CLOSE_MS);
    }

    /** Abre a janela com a vitrine alternativa (ou troca pra ela, se a loja já estiver aberta). */
    openAlt() {
        if (!this.available) {
            this.open();
            return;
        }
        if (!this.altList) this.altList = buildAltList();
        if (!this.alt) {
            this.baseItems = this.items;
            this.alt = true;
            this.root.classList.add('shop-alt');
        }
        this.items = this.makeAltItems();
        this.previewDrawn.fill(0);
        if (!this.isOpen) {
            this.open(true);
            return;
        }
        clearTimeout(this.closeTimer);
        for (let slot = 0; slot < SLOTS; slot++) this.renderSlot(slot);
        this.renderFooter();
    }

    leaveAlt() {
        this.alt = false;
        this.items = this.baseItems || this.items;
        this.baseItems = null;
        this.previewDrawn.fill(0);
        this.root.classList.remove('shop-alt');
    }

    /** Os SLOTS itens a partir de altPos (volta ao início da lista quando passa do fim). */
    makeAltItems() {
        const list = this.altList;
        const out = new Array(SLOTS);
        for (let slot = 0; slot < SLOTS; slot++) {
            const entry = list[(this.altPos + slot) % list.length];
            const color = ALT_PLAIN.has(cardTypeName(entry.type))
                ? CONFIG.COLOR.BLACK
                : CONFIG.BASIC_COLORS[Math.floor(Math.random() * CONFIG.BASIC_COLORS.length)];
            const item = { type: entry.type, color, power: entry.power, price: 0, fullPrice: 0, flags: 0, face: '', key: '' };
            item.face = `${item.type}|${item.color}|${item.power}`;
            item.key = `${item.face}|0|0|0|${this.altPos}`;
            out[slot] = item;
        }
        return out;
    }

    /** A loja só abre na preparação; fora dela, fecha sozinha (ex.: o combate começou). */
    setAvailable(available) {
        if (available === this.available) return;
        this.available = available;
        this.button.classList.toggle('locked', !available);
        if (!available && this.isOpen) this.close();
    }

    // --- Estado vindo do servidor -------------------------------------------

    /**
     * @param {import('../network/protocol.js').SnapshotView} view
     * @param {boolean} available fase de preparação (a loja pode abrir e comprar)
     */
    sync(view, available) {
        this.handSize = view.handSize();
        this.rerollCost = view.rerollCost;
        this.roundsLeft = view.shopRoundsLeft;
        this.setCoins(view.coins);

        const items = this.alt ? this.baseItems : this.items;
        for (let slot = 0; slot < SLOTS; slot++) {
            const item = {
                type: view.shopType[slot], color: view.shopColor[slot], power: view.shopPower[slot],
                price: view.shopPrice[slot], fullPrice: view.shopFullPrice[slot], flags: view.shopFlags[slot]
            };
            item.face = `${item.type}|${item.color}|${item.power}`;
            item.key = `${item.face}|${item.price}|${item.fullPrice}|${item.flags}`;
            const prev = items[slot];
            const forced = (this.forceFlipMask & (1 << slot)) !== 0;
            if (prev && prev.key === item.key && !forced) continue;
            items[slot] = item;
            if (this.alt) continue;
            this.previewDrawn[slot] = 0; // a face nova aparece já no próximo frame, como antes (mesmo durante o giro)
            this.forceFlipMask &= ~(1 << slot);

            const replaced = prev && (prev.face !== item.face || ((prev.flags & SHOP_ITEM_FLAGS.SOLD) && !(item.flags & SHOP_ITEM_FLAGS.SOLD)));
            if (this.isOpen && (replaced || forced)) this.flipSwap(slot);
            else this.renderSlot(slot);
            if (this.isOpen && prev && !replaced) this.flagEffects(slot, prev.flags, item.flags);
        }

        this.renderFooter();
        this.setAvailable(available);
        this.synced = true;
    }

    hasItem(slot) {
        const item = this.items[slot];
        return !!item && item.type !== CARD_TYPES.HIDDEN;
    }

    // --- Desenho dos itens ---------------------------------------------------

    renderSlot(slot) {
        const s = this.slots[slot];
        const item = this.items[slot];
        const el = s.el;
        if (!item || item.type === CARD_TYPES.HIDDEN) {
            el.style.visibility = 'hidden';
            return;
        }
        el.style.visibility = '';
        const name = cardTypeName(item.type);
        const sold = (item.flags & SHOP_ITEM_FLAGS.SOLD) !== 0;
        const frozen = (item.flags & SHOP_ITEM_FLAGS.FROZEN) !== 0;
        const deal = (item.flags & SHOP_ITEM_FLAGS.DISCOUNT) !== 0 && item.fullPrice > item.price;

        el.classList.toggle('is-sold', sold);
        el.classList.toggle('is-frozen', frozen);
        el.classList.toggle('is-deal', deal && !sold);
        el.style.setProperty('--accent', item.type === CARD_TYPES.NUMBER ? COLOR_HEX[item.color] : (ACCENT[name] || '#9b59b6'));

        s.name.textContent = i18n.t(cardNameKey(item.type), { n: item.power });
        s.desc.textContent = i18n.t(`DESC_${name}`, { n: item.power });
        s.price.textContent = String(item.price);
        s.oldPrice.textContent = deal ? String(item.fullPrice) : '';
        s.deal.textContent = i18n.t('SHOP_DEAL');
        s.buyLabel.textContent = i18n.t('SHOP_BUY');
        s.stamp.textContent = i18n.t('SHOP_BOUGHT');
        const freezeLabel = i18n.t(frozen ? 'SHOP_UNFREEZE' : 'SHOP_FREEZE');
        s.freeze.setAttribute('aria-label', freezeLabel);
        s.freeze.title = freezeLabel;
        s.buy.classList.toggle('poor', !sold && item.price > this.coins);
        this.drawCard(slot);
    }

    renderFooter() {
        if (this.alt) {
            this.rerollCostEl.textContent = '0';
            this.rerollBtn.classList.remove('poor');
            return;
        }
        const n = this.roundsLeft;
        this.refreshText.textContent = n <= 1 ? i18n.t('SHOP_REFRESH_NEXT') : i18n.t('SHOP_REFRESH_IN', { n });
        this.refreshEl.classList.toggle('soon', n <= 1);
        this.rerollCostEl.textContent = String(this.rerollCost);
        this.rerollBtn.classList.toggle('poor', this.rerollCost > this.coins);

        let frozenSlot = -1;
        for (let slot = 0; slot < SLOTS; slot++) {
            const item = this.items[slot];
            if (item && (item.flags & SHOP_ITEM_FLAGS.FROZEN)) frozenSlot = slot;
        }
        for (let slot = 0; slot < SLOTS; slot++) {
            const item = this.items[slot];
            if (!item) continue;
            const sold = (item.flags & SHOP_ITEM_FLAGS.SOLD) !== 0;
            this.slots[slot].buy.classList.toggle('poor', !sold && item.price > this.coins);
            this.slots[slot].freeze.classList.toggle('locked', frozenSlot !== -1 && frozenSlot !== slot);
        }
    }

    /** Backbuffer das prévias bate 1:1 com os pixels reais (escala da HUD x densidade da tela). */
    resizeCanvases() {
        const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.VIEW.MAX_DPR);
        this.cardDensity = (CARD_CSS_WIDTH / CARD_UNITS.WIDTH) * (this.viewport.uiScale * 1.25) * dpr;
        // px do canvas por px CSS (a carta tem CARD_CSS_WIDTH px pra CARD_UNITS.WIDTH unidades)
        this.previewPad = Math.round(PREVIEW_PAD_CSS * this.cardDensity * CARD_UNITS.WIDTH / CARD_CSS_WIDTH);
        for (const s of this.slots) {
            s.canvas.width = Math.round(CARD_UNITS.WIDTH * this.cardDensity) + this.previewPad * 2;
            s.canvas.height = Math.round(CARD_UNITS.HEIGHT * this.cardDensity) + this.previewPad * 2;
        }
        // Redimensionar apaga os canvas: as prévias estáticas e o canvas de partículas recomeçam limpos
        this.previewDrawn.fill(0);
        this.fxDpr = dpr;
        this.fxCanvas.width = Math.round(window.innerWidth * dpr);
        this.fxCanvas.height = Math.round(window.innerHeight * dpr);
        this.fxDirty = false;
        this.particles.setBounds(window.innerWidth, window.innerHeight);
        this.paintRays(Math.min(RAYS_MAX_PX, Math.round(RAYS_CSS_SIZE * this.viewport.uiScale * dpr)));
    }

    /**
     * Pinta os raios do fundo uma única vez, já esmaecidos (o mesmo que o antigo repeating-conic-gradient +
     * mask-image radial). Assim o giro em CSS é só um transform de uma textura pronta, sem máscara por frame.
     * @param {number} px lado do backbuffer em pixels físicos
     */
    paintRays(px) {
        if (px === this.raysPx || px <= 0) return;
        this.raysPx = px;
        const c = this.raysCanvas;
        c.width = px;
        c.height = px;
        const g = c.getContext('2d');
        const half = RAYS_CSS_SIZE / 2;
        g.setTransform(px / RAYS_CSS_SIZE, 0, 0, px / RAYS_CSS_SIZE, 0, 0);
        g.fillStyle = `rgba(255, 215, 0, ${RAY_ALPHA})`;
        // conic-gradient começa às 12h (CSS 0deg); no canvas o ângulo 0 aponta para as 3h
        const step = (Math.PI * 2) / RAY_COUNT;
        const arc = (RAY_ARC_DEG * Math.PI) / 180;
        const reach = half * Math.SQRT2 + 2;
        g.beginPath();
        for (let i = 0; i < RAY_COUNT; i++) {
            const a0 = i * step - Math.PI / 2;
            g.moveTo(half, half);
            g.arc(half, half, reach, a0, a0 + arc);
            g.closePath();
        }
        g.fill();
        // Máscara radial "circle" do CSS: o raio do gradiente vai até o canto mais distante (farthest-corner)
        const fade = g.createRadialGradient(half, half, 0, half, half, half * Math.SQRT2);
        fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
        fade.addColorStop(RAY_FADE_FROM, 'rgba(0, 0, 0, 1)');
        fade.addColorStop(RAY_FADE_TO, 'rgba(0, 0, 0, 0)');
        fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = fade;
        g.fillRect(0, 0, RAYS_CSS_SIZE, RAYS_CSS_SIZE);
        g.globalCompositeOperation = 'source-over';
        console.log(`[Shop] Raios do fundo pintados em ${px}x${px}px.`);
    }

    drawCard(slot) {
        const item = this.items[slot];
        if (!this.painter || !item || item.type === CARD_TYPES.HIDDEN) return;
        const { ctx, canvas } = this.slots[slot];
        const d = this.cardDensity;
        const pad = this.previewPad;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(d, 0, 0, d, pad, pad);
        this.painter(ctx, item.type, item.color, item.power, 11 + slot * 7, d);
        // Antes da fonte carregar o pintor usa um fallback: a prévia estática segue sendo repintada até sair a certa
        // (a animada é repintada todo frame de qualquer jeito, então nem consulta a fonte)
        if (!this.isAnimatedPreview(slot)) this.previewDrawn[slot] = previewFontReady() ? 1 : 0;
    }

    /** A face tem laminado/efeito vivo (precisa ser repintada a cada frame)? */
    isAnimatedPreview(slot) {
        const item = this.items[slot];
        if (!item) return false;
        const visual = CONFIG.CARD_VISUALS[item.type];
        return !!(visual && visual.fx);
    }

    /** Troca o conteúdo do item com um giro (sai de lado, troca, volta com impulso). */
    flipSwap(slot) {
        const s = this.slots[slot];
        clearTimeout(this.flipTimers[slot]);
        s.el.classList.remove('flip-in');
        s.el.classList.add('flip-out');
        this.flipTimers[slot] = setTimeout(() => {
            s.el.classList.remove('flip-out');
            this.renderSlot(slot);
            void s.el.offsetWidth;
            s.el.classList.add('flip-in');
            const c = this.center(s.canvas);
            this.particles.emitBurst(c.x, c.y, '#b36bff', 26, 320, PARTICLE_TYPES.STAR);
            this.particles.emitBurst(c.x, c.y, '#ffffff', 12, 200, PARTICLE_TYPES.CIRCLE);
            this.flipTimers[slot] = setTimeout(() => s.el.classList.remove('flip-in'), 450);
        }, FLIP_OUT_MS);
    }

    /** Efeitos de mudança de estado confirmada pelo servidor (ex.: congelou pelo outro caminho). */
    flagEffects(slot, before, after) {
        const froze = !(before & SHOP_ITEM_FLAGS.FROZEN) && (after & SHOP_ITEM_FLAGS.FROZEN);
        if (froze && !this.slots[slot].el.dataset.optimistic) this.iceBurst(slot);
        delete this.slots[slot].el.dataset.optimistic;
    }

    // --- Ações do jogador ------------------------------------------------------

    canAct() {
        return this.isOpen && this.available;
    }

    tryBuy(slot) {
        if (!this.canAct() || this.pendingBuy >= 0 || !this.hasItem(slot)) return;
        if (this.alt) {
            if (this.handSize >= CONFIG.MAX_HAND_SIZE) {
                this.deny(slot, 'HAND_FULL');
                return;
            }
            this.pendingBuy = slot;
            this.slots[slot].buy.classList.add('pending');
            this.audio.play(SFX.CLICK);
            this.armPendingTimeout();
            if (this.onAltBuy) this.onAltBuy(slot, this.items[slot]);
            return;
        }
        const reason = purchaseBlockReason(this.items[slot], this.coins, this.handSize);
        if (reason) {
            this.deny(slot, reason);
            return;
        }
        console.log(`[Shop] Pedindo compra do item ${slot + 1}.`);
        this.pendingBuy = slot;
        this.slots[slot].buy.classList.add('pending');
        this.audio.play(SFX.CLICK);
        this.armPendingTimeout();
        if (this.onBuy) this.onBuy(slot);
    }

    tryReroll() {
        if (!this.canAct() || this.pendingReroll) return;
        if (this.alt) {
            this.altPos = (this.altPos + SLOTS) % this.altList.length;
            this.items = this.makeAltItems();
            this.audio.play(SFX.SHOP_REROLL);
            this.pulse(this.rerollBtn, 'spinning', 1000);
            for (let slot = 0; slot < SLOTS; slot++) {
                this.previewDrawn[slot] = 0;
                this.flipSwap(slot);
            }
            return;
        }
        if (this.coins < this.rerollCost) {
            this.audio.play(SFX.SHOP_DENY);
            this.pulse(this.rerollBtn, 'deny-btn', 400);
            this.pulse(this.shopWallet, 'drop', 400);
            this.showMessage(i18n.t('SHOP_NO_COINS'));
            return;
        }
        this.pendingReroll = true;
        this.audio.play(SFX.CLICK);
        this.armPendingTimeout();
        if (this.onReroll) this.onReroll();
    }

    /** Nenhum outro slot pode já estar congelado (só 1 por vez — CONFIG.SHOP.MAX_FROZEN). */
    frozenElsewhere(slot) {
        for (let i = 0; i < SLOTS; i++) {
            if (i !== slot && this.slots[i].el.classList.contains('is-frozen')) return true;
        }
        return false;
    }

    /** Congelar é otimista: o gelo aparece na hora e o snapshot confirma (ou o REJECTED desfaz). */
    tryFreeze(slot) {
        if (this.alt || !this.canAct() || !this.hasItem(slot)) return;
        const item = this.items[slot];
        if (item.flags & SHOP_ITEM_FLAGS.SOLD) return;
        const s = this.slots[slot];
        const willFreeze = !s.el.classList.contains('is-frozen');
        if (willFreeze && this.frozenElsewhere(slot)) {
            this.deny(slot, 'FREEZE_LIMIT');
            return;
        }
        s.el.classList.toggle('is-frozen', willFreeze);
        s.el.dataset.optimistic = '1';
        if (willFreeze) this.iceBurst(slot);
        else {
            this.audio.play(SFX.SHOP_UNFREEZE);
            const c = this.center(s.canvas);
            this.particles.emitBurst(c.x, c.y, '#9fe8ff', 18, 240, PARTICLE_TYPES.CIRCLE);
        }
        if (this.onFreeze) this.onFreeze(slot);
    }

    iceBurst(slot) {
        this.audio.play(SFX.SHOP_FREEZE);
        const c = this.center(this.slots[slot].canvas);
        this.particles.emitBurst(c.x, c.y, '#bfefff', 40, 380, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(c.x, c.y, '#ffffff', 20, 260, PARTICLE_TYPES.CIRCLE);
    }

    deny(slot, reason) {
        this.audio.play(SFX.SHOP_DENY);
        const s = this.slots[slot];
        this.pulse(s.el, 'deny', 450);
        if (reason === 'NOT_ENOUGH_COINS') {
            this.pulse(this.shopWallet, 'drop', 400);
            const c = this.center(s.priceBox);
            this.particles.emitBurst(c.x, c.y, '#ff4d4d', 18, 200, PARTICLE_TYPES.SQUARE);
        }
        this.showMessage(i18n.t(REASON_KEYS[reason] || 'SHOP_UNAVAILABLE'));
    }

    armPendingTimeout() {
        clearTimeout(this.pendingTimer);
        // Rede caiu no meio do pedido: nunca deixa o botão preso girando
        this.pendingTimer = setTimeout(() => this.clearPending(), PENDING_TIMEOUT_MS);
    }

    clearPending() {
        clearTimeout(this.pendingTimer);
        if (this.pendingBuy >= 0) this.slots[this.pendingBuy].buy.classList.remove('pending');
        this.pendingBuy = -1;
        this.pendingReroll = false;
    }

    // --- Eventos do servidor --------------------------------------------------

    /** @param {object} evt EVENT.SHOP_* / COINS_EARNED (todos privados deste jogador) */
    handleEvent(evt) {
        switch (evt.t) {
            case EVENT.SHOP_PURCHASED: this.onPurchased(evt.slot); break;
            case EVENT.SHOP_REROLLED: this.onRerolled(); break;
            case EVENT.SHOP_REFRESHED: this.onRefreshed(); break;
            case EVENT.COINS_EARNED: this.onCoinsEarned(evt.amount); break;
        }
    }

    onPurchased(slot) {
        this.clearPending();
        const s = this.slots[slot];
        if (!s) return;
        this.audio.play(SFX.SHOP_BUY);
        this.pulse(s.el, 'just-bought', 520);
        const card = this.center(s.canvas);
        const wallet = this.center(this.shopWallet);
        // Moedas voando da carteira até o item, e o item explodindo em brilho e confete
        this.particles.emitLine(wallet.x, wallet.y, card.x, card.y, '#ffd700', 40, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(card.x, card.y, '#ffd700', 60, 520, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(card.x, card.y, '#ffffff', 26, 380, PARTICLE_TYPES.CIRCLE);
        const confetti = ['#ff3b6b', '#2ecc71', '#3498db', '#f1c40f', '#b36bff'];
        for (let i = 0; i < confetti.length; i++) {
            this.particles.emitBurst(card.x, card.y, confetti[i], 10, 620, PARTICLE_TYPES.SQUARE, 1.3);
        }
    }

    onRerolled() {
        this.clearPending();
        this.audio.play(SFX.SHOP_REROLL);
        this.pulse(this.rerollBtn, 'spinning', 1000);
        const from = this.center(this.shopWallet);
        const to = this.center(this.rerollBtn);
        this.particles.emitLine(from.x, from.y, to.x, to.y, '#ffd700', 24, PARTICLE_TYPES.STAR);
        this.markFlipsForUnfrozen();
    }

    onRefreshed() {
        this.audio.play(SFX.SHOP_REFRESH);
        if (this.isOpen) {
            this.showMessage(i18n.t('SHOP_REFRESHED'), true);
            this.markFlipsForUnfrozen();
        } else {
            this.button.classList.add('has-new');
            this.toast(i18n.t('SHOP_REFRESHED'));
        }
    }

    /** Toda carta não congelada gira na troca, mesmo se o sorteio repetir a mesma face. */
    markFlipsForUnfrozen() {
        for (let slot = 0; slot < SLOTS; slot++) {
            const item = this.items[slot];
            if (item && !(item.flags & SHOP_ITEM_FLAGS.FROZEN)) this.forceFlipMask |= 1 << slot;
        }
    }

    onCoinsEarned(amount) {
        this.audio.play(SFX.COIN);
        const gain = document.createElement('span');
        gain.className = 'wallet-gain';
        gain.textContent = `+${amount}`;
        this.wallet.appendChild(gain);
        setTimeout(() => gain.remove(), 1350);
    }

    /** @param {{ input: number, reason: string }} evt EVENT.REJECTED de um input da loja */
    onRejected(evt) {
        if ((evt.input === INPUT.SHOP_BUY || evt.input === INPUT.SYNC_HINT) && this.pendingBuy >= 0) this.deny(this.pendingBuy, evt.reason);
        else if (evt.input === INPUT.SHOP_REROLL) {
            this.audio.play(SFX.SHOP_DENY);
            this.showMessage(i18n.t(REASON_KEYS[evt.reason] || 'SHOP_UNAVAILABLE'));
        } else if (evt.input === INPUT.SHOP_FREEZE) {
            for (let slot = 0; slot < SLOTS; slot++) this.renderSlot(slot);
            this.audio.play(SFX.SHOP_DENY);
            this.showMessage(i18n.t(REASON_KEYS[evt.reason] || 'SHOP_UNAVAILABLE'));
        }
        this.clearPending();
    }

    // --- Moedas ----------------------------------------------------------------

    setCoins(value) {
        if (value === this.coins && this.synced) return;
        const before = this.coins;
        this.coins = value;
        if (!this.synced) {
            this.shownCoins = value;
            this.writeCoins(value);
            return;
        }
        if (value > before) {
            this.pulse(this.wallet, 'pop', 460);
            this.pulse(this.shopWallet, 'pop', 460);
        } else {
            this.pulse(this.wallet, 'drop', 420);
            this.pulse(this.shopWallet, 'drop', 420);
        }
        this.animateCoins(value);
    }

    /** Contador rolando até o valor novo (só texto, ~450ms). */
    animateCoins(target) {
        cancelAnimationFrame(this.coinTween);
        const start = this.shownCoins;
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / 450);
            const eased = 1 - (1 - t) * (1 - t);
            const shown = Math.round(start + (target - start) * eased);
            if (shown !== this.shownCoins) {
                this.shownCoins = shown;
                this.writeCoins(shown);
            }
            if (t < 1) this.coinTween = requestAnimationFrame(step);
        };
        this.coinTween = requestAnimationFrame(step);
    }

    writeCoins(n) {
        const text = String(n);
        this.walletCoins.textContent = text;
        this.shopCoins.textContent = text;
    }

    // --- Utilitários ---------------------------------------------------------

    center(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    /** Centro (px de tela) da carta de um item: é dali que a carta comprada nasce no jogo. */
    itemCenter(slot) {
        return this.center(this.slots[slot].canvas);
    }

    walletCenter() {
        return this.center(this.wallet);
    }

    /** Reinicia uma animação CSS curta (remove, força recálculo, recoloca e some sozinha). */
    pulse(el, cls, ms) {
        let timers = this.pulseTimers.get(el);
        if (!timers) {
            timers = {};
            this.pulseTimers.set(el, timers);
        }
        clearTimeout(timers[cls]);
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        timers[cls] = setTimeout(() => el.classList.remove(cls), ms);
    }

    showMessage(text, good = false) {
        const el = this.messageEl;
        el.textContent = text;
        el.classList.toggle('good', good);
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
        clearTimeout(this.messageTimer);
        this.messageTimer = setTimeout(() => el.classList.remove('show'), MESSAGE_MS);
    }

    toast(text) {
        const el = document.createElement('span');
        el.className = 'shop-btn-toast';
        el.textContent = text;
        this.button.appendChild(el);
        setTimeout(() => el.remove(), 2450);
    }

    // --- Loop (só com a loja aberta) ----------------------------------------

    startLoop() {
        if (this.loopId) return;
        this.lastFrame = performance.now();
        this.loopId = requestAnimationFrame(this._frame);
    }

    stopLoop() {
        cancelAnimationFrame(this.loopId);
        this.loopId = 0;
        this.fxCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.fxCtx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
        this.fxDirty = false;
    }

    frame(now) {
        const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
        this.lastFrame = now;
        this.particles.update(dt);

        // Canvas de tela cheia: tocar nele (mesmo só limpar) força reenviar a textura inteira à GPU. Sem partícula
        // viva ele já está vazio, então só é limpo uma última vez quando a última partícula morre
        const alive = this.particles.activeCount > 0;
        if (alive || this.fxDirty) {
            const ctx = this.fxCtx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
            if (alive) {
                ctx.setTransform(this.fxDpr, 0, 0, this.fxDpr, 0, 0);
                this.particles.draw(ctx);
            }
            this.fxDirty = alive;
        }

        // Prévias ao vivo: o laminado/efeitos animados continuam rodando; faces estáticas são pintadas uma vez
        // Prévias animadas a no máximo ~60 fps (PREVIEW_MIN_FRAME_MS); estáticas ainda não pintadas saem na hora
        this.previewAcc += dt * 1000;
        const animate = this.previewAcc >= PREVIEW_MIN_FRAME_MS;
        if (animate) this.previewAcc = 0;

        // Laminados das prévias animadas pintados num atlas antes do 1º carimbo (uma foto por frame, não por carta)
        if (animate && this.foils) {
            this.foils.begin();
            for (let slot = 0; slot < SLOTS; slot++) {
                const item = this.items[slot];
                if (item && this.isAnimatedPreview(slot)) this.foils.prepare(item.type, item.color, 11 + slot * 7);
            }
        }
        for (let slot = 0; slot < SLOTS; slot++) {
            if (this.isAnimatedPreview(slot) ? animate : !this.previewDrawn[slot]) this.drawCard(slot);
        }

        this.loopId = requestAnimationFrame(this._frame);
    }
}
