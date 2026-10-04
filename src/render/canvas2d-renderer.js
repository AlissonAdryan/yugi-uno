import { CONFIG } from '../config/constants.js';
import { CardArt, drawHealIcon, drawShieldIcon } from './card-art.js';
import { CardEffects } from './card-effects.js';
import { ZONE, zoneSeat } from '../utils/zones.js';
import { GRAPHICS } from '../config/graphics.js';
import { drawRonovaBurn, drawRonovaCardFlames, drawRonovaLive } from './death-art.js';

const { CARD_TYPES, COLOR_HEX, COLOR, CARD_DIMENSIONS, CARD_VISUALS } = CONFIG;
const NUMBER_LABELS = Array.from({ length: 64 }, (_, i) => String(i));
const HEART_LABELS = Array.from({ length: 64 }, (_, i) => `♥ ${i}`);
const DECK_PILE_MAX = 5;
const WHEEL_COLORS = [COLOR.RED, COLOR.BLUE, COLOR.GREEN, COLOR.YELLOW];
const WHEEL_STARTS = [Math.PI, Math.PI * 1.5, 0, Math.PI * 0.5];
const FRAME_MS = 1000 / 60;

const OUTLINE = CONFIG.PLAYABLE_OUTLINE;
const OUTLINE_POS = -OUTLINE.PADDING;
const OUTLINE_W = CARD_DIMENSIONS.WIDTH + OUTLINE.PADDING * 2;
const OUTLINE_H = CARD_DIMENSIONS.HEIGHT + OUTLINE.PADDING * 2;
const OUTLINE_R = CARD_DIMENSIONS.RADIUS + OUTLINE.PADDING;
// Período que divide o perímetro exatamente: o padrão tracejado fecha o laço sem emenda visível
const OUTLINE_PERIMETER = 2 * (OUTLINE_W + OUTLINE_H) - 8 * OUTLINE_R + 2 * Math.PI * OUTLINE_R;
const OUTLINE_PERIOD = OUTLINE_PERIMETER / OUTLINE.DASH_COUNT;
const OUTLINE_DASH = [OUTLINE_PERIOD * OUTLINE.DASH_FILL, OUTLINE_PERIOD * (1 - OUTLINE.DASH_FILL)];
const NO_DASH = [];
// Brilho em volta da carta (pool.glowKind): 1 Maldição (roxo), 2 Emboscada (verde), 3 Fantasma, 4 Espelho
const CARD_GLOW = [
    null,
    { wide: 'rgba(170, 60, 255, 0.35)', line: '#d9a6ff', tint: 'rgba(150, 40, 230, 0.22)' },
    { wide: 'rgba(57, 255, 20, 0.3)', line: '#9dff7a', tint: 'rgba(57, 255, 20, 0.16)' },
    { wide: 'rgba(190, 170, 255, 0.3)', line: '#e6dcff', tint: 'rgba(190, 170, 255, 0.14)' },
    { wide: 'rgba(210, 200, 255, 0.35)', line: '#ffffff', tint: 'rgba(210, 200, 255, 0.18)' },
    // 5 = Reverso Kármico (fita VHS: magenta/ciano), 6 = Prisão de Cristal (vidro gelado)
    { wide: 'rgba(255, 0, 200, 0.32)', line: '#7ff6ff', tint: 'rgba(120, 0, 255, 0.16)' },
    { wide: 'rgba(143, 233, 255, 0.38)', line: '#ffffff', tint: 'rgba(200, 245, 255, 0.34)' },
    // 7 = Ronova (força sendo drenada pelas chamas carmesim)
    { wide: 'rgba(255, 30, 55, 0.4)', line: '#ff8a94', tint: 'rgba(200, 0, 30, 0.26)' }
];
// Rachaduras da Maldição na carta: 4 variações fixas (a carta usa id % 4), pintadas progressivamente
const CARD_CRACKS = (() => {
    let state = 0xc0ffee;
    const rand = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const sets = [];
    for (let v = 0; v < 4; v++) {
        const cracks = [];
        const cx = CARD_DIMENSIONS.WIDTH * (0.35 + rand() * 0.3);
        const cy = CARD_DIMENSIONS.HEIGHT * (0.35 + rand() * 0.3);
        for (let c = 0; c < 6; c++) {
            const pts = new Float32Array(12);
            let x = cx;
            let y = cy;
            const base = (c / 6) * Math.PI * 2 + rand() * 0.6;
            pts[0] = x;
            pts[1] = y;
            for (let k = 1; k < 6; k++) {
                const a = base + (rand() - 0.5) * 1;
                const len = 8 + rand() * 11;
                x += Math.cos(a) * len;
                y += Math.sin(a) * len;
                pts[k * 2] = x;
                pts[k * 2 + 1] = y;
            }
            cracks.push(pts);
        }
        sets.push(cracks);
    }
    return sets;
})();
const CRACK_STYLE_GOLD = ['rgba(255, 190, 40, 0.55)', '#ffffff'];
const CRACK_STYLE_CURSE = ['rgba(190, 80, 255, 0.7)', '#f3e3ff'];
const GLITCH_STRIPS = 5;
const MIRROR_GLYPH_FONT = '44px Righteous';
const MIRROR_NUMBER_FONT = '40px Righteous';
const MIRROR_TINT = ['#ffffff', '#ff2a3d'];
const MIRROR_TINT_GLOW = ['rgba(200, 180, 255, 0.9)', 'rgba(255, 30, 50, 0.95)'];
const AMBUSH_DASH = [3, 5];
// Troca de Guarda armada: órbita tracejada em volta de Ataque + Defesa
const SWAP_DASH = [10, 8];
const ZONE_SELF_ATTACK = ZONE.SELF_ATTACK;
const ZONE_SELF_DEFENSE = ZONE.SELF_DEFENSE;
const ZONE_OPP_ATTACK = ZONE.OPP_ATTACK;
const ZONE_OPP_DEFENSE = ZONE.OPP_DEFENSE;

// Pintar: contorno arco-íris das cartas escolhíveis (cores pré-montadas: nenhuma string criada por frame)
const HUE_STEP = 10;
const PAINT_HUE_SPEED = 140;
const HUE_LINE = Array.from({ length: 360 / HUE_STEP }, (_, i) => `hsl(${i * HUE_STEP}, 100%, 68%)`);
const HUE_GLOW = Array.from({ length: 360 / HUE_STEP }, (_, i) => `hsla(${i * HUE_STEP}, 100%, 60%, 0.35)`);
// Pintar: resolução da frente de tinta e das gotas que escorrem à frente dela
const PAINT_SEGMENTS = 40;
const PAINT_DRIP_LEN = 16;
const PAINT_DRIP_WIDTH = 5;

