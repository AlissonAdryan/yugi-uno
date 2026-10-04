import { CONFIG } from '../config/constants.js';
import {
    AMBUSH_EYE, CURSE_EYES, MIRROR_OVAL, MIRROR_VEINS, RUNES, getSkullSprite, paintGhostFrame, traceGhostCard,
    traceRune, traceVein
} from './card-art-arcane.js';
import { GRAPHICS } from '../config/graphics.js';

/**
 * Camadas animadas das cartas arcanas (ligadas em card-effects.js como `extra` dos presets):
 *   ETHEREAL    Fantasma (normal)  — neblina à deriva, silhueta e aura pulsando, moldura que treme
 *   AMBUSH_EYE  Emboscada (normal) — o olho semiaberto que olha em volta e pisca a cada 3s
 *   FOIL_MIRROR Espelho (laminado) — reflexo girando dentro do espelho, veias pulsando na cor, runas
 *               cintilando como estrelas (acendem todas em roxo quando a carta está na mão do jogador)
 *   FOIL_CURSE  Maldição (laminado) — tempestade roxa contida: névoa, mini-relâmpagos, crânios girando,
 *               fogo nos olhos da caveira, inscrições pulsando e correntes balançando
 *
 * Desempenho: todo gradiente vive em sprites pintados uma única vez (cache do módulo); por frame só
 * drawImage, caminhos curtos e cores pré-montadas. Assinatura de cada camada:
 * (ctx, w, h, time, phase, seed, scratch, color, held).
 */

const TAU = Math.PI * 2;
const SPRITE_SCALE = 4;
const sprites = new Map();

/** Sprite pintado uma vez (w x h em unidades de carta, resolução SPRITE_SCALE). */
function sprite(key, w, h, painter) {
    let canvas = sprites.get(key);
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * SPRITE_SCALE);
    canvas.height = Math.ceil(h * SPRITE_SCALE);
    const g = canvas.getContext('2d');
    g.setTransform(SPRITE_SCALE, 0, 0, SPRITE_SCALE, 0, 0);
    painter(g, w, h);
    sprites.set(key, canvas);
    return canvas;
}

function softBlob(r, g, b, a) {
    return (ctx, w, h) => {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${a * 0.35})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    };
}

// Cores por cor de carta, montadas uma vez (índices de CONFIG.COLOR)
const COLOR_GLOW = CONFIG.COLOR_HEX.map((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { wide: `rgba(${r},${g},${b},0.55)`, core: `rgb(${Math.min(255, r + 90)},${Math.min(255, g + 90)},${Math.min(255, b + 90)})`, r, g, b };
});

// --- Fantasma (ETHEREAL) -------------------------------------------------------------

const GHOST_FRAME_PERIOD = 2;    // s entre tremidas da moldura
const GHOST_FRAME_SHAKE = 0.07;  // fração do ciclo tremendo (~140ms)

export function drawEthereal(ctx, w, h, time, phase, seed, scratch, color) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + phase * TAU);
    const mist = sprite('mist', 64, 64, softBlob(200, 185, 255, 0.55));
    const glow = sprite('ghostGlow', 70, 92, (g) => {
        g.shadowColor = 'rgba(235, 225, 255, 1)';
        g.shadowBlur = 10;
        traceGhostCard(g, 35, 48, 1.18);
        g.fillStyle = 'rgba(235, 228, 255, 0.3)';
        g.fill();
    });
    const c = COLOR_GLOW[color] || COLOR_GLOW[0];
    const aura = sprite(`ghostAura${color}`, 90, 90, softBlob(c.r, c.g, c.b, 0.9));

    ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
    // Neblina à deriva, em três camadas de velocidades diferentes
    for (let k = 0; k < 3; k++) {
        const x = w * (0.5 + 0.48 * Math.sin(time * (0.28 + k * 0.09) + k * 2.1 + phase * 5));
        const y = h * (0.22 + k * 0.28) + Math.sin(time * 0.8 + k) * 4;
        const size = 62 + k * 12;
        ctx.globalAlpha = 0.2;
        ctx.drawImage(mist, x - size / 2, y - size / 4, size, size / 2);
    }
    // Aura na cor e a silhueta "fora de fase" respirando (bem mais opaca: é o principal identificador da cor)
    ctx.globalAlpha = 0.42 + 0.4 * pulse;
    ctx.drawImage(aura, w / 2 - 45, h * 0.5 - 45, 90, 90);
    const s = 1 + 0.05 * pulse;
    ctx.globalAlpha = 0.08 + 0.24 * pulse;
    ctx.drawImage(glow, w / 2 - 35 * s, h * 0.5 - 48 * s, 70 * s, 92 * s);

    // Moldura prateada com micro-tremida de 0,5px a cada 2s
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    let u = time / GHOST_FRAME_PERIOD + phase;
    u -= Math.floor(u);
    let jx = 0;
    let jy = 0;
    if (u < GHOST_FRAME_SHAKE) {
        jx = Math.sin(time * 95) * 0.5;
        jy = Math.cos(time * 71) * 0.5;
    }
    ctx.drawImage(sprite('ghostFrame', w, h, (g) => paintGhostFrame(g)), jx, jy, w, h);
}

