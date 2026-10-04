import { CONFIG } from '../config/constants.js';
import { GRAPHICS } from '../config/graphics.js';
import { ZONE } from '../utils/zones.js';
import { i18n } from '../i18n/index.js';
import { globalEvents } from '../core/event-bus.js';
import { PARTICLE_TYPES } from './particle-system.js';

/**
 * UltimateFx - camada visual dos Combos Supremos (GAME_RULES §6.18), dirigida pelo
 * cinematics-ultimate.js e pelo snapshot (campo trancado).
 *
 *  Reverso Kármico:  relógio holográfico girando ao contrário no fundo da mesa + pós-processamento de fita
 *                    VHS (scanlines, faixa rolando, rasgos horizontais e aberração cromática RGB).
 *  Prisão de Cristal: monólito de cristal, rachaduras neon no chão, cristais cobrindo Ataque/Defesa
 *                    trancados com cadeados + "ZONAS ISOLADAS", e a tela estilhaçada de quem leva na vida.
 *  Os dois:          tremor de tela (transform CSS no canvas: compositor, zero repaint).
 *
 * Performance (Pilares 1/2): tudo que tem gradiente/sombra/texto é rasterizado UMA vez em sprites (por cor,
 * cache de 1 entrada — o jogo raramente troca), e por frame só há drawImage, poucas linhas e fillRect. Nada é
 * alocado por frame: rachaduras são geradas no instante do evento (Float32Array) e o estado é pré-alocado.
 *
 * Gráfico baixo (GRAPHICS.isHigh = false) corta só o que pesa em GPU/CPU fraca, sem mudar a leitura do efeito:
 *  - sem aberração cromática RGB e sem rasgos de tela (cópias do backbuffer): ficam scanlines, faixa e barras;
 *  - relógio sem rastro de pós-imagem (3 -> 1 blit grande) e em sprite de resolução menor;
 *  - monólito sem halo aditivo e sem varredura de brilho; cristais sem o reflexo pulsante;
 *  - rachaduras (chão e tela) sem o traço largo de brilho, sem ramificações e sem o realce do vidro;
 *  - composição 'source-over' em vez de 'lighter' (GRAPHICS.compositeLighter), sprites em escala 1x.
 */

const TAU = Math.PI * 2;
const { CARD_DIMENSIONS } = CONFIG;

export const PRISON_SIDE = Object.freeze({ SELF: 0, OPP: 1 });

const DEFAULT_CRYSTAL = '#8fe9ff';
const LOCK_RED = '#ff2d55';

