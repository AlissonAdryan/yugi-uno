import { CONFIG } from '../config/constants.js';

const { CARD_DIMENSIONS } = CONFIG;
const HALF_W = CARD_DIMENSIONS.WIDTH / 2;
const HALF_H = CARD_DIMENSIONS.HEIGHT / 2;
const MAX_RINGS = 24;
const MAX_TETHERS = 8;
const MAX_SEALS = 2;
const TAU = Math.PI * 2;

// --- Selo de espinhos da Emboscada (slot USE bloqueado) ------------------------
// Raios da teia: meios das bordas e cantos do slot, em volta (multiplicadores de meia-largura/altura)
const SPOKE_UX = [1, 1, 0, -1, -1, -1, 0, 1];
const SPOKE_UY = [0, 1, 1, 1, 0, -1, -1, -1];
const SEAL_REACH = 0.9;
const SEAL_RINGS = [0.3, 0.58, 0.86];
const SEAL_GLOW = 'rgba(57, 255, 20, 0.3)';
const SEAL_BODY = '#6dff4a';
const SEAL_CORE = '#e9ffe0';
const SEAL_THORN_STEP = 9;

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fio de arame farpado: halo, corpo, espinhos alternados e um núcleo claro. */
function thornLine(ctx, x0, y0, x1, y1, alpha) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1 || alpha <= 0) return;
    const ux = dx / len;
    const uy = dy / len;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = SEAL_GLOW;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = SEAL_BODY;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const n = Math.floor(len / SEAL_THORN_STEP);
    ctx.beginPath();
    for (let k = 1; k <= n; k++) {
        const px = x0 + ux * k * SEAL_THORN_STEP;
        const py = y0 + uy * k * SEAL_THORN_STEP;
        const side = k % 2 === 0 ? 1 : -1;
        ctx.moveTo(px, py);
        ctx.lineTo(px - ux * 4 - uy * 5 * side, py - uy * 4 + ux * 5 * side);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = SEAL_CORE;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
}

/**
 * Selo de espinhos sobre um slot: 8 fios farpados saem do centro até as bordas, anéis de teia se fecham
 * e o olho da Emboscada abre no meio (dentro do triângulo invertido). `t` = progresso da formação (0..1);
 * com t = 1 é o estado bloqueado fixo, que respira com `time` (s). Usado pela animação (FxLayer.seal) e
 * pelo slot bloqueado no tabuleiro (BoardSystem), então os dois se emendam sem piscar.
 */