/**
 * Canvas2DRenderer - backend de renderização 2D (Pilar 2/7: interface draw(scene)).
 *
 * scene = { deckX, deckY, deckCount, hoveredCard, selectableZone, showcase, bolts, flash, flashColor, guardSwapArmed, ultimate }
 * ultimate = UltimateFx (Combos Supremos): fundo (relógio, rachaduras, cristais) antes das cartas, monólito e
 * cadeados depois, e o pós-processamento (tela estilhaçada, fita VHS) por último. O tremor é um transform CSS
 * no próprio canvas (compositor: não repinta nada).
 * showcase = carta gigante no centro da tela (ex.: Reviver se despedaçando), animada pelo CinematicPlayer.
 * bolts = BoltSystem (raios do Relâmpago); flash 0..1 = clarão de tela; guardSwapArmed = sinal da Troca de Guarda.
 * fx = FxLayer (anéis, correntes, fios, vinheta); ambushArmed = sinal da Emboscada; draggedCard = carta arrastada.
 */
export class Canvas2DRenderer {
    /**
     * @param {import('../core/viewport.js').Viewport} viewport
     */
    constructor(canvasElement, cardPool, particleSystem, boardSystem, viewport, onResize) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { alpha: true });
        this.pool = cardPool;
        this.particles = particleSystem;
        this.board = boardSystem;
        this.viewport = viewport;
        this.onResize = onResize;
        this.outlinePhase = 0;
        // Relógio dos efeitos animados de carta (segundos) e escala real de pixels do frame atual
        this.time = 0;
        this.pixelScale = 1;
        this.art = new CardArt();
        this.effects = new CardEffects();
        // Prévias fora da mesa (loja, painel de info): atlas de laminado próprio, pra não disputar o da mesa
        this.previewEffects = new CardEffects();
        this.glowSprite = null;
        this.paintEdge = new Float32Array(PAINT_SEGMENTS + 1);
        // Estado da carta sendo desenhada (lido por drawStyledFace sem mudar a assinatura de drawFace)
        this.faceHeld = false;
        this.faceTint = 0;
        this.shaking = false;

        this.haloHover = this.buildHaloSprite('#00ffff', 20);
        this.haloSelect = this.buildHaloSprite('#ff3333', 14);

        // Cache do verso da carta (evita Recalculate Style causado pelo ctx.font repetitivo)
        this.backSprite = null;
        // Cache universal das faces das cartas comuns (números e normais), unificando todo desenho e texto num carimbo
        this.baseFaceCache = new Map();
        // Cache do glifo/número do Espelho Sombrio
        this.mirrorGlyphCache = new Map();
        // Caches para as bordas neon animadas (Fantasma, Espelho e mira do Pintar)
        this.rimGlowCache = new Map();
        this.paintGlowSprite = null;

        this.resize();
        viewport.onChange(() => this.resize());
    }

    buildHaloSprite(color, blurPx) {
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const r = CARD_DIMENSIONS.RADIUS;
        const pad = blurPx * 2;
        const c = document.createElement('canvas');
        c.width = w + pad * 2; 
        c.height = h + pad * 2;
        const g = c.getContext('2d');
        g.shadowColor = color; 
        g.shadowBlur = blurPx;
        g.fillStyle = color;
        g.beginPath(); 
        g.roundRect(pad, pad, w, h, r); 
        g.fill();
        return { canvas: c, pad };
    }

    /** Backbuffer em pixels físicos (nítido em telas de alta densidade); o jogo desenha em coordenadas virtuais. */
    resize() {
        const vp = this.viewport;
        this.canvas.width = Math.round(vp.cssWidth * vp.dpr);
        this.canvas.height = Math.round(vp.cssHeight * vp.dpr);
        this.canvas.style.width = `${vp.cssWidth}px`;
        this.canvas.style.height = `${vp.cssHeight}px`;
        this.board.resize(vp.width, vp.height, vp.scale * vp.dpr);
        if (this.onResize) this.onResize(vp.width, vp.height);
    }

    /**
     * @param {object} scene
     * @param {number} dt ms desde o último frame
     */
    draw(scene, dt) {
        const ctx = this.ctx;
        const pool = this.pool;
        const vp = this.viewport;
        const pixelScale = vp.scale * vp.dpr;
        this.pixelScale = pixelScale;
        ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
        ctx.clearRect(0, 0, vp.width, vp.height);

        const ultimate = scene.ultimate || null;
        if (ultimate) {
            ultimate.update(dt);
            this.applyShake(ultimate.shakeX, ultimate.shakeY, vp.scale);
        }

        this.board.draw(ctx, scene.fx ? scene.fx.time : this.time);
        if (ultimate) ultimate.drawBack(ctx);
        this.drawDeckPile(scene);
        if (scene.guardSwapArmedSelf) this.drawGuardSwapSigil(0);
        if (scene.guardSwapArmedOpp) this.drawGuardSwapSigil(1);
        if (scene.ambushArmedSelf) this.drawAmbushSigil(0);
        if (scene.ambushArmedOpp) this.drawAmbushSigil(1);

        // Suavização independente de FPS (equivale a 0.4 por frame a 60fps)
        const k = 1 - Math.pow(CONFIG.ANIM.RENDER_SMOOTHING, dt / FRAME_MS);
        const width = CARD_DIMENSIONS.WIDTH;
        const height = CARD_DIMENSIONS.HEIGHT;
        this.outlinePhase = (this.outlinePhase + (dt / 1000) * OUTLINE.SPEED) % OUTLINE_PERIOD;

        pool.sortDrawOrder();
        const order = pool.drawOrder;
        this.prepareFoils(scene, order, pool.drawCount);
        for (let n = 0; n < pool.drawCount; n++) {
            const i = order[n];
            const drawX = pool.x[i] + (pool.targetX[i] - pool.x[i]) * k;
            const drawY = pool.y[i] + (pool.targetY[i] - pool.y[i]) * k;
            pool.x[i] = drawX;
            pool.y[i] = drawY;

            ctx.save();
            const zone = pool.zone[i];

            ctx.translate(drawX + width / 2, drawY + pool.hoverOffsetY[i] + height / 2);
            if (pool.rotation[i] !== 0) ctx.rotate(pool.rotation[i]);
            if (pool.scale[i] !== 1) ctx.scale(pool.scale[i], pool.scale[i]);
            ctx.translate(-width / 2, -height / 2);

            let halo = null;
            if (i === scene.hoveredCard) halo = this.haloHover;
            else if (zone === scene.selectableZone) halo = this.haloSelect;
            if (halo) {
                ctx.drawImage(halo.canvas, -halo.pad, -halo.pad);
            }

            if (pool.alpha[i] < 1) ctx.globalAlpha = Math.max(0, pool.alpha[i]);
            this.faceHeld = i === scene.hoveredCard || i === scene.draggedCard;
            this.faceTint = pool.numberTint[i];
            if (pool.type[i] === CARD_TYPES.HIDDEN) this.drawBack(ctx);
            else if (pool.paintAnim[i] === 1) this.drawPaintingFace(ctx, i);
            else this.drawFace(ctx, pool.type[i], pool.color[i], pool.power[i], i, pool.scale[i]);
            if (pool.glitch[i] > 0) this.drawGlitch(ctx, i);
            if (pool.crack[i] > 0) this.drawCracks(ctx, CARD_CRACKS[i & 3], pool.crack[i], CRACK_STYLE_CURSE);
            if (pool.glow[i] > 0 && pool.glowKind[i] > 0) this.drawCardGlow(ctx, pool.glow[i], CARD_GLOW[pool.glowKind[i]]);
            // Ronova: todas as cartas do marcado (mão, campo, frente ou verso) ardem em chamas carmesim suaves
            const seat = zoneSeat(zone);
            if ((seat === 0 && scene.ronovaSelf) || (seat === 1 && scene.ronovaOpp)) {
                drawRonovaCardFlames(ctx, this.time, i, 1);
            }
            if (pool.burn[i] > 0) drawRonovaBurn(ctx, pool.burn[i], this.time, i);
            this.faceHeld = false;
            this.faceTint = 0;

            if (pool.outlined[i] === 1) this.drawPlayableOutline(ctx);
            if (pool.paintSelected[i] === 1) this.drawPaintSelected(ctx);
            else if (pool.paintable[i] === 1) this.drawPaintableOutline(ctx, i);

            ctx.restore();
        }

        if (scene.fx) {
            scene.fx.update(dt);
            if (GRAPHICS.enableFxLayer) scene.fx.draw(ctx, vp.width, vp.height);
        }
        if (ultimate) ultimate.drawFront(ctx);
        if (scene.bolts) {
            scene.bolts.update(dt);
            scene.bolts.draw(ctx);
        }
        if (scene.flash > 0) this.drawScreenFlash(scene.flash, scene.flashColor);
        if (scene.showcase) this.drawShowcase(scene.showcase);
        this.particles.draw(ctx);
        if (ultimate) ultimate.drawPost(ctx, this.canvas, vp.width, vp.height, pixelScale);
    }

    /**
     * Pré-passada do laminado: pinta no atlas do CardEffects o efeito de toda carta que vai desenhá-lo neste
     * frame (mesmas condições e parâmetros de drawStyledFace), antes do primeiro carimbo. Assim o buffer vira
     * uma foto só por frame, em vez de uma cópia por carta (ver CardEffects). Cartas fora da lista (vitrine,
     * pintura em andamento) continuam funcionando pelo buffer avulso.
     */
    prepareFoils(scene, order, count) {
        const effects = this.effects;
        effects.beginFrame();
        if (!GRAPHICS.enableFoil) return;
        const pool = this.pool;
        for (let n = 0; n < count; n++) {
            const i = order[n];
            const type = pool.type[i];
            if (type === CARD_TYPES.HIDDEN || pool.paintAnim[i] === 1 || !(pool.alpha[i] > 0.99)) continue;
            const visual = CARD_VISUALS[type];
            if (!visual || !visual.fx) continue;
            const held = i === scene.hoveredCard || i === scene.draggedCard;
            effects.prepare(visual.fx, CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT, CARD_DIMENSIONS.RADIUS,
                this.time, i, pool.color[i], held);
        }
    }

    /**
     * Tremor de tela como transform CSS do canvas: roda no compositor (sem repintar), e só escreve o estilo
     * enquanto há tremor (ou uma vez pra zerar no fim).
     */
    applyShake(x, y, cssScale) {
        if (x === 0 && y === 0) {
            if (this.shaking) {
                this.shaking = false;
                this.canvas.style.transform = '';
            }
            return;
        }
        this.shaking = true;
        this.canvas.style.transform = `translate3d(${(x * cssScale).toFixed(1)}px, ${(y * cssScale).toFixed(1)}px, 0)`;
    }

    /** Clarão aditivo na tela inteira (ex.: o estalo do Relâmpago). `color` = 'r, g, b'. */
    drawScreenFlash(amount, color) {
        const ctx = this.ctx;
        const vp = this.viewport;
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.globalAlpha = Math.min(1, amount) * 0.42;
        ctx.fillStyle = color || '#cfefff';
        ctx.fillRect(0, 0, vp.width, vp.height);
        ctx.restore();
    }

    /**
     * Troca de Guarda armada (só quem usou vê, durante a preparação): no campo do oponente (o único que
     * troca), uma órbita tracejada envolve Ataque e Defesa com duas setas correndo — o aviso de que as
     * duas posições vão trocar. Desenhada antes das cartas (elas ficam por cima).
     */
    drawGuardSwapSigil(side) {
        const ctx = this.ctx;
        const t = this.time;
        const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        
        // O efeito visual do Guard Swap deve aparecer no campo do OPONENTE de quem usou.
        // Se side === 0 (Host usou), desenha no OPP. Se side === 1 (Opp usou), desenha no SELF.
        const atk = this.board.slots[side === 1 ? ZONE_SELF_ATTACK : ZONE_OPP_ATTACK];
        const def = this.board.slots[side === 1 ? ZONE_SELF_DEFENSE : ZONE_OPP_DEFENSE];
        if (atk && def) {
            const ax = atk.hitX + atk.hitW / 2;
            const ay = atk.hitY + atk.hitH / 2;
            const dy = def.hitY + def.hitH / 2;
            const cx = ax;
            const cy = (ay + dy) / 2;
            const rx = CARD_DIMENSIONS.HEIGHT * 0.62;
            const ry = Math.abs(dy - ay) / 2 + CARD_DIMENSIONS.HEIGHT * 0.4;

            ctx.setLineDash(SWAP_DASH);
            ctx.lineDashOffset = -t * 40 * (side === 0 ? 1 : -1);
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.28 + pulse * 0.22;
            ctx.strokeStyle = '#7fdbff';
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash(NO_DASH);

            // Duas setas opostas correndo pela órbita
            ctx.globalAlpha = 0.65 + pulse * 0.3;
            ctx.fillStyle = '#c9f1ff';
            for (let k = 0; k < 2; k++) {
                const a = t * 1.6 + k * Math.PI + side * 0.8;
                const px = cx + Math.cos(a) * rx;
                const py = cy + Math.sin(a) * ry;
                // Direção da tangente da elipse (derivada), pra ponta apontar no sentido do giro
                const tx = -Math.sin(a) * rx;
                const ty = Math.cos(a) * ry;
                const tl = Math.sqrt(tx * tx + ty * ty) || 1;
                const ux = tx / tl;
                const uy = ty / tl;
                ctx.beginPath();
                ctx.moveTo(px + ux * 9, py + uy * 9);
                ctx.lineTo(px - ux * 5 - uy * 6, py - uy * 5 + ux * 6);
                ctx.lineTo(px - ux * 5 + uy * 6, py - uy * 5 - ux * 6);
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.restore();
    }

    /**
     * Desenha uma carta num contexto externo (ex.: as prévias da loja), com os mesmos ícones, faces
     * pintadas e efeitos animados do tabuleiro. `density` = px de device por unidade de carta.
     */
    drawCardInto(ctx, type, color, power, seed, density) {
        const saved = this.pixelScale;
        const savedEffects = this.effects;
        this.pixelScale = 1;
        this.effects = this.previewEffects;
        if (type === CARD_TYPES.HIDDEN) this.drawBack(ctx);
        else this.drawFace(ctx, type, color, power, seed, density);
        this.effects = savedEffects;
        this.pixelScale = saved;
    }

    /**
     * Avança o relógio das animações das cartas (laminados, chamas). Chamado todo frame pelo cliente, mesmo nos
     * frames em que a mesa não é redesenhada: as prévias da loja usam o mesmo relógio e seguem fluidas.
     * @param {number} dt ms
     */
    advanceTime(dt) {
        this.time += dt / 1000;
    }

    /** Início de um frame das prévias (loja): esvazia o atlas de laminado delas. */
    beginPreviewFoils() {
        this.previewEffects.beginFrame();
    }

    /** Pinta no atlas das prévias o laminado de uma carta que drawCardInto vai desenhar neste frame. */
    preparePreviewFoil(type, color, seed) {
        const visual = CARD_VISUALS[type];
        if (!visual || !visual.fx || !GRAPHICS.enableFoil) return;
        this.previewEffects.prepare(visual.fx, CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT, CARD_DIMENSIONS.RADIUS,
            this.time, seed, color, false);
    }

    /** Brilho radial dourado pré-rasterizado (atrás da carta gigante); criado uma única vez. */
    getGlowSprite() {
        if (this.glowSprite) return this.glowSprite;
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const g = canvas.getContext('2d');
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255, 250, 225, 0.95)');
        grad.addColorStop(0.25, 'rgba(255, 220, 120, 0.6)');
        grad.addColorStop(0.6, 'rgba(255, 180, 40, 0.18)');
        grad.addColorStop(1, 'rgba(255, 180, 40, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        this.glowSprite = canvas;
        return canvas;
    }

    /** Carta gigante no centro (escurece a mesa, brilho atrás, rachaduras antes de se despedaçar). */
    drawShowcase(sc) {
        if (sc.dim <= 0 && sc.glow <= 0 && sc.flash <= 0 && !sc.cardVisible) return;
        const ctx = this.ctx;
        const vp = this.viewport;
        const cx = vp.width / 2;
        const cy = vp.height / 2;
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;

        ctx.save();
        if (sc.dim > 0) {
            ctx.globalAlpha = sc.dim;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, vp.width, vp.height);
        }
        if (sc.glow > 0) {
            const radius = h * Math.max(1, sc.scale) * 1.1;
            ctx.globalAlpha = sc.glow;
            ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
            ctx.drawImage(this.getGlowSprite(), cx - radius, cy - radius, radius * 2, radius * 2);
            ctx.globalCompositeOperation = 'source-over';
        }
        // Estouro do despedaçamento: clarão de luz + anel de choque se expandindo
        if (sc.flash > 0) {
            const f = sc.flash;
            const burst = h * (2.2 + (1 - f) * 2.5);
            ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
            ctx.globalAlpha = f;
            ctx.drawImage(this.getGlowSprite(), cx - burst, cy - burst, burst * 2, burst * 2);
            ctx.globalCompositeOperation = 'source-over';
            const ring = h * (0.4 + (1 - f) * 3.2);
            ctx.globalAlpha = f * 0.9;
            ctx.lineWidth = 3 + f * 10;
            ctx.strokeStyle = '#ffe9a3';
            ctx.beginPath();
            ctx.arc(cx, cy, ring, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = f * 0.6;
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(cx, cy, ring * 0.82, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (sc.cardVisible) {
            ctx.globalAlpha = sc.alpha;
            ctx.translate(cx + sc.shakeX, cy + sc.shakeY);
            ctx.rotate(sc.rotation);
            ctx.scale(sc.scale, sc.scale);
            ctx.translate(-w / 2, -h / 2);
            this.drawFace(ctx, sc.type, sc.color, 0, 7, sc.scale);
            if (sc.crack > 0) this.drawCracks(ctx, sc.cracks, sc.crack, CRACK_STYLE_GOLD);
        }
        ctx.restore();
    }

    /** Rachaduras crescendo do centro (halo dourado largo + fio branco fino, sem shadowBlur por frame). */
    drawCracks(ctx, cracks, progress, style = CRACK_STYLE_GOLD) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = style[pass];
            ctx.lineWidth = pass === 0 ? 3.2 : 1.1;
            for (let c = 0; c < cracks.length; c++) {
                const pts = cracks[c];
                const segments = (pts.length / 2) - 1;
                const shown = progress * segments;
                const whole = Math.floor(shown);
                ctx.beginPath();
                ctx.moveTo(pts[0], pts[1]);
                for (let s = 1; s <= whole; s++) ctx.lineTo(pts[s * 2], pts[s * 2 + 1]);
                if (whole < segments) {
                    const f = shown - whole;
                    const x0 = pts[whole * 2];
                    const y0 = pts[whole * 2 + 1];
                    ctx.lineTo(x0 + (pts[whole * 2 + 2] - x0) * f, y0 + (pts[whole * 2 + 3] - y0) * f);
                }
                ctx.stroke();
            }
        }
    }

    /** Traços que percorrem a borda em sentido horário (offset negativo avança no sentido do caminho do roundRect). */
    drawPlayableOutline(ctx) {
        ctx.shadowBlur = 0;
        ctx.setLineDash(OUTLINE_DASH);
        ctx.lineDashOffset = -this.outlinePhase;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.roundRect(OUTLINE_POS, OUTLINE_POS, OUTLINE_W, OUTLINE_H, OUTLINE_R);
        ctx.strokeStyle = OUTLINE.GLOW_COLOR;
        ctx.lineWidth = OUTLINE.GLOW_WIDTH;
        ctx.stroke();
        ctx.strokeStyle = OUTLINE.COLOR;
        ctx.lineWidth = OUTLINE.LINE_WIDTH;
        ctx.stroke();
    }

    /** Carta que pode ser escolhida para o Pintar: traços correndo pela borda, trocando de cor em ciclo. */
    drawPaintableOutline(ctx, seed) {
        const hue = (this.time * PAINT_HUE_SPEED + seed * 47) % 360;
        ctx.shadowBlur = 0;
        ctx.setLineDash(OUTLINE_DASH);
        ctx.lineDashOffset = -this.outlinePhase;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.roundRect(OUTLINE_POS, OUTLINE_POS, OUTLINE_W, OUTLINE_H, OUTLINE_R);
        ctx.strokeStyle = HUE_GLOW[Math.floor(hue / HUE_STEP)];
        ctx.lineWidth = OUTLINE.GLOW_WIDTH;
        ctx.stroke();
        ctx.strokeStyle = HUE_LINE[Math.floor(hue / HUE_STEP)];
        ctx.lineWidth = OUTLINE.LINE_WIDTH;
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
    }

    /**
     * Pintura em tempo real (Pintar): a face antiga (paintFrom) por baixo e a nova (color) escorrendo por
     * cima, de cima pra baixo, com a frente da tinta ondulada, gotas escorrendo à frente e um brilho
     * molhado acompanhando a borda. Só as cartas sendo pintadas passam por aqui (2 cartas, ~0,8s).
     */
    drawPaintingFace(ctx, id) {
        const pool = this.pool;
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const type = pool.type[id];
        const power = pool.power[id];
        const t = pool.paintT[id];
        const amp = CONFIG.ANIM.PAINT_WAVE_AMP;

        this.drawFace(ctx, type, pool.paintFrom[id], power, id, pool.scale[id]);
        if (t <= 0) return;

        // Frente da tinta: sai de cima do topo e passa do rodapé (as gotas descem além da onda)
        const front = -amp * 3 + t * (h + amp * 6 + PAINT_DRIP_LEN);
        const phase = this.time * 7 + id;
        const drip = Math.min(1, t * 1.6) * PAINT_DRIP_LEN;
        const edge = this.paintEdge;
        for (let s = 0; s <= PAINT_SEGMENTS; s++) {
            const x = (s / PAINT_SEGMENTS) * w;
            let y = front + Math.sin(x * 0.11 + phase) * amp + Math.sin(x * 0.047 - phase * 0.6) * amp * 0.6;
            for (let d = 0; d < CONFIG.ANIM.PAINT_DRIPS; d++) {
                const dx = 14 + ((id * 37 + d * 53) % 72);
                const k = 1 - Math.abs(x - dx) / PAINT_DRIP_WIDTH;
                if (k > 0) y += k * k * drip * (0.6 + 0.4 * ((d + id) % 3) / 2);
            }
            edge[s] = y;
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-2, -2);
        ctx.lineTo(w + 2, -2);
        for (let s = PAINT_SEGMENTS; s >= 0; s--) ctx.lineTo((s / PAINT_SEGMENTS) * w, edge[s]);
        ctx.closePath();
        ctx.clip();
        ctx.shadowBlur = 0;
        this.drawFace(ctx, type, pool.color[id], power, id, pool.scale[id]);
        ctx.restore();

        // Brilho da tinta molhada acompanhando a frente (recortado no formato da carta)
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, CARD_DIMENSIONS.RADIUS);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(0, edge[0]);
        for (let s = 1; s <= PAINT_SEGMENTS; s++) ctx.lineTo((s / PAINT_SEGMENTS) * w, edge[s]);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = COLOR_HEX[pool.color[id]] || '#ffffff';
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
    }

    getPaintGlowSprite() {
        if (this.paintGlowSprite) return this.paintGlowSprite;
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const r = CARD_DIMENSIONS.RADIUS;
        const innerPad = 4;
        const blurPad = 26;
        const pad = innerPad + blurPad;
        
        const c = document.createElement('canvas');
        c.width = w + pad * 2;
        c.height = h + pad * 2;
        const g = c.getContext('2d');
        
        g.beginPath();
        g.roundRect(blurPad, blurPad, w + innerPad * 2, h + innerPad * 2, r + innerPad / 2);
        g.strokeStyle = '#7b68ee';
        g.lineWidth = 6;
        g.shadowColor = '#7b68ee';
        g.shadowBlur = 20;
        g.stroke();
        
        this.paintGlowSprite = { canvas: c, pad };
        return this.paintGlowSprite;
    }

    /** Borda brilhante roxa pulsante quando a carta é selecionada para o Pintar. */
    drawPaintSelected(ctx) {
        const sprite = this.getPaintGlowSprite();
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
        ctx.save();
        ctx.globalAlpha = 0.4 + pulse * 0.6;
        ctx.drawImage(sprite.canvas, -sprite.pad, -sprite.pad);
        ctx.restore();
    }

    drawDeckPile(scene) {
        if (scene.deckCount <= 0) return;
        const ctx = this.ctx;
        const layers = Math.min(DECK_PILE_MAX, Math.ceil(scene.deckCount / 20));
        for (let i = 0; i < layers; i++) {
            ctx.save();
            ctx.translate(scene.deckX - i * 2, scene.deckY - i * 2);
            this.drawBack(ctx);
            ctx.restore();
        }
        if (this.lastDeckCount !== scene.deckCount) {
            this.lastDeckCount = scene.deckCount;
            const c = document.createElement('canvas');
            c.width = 60;
            c.height = 30;
            const tCtx = c.getContext('2d', { alpha: true });
            
            // Só gera o cache quando a fonte estiver pronta para evitar cachear fonte de sistema
            if (document.fonts.check('16px Righteous')) {
                tCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                tCtx.font = '16px Righteous';
                tCtx.textAlign = 'center';
                tCtx.textBaseline = 'top';
                tCtx.fillText(String(scene.deckCount), 30, 0);
                this.deckCountSprite = c;
            } else {
                this.deckCountSprite = null;
                // Força re-tentar no próximo frame (voltando lastDeckCount)
                this.lastDeckCount = -1;
            }
        }

        if (this.deckCountSprite) {
            // Desenha a imagem cacheada sem tocar em ctx.font
            ctx.drawImage(this.deckCountSprite, scene.deckX + CARD_DIMENSIONS.WIDTH / 2 - 30, scene.deckY + CARD_DIMENSIONS.HEIGHT + 6);
        } else {
            // Fallback para a primeira frame antes da fonte carregar
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '16px Righteous';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(String(scene.deckCount), scene.deckX + CARD_DIMENSIONS.WIDTH / 2, scene.deckY + CARD_DIMENSIONS.HEIGHT + 6);
            ctx.restore();
        }
    }

    drawBack(ctx) {
        if (!this.backSprite) {
            const w = CARD_DIMENSIONS.WIDTH;
            const h = CARD_DIMENSIONS.HEIGHT;
            const pad = 2; // lineWidth=4 sangra 2px pra fora do shape da carta
            
            const canvas = document.createElement('canvas');
            canvas.width = w + pad * 2;
            canvas.height = h + pad * 2;
            const bCtx = canvas.getContext('2d', { alpha: true });
            bCtx.translate(pad, pad);
            
            bCtx.fillStyle = '#222';
            bCtx.beginPath();
            bCtx.roundRect(0, 0, w, h, CARD_DIMENSIONS.RADIUS);
            bCtx.fill();
            bCtx.strokeStyle = '#4a00e0';
            bCtx.lineWidth = 4;
            bCtx.stroke();

            // Só desenha e finaliza o cache se a webfont já tiver carregado.
            // Caso não tenha, ele não salva no this.backSprite, garantindo que o texto apareça
            // nos frames seguintes quando a fonte terminar de carregar.
            if (document.fonts.check('24px Righteous')) {
                bCtx.fillStyle = '#4a00e0';
                bCtx.font = '24px Righteous';
                bCtx.textAlign = 'center';
                bCtx.textBaseline = 'middle';
                bCtx.fillText('YUGI', w / 2, h / 2 - 12);
                bCtx.fillText('UNO', w / 2, h / 2 + 15);
                this.backSprite = canvas;
            } else {
                ctx.drawImage(canvas, -pad, -pad);
                return;
            }
        }
        ctx.drawImage(this.backSprite, -2, -2);
    }

    /**
     * @param {number} seed id da carta (defasa efeitos animados entre cartas iguais)
     * @param {number} displayScale escala em que a carta aparece (define a resolução do cache pintado)
     */
    drawFace(ctx, type, color, power, seed = 0, displayScale = 1) {
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const visual = CARD_VISUALS[type];

        if (visual) {
            this.drawStyledFace(ctx, type, visual, seed, displayScale, color, power);
            return;
        }

        const sprite = this.getBaseFaceSprite(type, color, power);
        if (sprite) {
            ctx.drawImage(sprite, -2, -2);
            return;
        }

        // Código de fallback: se a fonte ainda não tiver carregado, o sprite vai retornar nulo
        // e nós desenhamos uma base genérica (só fundo e borda) por 1 frame
        ctx.fillStyle = COLOR_HEX[color] || COLOR_HEX[COLOR.NONE];
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, CARD_DIMENSIONS.RADIUS);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /** Gera o canvas da face básica (comum) da carta pra não recalcular caminhos nem ctx.font todo frame */
    getBaseFaceSprite(type, color, power) {
        const key = `${type}_${color}_${power}`;
        let sprite = this.baseFaceCache.get(key);
        
        if (!sprite) {
            // Previne cachear uma fonte genérica antes da Righteous estar disponível (só acontece na 1ª frame)
            if (!document.fonts.check('50px Righteous') || !document.fonts.check('40px Righteous')) {
                return null;
            }

            const w = CARD_DIMENSIONS.WIDTH;
            const h = CARD_DIMENSIONS.HEIGHT;
            const pad = 2; // lineWidth=2 na borda, espalha 1px mas a gente deixa 2px de segurança
            
            sprite = document.createElement('canvas');
            sprite.width = w + pad * 2;
            sprite.height = h + pad * 2;
            const bCtx = sprite.getContext('2d', { alpha: true });
            bCtx.translate(pad, pad);
            
            bCtx.fillStyle = COLOR_HEX[color] || COLOR_HEX[COLOR.NONE];
            bCtx.beginPath();
            bCtx.roundRect(0, 0, w, h, CARD_DIMENSIONS.RADIUS);
            bCtx.fill();
            bCtx.strokeStyle = '#fff';
            bCtx.lineWidth = 2;
            bCtx.stroke();

            bCtx.fillStyle = COLOR_HEX[COLOR.RAINBOW]; // #ffffff
            bCtx.textAlign = 'center';
            bCtx.textBaseline = 'middle';

            switch (type) {
                case CARD_TYPES.PLUS4:
                    bCtx.font = '40px Righteous';
                    bCtx.fillText('+4', w / 2, h / 2);
                    break;
                case CARD_TYPES.PLUS2:
                    bCtx.font = '40px Righteous';
                    bCtx.fillText('+2', w / 2, h / 2);
                    break;
                case CARD_TYPES.BLOCK:
                    bCtx.lineWidth = 6;
                    bCtx.strokeStyle = '#ffffff';
                    bCtx.beginPath();
                    bCtx.arc(w / 2, h / 2, 25, 0, Math.PI * 2);
                    bCtx.stroke();
                    bCtx.beginPath();
                    bCtx.moveTo(w / 2 - 18, h / 2 - 18);
                    bCtx.lineTo(w / 2 + 18, h / 2 + 18);
                    bCtx.stroke();
                    break;
                case CARD_TYPES.REVERSE:
                    this.drawReverseIcon(bCtx, w / 2, h / 2, 22);
                    break;
                case CARD_TYPES.CHANGE_COLOR:
                    this.drawColorWheel(bCtx, w / 2, h / 2, 25);
                    break;
                case CARD_TYPES.HEAL:
                    drawHealIcon(bCtx, w / 2, h / 2, 27);
                    break;
                case CARD_TYPES.SHIELD:
                    drawShieldIcon(bCtx, w / 2, h / 2, 58);
                    break;
                default: {
                    const label = power >= 0 && power < NUMBER_LABELS.length ? power : 0;
                    const txt = NUMBER_LABELS[label];
                    bCtx.font = '50px Righteous';
                    bCtx.fillText(txt, w / 2, h / 2 - 10);
                    if (txt === '6' || txt === '9') {
                        bCtx.beginPath();
                        bCtx.moveTo(w / 2 - 14, h / 2 + 12);
                        bCtx.lineTo(w / 2 + 14, h / 2 + 12);
                        bCtx.lineWidth = 6;
                        bCtx.lineCap = 'round';
                        bCtx.strokeStyle = '#fff';
                        bCtx.stroke();
                    }
                    bCtx.font = '20px Righteous';
                    bCtx.fillText(HEART_LABELS[label], w - 30, h - 20);
                }
            }
            this.baseFaceCache.set(key, sprite);
        }
        return sprite;
    }

    /**
     * Carta com visual próprio (CONFIG.CARD_VISUALS): face pintada em cache ou fundo sólido + efeito animado.
     * `visual.colored`: a carta tem cor (ex.: Relâmpago) e a face em cache é uma por cor.
     */
    drawStyledFace(ctx, type, visual, seed, displayScale, color = COLOR.NONE, power = 0) {
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const radius = CARD_DIMENSIONS.RADIUS;
        const faceColor = visual.colored ? color : COLOR.NONE;

        const painted = visual.painted ? this.art.paintedFace(type, this.pixelScale * displayScale, faceColor) : null;
        if (painted) {
            ctx.drawImage(painted, 0, 0, w, h);
        } else {
            ctx.fillStyle = visual.colored ? (COLOR_HEX[color] || visual.background) : visual.background;
            ctx.beginPath();
            ctx.roundRect(0, 0, w, h, radius);
            ctx.fill();
        }

        if (type === CARD_TYPES.MIRROR) this.drawMirrorGlyph(ctx, power, this.faceTint);

        // Carta translúcida (Fantasma virando neblina): as camadas animadas usam alfa absoluto e
        // apareceriam opacas por cima; a face pintada já basta enquanto ela se desfaz
        if (visual.fx && ctx.globalAlpha > 0.99) {
            const shadow = ctx.shadowBlur;
            ctx.shadowBlur = 0;
            this.effects.draw(ctx, visual.fx, w, h, radius, this.time, seed, color, this.faceHeld);
            ctx.shadowBlur = shadow;
        }

        // Ronova: chamas da morte e os três olhos vivos, na resolução real (por cima do laminado, nítidos)
        if (type === CARD_TYPES.DEATH) drawRonovaLive(ctx, this.time, seed, this.faceHeld);

        // Fantasma e Espelho Sombrio: moldura em néon na cor da carta, fora do recorte do efeito acima
        // (pode brilhar um pouco pra fora da carta) — é o jeito mais direto de identificar a cor à distância
        if ((type === CARD_TYPES.GHOST || type === CARD_TYPES.MIRROR) && ctx.globalAlpha > 0.99) {
            this.drawColorRimGlow(ctx, color, type === CARD_TYPES.MIRROR ? 2.1 : 2.4);
        }

        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, radius);
        ctx.strokeStyle = visual.border || '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    getRimGlowSprite(color) {
        if (this.rimGlowCache.has(color)) return this.rimGlowCache.get(color);
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const hex = COLOR_HEX[color] || COLOR_HEX[COLOR.NONE];
        const pad = 24; // Espaço seguro para o shadowBlur máximo de 15

        const c = document.createElement('canvas');
        c.width = w + pad * 2;
        c.height = h + pad * 2;
        const g = c.getContext('2d');
        
        g.beginPath();
        g.roundRect(pad + 1.5, pad + 1.5, w - 3, h - 3, CARD_DIMENSIONS.RADIUS - 1);
        g.shadowColor = hex;
        // Rasteriza o glow na sua expansão máxima (pulse=1 -> blur=15)
        g.shadowBlur = 15;
        g.strokeStyle = hex;
        g.lineWidth = 2.6;
        g.stroke();

        const sprite = { canvas: c, pad };
        this.rimGlowCache.set(color, sprite);
        return sprite;
    }

    /** Contorno neon pulsante na cor da carta, hugando a borda (bem mais visível que uma aura interna). */
    drawColorRimGlow(ctx, color, speed) {
        const sprite = this.getRimGlowSprite(color);
        const pulse = 0.5 + 0.5 * Math.sin(this.time * speed);
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.globalAlpha = 0.6 + 0.35 * pulse;
        ctx.drawImage(sprite.canvas, -sprite.pad, -sprite.pad);
        ctx.restore();
    }

    drawMirrorGlyph(ctx, power, tint) {
        const sprites = this.getMirrorGlyphSprites(power, tint);
        if (!sprites) {
            // Fallback de 1 frame enquanto a fonte Righteous/Cinzel não carrega
            return; 
        }

        const base = ctx.globalAlpha;
        ctx.save();
        
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.globalAlpha = 0.35 * base;
        ctx.drawImage(sprites.glow, 0, 0);

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (power > 0 ? 1 : 0.8) * base;
        ctx.drawImage(sprites.text, 0, 0);
        
        ctx.restore();
    }

    /** Gera e divide os sprites do Espelho (Glow e Texto separados para preservar o efeito de Lighter Blend exato) */
    getMirrorGlyphSprites(power, tint) {
        const key = `${power}_${tint}`;
        let sprites = this.mirrorGlyphCache.get(key);
        
        if (!sprites) {
            if (!document.fonts.check(MIRROR_GLYPH_FONT) || !document.fonts.check(MIRROR_NUMBER_FONT)) {
                return null;
            }

            const w = CARD_DIMENSIONS.WIDTH;
            const h = CARD_DIMENSIONS.HEIGHT;
            const cx = w / 2;
            const cy = h * 0.47;
            const label = power > 0 && power < NUMBER_LABELS.length ? NUMBER_LABELS[power] : '?';
            const font = power > 0 ? MIRROR_NUMBER_FONT : MIRROR_GLYPH_FONT;

            // 1. Sprite do Glow (reflexo deslocado)
            const gSprite = document.createElement('canvas');
            gSprite.width = w;
            gSprite.height = h;
            const gCtx = gSprite.getContext('2d', { alpha: true });
            gCtx.textAlign = 'center';
            gCtx.textBaseline = 'middle';
            gCtx.font = font;
            gCtx.fillStyle = MIRROR_TINT_GLOW[tint];
            gCtx.fillText(label, cx + 1.5, cy + 2.5);
            gCtx.fillText(label, cx - 1.5, cy + 1.5);

            // 2. Sprite do Texto Principal
            const tSprite = document.createElement('canvas');
            tSprite.width = w;
            tSprite.height = h;
            const tCtx = tSprite.getContext('2d', { alpha: true });
            tCtx.textAlign = 'center';
            tCtx.textBaseline = 'middle';
            tCtx.font = font;
            tCtx.fillStyle = power > 0 ? MIRROR_TINT[tint] : '#cfc5ec';
            tCtx.fillText(label, cx, cy + 2);

            sprites = { glow: gSprite, text: tSprite };
            this.mirrorGlyphCache.set(key, sprites);
        }
        return sprites;
    }

    /** Glitch digital: faixas horizontais da face deslocadas + clarão magenta/ciano (Espelho copiando). */
    drawGlitch(ctx, id) {
        const pool = this.pool;
        const g = pool.glitch[id];
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        const stripH = h / GLITCH_STRIPS;
        const jitterSeed = Math.floor(this.time * 30);
        for (let k = 0; k < GLITCH_STRIPS; k++) {
            const r = Math.sin((jitterSeed + k * 7.13) * 12.9898) * 43758.5453;
            const off = (r - Math.floor(r) - 0.5) * 14 * g;
            if (Math.abs(off) < 0.5) continue;
            ctx.save();
            ctx.beginPath();
            ctx.rect(-4, k * stripH, w + 8, stripH);
            ctx.clip();
            ctx.translate(off, 0);
            this.drawFace(ctx, pool.type[id], pool.color[id], pool.power[id], id, pool.scale[id]);
            ctx.restore();
        }
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.globalAlpha = 0.25 * g;
        ctx.fillStyle = (jitterSeed & 1) === 0 ? '#ff00c8' : '#00e5ff';
        ctx.fillRect(0, ((jitterSeed * 37) % GLITCH_STRIPS) * stripH, w, stripH * 0.6);
        ctx.restore();
    }

    /** Brilho em volta (e por cima) da carta: halo largo + linha forte + véu leve. */
    drawCardGlow(ctx, amount, style) {
        const w = CARD_DIMENSIONS.WIDTH;
        const h = CARD_DIMENSIONS.HEIGHT;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.beginPath();
        ctx.roundRect(-2, -2, w + 4, h + 4, CARD_DIMENSIONS.RADIUS + 2);
        ctx.globalAlpha = Math.min(1, amount);
        ctx.strokeStyle = style.wide;
        ctx.lineWidth = 12;
        ctx.stroke();
        ctx.strokeStyle = style.line;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = style.tint;
        ctx.fill();
        ctx.restore();
    }

    /**
     * Emboscada armada (só quem usou vê, na preparação): fios espinhosos verdes correndo em volta do slot de
     * Defesa, respirando — a armadilha está plantada ali.
     */
    drawAmbushSigil(side) {
        const r = this.board.slots[side === 0 ? ZONE.SELF_DEFENSE : ZONE.OPP_DEFENSE];
        if (!r) return;
        const ctx = this.ctx;
        const t = this.time;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
        const pad = 9;
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.roundRect(r.hitX - pad, r.hitY - pad, r.hitW + pad * 2, r.hitH + pad * 2, CARD_DIMENSIONS.RADIUS + pad);
        ctx.setLineDash(AMBUSH_DASH);
        ctx.lineDashOffset = -t * 18 * (side === 0 ? 1 : -1);
        ctx.globalAlpha = 0.25 + pulse * 0.3;
        ctx.strokeStyle = 'rgba(57, 255, 20, 0.5)';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.globalAlpha = 0.5 + pulse * 0.4;
        ctx.strokeStyle = '#6dff4a';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
        // Espinhos nos cantos
        ctx.fillStyle = '#9dff7a';
        const x0 = r.hitX - pad;
        const y0 = r.hitY - pad;
        const x1 = r.hitX + r.hitW + pad;
        const y1 = r.hitY + r.hitH + pad;
        const corners = [x0, y0, 1, 1, x1, y0, -1, 1, x1, y1, -1, -1, x0, y1, 1, -1];
        for (let c = 0; c < 16; c += 4) {
            const x = corners[c];
            const y = corners[c + 1];
            const sx = corners[c + 2];
            const sy = corners[c + 3];
            ctx.beginPath();
            ctx.moveTo(x - sx * 3, y - sy * 3);
            ctx.lineTo(x + sx * 7, y + sy * 2);
            ctx.lineTo(x + sx * 2, y + sy * 7);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    drawColorWheel(ctx, cx, cy, r) {
        for (let q = 0; q < 4; q++) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, WHEEL_STARTS[q], WHEEL_STARTS[q] + Math.PI * 0.5);
            ctx.fillStyle = COLOR_HEX[WHEEL_COLORS[q]];
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
    }

    /**
     * Duas setas horizontais opostas (ícone do Reverso). Vetorial, não texto: o glifo de seta
     * usado antes (U+2B82) não existe nas fontes padrão de muitos celulares e caía no
     * "retângulo com traço" de glifo ausente. Path já é a solução do Block pro mesmo problema.
     */
    drawReverseIcon(ctx, cx, cy, size) {
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        const offsetY = size * 0.32;
        this.drawArrow(ctx, cx - size, cy - offsetY, cx + size, cy - offsetY, 15);
        this.drawArrow(ctx, cx + size, cy + offsetY, cx - size, cy + offsetY, 15);
    }

    /**
     * Segmento de reta com ponta triangular afiada em (x2,y2). A haste para um pouco antes do
     * vértice, senão a ponta arredondada dela (lineCap round) engorda o bico e o triângulo
     * some por baixo — assim a ponta afiada é só o triângulo, terminando exatamente em (x2,y2).
     */
    drawArrow(ctx, x1, y1, x2, y2, headLength) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const wingAngle = 0.4; // ~23°: ponta comprida e afiada, não um triângulo curto/largo
        const backX = x2 - headLength * 0.85 * Math.cos(angle);
        const backY = y2 - headLength * 0.85 * Math.sin(angle);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(backX, backY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLength * Math.cos(angle - wingAngle), y2 - headLength * Math.sin(angle - wingAngle));
        ctx.lineTo(x2 - headLength * Math.cos(angle + wingAngle), y2 - headLength * Math.sin(angle + wingAngle));
        ctx.closePath();
        ctx.fill();
    }
}
