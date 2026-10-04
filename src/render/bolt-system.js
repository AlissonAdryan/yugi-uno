import { GRAPHICS } from '../config/graphics.js';
const MAX_BOLTS = 12;
const SEGMENTS = 16;
const POINTS = SEGMENTS + 1;
const BRANCH_POINTS = 6;
const FLICKER_MS = 40;
const JITTER = 0.13;

// Gerador LCG do raio sendo remodelado (estado de módulo: nenhuma closure/alocação por tremida)
let rng = 1;
function next() {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
}

/**
 * BoltSystem - raios elétricos efêmeros entre dois pontos (Relâmpago em Cadeia, Sobrecarga).
 * Pool fixo em SoA/TypedArrays: nascer, tremer e sumir não aloca nada. O zigue-zague é refeito a cada
 * FLICKER_MS (a "tremida" elétrica) e cada raio ganha um galho lateral. Desenho em 3 passadas aditivas
 * (halo largo na cor, corpo na cor, núcleo branco), sem shadowBlur.
 *
 * Contrato: spawn() nas cinemáticas; update(dt) + draw(ctx) pelo renderer a cada frame.
 */
export class BoltSystem {
    constructor() {
        this.active = new Uint8Array(MAX_BOLTS);
        this.x0 = new Float32Array(MAX_BOLTS);
        this.y0 = new Float32Array(MAX_BOLTS);
        this.x1 = new Float32Array(MAX_BOLTS);
        this.y1 = new Float32Array(MAX_BOLTS);
        this.life = new Float32Array(MAX_BOLTS);
        this.maxLife = new Float32Array(MAX_BOLTS);
        this.width = new Float32Array(MAX_BOLTS);
        this.flicker = new Float32Array(MAX_BOLTS);
        this.seed = new Uint32Array(MAX_BOLTS);
        this.pts = new Float32Array(MAX_BOLTS * POINTS * 2);
        this.branch = new Float32Array(MAX_BOLTS * BRANCH_POINTS * 2);
        // Cor por raio (strings montadas só no spawn, nunca por frame)
        this.glow = new Array(MAX_BOLTS).fill('rgba(140,230,255,0.35)');
        this.body = new Array(MAX_BOLTS).fill('#8ff0ff');
        this.count = 0;
    }

    /**
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @param {number} durationMs
     * @param {string} [hex] cor do halo/corpo (#rrggbb); o núcleo é sempre branco
     * @param {number} [width] espessura relativa
     */
    spawn(x0, y0, x1, y1, durationMs, hex = '#8ff0ff', width = 1) {
        let slot = -1;
        let oldest = -1;
        for (let i = 0; i < MAX_BOLTS; i++) {
            if (this.active[i] === 0) { slot = i; break; }
            if (oldest < 0 || this.life[i] < this.life[oldest]) oldest = i;
        }
        if (slot < 0) slot = oldest;

        const r = parseInt(hex.slice(1, 3), 16) || 140;
        const g = parseInt(hex.slice(3, 5), 16) || 230;
        const b = parseInt(hex.slice(5, 7), 16) || 255;
        this.glow[slot] = `rgba(${r},${g},${b},0.3)`;
        this.body[slot] = `rgb(${r},${g},${b})`;
        this.active[slot] = 1;
        this.x0[slot] = x0;
        this.y0[slot] = y0;
        this.x1[slot] = x1;
        this.y1[slot] = y1;
        this.life[slot] = durationMs;
        this.maxLife[slot] = durationMs;
        this.width[slot] = width;
        this.flicker[slot] = 0;
        this.seed[slot] = (Math.random() * 4294967295) >>> 0;
        this.reshape(slot);
    }

    clear() {
        this.active.fill(0);
    }

    /** @param {number} dt ms */
    update(dt) {
        for (let i = 0; i < MAX_BOLTS; i++) {
            if (this.active[i] === 0) continue;
            this.life[i] -= dt;
            if (this.life[i] <= 0) {
                this.active[i] = 0;
                continue;
            }
            this.flicker[i] += dt;
            if (this.flicker[i] >= FLICKER_MS) {
                this.flicker[i] = 0;
                this.reshape(i);
            }
        }
    }

    /** Recalcula o zigue-zague (e o galho) do raio `i` com o gerador próprio dele. */
    reshape(i) {
        rng = this.seed[i];
        const x0 = this.x0[i];
        const y0 = this.y0[i];
        const dx = this.x1[i] - x0;
        const dy = this.y1[i] - y0;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const amp = len * JITTER;
        const base = i * POINTS * 2;
        for (let p = 0; p < POINTS; p++) {
            const t = p / SEGMENTS;
            const off = p === 0 || p === SEGMENTS ? 0 : (next() - 0.5) * 2 * amp * Math.sin(t * Math.PI);
            this.pts[base + p * 2] = x0 + dx * t + nx * off;
            this.pts[base + p * 2 + 1] = y0 + dy * t + ny * off;
        }

        // Galho: sai de um ponto do meio e se abre pra um lado
        const from = 4 + Math.floor(next() * (SEGMENTS - 8));
        const bx = this.pts[base + from * 2];
        const by = this.pts[base + from * 2 + 1];
        const side = next() < 0.5 ? -1 : 1;
        const blen = len * (0.18 + next() * 0.14);
        const bdx = (dx / len) * 0.7 + nx * side * 0.7;
        const bdy = (dy / len) * 0.7 + ny * side * 0.7;
        const bbase = i * BRANCH_POINTS * 2;
        for (let p = 0; p < BRANCH_POINTS; p++) {
            const t = p / (BRANCH_POINTS - 1);
            const off = p === 0 ? 0 : (next() - 0.5) * blen * 0.35;
            this.branch[bbase + p * 2] = bx + bdx * blen * t + nx * off;
            this.branch[bbase + p * 2 + 1] = by + bdy * blen * t + ny * off;
        }
        this.seed[i] = rng;
    }

    draw(ctx) {
        let any = false;
        for (let i = 0; i < MAX_BOLTS; i++) if (this.active[i] === 1) { any = true; break; }
        if (!any) return;

        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 0; i < MAX_BOLTS; i++) {
            if (this.active[i] === 0) continue;
            const k = this.life[i] / this.maxLife[i];
            // Acende rápido e apaga em curva (o raio "estala" e some)
            const alpha = Math.min(1, k * 2.2);
            const w = this.width[i];
            for (let pass = 0; pass < 3; pass++) {
                ctx.globalAlpha = alpha * (pass === 2 ? 1 : 0.9);
                ctx.strokeStyle = pass === 0 ? this.glow[i] : pass === 1 ? this.body[i] : '#ffffff';
                ctx.lineWidth = (pass === 0 ? 14 : pass === 1 ? 5 : 1.8) * w;
                this.tracePath(ctx, i);
                ctx.stroke();
                if (pass > 0) {
                    ctx.lineWidth *= 0.6;
                    this.traceBranch(ctx, i);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }

    tracePath(ctx, i) {
        const base = i * POINTS * 2;
        ctx.beginPath();
        ctx.moveTo(this.pts[base], this.pts[base + 1]);
        for (let p = 1; p < POINTS; p++) ctx.lineTo(this.pts[base + p * 2], this.pts[base + p * 2 + 1]);
    }

    traceBranch(ctx, i) {
        const base = i * BRANCH_POINTS * 2;
        ctx.beginPath();
        ctx.moveTo(this.branch[base], this.branch[base + 1]);
        for (let p = 1; p < BRANCH_POINTS; p++) ctx.lineTo(this.branch[base + p * 2], this.branch[base + p * 2 + 1]);
    }
}