// --- Emboscada (AMBUSH_EYE) ----------------------------------------------------------

const EYE_OPEN = 0.62;      // semiaberto
const EYE_PERIOD = 3;       // pisca a cada 3s
const EYE_BLINK = 0.08;     // fração do ciclo piscando

function almond(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - h * 2, x + w, y);
    ctx.quadraticCurveTo(x, y + h * 2, x - w, y);
    ctx.closePath();
}

// Olho da Emboscada sem clip(): a esclera e a íris (já com a pupila em fenda e o brilho, que andam juntos) entram
// como padrão (CanvasPattern) preenchendo a amêndoa. Um clip() de caminho curvo custava uma máscara por frame;
// preencher um caminho convexo com padrão é barato e recorta exatamente igual.
const EYE_IRIS_R = 6;
const eyePatternMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
let scleraPattern = null;
let irisPattern = null;

function getScleraSprite() {
    return sprite('sclera', 32, 16, (g, sw, sh) => {
        const grad = g.createRadialGradient(sw / 2, sh / 2, 1, sw / 2, sh / 2, sw / 2);
        grad.addColorStop(0, 'rgba(215, 255, 200, 0.95)');
        grad.addColorStop(1, 'rgba(50, 110, 40, 0.95)');
        g.fillStyle = grad;
        g.fillRect(0, 0, sw, sh);
    });
}

/** Íris + pupila em fenda + brilho, centrados (os três se movem juntos com o olhar). */
function getIrisSprite() {
    return sprite('irisFull', EYE_IRIS_R * 2, EYE_IRIS_R * 2, (g) => {
        const c = EYE_IRIS_R;
        const grad = g.createRadialGradient(c, c, 0.5, c, c, c);
        grad.addColorStop(0, '#e2ffc4');
        grad.addColorStop(0.35, '#39ff14');
        grad.addColorStop(0.85, '#0c5205');
        grad.addColorStop(1, 'rgba(12, 82, 5, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(c, c, c, 0, TAU);
        g.fill();
        g.fillStyle = '#020a02';
        g.beginPath();
        g.ellipse(c, c, 1.1, 3.8, 0, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255, 255, 255, 0.85)';
        g.beginPath();
        g.arc(c + 1.8, c - 1.6, 0.9, 0, TAU);
        g.fill();
    });
}

export function drawAmbushEye(ctx, w, h, time, phase) {
    const e = AMBUSH_EYE;
    let u = time / EYE_PERIOD + phase;
    u -= Math.floor(u);
    let open = EYE_OPEN;
    if (u < EYE_BLINK) open *= 1 - Math.sin((u / EYE_BLINK) * Math.PI);
    const eh = e.h * open;

    ctx.lineCap = 'round';
    if (eh > 0.4) {
        if (!scleraPattern) {
            scleraPattern = ctx.createPattern(getScleraSprite(), 'no-repeat');
            irisPattern = ctx.createPattern(getIrisSprite(), 'no-repeat');
        }
        // Esclera: o sprite esticado em (x-w, y-h, 2w, 2h), recortado pela amêndoa
        const sclera = getScleraSprite();
        eyePatternMatrix.a = (e.w * 2) / sclera.width;
        eyePatternMatrix.d = (e.h * 2) / sclera.height;
        eyePatternMatrix.e = e.x - e.w;
        eyePatternMatrix.f = e.y - e.h;
        scleraPattern.setTransform(eyePatternMatrix);
        almond(ctx, e.x, e.y, e.w, eh);
        ctx.fillStyle = scleraPattern;
        ctx.fill();
        // A íris vigia em volta devagar (mesmo caminho da amêndoa, sem refazer)
        const gx = e.x + Math.sin(time * 0.7 + phase * 4) * 4.5;
        const gy = e.y + Math.sin(time * 0.43 + phase * 2) * 1.2;
        eyePatternMatrix.a = 1 / SPRITE_SCALE;
        eyePatternMatrix.d = 1 / SPRITE_SCALE;
        eyePatternMatrix.e = gx - EYE_IRIS_R;
        eyePatternMatrix.f = gy - EYE_IRIS_R;
        irisPattern.setTransform(eyePatternMatrix);
        ctx.fillStyle = irisPattern;
        ctx.fill();
    }
    // Pálpebras: halo aditivo + linha verde
    almond(ctx, e.x, e.y, e.w, Math.max(0.3, eh));
    ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.45)';
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 1.2;
    ctx.stroke();
}