export function drawThornSeal(ctx, cx, cy, hw, hh, t, time, alpha = 1) {
    if (t <= 0 || alpha <= 0) return;
    const breathe = 0.82 + 0.18 * Math.sin(time * 2.6);
    const sway = Math.sin(time * 1.7) * 0.6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1) Raios crescendo do centro (um pouco escalonados, como fios se esticando)
    const spokes = clamp01(t / 0.45);
    for (let k = 0; k < SPOKE_UX.length; k++) {
        const grow = clamp01(spokes * 1.35 - k * 0.045);
        if (grow <= 0) continue;
        const ex = cx + SPOKE_UX[k] * hw * SEAL_REACH * grow;
        const ey = cy + SPOKE_UY[k] * hh * SEAL_REACH * grow + sway;
        thornLine(ctx, cx, cy, ex, ey, alpha * breathe);
    }

    // 2) Anéis de teia se fechando (curvas cedendo pro centro, como teia de verdade)
    const rings = clamp01((t - 0.3) / 0.45);
    if (rings > 0) {
        ctx.strokeStyle = SEAL_BODY;
        ctx.lineWidth = 1.2;
        for (let r = 0; r < SEAL_RINGS.length; r++) {
            const ringT = clamp01(rings * 1.6 - r * 0.3);
            if (ringT <= 0) continue;
            const f = SEAL_RINGS[r];
            const segs = Math.ceil(SPOKE_UX.length * ringT);
            ctx.globalAlpha = alpha * breathe * 0.85;
            ctx.beginPath();
            for (let s = 0; s < segs; s++) {
                const a = s % SPOKE_UX.length;
                const b = (s + 1) % SPOKE_UX.length;
                const ax = cx + SPOKE_UX[a] * hw * f;
                const ay = cy + SPOKE_UY[a] * hh * f + sway;
                const bx = cx + SPOKE_UX[b] * hw * f;
                const by = cy + SPOKE_UY[b] * hh * f + sway;
                const mx = cx + ((ax + bx) / 2 - cx) * 0.82;
                const my = cy + ((ay + by) / 2 - cy) * 0.82;
                if (s === 0) ctx.moveTo(ax, ay);
                ctx.quadraticCurveTo(mx, my, bx, by);
            }
            ctx.stroke();
        }
    }

    // 3) Triângulo invertido + olho abrindo no centro
    const eye = clamp01((t - 0.62) / 0.38);
    if (eye > 0) {
        const tri = 24 * (0.6 + 0.4 * eye);
        ctx.globalAlpha = alpha * eye * 0.35 * breathe;
        ctx.fillStyle = SEAL_BODY;
        ctx.beginPath();
        ctx.arc(cx, cy, tri * 1.25, 0, TAU);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha * eye;
        ctx.fillStyle = '#061206';
        ctx.strokeStyle = SEAL_BODY;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - tri, cy - tri * 0.6);
        ctx.lineTo(cx + tri, cy - tri * 0.6);
        ctx.lineTo(cx, cy + tri);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Pálpebra: abre com o progresso e dá uma piscada lenta de vez em quando no estado fixo
        const blink = t >= 1 && Math.sin(time * 1.3) > 0.985 ? 0.15 : 1;
        const open = eye * blink;
        const ew = tri * 0.62;
        const eh = tri * 0.3 * open;
        const ey = cy - tri * 0.08;
        ctx.fillStyle = '#d9ffcf';
        ctx.beginPath();
        ctx.moveTo(cx - ew, ey);
        ctx.quadraticCurveTo(cx, ey - eh * 2, cx + ew, ey);
        ctx.quadraticCurveTo(cx, ey + eh * 2, cx - ew, ey);
        ctx.fill();
        if (open > 0.3) {
            ctx.fillStyle = '#39ff14';
            ctx.beginPath();
            ctx.arc(cx, ey, eh * 0.95, 0, TAU);
            ctx.fill();
            ctx.fillStyle = '#021002';
            ctx.beginPath();
            ctx.ellipse(cx, ey, eh * 0.22, eh * 0.85, 0, 0, TAU);
            ctx.fill();
        }
    }
    ctx.restore();
}

/** Estilos de amarra (tether) entre um ponto e uma carta. */
export const TETHER = Object.freeze({
    CHAIN: 0,   // corrente fantasmagórica roxa (Maldição)
    THREAD: 1   // fio espinhoso verde-tóxico (Emboscada)
});

// Cores prontas por estilo (nenhuma string montada por frame)
const TETHER_STYLE = [
    { glow: 'rgba(160, 60, 255, 0.35)', body: '#c28bff', core: '#f1e2ff', spacing: 9 },
    { glow: 'rgba(57, 255, 20, 0.3)', body: '#6dff4a', core: '#e9ffe0', spacing: 11 }
];

/**
 * FxLayer - efeitos de mesa por cima das cartas, em pools fixos (SoA, zero alocação por frame):
 *  - ring: onda de choque/distorção expandindo (Fantasma, Espelho, Maldição, Emboscada)
 *  - tether: corrente ou fio que sai de um ponto, alcança uma carta e a envolve em X (segue a carta)
 *  - vignette: bordas da tela tingidas (Maldição), com entrada/saída suaves
 * Contrato: as cinemáticas chamam ring/tether/vignette; o renderer chama update(dt) + draw(ctx) por frame.
 */
