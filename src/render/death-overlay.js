import { CONFIG } from '../config/constants.js';
import { GRAPHICS } from '../config/graphics.js';
import { drawFlame, drawRonovaEye, drawRonovaOrb, getGlowSprite, ronovaOrbGaze } from './death-art.js';

const { ANIM } = CONFIG;
const MAX_EMBERS = 90;
const TAU = Math.PI * 2;

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

// O olho está 100% opaco cobrindo a tela: o jogo por baixo não precisa ser desenhado (ninguém vê)
let covering = false;

/** true enquanto o olho cobre a tela inteira sem transparência (o GameClient pula o render da mesa). */
export function ronovaOverlayCovers() {
    return covering;
}

/** Pinta a vinheta antes da hora (tempo ocioso), pra o olho não pagar isso no 1º frame. */
export function warmRonovaOverlay() {
    getVignetteSprite();
}

// Gráfico baixo: o olho é arte de brilho/fogo (sem detalhe fino), então renderiza em resolução interna menor
// e o CSS estica — corta o custo de preenchimento (o maior do celular) sem mudar a composição
const LOW_RES_SCALE = 0.6;

let vignette = null;
/** Vinheta radial (centro transparente, bordas pretas) pintada uma única vez. */
function getVignetteSprite() {
    if (vignette) return vignette;
    vignette = document.createElement('canvas');
    vignette.width = 256;
    vignette.height = 256;
    const g = vignette.getContext('2d');
    const grad = g.createRadialGradient(128, 122, 40, 128, 128, 182);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.55, 'rgba(4, 0, 1, 0.35)');
    grad.addColorStop(1, 'rgba(4, 0, 1, 0.95)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return vignette;
}

function smooth(t) {
    return t * t * (3 - 2 * t);
}

