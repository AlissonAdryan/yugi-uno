import { GRAPHICS } from '../config/graphics.js';
import { drawFlame, getGlowSprite } from '../render/death-art.js';

/**
 * Chamas da Morte em volta da caixa de vida (GAME_RULES §6.19): um canvas atrás de cada caixa, com as mesmas
 * línguas de fogo da carta e do olho gigante. Labaredas subindo pelo topo e curvando pelas laterais (duas
 * camadas), duas espirais de brasa orbitando a caixa, brasas subindo e um halo carmesim respirando.
 *
 * Desempenho (Pilar 1/2): o loop rAF só existe enquanto alguma caixa arde; nada é alocado por frame (posições,
 * brasas e medidas em TypedArrays pré-alocados, sprites do death-art.js). As medidas da caixa (zoom da HUD e
 * densidade da tela) são lidas só ao acender e no resize — nunca dentro do frame.
 */

const PAD = 80;               // CSS px de fogo em volta da caixa (o canvas é maior que a caixa) — bate com o CSS
// Poucas línguas, grandes e macias (muitas pequenas viram "cerdas" numa caixa do tamanho da vida)
const FLAMES_BACK = 9;
const FLAMES_FRONT = 12;
const FLAME_INSET = 16;       // a base nasce por dentro da borda e é "escavada" junto com o interior da caixa
const BOX_RADIUS = 10;        // .hp-container border-radius
const CARVE_ALPHA = 0.97;     // quanto do fogo some dentro da caixa (parece nascer por trás dela)
const EMBERS = 16;
const FADE_OUT_MS = 520;
const TAU = Math.PI * 2;

let darkAura = null;
/**
 * Aura de fumaça escura (pintada uma vez): escurece só a região em volta da caixa, então o fogo carmesim salta
 * em qualquer cor de rodada (num fundo vermelho, vermelho aditivo quase não aparece).
 */