export class FxLayer {
    /** @param {import('../entities/card-pool.js').CardPool} pool */
    constructor(pool) {
        this.pool = pool;

        this.ringActive = new Uint8Array(MAX_RINGS);
        this.ringX = new Float32Array(MAX_RINGS);
        this.ringY = new Float32Array(MAX_RINGS);
        this.ringR0 = new Float32Array(MAX_RINGS);
        this.ringR1 = new Float32Array(MAX_RINGS);
        this.ringLife = new Float32Array(MAX_RINGS);
        this.ringMax = new Float32Array(MAX_RINGS);
        this.ringWidth = new Float32Array(MAX_RINGS);
        this.ringSquash = new Float32Array(MAX_RINGS);
        this.ringColor = new Array(MAX_RINGS).fill('#ffffff');

        this.tetherActive = new Uint8Array(MAX_TETHERS);
        this.tetherX = new Float32Array(MAX_TETHERS);
        this.tetherY = new Float32Array(MAX_TETHERS);
        this.tetherCard = new Int16Array(MAX_TETHERS);
        this.tetherLife = new Float32Array(MAX_TETHERS);
        this.tetherMax = new Float32Array(MAX_TETHERS);
        this.tetherKind = new Uint8Array(MAX_TETHERS);
        this.time = 0;

        this.vigAmount = 0;
        this.vigLife = 0;
        this.vigMax = 0;
        this.vigPeak = 0;
        this.vigSprite = null;
        this.vigSprites = new Map();

        // Selo de espinhos da Emboscada: fio farpado sai de (fromX, fromY), chega ao slot e tece a teia.
        // Fica no estado final até endSeal() (a cinemática troca pelo cadeado fixo do tabuleiro no mesmo tick).
        this.sealActive = new Uint8Array(MAX_SEALS);
        this.sealFromX = new Float32Array(MAX_SEALS);
        this.sealFromY = new Float32Array(MAX_SEALS);
        this.sealX = new Float32Array(MAX_SEALS);
        this.sealY = new Float32Array(MAX_SEALS);
        this.sealHW = new Float32Array(MAX_SEALS);
        this.sealHH = new Float32Array(MAX_SEALS);
        this.sealElapsed = new Float32Array(MAX_SEALS);
        this.sealMax = new Float32Array(MAX_SEALS);

        // Aparição: um sprite grande que surge, cresce e se desfaz (ex.: a caveira da Maldição)
        this.appSprite = null;
        this.appX = 0;
        this.appY = 0;
        this.appSize0 = 0;
        this.appSize1 = 0;
        this.appLife = 0;
        this.appPeak = 0;

        this.ringCount = 0;
        this.tetherCount = 0;
        this.sealCount = 0;
    }

    /** Sprite surgindo em (x, y), crescendo de size0 a size1 e sumindo (entra rápido, sai devagar). */
    apparition(sprite, x, y, size0, size1, durationMs, peakAlpha = 0.8) {
        this.appSprite = sprite;
        this.appX = x;
        this.appY = y;
        this.appSize0 = size0;
        this.appSize1 = size1;
        this.appLife = durationMs;
        this.appMax = durationMs;
        this.appPeak = peakAlpha;
    }

    /**
     * Onda circular (ou achatada com squash < 1) crescendo de r0 a r1 e sumindo.
     * @param {string} hex cor #rrggbb
     */
    ring(x, y, r0, r1, durationMs, hex, width = 3, squash = 1) {
        let slot = 0;
        for (let i = 0; i < MAX_RINGS; i++) {
            if (this.ringActive[i] === 0) { slot = i; break; }
            if (this.ringLife[i] < this.ringLife[slot]) slot = i;
        }
        if (this.ringActive[slot] === 0) {
            this.ringCount++;
            this.ringActive[slot] = 1;
        }
        this.ringX[slot] = x;
        this.ringY[slot] = y;
        this.ringR0[slot] = r0;
        this.ringR1[slot] = r1;
        this.ringLife[slot] = durationMs;
        this.ringMax[slot] = durationMs;
        this.ringSquash[slot] = squash;
        this.ringColor[slot] = hex;
    }