function backOut(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Olhar roteirizado do olho gigante durante o HOLD (h 0..1): abre olhando pra frente, desliza devagar pra
 * esquerda, depois pra direita, e volta ao centro antes de fechar.
 */
function scriptedGaze(h) {
    if (h < 0.24) return 0;
    if (h < 0.42) return -0.9 * smooth((h - 0.24) / 0.18);
    if (h < 0.52) return -0.9;
    if (h < 0.72) return -0.9 + 1.8 * smooth((h - 0.52) / 0.2);
    if (h < 0.8) return 0.9;
    return 0.9 * (1 - smooth((h - 0.8) / 0.2));
}

/**
 * O olho da Ronova cobrindo a tela inteira (inclusive a HUD em DOM): um canvas próprio, fixo acima de tudo,
 * que só existe durante a cinemática (o loop rAF para quando ela acaba). Escuridão carmesim, línguas de fogo
 * subindo das bordas, fitas de chamas da morte, brasas, o olho gigante abrindo, olhando pros lados e fechando,
 * e as duas órbitas negras com as pupilas inquietas. O fade é a `opacity` do canvas (compositor, sem repintar).
 */
export class RonovaOverlay {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.loopId = 0;
        this.running = false;
        this.start = 0;
        this.last = 0;
        this.vw = 0;
        this.vh = 0;
        this.dpr = 1;
        this.onClose = null;
        this.closedFired = false;
        this.resolve = null;
        this.safety = 0;
        this.emberX = new Float32Array(MAX_EMBERS);
        this.emberY = new Float32Array(MAX_EMBERS);
        this.emberV = new Float32Array(MAX_EMBERS);
        this.emberS = new Float32Array(MAX_EMBERS);
        this.emberP = new Float32Array(MAX_EMBERS);
        this.orbGaze = { x: 0, y: 0 };
        this._frame = (now) => this.frame(now);
    }

    get total() {
        return ANIM.DEATH_EYE_IN + ANIM.DEATH_EYE_HOLD + ANIM.DEATH_EYE_CLOSE + ANIM.DEATH_EYE_OUT;
    }

    ensureCanvas() {
        if (this.canvas) return;
        const c = document.createElement('canvas');
        c.id = 'death-overlay';
        c.className = 'death-overlay';
        c.setAttribute('aria-hidden', 'true');
        document.body.appendChild(c);
        this.canvas = c;
        this.ctx = c.getContext('2d');
    }

    resize() {
        this.vw = window.innerWidth;
        this.vh = window.innerHeight;
        this.dpr = Math.min(window.devicePixelRatio || 1, GRAPHICS.maxDpr) * (GRAPHICS.isHigh ? 1 : LOW_RES_SCALE);
        this.canvas.width = Math.round(this.vw * this.dpr);
        this.canvas.height = Math.round(this.vh * this.dpr);
    }

    seedEmbers() {
        for (let i = 0; i < MAX_EMBERS; i++) {
            this.emberX[i] = Math.random() * this.vw;
            this.emberY[i] = this.vh * (0.3 + Math.random() * 0.8);
            this.emberV[i] = 60 + Math.random() * 160;
            this.emberS[i] = 1 + Math.random() * 2.6;
            this.emberP[i] = Math.random() * TAU;
        }
    }

    /**
     * Toca o olho inteiro. `onClose` roda no instante em que as pálpebras se fecham (som da batida).
     * @returns {Promise<void>} resolve quando o overlay some (nunca trava: tem timeout de segurança)
     */
    play(onClose = null) {
        this.ensureCanvas();
        this.stop();
        this.resize();
        this.seedEmbers();
        this.onClose = onClose;
        this.closedFired = false;
        this.canvas.style.display = 'block';
        this.canvas.style.opacity = '0';
        this.running = true;
        this.start = performance.now();
        this.last = this.start;
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.safety = setTimeout(() => this.finish(), this.total + ANIM.SAFETY_MARGIN + 400);
            this.loopId = requestAnimationFrame(this._frame);
        });
    }

    stop() {
        cancelAnimationFrame(this.loopId);
        this.loopId = 0;
        clearTimeout(this.safety);
        this.running = false;
        covering = false;
    }

    finish() {
        if (!this.running && !this.resolve) return;
        this.stop();
        if (!this.closedFired && this.onClose) this.onClose();
        this.closedFired = true;
        if (this.canvas) {
            this.canvas.style.display = 'none';
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        const resolve = this.resolve;
        this.resolve = null;
        if (resolve) resolve();
    }

    frame(now) {
        if (!this.running) return;
        const elapsed = now - this.start;
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        if (elapsed >= this.total) {
            this.finish();
            return;
        }

        const tIn = ANIM.DEATH_EYE_IN;
        const tHold = tIn + ANIM.DEATH_EYE_HOLD;
        const tClose = tHold + ANIM.DEATH_EYE_CLOSE;
        let fade = 1;
        let open = 0;
        let h = 0;
        if (elapsed < tIn) {
            fade = smooth(elapsed / tIn);
        } else if (elapsed < tHold) {
            h = (elapsed - tIn) / ANIM.DEATH_EYE_HOLD;
            open = clamp01(backOut(clamp01(h / 0.22)));
        } else if (elapsed < tClose) {
            h = 1;
            open = 1 - smooth((elapsed - tHold) / ANIM.DEATH_EYE_CLOSE);
        } else {
            h = 1;
            fade = 1 - smooth((elapsed - tClose) / ANIM.DEATH_EYE_OUT);
            if (!this.closedFired) {
                this.closedFired = true;
                if (this.onClose) this.onClose();
            }
        }
        this.canvas.style.opacity = fade.toFixed(3);
        // O fundo do olho é opaco: com fade 1 a mesa fica 100% escondida (o próximo render dela pode ser pulado)
        covering = fade >= 0.999;
        this.draw(elapsed / 1000, dt, open, h, elapsed >= tClose ? (elapsed - tClose) / ANIM.DEATH_EYE_OUT : -1);
        this.loopId = requestAnimationFrame(this._frame);
    }

    draw(time, dt, open, h, afterClose) {
        const ctx = this.ctx;
        const vw = this.vw;
        const vh = this.vh;
        const high = GRAPHICS.isHigh;
        const lighter = GRAPHICS.compositeLighter;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgb(5, 0, 1)';
        ctx.fillRect(0, 0, vw, vh);

        // Olho no centro com as duas órbitas sempre dentro da tela (qualquer proporção)
        const ew = Math.min(vw * 0.22, vh * 0.3);
        const eh = ew * 0.4;
        const cx = vw / 2;
        const cy = vh * 0.48;

        // Brilho carmesim atrás do olho, respirando
        ctx.globalCompositeOperation = lighter;
        ctx.globalAlpha = 0.38 + 0.14 * Math.sin(time * 2.3);
        const gs = ew * 3.1;
        ctx.drawImage(getGlowSprite(170, 0, 22), cx - gs, cy - gs * 0.75, gs * 2, gs * 1.5);

        // Fitas de chamas da morte serpenteando de baixo pra cima (finas, entram e saem do escuro)
        const ribbons = high ? 14 : 6;
        ctx.lineCap = 'round';
        for (let i = 0; i < ribbons; i++) {
            const x0 = (vw * (i + 0.5)) / ribbons + Math.sin(time * 0.6 + i * 1.3) * vw * 0.04;
            const sway = Math.sin(time * 0.9 + i * 0.8) * vw * 0.12;
            const fadeIn = 0.5 + 0.5 * Math.sin(time * 1.1 + i * 2.4);
            // Gráfico baixo: só o fio fino (o traço largo de brilho é o mais caro de rasterizar)
            for (let pass = high ? 0 : 1; pass < 2; pass++) {
                ctx.globalAlpha = (pass === 0 ? 0.1 : 0.26) * fadeIn;
                ctx.lineWidth = pass === 0 ? 18 : 1.8;
                ctx.strokeStyle = pass === 0 ? 'rgb(190, 0, 32)' : (i % 3 === 0 ? 'rgb(255, 170, 160)' : 'rgb(255, 50, 75)');
                ctx.beginPath();
                ctx.moveTo(x0, vh + 20);
                ctx.bezierCurveTo(x0 + sway, vh * 0.66, x0 - sway * 1.2, vh * 0.32, x0 + sway * 0.6, -20);
                ctx.stroke();
            }
        }

        // Vinheta: o fundo afunda no escuro nas bordas e o olho fica no foco (o fogo vem por cima)
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.85;
        ctx.drawImage(getVignetteSprite(), 0, 0, vw, vh);
        ctx.globalCompositeOperation = lighter;

        // Fogo do pé da tela em duas camadas: fundo alto e escuro, frente baixa e brilhante. Tamanho, formato
        // e posição variam por língua (hash fixo) e cada uma balança: nada de fileira de gotas iguais.
        // Cada chama: translação + rotação numa matriz só (sem save/restore por chama)
        const d = this.dpr;
        const back = high ? Math.ceil(vw / 70) : Math.ceil(vw / 150);
        for (let i = 0; i <= back; i++) {
            const j = Math.sin(i * 12.9898) * 43758.5453;
            const rnd = j - Math.floor(j);
            const x = (vw * (i + rnd * 0.6 - 0.3)) / back;
            const flick = 0.7 + 0.22 * Math.sin(time * (3.6 + rnd * 2) + i * 1.9) + 0.08 * Math.sin(time * 11 + i);
            const a = Math.sin(time * 1.3 + i) * 0.08;
            ctx.setTransform(d * Math.cos(a), d * Math.sin(a), -d * Math.sin(a), d * Math.cos(a), d * x, d * (vh + 16));
            ctx.globalAlpha = 0.38 + 0.2 * flick;
            drawFlame(ctx, 0, 0, 120 + rnd * 70, vh * (0.3 + rnd * 0.22) * flick, i);
        }
        const front = high ? Math.ceil(vw / 46) : Math.ceil(vw / 110);
        for (let i = 0; i <= front; i++) {
            const j = Math.sin(i * 78.233 + 4.1) * 43758.5453;
            const rnd = j - Math.floor(j);
            const x = (vw * (i + rnd * 0.8 - 0.4)) / front;
            const flick = 0.68 + 0.24 * Math.sin(time * (5.4 + rnd * 3) + i * 2.3) + 0.08 * Math.sin(time * 14 + i * 3);
            const a = Math.sin(time * 2.1 + i * 1.7) * 0.12;
            ctx.setTransform(d * Math.cos(a), d * Math.sin(a), -d * Math.sin(a), d * Math.cos(a), d * x, d * (vh + 10));
            ctx.globalAlpha = 0.55 + 0.35 * flick;
            drawFlame(ctx, 0, 0, 60 + rnd * 50, vh * (0.12 + rnd * 0.12) * flick, i + 1);
        }
        // Poucas chamas grandes subindo pelas laterais, curvadas pra dentro (só no gráfico alto)
        const side = high ? 3 : 0;
        for (let s = 0; s < 2; s++) {
            for (let i = 0; i < side; i++) {
                const flick = 0.72 + 0.22 * Math.sin(time * (3.2 + i) + i * 2.7 + s * 4);
                const a = (s === 0 ? 1 : -1) * (0.35 + i * 0.12);
                ctx.setTransform(d * Math.cos(a), d * Math.sin(a), -d * Math.sin(a), d * Math.cos(a),
                    d * (s === 0 ? -20 : vw + 20), d * vh * (0.55 + i * 0.2));
                ctx.globalAlpha = 0.32 + 0.2 * flick;
                drawFlame(ctx, 0, 0, 150, vh * (0.5 - i * 0.08) * flick, s === 0 ? 2 : 1);
            }
        }
        ctx.setTransform(d, 0, 0, d, 0, 0);

        // Brasas subindo
        const embers = high ? MAX_EMBERS : 30;
        ctx.fillStyle = '#ff8a5c';
        for (let i = 0; i < embers; i++) {
            this.emberY[i] -= this.emberV[i] * dt;
            if (this.emberY[i] < -10) {
                this.emberY[i] = vh + 10;
                this.emberX[i] = Math.random() * vw;
            }
            const x = this.emberX[i] + Math.sin(time * 2 + this.emberP[i]) * 14;
            const s = this.emberS[i];
            ctx.globalAlpha = 0.45 + 0.45 * Math.sin(time * 6 + this.emberP[i]);
            ctx.fillRect(x - s / 2, this.emberY[i] - s / 2, s, s);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // Duas órbitas (pupilas inquietas) e o olho gigante
        // As órbitas já estão lá quando a escuridão chega; crescem um pouco quando o olho abre
        const orbR = ew * 0.2 * (afterClose >= 0 ? 0.65 + 0.35 * open : 0.86 + 0.14 * open);
        for (let k = 0; k < 2; k++) {
            const g = ronovaOrbGaze(time, 7, k, this.orbGaze);
            const dir = k === 0 ? -1 : 1;
            drawRonovaOrb(ctx, cx + dir * ew * 1.3, cy + dir * eh * 2.5, orbR, g.x, g.y, time, 1);
        }
        drawRonovaEye(ctx, cx, cy, ew, eh, open, scriptedGaze(h), 0.1 * Math.sin(time * 1.3), time * 0.6, time, high ? 9 : 5);

        // Clarão carmesim quando o olho se fecha
        if (afterClose >= 0) {
            ctx.globalCompositeOperation = lighter;
            ctx.globalAlpha = 0.45 * (1 - afterClose);
            ctx.fillStyle = 'rgb(255, 40, 60)';
            ctx.fillRect(0, 0, vw, vh);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }
    }
}