// --- Espelho Sombrio (FOIL_MIRROR) ---------------------------------------------------

function paintSwirl(g, w, h) {
    // Redemoinho de reflexos escuros: raios alternando prata e roxo em volta do centro
    const cx = w / 2;
    const cy = h / 2;
    const rays = 14;
    for (let i = 0; i < rays; i++) {
        const a0 = (i / rays) * TAU;
        const a1 = a0 + TAU / rays * 0.55;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
        const tint = i % 2 === 0 ? '205, 195, 255' : '140, 70, 255';
        grad.addColorStop(0, `rgba(${tint}, 0)`);
        grad.addColorStop(0.5, `rgba(${tint}, ${i % 2 === 0 ? 0.28 : 0.2})`);
        grad.addColorStop(1, `rgba(${tint}, 0)`);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, w / 2, a0, a1);
        g.closePath();
        g.fill();
    }
}

export function drawMirrorFx(ctx, w, h, time, phase, seed, scratch, color, held) {
    const o = MIRROR_OVAL;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.1 + phase * TAU);
    ctx.globalCompositeOperation = GRAPHICS.compositeLighter;

    // Reflexo girando dentro do espelho (parece refletir o ambiente ao "inclinar")
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, TAU);
    ctx.clip();
    const size = o.ry * 2.8;
    ctx.translate(o.x, o.y);
    ctx.rotate(time * 0.35 + phase * TAU);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(sprite('swirl', 64, 64, paintSwirl), -size / 2, -size / 2, size, size);
    ctx.restore();

    // Veias de luz pulsando na cor da carta (bem mais opacas: é o principal identificador da cor)
    const c = COLOR_GLOW[color] || COLOR_GLOW[0];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let v = 0; v < MIRROR_VEINS.length; v++) {
        const local = 0.5 + 0.5 * Math.sin(time * 2.6 + v * 0.9 + phase * 7);
        traceVein(ctx, MIRROR_VEINS[v]);
        ctx.globalAlpha = 0.35 + 0.55 * local * pulse;
        ctx.strokeStyle = c.wide;
        ctx.lineWidth = 4.2;
        ctx.stroke();
        ctx.globalAlpha = 0.6 + 0.4 * local;
        ctx.strokeStyle = c.core;
        ctx.lineWidth = 1.1;
        ctx.stroke();
    }

    // Runas: na mão do jogador acendem todas em roxo; senão cintilam uma a uma como estrelas
    ctx.lineWidth = held ? 1.1 : 0.9;
    ctx.strokeStyle = held ? '#c9a2ff' : '#b39dff';
    for (let i = 0; i < RUNES.length; i++) {
        let a;
        if (held) {
            a = 0.65 + 0.35 * Math.sin(time * 6 + i * 0.7);
        } else {
            a = Math.sin(time * 1.6 + i * 1.37 + phase * 9);
            a = a > 0 ? a * a * a * a * 0.85 : 0;
        }
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        traceRune(ctx, RUNES[i]);
        ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
}

// --- Maldição (FOIL_CURSE) -----------------------------------------------------------

const CURSE_ARC_PERIOD = 2.3;
const CURSE_ARC_VISIBLE = 0.1;
const CURSE_ARC_POINTS = 7;
const SKULL_SPOTS = Object.freeze([[17, 27, 15], [83, 38, 13], [20, 122, 14], [80, 118, 16]]);