    /**
     * Amarra de (x, y) até a carta `cardId`: cresce até ela, envolve em X e some no fim.
     * @param {number} kind TETHER.*
     */
    tether(x, y, cardId, durationMs, kind) {
        let slot = 0;
        for (let i = 0; i < MAX_TETHERS; i++) {
            if (this.tetherActive[i] === 0) { slot = i; break; }
            if (this.tetherLife[i] < this.tetherLife[slot]) slot = i;
        }
        if (this.tetherActive[slot] === 0) {
            this.tetherCount++;
            this.tetherActive[slot] = 1;
        }
        this.tetherX[slot] = x;
        this.tetherY[slot] = y;
        this.tetherCard[slot] = cardId;
        this.tetherMax[slot] = durationMs;
        this.tetherKind[slot] = kind;
    }

    /**
     * Selo de espinhos: o fio farpado viaja de (fromX, fromY) até o centro do slot (cx, cy) no primeiro
     * quarto de `durationMs` e depois tece a teia (drawThornSeal). Fica pronto até endSeal().
     * @returns {number} índice do selo, pra endSeal()
     */
    seal(fromX, fromY, cx, cy, hw, hh, durationMs) {
        let slot = 0;
        for (let i = 0; i < MAX_SEALS; i++) {
            if (this.sealActive[i] === 0) { slot = i; break; }
        }
        if (this.sealActive[slot] === 0) {
            this.sealCount++;
            this.sealActive[slot] = 1;
        }
        this.sealFromX[slot] = fromX;
        this.sealFromY[slot] = fromY;
        this.sealX[slot] = cx;
        this.sealY[slot] = cy;
        this.sealHW[slot] = hw;
        this.sealHH[slot] = hh;
        this.sealElapsed[slot] = 0;
        this.sealMax[slot] = durationMs;
        return slot;
    }

    endSeal(slot) {
        if (slot >= 0 && slot < MAX_SEALS && this.sealActive[slot] === 1) {
            this.sealActive[slot] = 0;
            this.sealCount--;
        }
    }

    drawSeal(ctx, i) {
        const t = Math.min(1, this.sealElapsed[i] / this.sealMax[i]);
        const x0 = this.sealFromX[i];
        const y0 = this.sealFromY[i];
        const cx = this.sealX[i];
        const cy = this.sealY[i];
        // Fio viajando da vida até o slot, que some quando a teia começa a se fechar
        const head = clamp01(t / 0.25);
        const threadAlpha = t < 0.25 ? 1 : 1 - clamp01((t - 0.25) / 0.2);
        if (threadAlpha > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            const wobble = Math.sin(this.time * 14) * 3 * (1 - head);
            thornLine(ctx, x0, y0, x0 + (cx - x0) * head, y0 + (cy - y0) * head + wobble, threadAlpha);
            ctx.restore();
        }
        drawThornSeal(ctx, cx, cy, this.sealHW[i], this.sealHH[i], clamp01((t - 0.2) / 0.8), this.time);
    }

    /** Bordas da tela tingidas por `durationMs` (entra rápido, segura e sai suave). */
    vignette(hex, peak, durationMs) {
        this.vigSprite = this.getVignetteSprite(hex);
        this.vigPeak = peak;
        this.vigLife = durationMs;
        this.vigMax = durationMs;
    }

    clear() {
        this.ringActive.fill(0);
        this.tetherActive.fill(0);
        this.sealActive.fill(0);
        this.vigAmount = 0;
        this.appLife = 0;
        this.ringCount = 0;
        this.tetherCount = 0;
        this.sealCount = 0;
    }