function getDarkAura() {
    if (darkAura) return darkAura;
    darkAura = document.createElement('canvas');
    darkAura.width = 128;
    darkAura.height = 128;
    const g = darkAura.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(8, 0, 2, 0.82)');
    grad.addColorStop(0.55, 'rgba(8, 0, 2, 0.55)');
    grad.addColorStop(1, 'rgba(8, 0, 2, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return darkAura;
}

/** Ponto e normal no contorno de um retângulo (s 0..1 no perímetro), sem o lado de baixo. */
function perimeterPoint(s, w, h, out) {
    // Ordem: lateral esquerda (de baixo pra cima), topo (esquerda -> direita), lateral direita (de cima pra baixo)
    const total = h * 2 + w;
    let d = s * total;
    if (d < h) {
        out[0] = 0; out[1] = h - d; out[2] = -1; out[3] = 0;
        return out;
    }
    d -= h;
    if (d < w) {
        out[0] = d; out[1] = 0; out[2] = 0; out[3] = -1;
        return out;
    }
    d -= w;
    out[0] = w; out[1] = d; out[2] = 1; out[3] = 0;
    return out;
}

function makeItem(box) {
    const canvas = document.createElement('canvas');
    canvas.className = 'hp-death-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    box.appendChild(canvas);
    return {
        box, canvas, ctx: canvas.getContext('2d'),
        on: false, intensity: 0, target: 0, boost: 0, offAt: 0,
        k: 1, cw: 0, ch: 0, bw: 0, bh: 0,
        emberS: new Float32Array(EMBERS), emberY: new Float32Array(EMBERS), emberV: new Float32Array(EMBERS),
        emberP: new Float32Array(EMBERS), seed: Math.random() * 100
    };
}

export class RonovaHpFx {
    /** @param {HTMLElement[]} boxes [caixa de vida própria, caixa do oponente] */
    constructor(boxes) {
        this.items = boxes.map(makeItem);
        this.loopId = 0;
        this.last = 0;
        this.time = 0;
        this.pt = new Float32Array(4);
        this._frame = (now) => this.frame(now);
        window.addEventListener('resize', () => {
            for (const item of this.items) if (item.on) this.measure(item);
        });
    }

    /**
     * Acende/apaga o fogo de uma caixa. `intensity` 0..1 (plantada arde um pouco menos que a marca ativa).
     * @param {number} index 0 = própria, 1 = oponente
     */
    set(index, on, intensity = 1) {
        const item = this.items[index];
        item.target = on ? intensity : 0;
        if (on && !item.on) {
            item.on = true;
            item.canvas.classList.add('on');
            this.measure(item);
            this.seedEmbers(item);
        } else if (!on && item.on) {
            item.on = false;
            item.canvas.classList.remove('on');
            item.offAt = performance.now();
        }
        this.start();
    }

    /** Estouro curto (o fogo acabou de acender ou o olho acabou de marcar): as chamas sobem e brilham mais. */
    flare(index) {
        this.items[index].boost = 1;
        this.start();
    }

    measure(item) {
        const rect = item.canvas.getBoundingClientRect();
        const cssW = item.canvas.offsetWidth;
        const cssH = item.canvas.offsetHeight;
        if (cssW === 0 || cssH === 0) return;
        const dpr = Math.min(window.devicePixelRatio || 1, GRAPHICS.maxDpr);
        // k = px de device por px de layout (inclui o zoom da HUD, --ui-scale)
        item.k = (rect.width / cssW) * dpr;
        item.canvas.width = Math.max(1, Math.round(cssW * item.k));
        item.canvas.height = Math.max(1, Math.round(cssH * item.k));
        item.cw = cssW;
        item.ch = cssH;
        item.bw = cssW - PAD * 2;
        item.bh = cssH - PAD * 2;
    }

    seedEmbers(item) {
        for (let i = 0; i < EMBERS; i++) {
            item.emberS[i] = Math.random();
            item.emberY[i] = Math.random();
            item.emberV[i] = 0.35 + Math.random() * 0.5;
            item.emberP[i] = Math.random() * TAU;
        }
    }

    start() {
        if (this.loopId) return;
        this.last = performance.now();
        this.loopId = requestAnimationFrame(this._frame);
    }

    frame(now) {
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        let alive = false;
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            // Intensidade e estouro suavizados (sem saltos quando a marca muda de plantada pra ativa)
            item.intensity += (item.target - item.intensity) * Math.min(1, dt * 4);
            item.boost = Math.max(0, item.boost - dt * 1.4);
            const fading = !item.on && now - item.offAt < FADE_OUT_MS;
            if (item.on || fading) {
                alive = true;
                this.draw(item, dt);
            } else if (item.canvas.width > 1) {
                item.canvas.width = 1;
                item.canvas.height = 1;
            }
        }
        this.loopId = alive ? requestAnimationFrame(this._frame) : 0;
    }

    draw(item, dt) {
        const ctx = item.ctx;
        const t = this.time + item.seed;
        const high = GRAPHICS.isHigh;
        const lighter = GRAPHICS.compositeLighter;
        const power = Math.max(0.25, item.intensity) * (1 + item.boost * 0.6);
        const bw = item.bw;
        const bh = item.bh;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);
        ctx.setTransform(item.k, 0, 0, item.k, 0, 0);

        // Fumaça escura em volta (um pouco mais alta, onde a coroa de fogo sobe)
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, 0.9 * Math.max(0.4, item.intensity));
        ctx.drawImage(getDarkAura(), PAD - 64, PAD - 92, bw + 128, bh + 140);
        ctx.globalCompositeOperation = lighter;

        // Halo carmesim respirando em volta da caixa
        const pulse = 0.7 + 0.3 * Math.sin(t * 2.1);
        ctx.globalAlpha = Math.min(1, 0.55 * pulse * power);
        ctx.drawImage(getGlowSprite(255, 20, 45), PAD - 34, PAD - 40, bw + 68, bh + 62);

        // Labaredas: camada de trás (altas, escuras) e da frente (baixas, brilhantes), saindo do contorno e
        // subindo — no topo sobem retas, nas laterais abrem pra fora e curvam pra cima
        const pt = this.pt;
        const back = high ? FLAMES_BACK : 6;
        const front = high ? FLAMES_FRONT : 8;
        for (let layer = 0; layer < 2; layer++) {
            const count = layer === 0 ? back : front;
            for (let i = 0; i < count; i++) {
                const s = (i + 0.5 + (layer === 0 ? 0.25 : 0)) / count;
                perimeterPoint(s, bw, bh, pt);
                const j = Math.sin((i + layer * 31) * 12.9898) * 43758.5453;
                const rnd = j - Math.floor(j);
                const flick = 0.7 + 0.22 * Math.sin(t * (4.4 + rnd * 3) + i * 1.9 + layer) + 0.08 * Math.sin(t * 12.5 + i * 2.7);
                // Topo: sobe reto e nasce bem por trás da borda. Laterais: a base fica logo dentro da borda e a
                // língua sai inclinada pra fora e pra cima (senão ficaria escavada junto com o interior)
                const onSide = pt[3] === 0;
                const inset = onSide ? 8 : FLAME_INSET;
                const dx = onSide ? pt[2] * 0.8 : 0;
                const dy = onSide ? -0.95 : -1;
                const ang = Math.atan2(dx, -dy) + Math.sin(t * 1.8 + i * 1.3) * 0.12;
                // Coroa alta no topo (mais alta no meio), labaredas menores subindo pelas laterais
                const onTop = pt[3] < 0;
                const crown = onTop ? 0.75 + 0.25 * Math.sin((pt[0] / bw) * Math.PI) : 0.8;
                // Línguas altas e finas: a ponta da chama é translúcida, então baixa e larga viraria só um "bulbo"
                const baseH = onTop ? (layer === 0 ? 92 : 62) : (layer === 0 ? 60 : 40);
                const fh = (baseH + rnd * 16) * crown * flick * (0.65 + 0.35 * power);
                const fw = (layer === 0 ? 25 : 16) + rnd * 5;
                // Translação + rotação numa matriz só (sem save/restore por chama)
                const k = item.k;
                const c = Math.cos(ang);
                const sn = Math.sin(ang);
                ctx.setTransform(k * c, k * sn, -k * sn, k * c,
                    k * (PAD + pt[0] - pt[2] * inset), k * (PAD + pt[1] - pt[3] * inset));
                ctx.globalAlpha = Math.min(1, (layer === 0 ? 0.8 : 1) * (0.7 + 0.3 * flick) * power);
                drawFlame(ctx, 0, 0, fw, fh, i + layer);
            }
        }
        ctx.setTransform(item.k, 0, 0, item.k, 0, 0);

        // Escava o interior da caixa: as bases das chamas somem e o fogo parece nascer por trás da vida (e o
        // número continua legível). Um preenchimento por frame.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = CARVE_ALPHA;
        ctx.beginPath();
        ctx.roundRect(PAD, PAD, bw, bh, BOX_RADIUS);
        ctx.fill();
        ctx.globalCompositeOperation = lighter;

        // Duas espirais de brasa orbitando a caixa (como os redemoinhos das órbitas da carta)
        const cx = item.cw / 2;
        const cy = item.ch / 2;
        const rx = bw / 2 + 19;
        const ry = bh / 2 + 15;
        ctx.lineCap = 'round';
        // As duas espirais ficam em lados opostos (1.9 rad cada, meia volta de distância) e nunca se tocam:
        // um stroke só com as duas é idêntico a dois, com metade do trabalho de traçado
        for (let pass = 0; pass < (high ? 2 : 1); pass++) {
            ctx.lineWidth = pass === 0 && high ? 5 : 1.4;
            ctx.strokeStyle = pass === 0 && high ? 'rgba(255, 30, 55, 0.35)' : 'rgb(255, 120, 132)';
            ctx.globalAlpha = Math.min(1, 0.8 * power);
            ctx.beginPath();
            for (let k = 0; k < 2; k++) {
                const a0 = t * 1.25 + k * Math.PI;
                ctx.moveTo(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry);
                ctx.ellipse(cx, cy, rx, ry, 0, a0, a0 + 1.9);
            }
            ctx.stroke();
        }

        // Brasas subindo do contorno, serpenteando
        if (high) {
            ctx.fillStyle = '#ff8a5c';
            for (let i = 0; i < EMBERS; i++) {
                item.emberY[i] += item.emberV[i] * dt;
                if (item.emberY[i] > 1) {
                    item.emberY[i] = 0;
                    item.emberS[i] = Math.random();
                }
                perimeterPoint(item.emberS[i], bw, bh, pt);
                const life = item.emberY[i];
                const x = PAD + pt[0] + pt[2] * life * 10 + Math.sin(t * 3 + item.emberP[i]) * 4;
                const y = PAD + pt[1] - life * 54;
                const size = 1.2 + (i % 3) * 0.6;
                ctx.globalAlpha = Math.min(1, (1 - life) * 0.95 * power);
                ctx.fillRect(x - size / 2, y - size / 2, size, size);
            }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }
}