function paintFlame(g, w, h) {
    const grad = g.createRadialGradient(w / 2, h * 0.72, 0.5, w / 2, h * 0.6, h * 0.62);
    grad.addColorStop(0, 'rgba(255, 240, 255, 1)');
    grad.addColorStop(0.3, 'rgba(210, 120, 255, 0.95)');
    grad.addColorStop(0.7, 'rgba(140, 30, 230, 0.5)');
    grad.addColorStop(1, 'rgba(120, 20, 220, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.bezierCurveTo(w * 0.95, h * 0.45, w * 0.9, h, w / 2, h);
    g.bezierCurveTo(w * 0.1, h, w * 0.05, h * 0.45, w / 2, 0);
    g.fill();
}

// Runas da Maldição: as formas são fixas (só o brilho pulsa). Cada uma é traçada UMA vez num atlas, alinhada ao
// pixel exatamente como seria traçada na carta (o laminado é pintado a 1 px por unidade, com origem inteira), e
// por frame vira um drawImage 1:1 com o mesmo alfa: pixel a pixel igual ao traço, e as 24 saem num lote só
// (antes eram 24 strokes por carta, por frame).
const RUNE_PAD = 2;
const RUNE_COLOR = '#c77dff';
const RUNE_WIDTH = 0.9;
let runeAtlas = null;
const runeSX = new Int32Array(RUNES.length);
const runeBX = new Int32Array(RUNES.length);
const runeBY = new Int32Array(RUNES.length);
const runeBW = new Int32Array(RUNES.length);
const runeBH = new Int32Array(RUNES.length);

function getRuneAtlas() {
    if (runeAtlas) return runeAtlas;
    let x = 0;
    let hMax = 0;
    for (let i = 0; i < RUNES.length; i++) {
        const r = RUNES[i];
        const s = r.strokes;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < s.length; k += 2) {
            minX = Math.min(minX, r.x + s[k]);
            maxX = Math.max(maxX, r.x + s[k]);
            minY = Math.min(minY, r.y + s[k + 1]);
            maxY = Math.max(maxY, r.y + s[k + 1]);
        }
        runeBX[i] = Math.floor(minX) - RUNE_PAD;
        runeBY[i] = Math.floor(minY) - RUNE_PAD;
        runeBW[i] = Math.ceil(maxX) + RUNE_PAD - runeBX[i];
        runeBH[i] = Math.ceil(maxY) + RUNE_PAD - runeBY[i];
        runeSX[i] = x;
        x += runeBW[i] + RUNE_PAD;
        hMax = Math.max(hMax, runeBH[i]);
    }
    runeAtlas = document.createElement('canvas');
    runeAtlas.width = x;
    runeAtlas.height = hMax;
    const g = runeAtlas.getContext('2d');
    g.strokeStyle = RUNE_COLOR;
    g.lineWidth = RUNE_WIDTH;
    for (let i = 0; i < RUNES.length; i++) {
        // Mesmo deslocamento inteiro que a runa tem na carta: a rasterização sai idêntica
        g.setTransform(1, 0, 0, 1, runeSX[i] - runeBX[i], -runeBY[i]);
        traceRune(g, RUNES[i]);
        g.stroke();
    }
    return runeAtlas;
}

// Elos da corrente: dois formatos (elo largo e fino) traçados uma vez em alta resolução; por frame cada elo é um
// drawImage girado do mesmo sprite (antes: 10 strokes de elipse por carta, por frame)
const CHAIN_RY = 2.6;
const CHAIN_RX = Object.freeze([1.7, 0.5]);
const CHAIN_COLOR = 'rgba(200, 180, 225, 0.55)';
const CHAIN_WIDTH = 0.9;
const CHAIN_BOX_W = 2 * (1.7 + CHAIN_WIDTH);
const CHAIN_BOX_H = 2 * (CHAIN_RY + CHAIN_WIDTH);

function getChainSprite(thin) {
    return sprite(thin ? 'chainThin' : 'chainWide', CHAIN_BOX_W, CHAIN_BOX_H, (g, sw, sh) => {
        g.strokeStyle = CHAIN_COLOR;
        g.lineWidth = CHAIN_WIDTH;
        g.beginPath();
        g.ellipse(sw / 2, sh / 2, CHAIN_RX[thin ? 1 : 0], CHAIN_RY, 0, 0, TAU);
        g.stroke();
    });
}