    /** Vinheta radial pré-rasterizada por cor (uma vez por cor, nunca por frame). */
    getVignetteSprite(hex) {
        let sprite = this.vigSprites.get(hex);
        if (sprite) return sprite;
        const size = 256;
        sprite = document.createElement('canvas');
        sprite.width = size;
        sprite.height = size;
        const g = sprite.getContext('2d');
        const r = parseInt(hex.slice(1, 3), 16);
        const gr = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const grad = g.createRadialGradient(size / 2, size / 2, size * 0.22, size / 2, size / 2, size * 0.72);
        grad.addColorStop(0, `rgba(${r},${gr},${b},0)`);
        grad.addColorStop(0.6, `rgba(${r},${gr},${b},0.45)`);
        grad.addColorStop(1, `rgba(${r},${gr},${b},0.95)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        this.vigSprites.set(hex, sprite);
        return sprite;
    }

    /** @param {number} dt ms */
    update(dt) {
        if (this.ringCount === 0 && this.tetherCount === 0 && this.sealCount === 0 
            && this.vigAmount <= 0 && this.appLife <= 0 && this.vigLife <= 0) return;

        this.time += dt / 1000;
        for (let i = 0; i < MAX_RINGS; i++) {
            if (this.ringActive[i] === 0) continue;
            this.ringLife[i] -= dt;
            if (this.ringLife[i] <= 0) {
                this.ringActive[i] = 0;
                this.ringCount--;
            }
        }
        for (let i = 0; i < MAX_TETHERS; i++) {
            if (this.tetherActive[i] === 0) continue;
            this.tetherLife[i] -= dt;
            if (this.tetherLife[i] <= 0 || this.pool.active[this.tetherCard[i]] !== 1) {
                this.tetherActive[i] = 0;
                this.tetherCount--;
            }
        }
        for (let i = 0; i < MAX_SEALS; i++) {
            if (this.sealActive[i] === 1) this.sealElapsed[i] += dt;
        }
        if (this.appLife > 0) this.appLife -= dt;
        if (this.vigLife > 0) {
            this.vigLife -= dt;
            const t = 1 - Math.max(0, this.vigLife) / this.vigMax;
            const env = t < 0.2 ? t / 0.2 : t > 0.7 ? (1 - t) / 0.3 : 1;
            this.vigAmount = this.vigPeak * env;
        } else {
            this.vigAmount = 0;
        }
    }

    /**
     * @param {CanvasRenderingContext2D} ctx em coordenadas virtuais
     * @param {number} width largura virtual da tela
     * @param {number} height altura virtual da tela
     */
    draw(ctx, width, height) {
        if (this.ringCount === 0 && this.tetherCount === 0 && this.sealCount === 0 
            && this.vigAmount <= 0 && this.appLife <= 0) return;

        if (this.vigAmount > 0.001 && this.vigSprite) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, this.vigAmount);
            ctx.drawImage(this.vigSprite, -width * 0.1, -height * 0.1, width * 1.2, height * 1.2);
            ctx.restore();
        }

        if (this.appLife > 0 && this.appSprite) {
            const t = 1 - this.appLife / this.appMax;
            const e = 1 - (1 - t) * (1 - t);
            const size = this.appSize0 + (this.appSize1 - this.appSize0) * e;
            ctx.save();
            ctx.globalAlpha = this.appPeak * (t < 0.2 ? t / 0.2 : (1 - t) / 0.8);
            ctx.drawImage(this.appSprite, this.appX - size / 2, this.appY - size / 2, size, size);
            ctx.restore();
        }

        let anyRing = false;
        for (let i = 0; i < MAX_RINGS; i++) if (this.ringActive[i] === 1) { anyRing = true; break; }
        if (anyRing) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < MAX_RINGS; i++) {
                if (this.ringActive[i] === 0) continue;
                const t = 1 - this.ringLife[i] / this.ringMax[i];
                const e = 1 - (1 - t) * (1 - t);
                const r = this.ringR0[i] + (this.ringR1[i] - this.ringR0[i]) * e;
                const fade = 1 - t;
                ctx.strokeStyle = this.ringColor[i];
                ctx.beginPath();
                ctx.ellipse(this.ringX[i], this.ringY[i], r, r * this.ringSquash[i], 0, 0, TAU);
                // Halo largo e fraco + fio fino e forte: parece uma onda de distorção, não um traço
                ctx.globalAlpha = fade * 0.25;
                ctx.lineWidth = this.ringWidth[i] * 4 * (0.5 + fade);
                ctx.stroke();
                ctx.globalAlpha = fade * 0.9;
                ctx.lineWidth = this.ringWidth[i] * (0.4 + fade * 0.6);
                ctx.stroke();
            }
            ctx.restore();
        }

        for (let i = 0; i < MAX_TETHERS; i++) {
            if (this.tetherActive[i] === 1) this.drawTether(ctx, i);
        }
        for (let i = 0; i < MAX_SEALS; i++) {
            if (this.sealActive[i] === 1) this.drawSeal(ctx, i);
        }
    }

    drawTether(ctx, i) {
        const pool = this.pool;
        const id = this.tetherCard[i];
        const scale = pool.scale[id] || 1;
        const cx = pool.x[id] + HALF_W;
        const cy = pool.y[id] + pool.hoverOffsetY[id] + HALF_H;
        const t = 1 - this.tetherLife[i] / this.tetherMax[i];
        // 0..0.35 cresce até a carta; 0.25..0.55 envolve em X; últimos 20% somem
        const reach = Math.min(1, t / 0.35);
        const wrap = Math.max(0, Math.min(1, (t - 0.25) / 0.3));
        const alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
        const style = TETHER_STYLE[this.tetherKind[i]];
        const x0 = this.tetherX[i];
        const y0 = this.tetherY[i];
        const x1 = x0 + (cx - x0) * reach;
        const y1 = y0 + (cy - y0) * reach;
        const hw = HALF_W * scale * 1.05;
        const hh = HALF_H * scale * 1.02;
        const sway = Math.sin(this.time * 9 + i) * 2.5;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.drawStrand(ctx, style, this.tetherKind[i], x0, y0, x1, y1 + sway, alpha);
        if (wrap > 0) {
            // As duas diagonais atravessando a carta, crescendo do centro pras pontas
            this.drawStrand(ctx, style, this.tetherKind[i], cx - hw * wrap, cy - hh * wrap, cx + hw * wrap, cy + hh * wrap, alpha);
            this.drawStrand(ctx, style, this.tetherKind[i], cx + hw * wrap, cy - hh * wrap, cx - hw * wrap, cy + hh * wrap, alpha);
        }
        ctx.restore();
    }

    /** Uma corrente (elos alternados) ou fio espinhoso entre dois pontos, com halo. */
    drawStrand(ctx, style, kind, x0, y0, x1, y1, alpha) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) return;
        const ux = dx / len;
        const uy = dy / len;
        const angle = Math.atan2(dy, dx);

        // Halo contínuo por baixo
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = style.glow;
        ctx.lineWidth = kind === TETHER.CHAIN ? 10 : 7;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        if (kind === TETHER.CHAIN) {
            ctx.strokeStyle = style.body;
            ctx.lineWidth = 1.8;
            const n = Math.floor(len / style.spacing);
            for (let k = 0; k <= n; k++) {
                const px = x0 + ux * k * style.spacing;
                const py = y0 + uy * k * style.spacing;
                ctx.beginPath();
                // Elos alternam de frente e de lado (o de lado vira um traço fino)
                if (k % 2 === 0) ctx.ellipse(px, py, style.spacing * 0.62, 3.2, angle, 0, TAU);
                else ctx.ellipse(px, py, style.spacing * 0.62, 0.9, angle, 0, TAU);
                ctx.stroke();
            }
        } else {
            ctx.strokeStyle = style.body;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
            // Espinhos alternando de lado
            const n = Math.floor(len / style.spacing);
            ctx.beginPath();
            for (let k = 1; k <= n; k++) {
                const px = x0 + ux * k * style.spacing;
                const py = y0 + uy * k * style.spacing;
                const side = k % 2 === 0 ? 1 : -1;
                ctx.moveTo(px, py);
                ctx.lineTo(px - ux * 4 - uy * 5 * side, py - uy * 4 + ux * 5 * side);
            }
            ctx.stroke();
        }
        ctx.strokeStyle = style.core;
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    }
}