const CLOCK_RADIUS = 290;
const CLOCK_BASE_SPEED = 0.35;       // rad/s (anti-horário) com o relógio parado no fundo
const CLOCK_FADE_MS = 260;
const MONO_W = 120;
const MONO_H = 330;
const MONO_PAD = 34;
const REGION_PAD = 14;
const LOCK_INTRO_MS = 2600;          // "ZONAS ISOLADAS" forte logo após trancar; depois fica discreto
const PRISON_GROW_MS = CONFIG.ANIM.PRISON_FREEZE;
const PRISON_SHATTER_MS = 380;
const SCAN_BAR_H = 90;

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hexToRgb(hex) {
    const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cor misturada com branco (t = 0 cor pura, 1 branco) em 'rgba()'. Só usado ao montar sprites. */
function tint(rgb, t, a = 1) {
    const r = Math.round(rgb[0] + (255 - rgb[0]) * t);
    const g = Math.round(rgb[1] + (255 - rgb[1]) * t);
    const b = Math.round(rgb[2] + (255 - rgb[2]) * t);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** PRNG determinístico (mulberry32): os cristais saem iguais em todo rebuild e o reflexo casa com eles. */
function prng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Cor da carta -> hex do efeito (cartas sem cor básica usam o cristal gelo / roxo neon). */
export function ultimateHex(color, fallback = DEFAULT_CRYSTAL) {
    const hex = CONFIG.COLOR_HEX[color];
    if (!hex || color === CONFIG.COLOR.NONE || color === CONFIG.COLOR.BLACK || color === CONFIG.COLOR.RAINBOW) return fallback;
    return hex;
}

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
}

/**
 * Teia de rachaduras a partir de (cx, cy): raios quebrados (polilinhas) + anéis de teia ligando raios
 * vizinhos (vidro estilhaçado). `squash` achata no eixo Y (chão em perspectiva). Gerado 1x por impacto.
 * @returns {{ paths: Float32Array[], starts: Float32Array, web: Float32Array, webRing: Uint8Array }}
 */
function makeCrackWeb(cx, cy, radius, squash, spokeCount, rings, branches) {
    const rand = Math.random;
    const steps = 6;
    const paths = [];
    const startList = [];
    for (let i = 0; i < spokeCount; i++) {
        const base = (i / spokeCount) * TAU + (rand() - 0.5) * 0.35;
        const reach = radius * (0.65 + rand() * 0.45);
        const pts = new Float32Array((steps + 1) * 2);
        pts[0] = cx;
        pts[1] = cy;
        let x = cx;
        let y = cy;
        for (let s = 1; s <= steps; s++) {
            const a = base + (rand() - 0.5) * 0.55;
            const len = (reach / steps) * (0.7 + rand() * 0.6);
            x += Math.cos(a) * len;
            y += Math.sin(a) * len * squash;
            pts[s * 2] = x;
            pts[s * 2 + 1] = y;
        }
        paths.push(pts);
        startList.push(0);
        if (!branches) continue;
        // Ramificações curtas nascendo do meio de alguns raios (só no gráfico alto)
        const from = 2 + Math.floor(rand() * 3);
        const bx = pts[from * 2];
        const by = pts[from * 2 + 1];
        const side = rand() < 0.5 ? -1 : 1;
        const bpts = new Float32Array(4 * 2);
        let px = bx;
        let py = by;
        bpts[0] = px;
        bpts[1] = py;
        for (let s = 1; s < 4; s++) {
            const a = base + side * (0.6 + rand() * 0.5);
            const len = radius * 0.07 * (0.6 + rand());
            px += Math.cos(a) * len;
            py += Math.sin(a) * len * squash;
            bpts[s * 2] = px;
            bpts[s * 2 + 1] = py;
        }
        paths.push(bpts);
        startList.push(from / steps);
    }

    const webCount = rings * spokeCount;
    const web = new Float32Array(webCount * 4);
    const webRing = new Uint8Array(webCount);
    let w = 0;
    const spokesOnly = paths.filter((p) => p.length === (steps + 1) * 2);
    for (let r = 0; r < rings; r++) {
        const k = 1 + r * 2;
        for (let i = 0; i < spokesOnly.length; i++) {
            const a = spokesOnly[i];
            const b = spokesOnly[(i + 1) % spokesOnly.length];
            if (rand() < 0.2) continue;
            web[w * 4] = a[k * 2];
            web[w * 4 + 1] = a[k * 2 + 1];
            web[w * 4 + 2] = b[k * 2];
            web[w * 4 + 3] = b[k * 2 + 1];
            webRing[w] = r;
            w++;
        }
    }
    return { paths, starts: Float32Array.from(startList), web: web.subarray(0, w * 4), webRing: webRing.subarray(0, w) };
}

/** Traça a teia até o progresso `p` (0..1): cada raio cresce do centro pra fora, os anéis entram depois. */
function strokeCrackWeb(ctx, cr, p) {
    ctx.beginPath();
    const paths = cr.paths;
    for (let i = 0; i < paths.length; i++) {
        const pts = paths[i];
        const start = cr.starts[i];
        const local = start >= 1 ? 0 : clamp01((p - start) / (1 - start));
        if (local <= 0) continue;
        const segs = pts.length / 2 - 1;
        const reach = local * segs;
        const full = Math.floor(reach);
        ctx.moveTo(pts[0], pts[1]);
        for (let s = 1; s <= full; s++) ctx.lineTo(pts[s * 2], pts[s * 2 + 1]);
        if (full < segs) {
            const f = reach - full;
            const x0 = pts[full * 2];
            const y0 = pts[full * 2 + 1];
            ctx.lineTo(x0 + (pts[full * 2 + 2] - x0) * f, y0 + (pts[full * 2 + 3] - y0) * f);
        }
    }
    const web = cr.web;
    for (let i = 0; i < cr.webRing.length; i++) {
        if (p < 0.45 + cr.webRing[i] * 0.18) continue;
        ctx.moveTo(web[i * 4], web[i * 4 + 1]);
        ctx.lineTo(web[i * 4 + 2], web[i * 4 + 3]);
    }
}

/** Estado de uma teia de rachaduras em cena (chão ou tela). Pré-alocado; `web` troca a cada impacto. */
function makeCrackState() {
    return { web: null, p: 0, alpha: 0, age: 0, growMs: 1, holdMs: 1, fadeMs: 1, cx: 0, cy: 0, radius: 0, rgb: [255, 255, 255], glow: '', core: '' };
}

export class UltimateFx {
    /**
     * @param {import('../systems/board-system.js').BoardSystem} board
     * @param {import('./particle-system.js').ParticleSystem} particles
     */
    constructor(board, particles) {
        this.board = board;
        this.particles = particles;
        this.time = 0;

        // Tremor (aplicado como transform CSS no canvas pelo renderer)
        this.shakeAmp = 0;
        this.shakeDur = 1;
        this.shakeT = 1;
        this.shakeX = 0;
        this.shakeY = 0;

        // Relógio do Kármico
        this.clock = { alpha: 0, target: 0, angle: 0, speed: CLOCK_BASE_SPEED, hand: 0, handSpeed: 1.2, x: 0, y: 0, hex: '' };
        // Pós-processamento de fita (0..1) e quanto cai por ms
        this.glitch = 0;
        this.glitchFade = 1 / 600;

        // Monólito (posição do centro em coordenadas virtuais)
        this.mono = { on: false, x: 0, y: 0, scale: 1, alpha: 0, rot: 0, sink: 0, glow: 0, hex: DEFAULT_CRYSTAL };
        this.floor = makeCrackState();
        this.screen = makeCrackState();

        // Cristais do campo trancado: [SELF, OPP]
        this.prison = [
            { level: 0, target: 0, intro: 0, hex: DEFAULT_CRYSTAL },
            { level: 0, target: 0, intro: 0, hex: DEFAULT_CRYSTAL }
        ];
        this.region = { x: 0, y: 0, w: 0, h: 0, ax: 0, ay: 0, dx: 0, dy: 0 };

        // Sprites (cache de 1 entrada por tipo, chave = cor + qualidade)
        this.clockSprite = null;
        this.clockKey = '';
        this.monoSprite = null;
        this.monoKey = '';
        this.haloSprite = null;
        this.haloKey = '';
        this.crystal = [null, null];
        this.crystalKey = ['', ''];
        this.padlockSprite = null;
        this.labelSprite = null;
        this.scanPattern = null;
        this.scanBar = null;
        this.scratchR = null;
        this.scratchB = null;

        globalEvents.on('LANGUAGE_CHANGED', () => { this.labelSprite = null; });
    }

    // --- API das cinemáticas ------------------------------------------------------

    /** Tremor que decai quadraticamente em `ms` (px virtuais). Um tremor maior sobrescreve o atual. */
    shake(amp, ms) {
        const current = this.shakeT < this.shakeDur ? this.shakeAmp * (1 - this.shakeT / this.shakeDur) : 0;
        if (amp < current) return;
        this.shakeAmp = amp;
        this.shakeDur = Math.max(1, ms);
        this.shakeT = 0;
    }

    showClock(x, y, hex) {
        const c = this.clock;
        if (c.alpha <= 0.01) {
            c.angle = 0;
            c.hand = 0;
        }
        c.x = x;
        c.y = y;
        c.hex = hex;
        c.target = 1;
    }

    hideClock() {
        this.clock.target = 0;
    }

    /** Arranco do relógio: gira muito rápido ao contrário e desacelera sozinho até a rotação de fundo. */
    spinClock(speed, handSpeed) {
        this.clock.speed = speed;
        this.clock.handSpeed = handSpeed;
    }

    /** Pulso de fita VHS (scanlines, faixa, rasgos, RGB) com `amount` 0..1 decaindo em `ms`. */
    pulseGlitch(amount, ms) {
        this.glitch = Math.max(this.glitch, amount);
        this.glitchFade = 1 / Math.max(1, ms);
    }

    /** Liga o monólito em (x, y). A cinemática anima os campos de `this.mono` diretamente. */
    showMonolith(x, y, hex) {
        const m = this.mono;
        m.on = true;
        m.x = x;
        m.y = y;
        m.scale = 1;
        m.alpha = 0;
        m.rot = 0;
        m.sink = 0;
        m.glow = 0;
        m.hex = hex;
    }

    hideMonolith() {
        this.mono.on = false;
        this.mono.alpha = 0;
    }

    /** Rachaduras neon no chão da mesa a partir do ponto de impacto. */
    crackFloor(x, y, hex, radius = 260) {
        this.startCracks(this.floor, x, y, radius, 0.62, GRAPHICS.isHigh ? 11 : 8, 0, GRAPHICS.isHigh, hex, 380, 2200, 900);
    }

    /** Tela estilhaçada (vidro) a partir do ponto de impacto: dura alguns segundos e some. */
    crackScreen(x, y, radius = 520) {
        this.startCracks(this.screen, x, y, radius, 1, GRAPHICS.isHigh ? 14 : 10, 3, GRAPHICS.isHigh, '#ffffff', 160, 2600, 800);
    }

    startCracks(cr, x, y, radius, squash, spokes, rings, branches, hex, growMs, holdMs, fadeMs) {
        cr.web = makeCrackWeb(x, y, radius, squash, spokes, rings, branches);
        cr.p = 0;
        cr.alpha = 1;
        cr.age = 0;
        cr.growMs = growMs;
        cr.holdMs = holdMs;
        cr.fadeMs = fadeMs;
        cr.cx = x;
        cr.cy = y;
        cr.radius = radius;
        cr.rgb = hexToRgb(hex);
        cr.glow = tint(cr.rgb, 0.1, 0.35);
        cr.core = tint(cr.rgb, 0.55, 0.95);
    }

    /**
     * Campo trancado (Prisão de Cristal): cristais crescem cobrindo Ataque + Defesa do lado. Desligar
     * estilhaça os cristais. Idempotente (o snapshot chama a cada atualização).
     * @param {number} side PRISON_SIDE
     * @param {boolean} on
     * @param {string} [hex] cor do cristal (a do trio de Blocks)
     */
    setPrison(side, on, hex) {
        const p = this.prison[side];
        if (hex) p.hex = hex;
        if (on && p.target === 0) {
            p.target = 1;
            p.intro = LOCK_INTRO_MS;
            console.log(`[UltimateFx] Cristais da Prisão crescendo no campo ${side === PRISON_SIDE.SELF ? 'próprio' : 'do oponente'}.`);
        } else if (!on && p.target === 1) {
            p.target = 0;
            this.shatterPrison(side);
        }
    }

    /** Some com tudo na hora (nova partida / reconexão). */
    reset() {
        this.hideMonolith();
        this.clock.alpha = 0;
        this.clock.target = 0;
        this.glitch = 0;
        this.floor.alpha = 0;
        this.floor.web = null;
        this.screen.alpha = 0;
        this.screen.web = null;
        this.shakeT = this.shakeDur;
        this.shakeX = 0;
        this.shakeY = 0;
        for (const p of this.prison) {
            p.level = 0;
            p.target = 0;
            p.intro = 0;
        }
    }

    /** Retângulo (virtual) que cobre Ataque + Defesa de um lado; escreve em this.region. */
    regionOf(side) {
        const atk = this.board.slots[side === PRISON_SIDE.SELF ? ZONE.SELF_ATTACK : ZONE.OPP_ATTACK];
        const def = this.board.slots[side === PRISON_SIDE.SELF ? ZONE.SELF_DEFENSE : ZONE.OPP_DEFENSE];
        const r = this.region;
        if (!atk || !def) {
            r.w = 0;
            return r;
        }
        const x0 = Math.min(atk.hitX, def.hitX) - REGION_PAD;
        const y0 = Math.min(atk.hitY, def.hitY) - REGION_PAD;
        const x1 = Math.max(atk.hitX + atk.hitW, def.hitX + def.hitW) + REGION_PAD;
        const y1 = Math.max(atk.hitY + atk.hitH, def.hitY + def.hitH) + REGION_PAD;
        r.x = x0;
        r.y = y0;
        r.w = x1 - x0;
        r.h = y1 - y0;
        r.ax = atk.hitX + atk.hitW / 2;
        r.ay = atk.hitY + atk.hitH / 2;
        r.dx = def.hitX + def.hitW / 2;
        r.dy = def.hitY + def.hitH / 2;
        return r;
    }

    shatterPrison(side) {
        const r = this.regionOf(side);
        if (r.w <= 0 || !this.particles) return;
        const hex = this.prison[side].hex;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        this.particles.emitBurst(cx, cy, hex, 40, 320, PARTICLE_TYPES.SQUARE, 1.3);
        this.particles.emitBurst(cx, cy, '#ffffff', 26, 260, PARTICLE_TYPES.SPARK, 1.1);
        this.particles.emitBurst(r.ax, r.ay, LOCK_RED, 10, 160, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(r.dx, r.dy, LOCK_RED, 10, 160, PARTICLE_TYPES.STAR);
    }

    // --- Frame ------------------------------------------------------------------

    update(dt) {
        const s = dt / 1000;
        this.time += s;

        if (this.shakeT < this.shakeDur) {
            this.shakeT += dt;
            const k = clamp01(1 - this.shakeT / this.shakeDur);
            const a = this.shakeAmp * k * k;
            this.shakeX = (Math.random() * 2 - 1) * a;
            this.shakeY = (Math.random() * 2 - 1) * a;
        } else {
            this.shakeX = 0;
            this.shakeY = 0;
        }

        const c = this.clock;
        if (c.alpha !== c.target) {
            const step = dt / CLOCK_FADE_MS;
            c.alpha = c.target > c.alpha ? Math.min(c.target, c.alpha + step) : Math.max(c.target, c.alpha - step);
        }
        if (c.alpha > 0) {
            c.angle -= c.speed * s;
            c.hand -= c.handSpeed * s;
            const settle = Math.min(1, s * 1.8);
            c.speed += (CLOCK_BASE_SPEED - c.speed) * settle;
            c.handSpeed += (1.2 - c.handSpeed) * settle;
        }

        if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * this.glitchFade);

        this.tickCracks(this.floor, dt);
        this.tickCracks(this.screen, dt);

        for (let i = 0; i < 2; i++) {
            const p = this.prison[i];
            if (p.level < p.target) p.level = Math.min(p.target, p.level + dt / PRISON_GROW_MS);
            else if (p.level > p.target) p.level = Math.max(p.target, p.level - dt / PRISON_SHATTER_MS);
            if (p.intro > 0) p.intro = Math.max(0, p.intro - dt);
        }
    }

    tickCracks(cr, dt) {
        if (cr.alpha <= 0) return;
        cr.age += dt;
        cr.p = clamp01(cr.age / cr.growMs);
        if (cr.age > cr.holdMs) cr.alpha = Math.max(0, cr.alpha - dt / cr.fadeMs);
        if (cr.alpha <= 0) cr.web = null;
    }

    /** Embaixo das cartas: relógio no fundo, rachaduras do chão e os cristais do campo trancado. */
    drawBack(ctx) {
        if (this.clock.alpha > 0.005) this.drawClock(ctx);
        if (this.floor.alpha > 0 && this.floor.web) this.drawFloorCracks(ctx);
        for (let side = 0; side < 2; side++) {
            if (this.prison[side].level > 0.001) this.drawCrystals(ctx, side);
        }
    }

    /** Por cima das cartas: monólito, cadeados e o aviso "ZONAS ISOLADAS". */
    drawFront(ctx) {
        if (this.mono.on && this.mono.alpha > 0.005) this.drawMonolith(ctx);
        for (let side = 0; side < 2; side++) {
            if (this.prison[side].level > 0.3) this.drawLocks(ctx, side);
        }
    }

    /**
     * Pós-processamento (depois das partículas): tela estilhaçada e fita VHS.
     * @param {HTMLCanvasElement} canvas backbuffer (fonte das cópias do glitch)
     * @param {number} pixelScale pixels físicos por unidade virtual
     */
    drawPost(ctx, canvas, width, height, pixelScale) {
        if (this.screen.alpha > 0 && this.screen.web) this.drawScreenCracks(ctx);
        if (this.glitch > 0.01) this.drawGlitch(ctx, canvas, width, height, pixelScale);
    }

    // --- Relógio ----------------------------------------------------------------

    getClockSprite(hex) {
        const key = `${hex}|${GRAPHICS.isHigh ? 1 : 0}`;
        if (this.clockSprite && this.clockKey === key) return this.clockSprite;
        const S = GRAPHICS.isHigh ? 1.2 : 0.8;
        const R = CLOCK_RADIUS;
        const pad = 24;
        const size = (R + pad) * 2;
        const c = makeCanvas(size * S, size * S);
        const g = c.getContext('2d');
        const rgb = hexToRgb(hex);
        g.scale(S, S);
        g.translate(size / 2, size / 2);

        const disc = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
        disc.addColorStop(0, tint(rgb, 0.2, 0.22));
        disc.addColorStop(0.7, tint(rgb, 0, 0.1));
        disc.addColorStop(1, tint(rgb, 0, 0));
        g.fillStyle = disc;
        g.beginPath();
        g.arc(0, 0, R, 0, TAU);
        g.fill();

        g.shadowColor = hex;
        g.shadowBlur = 14;
        g.strokeStyle = tint(rgb, 0.45, 0.95);
        g.lineWidth = 4;
        g.beginPath();
        g.arc(0, 0, R, 0, TAU);
        g.stroke();
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(0, 0, R * 0.93, 0, TAU);
        g.stroke();

        // 60 marcas (as 12 das horas mais longas e grossas)
        for (let i = 0; i < 60; i++) {
            const a = (i / 60) * TAU;
            const major = i % 5 === 0;
            const r0 = major ? R * 0.83 : R * 0.88;
            g.lineWidth = major ? 4 : 1.5;
            g.beginPath();
            g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
            g.lineTo(Math.cos(a) * R * 0.93, Math.sin(a) * R * 0.93);
            g.stroke();
        }
        // Algarismos romanos (decorativos, universais: não são texto traduzível)
        const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
        g.fillStyle = tint(rgb, 0.5, 0.9);
        g.font = '700 30px Georgia, "Times New Roman", serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU - Math.PI / 2;
            g.save();
            g.translate(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72);
            g.rotate(a + Math.PI / 2);
            g.fillText(numerals[i], 0, 0);
            g.restore();
        }
        // Anel tracejado + engrenagem interna
        g.setLineDash([10, 8]);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, R * 0.58, 0, TAU);
        g.stroke();
        g.setLineDash([]);
        const teeth = 24;
        g.lineWidth = 2.5;
        g.beginPath();
        for (let i = 0; i <= teeth * 2; i++) {
            const a = (i / (teeth * 2)) * TAU;
            const r = i % 2 === 0 ? R * 0.44 : R * 0.4;
            const a2 = a + TAU / (teeth * 4);
            if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            g.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
        }
        g.stroke();
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(0, 0, R * 0.3, 0, TAU);
        g.stroke();

        this.clockSprite = c;
        this.clockKey = key;
        return c;
    }

    drawClock(ctx) {
        const c = this.clock;
        const sprite = this.getClockSprite(c.hex);
        const size = (CLOCK_RADIUS + 24) * 2;
        const half = size / 2;
        const a = c.alpha;
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        ctx.globalAlpha = a * (GRAPHICS.isHigh ? 0.5 : 0.42);
        ctx.drawImage(sprite, -half, -half, size, size);
        if (GRAPHICS.isHigh && c.speed > 1) {
            // Pós-imagem do giro rápido (rastro), só enquanto está disparado
            const trail = clamp01((c.speed - 1) / 6);
            ctx.rotate(0.14);
            ctx.globalAlpha = a * 0.2 * trail;
            ctx.drawImage(sprite, -half, -half, size, size);
            ctx.rotate(0.14);
            ctx.globalAlpha = a * 0.1 * trail;
            ctx.drawImage(sprite, -half, -half, size, size);
        }
        ctx.restore();

        // Ponteiros (independentes do mostrador), girando pra trás
        ctx.save();
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        ctx.globalAlpha = a * 0.85;
        ctx.translate(c.x, c.y);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.rotate(c.hand);
        ctx.beginPath();
        ctx.moveTo(0, 18);
        ctx.lineTo(0, -CLOCK_RADIUS * 0.78);
        ctx.stroke();
        ctx.rotate(-c.hand + c.hand / 12);
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(0, 14);
        ctx.lineTo(0, -CLOCK_RADIUS * 0.5);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, TAU);
        ctx.fill();
        ctx.restore();
    }

    // --- Monólito ---------------------------------------------------------------

    getMonoSprite(hex) {
        const key = `${hex}|${GRAPHICS.isHigh ? 1 : 0}`;
        if (this.monoSprite && this.monoKey === key) return this.monoSprite;
        const S = GRAPHICS.isHigh ? 1.6 : 1;
        const W = MONO_W + MONO_PAD * 2;
        const H = MONO_H + MONO_PAD * 2;
        const c = makeCanvas(W * S, H * S);
        const g = c.getContext('2d');
        const rgb = hexToRgb(hex);
        g.scale(S, S);
        g.translate(W / 2, MONO_PAD);

        const hw = MONO_W / 2;
        const inner = MONO_W * 0.17;
        const y1 = MONO_H * 0.17;
        const y2 = MONO_H * 0.8;
        const top = 0;
        const bot = MONO_H;
        const silhouette = () => {
            g.beginPath();
            g.moveTo(0, top);
            g.lineTo(hw, y1);
            g.lineTo(hw * 0.92, y2);
            g.lineTo(0, bot);
            g.lineTo(-hw * 0.92, y2);
            g.lineTo(-hw, y1);
            g.closePath();
        };
        // Halo de base (sombra colorida só na rasterização)
        g.shadowColor = hex;
        g.shadowBlur = 26;
        g.fillStyle = tint(rgb, 0.2, 0.55);
        silhouette();
        g.fill();
        g.shadowBlur = 0;

        const face = (pts, c0, c1) => {
            const grad = g.createLinearGradient(pts[0], 0, pts[pts.length - 2], 0);
            grad.addColorStop(0, c0);
            grad.addColorStop(1, c1);
            g.fillStyle = grad;
            g.beginPath();
            g.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
            g.closePath();
            g.fill();
        };
        // Faces: esquerda escura, centro clara, direita média (luz vindo de cima à esquerda)
        face([-hw, y1, -inner, y1, -inner, y2 + 8, -hw * 0.92, y2], tint(rgb, 0.05, 0.85), tint(rgb, 0.3, 0.85));
        face([-inner, y1, inner, y1, inner, y2 + 8, -inner, y2 + 8], tint(rgb, 0.75, 0.9), tint(rgb, 0.45, 0.88));
        face([inner, y1, hw, y1, hw * 0.92, y2, inner, y2 + 8], tint(rgb, 0.35, 0.85), tint(rgb, 0.0, 0.85));
        // Pontas (topo e fundo)
        face([0, top, -hw, y1, -inner, y1], tint(rgb, 0.4, 0.9), tint(rgb, 0.8, 0.95));
        face([0, top, inner, y1, hw, y1], tint(rgb, 0.9, 0.95), tint(rgb, 0.3, 0.9));
        face([-hw * 0.92, y2, -inner, y2 + 8, 0, bot], tint(rgb, 0.0, 0.9), tint(rgb, 0.25, 0.9));
        face([inner, y2 + 8, hw * 0.92, y2, 0, bot], tint(rgb, 0.2, 0.9), tint(rgb, 0.0, 0.9));

        // Arestas de vidro
        g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        g.lineWidth = 1.6;
        silhouette();
        g.stroke();
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        g.beginPath();
        g.moveTo(-hw, y1); g.lineTo(hw, y1);
        g.moveTo(-inner, y1); g.lineTo(-inner, y2 + 8); g.lineTo(0, bot);
        g.moveTo(inner, y1); g.lineTo(inner, y2 + 8); g.lineTo(0, bot);
        g.moveTo(-hw * 0.92, y2); g.lineTo(-inner, y2 + 8);
        g.moveTo(hw * 0.92, y2); g.lineTo(inner, y2 + 8);
        g.moveTo(0, top); g.lineTo(-inner, y1);
        g.moveTo(0, top); g.lineTo(inner, y1);
        g.stroke();

        // Símbolo do Block gravado no cristal (círculo cortado)
        const cy = (y1 + y2) / 2;
        g.shadowColor = '#ffffff';
        g.shadowBlur = 10;
        g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(0, cy, 24, 0, TAU);
        g.moveTo(-17, cy - 17);
        g.lineTo(17, cy + 17);
        g.stroke();
        // Veios internos
        g.shadowBlur = 0;
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        g.beginPath();
        g.moveTo(-inner * 0.4, y1 + 20); g.lineTo(inner * 0.7, y1 + 70); g.lineTo(-inner * 0.2, y1 + 110);
        g.moveTo(inner * 0.3, y2 - 70); g.lineTo(-inner * 0.6, y2 - 30);
        g.stroke();

        this.monoSprite = c;
        this.monoKey = key;
        return c;
    }

    getHaloSprite(hex) {
        if (this.haloSprite && this.haloKey === hex) return this.haloSprite;
        const size = 256;
        const c = makeCanvas(size, size);
        const g = c.getContext('2d');
        const rgb = hexToRgb(hex);
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, tint(rgb, 0.5, 0.55));
        grad.addColorStop(0.45, tint(rgb, 0.1, 0.22));
        grad.addColorStop(1, tint(rgb, 0, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        this.haloSprite = c;
        this.haloKey = hex;
        return c;
    }

    drawMonolith(ctx) {
        const m = this.mono;
        const sprite = this.getMonoSprite(m.hex);
        const W = MONO_W + MONO_PAD * 2;
        const H = MONO_H + MONO_PAD * 2;
        ctx.save();
        ctx.translate(m.x, m.y);
        if (GRAPHICS.isHigh && m.glow > 0) {
            // Halo aditivo em volta (só no alto)
            const halo = this.getHaloSprite(m.hex);
            const hs = 380 * m.scale * (1 + m.glow * 0.25);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = m.alpha * m.glow * 0.9;
            ctx.drawImage(halo, -hs / 2, -hs * 0.6, hs, hs * 1.2);
            ctx.globalCompositeOperation = 'source-over';
        }
        if (m.rot !== 0) ctx.rotate(m.rot);
        ctx.scale(m.scale, m.scale);
        ctx.globalAlpha = m.alpha;
        if (m.sink > 0) {
            // Afunda no chão: tudo abaixo do "solo" (centro original + meia altura) fica cortado
            const ground = MONO_H / 2;
            ctx.beginPath();
            ctx.rect(-W / 2, -H, W, H + ground);
            ctx.clip();
            ctx.translate(0, m.sink * MONO_H);
        }
        ctx.drawImage(sprite, -W / 2, -MONO_H / 2 - MONO_PAD, W, H);
        if (GRAPHICS.isHigh && m.glow > 0) {
            // Varredura de luz subindo pelo cristal
            const y = MONO_H / 2 - ((this.time * 1.3) % 1) * MONO_H;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = m.alpha * m.glow * 0.35;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-MONO_W * 0.2, y, MONO_W * 0.4, 6);
        }
        ctx.restore();
    }

    // --- Rachaduras ---------------------------------------------------------------

    drawFloorCracks(ctx) {
        const cr = this.floor;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        strokeCrackWeb(ctx, cr.web, cr.p);
        if (GRAPHICS.isHigh) {
            ctx.globalAlpha = cr.alpha * (0.75 + 0.25 * Math.sin(this.time * 9));
            ctx.strokeStyle = cr.glow;
            ctx.lineWidth = 9;
            ctx.stroke();
        }
        ctx.globalAlpha = cr.alpha;
        ctx.strokeStyle = cr.core;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
    }

    drawScreenCracks(ctx) {
        const cr = this.screen;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (GRAPHICS.isHigh) {
            // Leve brilho de vidro no centro do impacto
            ctx.globalAlpha = cr.alpha * 0.18 * (1 - cr.p * 0.5);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(cr.cx, cr.cy, 40 + cr.p * 30, 0, TAU);
            ctx.fill();
        }
        strokeCrackWeb(ctx, cr.web, cr.p);
        if (GRAPHICS.isHigh) {
            // Sombra da fissura (profundidade) + fio de luz deslocado (borda do vidro)
            ctx.globalAlpha = cr.alpha * 0.6;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.lineWidth = 3.4;
            ctx.stroke();
        }
        ctx.globalAlpha = cr.alpha;
        ctx.strokeStyle = 'rgba(235, 248, 255, 0.95)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        if (GRAPHICS.isHigh) {
            ctx.translate(1.2, -1.2);
            ctx.globalAlpha = cr.alpha * 0.45;
            ctx.strokeStyle = 'rgba(160, 220, 255, 0.9)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
        ctx.restore();
    }

    // --- Cristais do campo trancado ---------------------------------------------------

    getCrystalSprite(side, hex, w, h) {
        const key = `${hex}|${Math.round(w)}x${Math.round(h)}|${GRAPHICS.isHigh ? 1 : 0}`;
        if (this.crystal[side] && this.crystalKey[side] === key) return this.crystal[side];
        const S = GRAPHICS.isHigh ? 1.5 : 1;
        const pad = 16;
        const W = w + pad * 2;
        const H = h + pad * 2;
        const body = makeCanvas(W * S, H * S);
        const glint = GRAPHICS.isHigh ? makeCanvas(W * S, H * S) : null;
        const g = body.getContext('2d');
        const rgb = hexToRgb(hex);
        g.scale(S, S);
        g.translate(pad, pad);

        // Lâmina de gelo sobre os dois slots
        g.shadowColor = hex;
        g.shadowBlur = 18;
        g.fillStyle = tint(rgb, 0.6, 0.32);
        g.strokeStyle = tint(rgb, 0.8, 0.7);
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(0, 0, w, h, 16);
        g.fill();
        g.stroke();
        g.shadowBlur = 0;

        // Geada: riscos finos
        const rand = prng(0xC0FFEE);
        g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        g.lineWidth = 1;
        g.beginPath();
        for (let i = 0; i < 110; i++) {
            const x = rand() * w;
            const y = rand() * h;
            const a = rand() * TAU;
            const l = 4 + rand() * 12;
            g.moveTo(x, y);
            g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        }
        g.stroke();

        // Estilhaços de cristal (prismas alongados), mesma sequência pro reflexo
        const shards = [];
        const count = 24;
        for (let i = 0; i < count; i++) {
            const cx = w * (0.12 + rand() * 0.76);
            const cy = h * (0.08 + rand() * 0.84);
            const len = 40 + rand() * 78;
            const wid = 14 + rand() * 18;
            const ang = -Math.PI / 2 + (rand() - 0.5) * 1.8;
            shards.push(cx, cy, len, wid, ang);
        }
        const shardPath = (ctx2, i) => {
            const cx = shards[i];
            const cy = shards[i + 1];
            const len = shards[i + 2];
            const wid = shards[i + 3];
            const ang = shards[i + 4];
            ctx2.save();
            ctx2.translate(cx, cy);
            ctx2.rotate(ang);
            ctx2.beginPath();
            ctx2.moveTo(len / 2, 0);
            ctx2.lineTo(len * 0.28, -wid / 2);
            ctx2.lineTo(-len / 2, -wid * 0.4);
            ctx2.lineTo(-len / 2 - 6, 0);
            ctx2.lineTo(-len / 2, wid * 0.4);
            ctx2.lineTo(len * 0.28, wid / 2);
            ctx2.closePath();
        };
        for (let i = 0; i < shards.length; i += 5) {
            shardPath(g, i);
            const wid = shards[i + 3];
            const grad = g.createLinearGradient(0, -wid / 2, 0, wid / 2);
            grad.addColorStop(0, tint(rgb, 0.85, 0.85));
            grad.addColorStop(0.5, tint(rgb, 0.35, 0.6));
            grad.addColorStop(1, tint(rgb, 0.05, 0.75));
            g.fillStyle = grad;
            g.fill();
            g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            g.lineWidth = 1.2;
            g.stroke();
            g.beginPath();
            g.moveTo(shards[i + 2] / 2, 0);
            g.lineTo(-shards[i + 2] / 2, 0);
            g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            g.stroke();
            g.restore();
        }

        if (glint) {
            const gg = glint.getContext('2d');
            gg.scale(S, S);
            gg.translate(pad, pad);
            gg.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            gg.lineWidth = 2;
            gg.shadowColor = '#ffffff';
            gg.shadowBlur = 8;
            for (let i = 0; i < shards.length; i += 5) {
                shardPath(gg, i);
                gg.stroke();
                gg.restore();
            }
        }

        const sprite = { body, glint, pad };
        this.crystal[side] = sprite;
        this.crystalKey[side] = key;
        return sprite;
    }

    drawCrystals(ctx, side) {
        const p = this.prison[side];
        const r = this.regionOf(side);
        if (r.w <= 0) return;
        const sprite = this.getCrystalSprite(side, p.hex, r.w, r.h);
        // Crescimento: brota do centro, estica primeiro na vertical com um leve "passa e volta"
        const t = p.level;
        const e = t < 1 ? 1 - Math.pow(1 - t, 3) * (1 - 1.6 * t * (1 - t)) : 1;
        const sx = Math.min(1, 0.35 + 0.65 * e);
        const sy = Math.max(0.01, e);
        const W = r.w + sprite.pad * 2;
        const H = r.h + sprite.pad * 2;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(sx, sy);
        ctx.globalAlpha = clamp01(t * 1.6);
        ctx.drawImage(sprite.body, -W / 2, -H / 2, W, H);
        if (sprite.glint && GRAPHICS.isHigh) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = clamp01(t * 1.6) * (0.18 + 0.22 * Math.max(0, Math.sin(this.time * 2.1 + side)));
            ctx.drawImage(sprite.glint, -W / 2, -H / 2, W, H);
        }
        ctx.restore();
    }

    // --- Cadeados + "ZONAS ISOLADAS" ------------------------------------------------

    getPadlockSprite() {
        if (this.padlockSprite) return this.padlockSprite;
        const S = 2;
        const W = 64;
        const H = 76;
        const c = makeCanvas(W * S, H * S);
        const g = c.getContext('2d');
        g.scale(S, S);
        g.translate(W / 2, 8);
        g.shadowColor = LOCK_RED;
        g.shadowBlur = 14;
        g.strokeStyle = '#ff8fa3';
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-13, 30);
        g.lineTo(-13, 16);
        g.arc(0, 16, 13, Math.PI, 0);
        g.lineTo(13, 30);
        g.stroke();
        const grad = g.createLinearGradient(0, 28, 0, 64);
        grad.addColorStop(0, '#ff5c7a');
        grad.addColorStop(1, '#a3001f');
        g.fillStyle = grad;
        g.beginPath();
        g.roundRect(-22, 28, 44, 34, 7);
        g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = '#ffd0da';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = '#3a0010';
        g.beginPath();
        g.arc(0, 41, 5, 0, TAU);
        g.fill();
        g.fillRect(-2, 43, 4, 10);
        this.padlockSprite = { canvas: c, w: W, h: H };
        return this.padlockSprite;
    }

    getLabelSprite() {
        if (this.labelSprite) return this.labelSprite;
        const text = i18n.t('PRISON_ZONES_LOCKED');
        const S = 2;
        const font = '900 22px system-ui, -apple-system, "Segoe UI", sans-serif';
        const probe = makeCanvas(4, 4).getContext('2d');
        probe.font = font;
        const tw = Math.ceil(probe.measureText(text).width);
        const W = tw + 40;
        const H = 44;
        const c = makeCanvas(W * S, H * S);
        const g = c.getContext('2d');
        g.scale(S, S);
        g.font = font;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(28, 0, 8, 0.9)';
        g.beginPath();
        g.roundRect(4, 6, W - 8, H - 12, 8);
        g.fill();
        g.strokeStyle = '#ff4d6d';
        g.lineWidth = 2;
        g.stroke();
        g.shadowColor = LOCK_RED;
        g.shadowBlur = 14;
        g.fillStyle = '#ff5c7a';
        g.fillText(text, W / 2, H / 2 + 1);
        g.shadowBlur = 0;
        g.fillStyle = '#fff0f3';
        g.globalAlpha = 0.55;
        g.fillText(text, W / 2, H / 2 + 1);
        this.labelSprite = { canvas: c, w: W, h: H };
        return this.labelSprite;
    }

    drawLocks(ctx, side) {
        const p = this.prison[side];
        const r = this.regionOf(side);
        if (r.w <= 0) return;
        const show = clamp01((p.level - 0.3) / 0.5);
        const lock = this.getPadlockSprite();
        const t = this.time;
        ctx.save();
        for (let k = 0; k < 2; k++) {
            const x = k === 0 ? r.ax : r.dx;
            const y = (k === 0 ? r.ay : r.dy) - 6 + Math.sin(t * 2.2 + k * 1.7) * 5;
            const s = 0.75 + 0.05 * Math.sin(t * 3 + k);
            ctx.globalAlpha = show * (0.75 + 0.25 * Math.sin(t * 4 + k * 2));
            ctx.drawImage(lock.canvas, x - (lock.w * s) / 2, y - (lock.h * s) / 2, lock.w * s, lock.h * s);
        }
        // Aviso trêmulo entre os dois slots: forte no começo, discreto (mas visível) depois
        const label = this.getLabelSprite();
        const intro = p.intro / LOCK_INTRO_MS;
        const jitter = 1 + intro * 2.5;
        const lx = r.x + r.w / 2 + (Math.random() * 2 - 1) * jitter;
        const ly = (r.ay + r.dy) / 2 + (Math.random() * 2 - 1) * jitter;
        const ls = Math.min(1, (r.w + 60) / label.w) * (1 + intro * 0.12);
        ctx.globalAlpha = show * (0.8 + 0.2 * intro) * (0.88 + 0.12 * Math.sin(t * 11));
        ctx.drawImage(label.canvas, lx - (label.w * ls) / 2, ly - (label.h * ls) / 2, label.w * ls, label.h * ls);
        ctx.restore();
    }

    // --- Fita VHS (pós) -------------------------------------------------------------

    getScanPattern(ctx) {
        if (this.scanPattern) return this.scanPattern;
        const c = makeCanvas(1, 3);
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(0, 0, 0, 0.55)';
        g.fillRect(0, 2, 1, 1);
        this.scanPattern = ctx.createPattern(c, 'repeat');
        const bar = ctx.createLinearGradient(0, 0, 0, SCAN_BAR_H);
        bar.addColorStop(0, 'rgba(255, 255, 255, 0)');
        bar.addColorStop(0.55, 'rgba(210, 240, 255, 0.16)');
        bar.addColorStop(1, 'rgba(255, 255, 255, 0)');
        this.scanBar = bar;
        return this.scanPattern;
    }

    /** Canal isolado (R ou G+B) da imagem atual em meia resolução, com o alfa original. */
    isolateChannel(scratch, canvas, hex) {
        const g = scratch.getContext('2d');
        const w = scratch.width;
        const h = scratch.height;
        g.globalCompositeOperation = 'copy';
        g.drawImage(canvas, 0, 0, w, h);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = hex;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(canvas, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
    }

    drawGlitch(ctx, canvas, width, height, pixelScale) {
        const gA = this.glitch;
        const high = GRAPHICS.isHigh;
        ctx.save();

        if (high && canvas) {
            // 1) Aberração cromática: vermelho pra um lado, ciano pro outro (cópias em meia resolução)
            const hw = canvas.width >> 1;
            const hh = canvas.height >> 1;
            if (!this.scratchR || this.scratchR.width !== hw || this.scratchR.height !== hh) {
                this.scratchR = makeCanvas(hw, hh);
                this.scratchB = makeCanvas(hw, hh);
            }
            this.isolateChannel(this.scratchR, canvas, '#ff0000');
            this.isolateChannel(this.scratchB, canvas, '#00ffff');
            const off = 4 + gA * 10;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.45 * gA;
            ctx.drawImage(this.scratchR, -off, 0, width, height);
            ctx.drawImage(this.scratchB, off, 0, width, height);

            // 2) Rasgos horizontais: faixas do próprio quadro deslocadas
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            const tears = 2 + Math.floor(gA * 4);
            for (let i = 0; i < tears; i++) {
                const sy = Math.random() * height;
                const sh = 4 + Math.random() * 22;
                const dx = (Math.random() * 2 - 1) * 40 * gA;
                ctx.drawImage(canvas, 0, sy * pixelScale, canvas.width, sh * pixelScale, dx, sy, width, sh);
            }
        }

        // 3) Scanlines + faixa rolando de cima pra baixo (os dois níveis)
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.35 * gA + 0.1;
        ctx.fillStyle = this.getScanPattern(ctx);
        ctx.fillRect(0, 0, width, height);
        const barY = ((this.time * 900) % (height + SCAN_BAR_H)) - SCAN_BAR_H;
        ctx.globalAlpha = Math.min(1, gA * 1.4);
        ctx.translate(0, barY);
        ctx.fillStyle = this.scanBar;
        ctx.fillRect(0, 0, width, SCAN_BAR_H);
        ctx.translate(0, -barY);

        // 4) Barras finas magenta/ciano (estática de sinal)
        ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
        const bars = 2 + Math.floor(gA * 3);
        for (let i = 0; i < bars; i++) {
            ctx.globalAlpha = (0.12 + Math.random() * 0.2) * gA;
            ctx.fillStyle = (i & 1) === 0 ? '#ff00c8' : '#00e5ff';
            ctx.fillRect(0, Math.random() * height, width, 1 + Math.random() * 3);
        }
        ctx.restore();
    }
}

/** Centro da carta em coordenadas virtuais a partir do alvo do layout. */
export function cardCenter(pool, id) {
    return { x: pool.targetX[id] + CARD_DIMENSIONS.WIDTH / 2, y: pool.targetY[id] + CARD_DIMENSIONS.HEIGHT / 2 };
}