export function drawCurseFx(ctx, w, h, time, phase, seed, pts) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.5 + phase * TAU);
    const mist = sprite('curseMist', 64, 64, softBlob(150, 40, 230, 0.6));
    ctx.globalCompositeOperation = GRAPHICS.compositeLighter;

    // Névoa roxa rodando devagar (tempestade contida)
    for (let k = 0; k < 3; k++) {
        const a = time * (0.22 + k * 0.07) + k * 2.2 + phase * 6;
        const x = w * 0.5 + Math.cos(a) * w * 0.3;
        const y = h * 0.48 + Math.sin(a * 1.3) * h * 0.28;
        const size = 70 + k * 10;
        ctx.globalAlpha = 0.28;
        ctx.drawImage(mist, x - size / 2, y - size / 2, size, size);
    }

    // Crânios do fundo girando de leve
    const skull = getSkullSprite();
    for (let i = 0; i < SKULL_SPOTS.length; i++) {
        const [x, y, s] = SKULL_SPOTS[i];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(time * 0.6 + i * 1.7 + phase * 3) * 0.2);
        ctx.globalAlpha = 0.12 + 0.06 * Math.sin(time + i);
        ctx.drawImage(skull, -s / 2, -s / 2, s, s);
        ctx.restore();
    }

    // Mini-relâmpago roxo piscando dentro da névoa de vez em quando
    let u = time / CURSE_ARC_PERIOD + phase;
    const cycle = Math.floor(u);
    u -= cycle;
    if (u < CURSE_ARC_VISIBLE) {
        let s = (Math.imul(cycle + 3, 2654435761) ^ Math.imul(seed + 17, 40503) ^ Math.imul(Math.floor(time * 24), 83492791)) >>> 0;
        let e = (Math.imul(cycle + 9, 73856093) ^ Math.imul(seed + 5, 19349663)) >>> 0;
        e = (Math.imul(e, 1664525) + 1013904223) >>> 0;
        const top = (e & 1) === 0;
        e = (Math.imul(e, 1664525) + 1013904223) >>> 0;
        const x0 = 15 + (e / 4294967296) * 70;
        const y0 = top ? 16 : h - 16;
        e = (Math.imul(e, 1664525) + 1013904223) >>> 0;
        const x1 = 15 + (e / 4294967296) * 70;
        const y1 = top ? 48 : h - 48;
        for (let i = 0; i < CURSE_ARC_POINTS; i++) {
            const t = i / (CURSE_ARC_POINTS - 1);
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            const off = i === 0 || i === CURSE_ARC_POINTS - 1 ? 0 : ((s / 4294967296) - 0.5) * 10;
            pts[i * 2] = x0 + (x1 - x0) * t + off;
            pts[i * 2 + 1] = y0 + (y1 - y0) * t;
        }
        const life = 1 - u / CURSE_ARC_VISIBLE;
        ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 1; i < CURSE_ARC_POINTS; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
            ctx.globalAlpha = life * (pass === 0 ? 0.6 : 1);
            ctx.strokeStyle = pass === 0 ? 'rgba(170, 70, 255, 0.6)' : '#f0dcff';
            ctx.lineWidth = pass === 0 ? 3.5 : 0.9;
            ctx.stroke();
        }
    }

    // Fogo roxo nos olhos da caveira
    const flame = sprite('flame', 10, 16, paintFlame);
    for (let k = 0; k < CURSE_EYES.length; k++) {
        const flick = Math.sin(time * 13 + k * 2.3) * 0.5 + Math.sin(time * 7.3 + k) * 0.5;
        const fh = 9 + flick * 2.2;
        const fw = 5.4 + flick * 0.8;
        const [x, y] = CURSE_EYES[k];
        ctx.globalAlpha = 0.85 + 0.15 * flick;
        ctx.drawImage(flame, x - fw / 2, y + 2.2 - fh, fw, fh);
    }

    // Inscrições arcanas pulsando (atlas das runas: drawImage 1:1, ver getRuneAtlas)
    const runes = getRuneAtlas();
    for (let i = 0; i < RUNES.length; i++) {
        ctx.globalAlpha = (0.15 + 0.55 * pulse) * (0.6 + 0.4 * Math.sin(time * 2 + i * 0.8));
        ctx.drawImage(runes, runeSX[i], 0, runeBW[i], runeBH[i], runeBX[i], runeBY[i], runeBW[i], runeBH[i]);
    }

    // Correntes pendendo dos cantos de cima, balançando (cada elo = o sprite girado em volta do próprio centro)
    const wide = getChainSprite(false);
    const thin = getChainSprite(true);
    for (let side = 0; side < 2; side++) {
        const ax = side === 0 ? 14 : w - 14;
        const swing = Math.sin(time * 1.8 + side * 1.4 + phase * 4) * 0.16;
        const dx = Math.sin(swing);
        const dy = Math.cos(swing);
        for (let k = 0; k < 5; k++) {
            ctx.globalAlpha = 0.55 - k * 0.07;
            ctx.save();
            ctx.translate(ax + dx * k * 4.2, 13 + dy * k * 4.2);
            ctx.rotate(-swing);
            ctx.drawImage(k % 2 === 0 ? wide : thin, -CHAIN_BOX_W / 2, -CHAIN_BOX_H / 2, CHAIN_BOX_W, CHAIN_BOX_H);
            ctx.restore();
        }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
}

/** Presets (formato de card-effects.js). */
export const ARCANE_PRESETS = Object.freeze({
    ETHEREAL: {
        angle: 0,
        bands: [],
        sparkles: { count: 5, color: '#cbb8ff', minSize: 1.2, maxSize: 2.4, minRate: 1.2, maxRate: 2.4 },
        extra: drawEthereal
    },
    AMBUSH_EYE: {
        angle: 0.4,
        bands: [
            {
                stops: [[0, 'rgba(57,255,20,0)'], [0.5, 'rgba(57,255,20,0.1)'], [1, 'rgba(57,255,20,0)']],
                width: 0.5, period: 5.5, sweep: 0.5, alpha: 1, composite: GRAPHICS.compositeLighter
            }
        ],
        sparkles: { count: 4, color: '#6dff4a', minSize: 1, maxSize: 2, minRate: 1.5, maxRate: 3 },
        extra: drawAmbushEye
    },
    FOIL_MIRROR: {
        angle: -0.7,
        bands: [
            {
                stops: [
                    [0, 'rgba(120,100,200,0)'], [0.3, 'rgba(150,120,255,0.16)'], [0.5, 'rgba(225,215,255,0.34)'],
                    [0.7, 'rgba(90,60,160,0.16)'], [1, 'rgba(120,100,200,0)']
                ],
                width: 0.65, period: 3.4, sweep: 0.6, alpha: 1, composite: GRAPHICS.compositeLighter
            },
            {
                stops: [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(240,232,255,0.8)'], [1, 'rgba(255,255,255,0)']],
                width: 0.1, period: 2.2, sweep: 0.35, alpha: 0.9, composite: GRAPHICS.compositeLighter, offset: 0.5
            }
        ],
        sparkles: { count: 10, color: '#b9a3ff', core: '#ffffff', minSize: 1.4, maxSize: 3.2, minRate: 2.2, maxRate: 4.5 },
        extra: drawMirrorFx
    },
    FOIL_CURSE: {
        angle: 0.5,
        bands: [
            {
                stops: [
                    [0, 'rgba(90,0,160,0)'], [0.35, 'rgba(140,30,230,0.22)'], [0.5, 'rgba(190,110,255,0.3)'],
                    [0.65, 'rgba(140,30,230,0.22)'], [1, 'rgba(90,0,160,0)']
                ],
                width: 0.95, period: 6.5, sweep: 0.9, alpha: 1, composite: GRAPHICS.compositeLighter
            },
            {
                stops: [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(230,200,255,0.7)'], [1, 'rgba(255,255,255,0)']],
                width: 0.12, period: 3.1, sweep: 0.4, alpha: 0.85, composite: GRAPHICS.compositeLighter, offset: 0.3
            }
        ],
        sparkles: { count: 7, color: '#c77dff', core: '#f3e6ff', minSize: 1.4, maxSize: 3, minRate: 1.8, maxRate: 3.6 },
        extra: drawCurseFx
    }
});
