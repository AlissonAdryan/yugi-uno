import { CONFIG } from '../config/constants.js';
import { GRAPHICS } from '../config/graphics.js';

/**
 * Ronova, a Sombra da Morte (GAME_RULES §6.19) — arte procedural compartilhada pela carta, pelo laminado
 * próprio (FOIL_DEATH), pelas chamas carmesim das cartas marcadas, pela carta sendo consumida e pelo olho
 * gigante que cobre a tela (death-overlay.js).
 *
 * Inspirada na Sombra da Morte (Ronova, Genshin Impact: "Senhora do Submundo", olhos com pupila em flor e
 * asas carmesim com aberturas em forma de olho): fundo de chamas da morte em espirais carmesim, um olho
 * central de esclera rosada com íris carmesim e um selo de estrela de 8 pontas, e duas órbitas negras com
 * pupilas vermelhas. O olho principal olha devagar para os lados e pisca devagar de vez em quando; as órbitas
 * mudam de direção com mais frequência.
 *
 * Desempenho (Pilar 1/2): todo gradiente vive em sprites pintados UMA vez (cache do módulo). Por frame só há
 * drawImage, caminhos curtos e o estado do olhar vem de funções puras do tempo (sem Math.random, sem alocar).
 */

const W = CONFIG.CARD_DIMENSIONS.WIDTH;
const H = CONFIG.CARD_DIMENSIONS.HEIGHT;
const R = CONFIG.CARD_DIMENSIONS.RADIUS;
const TAU = Math.PI * 2;

/** Olho central e as duas órbitas, em unidades de carta (100 x 150). */
export const DEATH_EYE = Object.freeze({ x: W / 2, y: 74, ew: 36, eh: 15 });
export const DEATH_ORBS = Object.freeze([
    Object.freeze({ x: 24, y: 31, r: 10.5 }),
    Object.freeze({ x: 76, y: 118, r: 10.5 })
]);
export const DEATH_HEX = '#ff2a3d';
export const DEATH_LIGHT = '#ff8a94';
export const DEATH_DARK = '#5a0010';

// --- Sprites (pintados uma vez) ---------------------------------------------------------

const sprites = new Map();

/** Sprite w x h (unidades) em `scale` px por unidade, pintado por `painter(g, w, h)` uma única vez. */
function sprite(key, w, h, scale, painter) {
    let canvas = sprites.get(key);
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const g = canvas.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    painter(g, w, h);
    sprites.set(key, canvas);
    return canvas;
}

/**
 * Língua de fogo: base larga e arredondada, pescoço fino e ponta curvada pro lado (`lean` -1..1). `inset`
 * encolhe o contorno pro núcleo.
 */
function tongue(g, w, h, inset, lean) {
    const cx = w / 2;
    const k = 1 - inset;
    const tipX = cx + lean * w * 0.28 * k;
    const top = h * (0.02 + inset * 0.9);
    g.beginPath();
    g.moveTo(tipX, top);
    g.bezierCurveTo(tipX - lean * w * 0.12 + w * 0.06 * k, h * 0.26, cx + w * 0.46 * k, h * 0.5, cx + w * 0.4 * k, h * 0.8);
    g.bezierCurveTo(cx + w * 0.3 * k, h * 0.99, cx - w * 0.3 * k, h * 0.99, cx - w * 0.4 * k, h * 0.8);
    g.bezierCurveTo(cx - w * 0.46 * k, h * 0.52, tipX - lean * w * 0.2 - w * 0.08 * k, h * 0.3, tipX, top);
    g.closePath();
}

const FLAME_LEANS = [0, -0.7, 0.75];

// Referências diretas (o caminho quente não monta string de chave nem consulta o Map)
const flameSprites = [null, null, null];

/**
 * Língua de fogo carmesim (base embaixo, ponta em cima). Três formatos (reta, curvada pra esquerda/direita)
 * pra o fogo não parecer uma fileira de gotas iguais: halo translúcido, corpo vermelho escurecendo pra ponta
 * e núcleo rosado quase branco.
 */
export function getFlameSprite(variant = 0) {
    const v = (((variant | 0) % FLAME_LEANS.length) + FLAME_LEANS.length) % FLAME_LEANS.length;
    const cached = flameSprites[v];
    if (cached) return cached;
    const lean = FLAME_LEANS[v];
    flameSprites[v] = sprite(`flame${v}`, 32, 64, 4, (g, w, h) => {
        tongue(g, w, h, -0.12, lean);
        g.fillStyle = 'rgba(200, 0, 30, 0.14)';
        g.fill();
        tongue(g, w, h, 0, lean);
        const body = g.createLinearGradient(0, h, 0, 0);
        body.addColorStop(0, 'rgba(255, 60, 82, 0.92)');
        body.addColorStop(0.3, 'rgba(215, 12, 42, 0.78)');
        body.addColorStop(0.62, 'rgba(120, 0, 22, 0.42)');
        body.addColorStop(1, 'rgba(50, 0, 8, 0)');
        g.fillStyle = body;
        g.fill();
        tongue(g, w, h, 0.42, lean * 0.6);
        const core = g.createLinearGradient(0, h, 0, h * 0.4);
        core.addColorStop(0, 'rgba(255, 238, 240, 0.95)');
        core.addColorStop(0.4, 'rgba(255, 130, 145, 0.55)');
        core.addColorStop(1, 'rgba(255, 80, 96, 0)');
        g.fillStyle = core;
        g.fill();
    });
    return flameSprites[v];
}

// Chave numérica (cor + alfa): consultar o cache por frame não aloca string nenhuma
const glowSprites = new Map();

/** Brilho radial suave (aditivo). */
export function getGlowSprite(r, gr, b, a = 1) {
    const key = ((r << 16) | (gr << 8) | b) * 1000 + Math.round(a * 999);
    let glow = glowSprites.get(key);
    if (glow) return glow;
    glow = sprite(`glow${r},${gr},${b},${a}`, 32, 32, 4, (g, w, h) => {
        const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grad.addColorStop(0, `rgba(${r},${gr},${b},${a})`);
        grad.addColorStop(0.4, `rgba(${r},${gr},${b},${a * 0.38})`);
        grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
    });
    glowSprites.set(key, glow);
    return glow;
}

function starPath(g, cx, cy, points, outer, inner, rot) {
    g.beginPath();
    for (let k = 0; k < points * 2; k++) {
        const a = rot + (k * Math.PI) / points;
        const r = k % 2 === 0 ? outer : inner;
        if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
}

/** Íris carmesim com o selo de estrela de 8 pontas e a pupila de brasa (raio 1 = metade do sprite). */
export function getIrisSprite() {
    return sprite('iris', 64, 64, 8, (g, w) => {
        const c = w / 2;
        const r = w / 2;
        const disk = g.createRadialGradient(c, c, 0, c, c, r);
        disk.addColorStop(0, '#ff7480');
        disk.addColorStop(0.2, '#e41d31');
        disk.addColorStop(0.55, '#8c0719');
        disk.addColorStop(0.86, '#4a0410');
        disk.addColorStop(1, '#1c0005');
        g.fillStyle = disk;
        g.beginPath();
        g.arc(c, c, r * 0.98, 0, TAU);
        g.fill();
        // Fibras da íris
        g.lineWidth = 0.35;
        for (let k = 0; k < 56; k++) {
            const a = (k / 56) * TAU;
            g.strokeStyle = k % 2 === 0 ? 'rgba(255, 150, 160, 0.16)' : 'rgba(40, 0, 6, 0.3)';
            g.beginPath();
            g.moveTo(c + Math.cos(a) * r * 0.32, c + Math.sin(a) * r * 0.32);
            g.lineTo(c + Math.cos(a) * r * 0.93, c + Math.sin(a) * r * 0.93);
            g.stroke();
        }
        g.lineWidth = r * 0.07;
        g.strokeStyle = '#160004';
        g.beginPath();
        g.arc(c, c, r * 0.95, 0, TAU);
        g.stroke();
        g.lineWidth = r * 0.025;
        g.strokeStyle = 'rgba(255, 140, 150, 0.5)';
        g.beginPath();
        g.arc(c, c, r * 0.8, 0, TAU);
        g.stroke();
        // Selo: estrela de 8 pontas escura com veio carmesim + uma segunda estrela girada por dentro
        starPath(g, c, c, 8, r * 0.88, r * 0.36, -Math.PI / 2);
        g.lineJoin = 'miter';
        g.lineWidth = r * 0.08;
        g.strokeStyle = '#1a0004';
        g.stroke();
        g.lineWidth = r * 0.024;
        g.strokeStyle = '#ff5a68';
        g.stroke();
        starPath(g, c, c, 8, r * 0.6, r * 0.3, -Math.PI / 2 + Math.PI / 8);
        g.lineWidth = r * 0.04;
        g.strokeStyle = 'rgba(30, 0, 6, 0.85)';
        g.stroke();
        g.fillStyle = '#1a0004';
        g.beginPath();
        g.arc(c, c, r * 0.28, 0, TAU);
        g.fill();
        // Pupila: brasa vermelha
        const pupil = g.createRadialGradient(c - r * 0.05, c - r * 0.05, 0, c, c, r * 0.22);
        pupil.addColorStop(0, '#ffe0e3');
        pupil.addColorStop(0.35, '#ff2a3d');
        pupil.addColorStop(1, '#7a0012');
        g.fillStyle = pupil;
        g.beginPath();
        g.arc(c, c, r * 0.21, 0, TAU);
        g.fill();
    });
}

/** Esclera rosada brilhante (preenche o olho todo aberto; o recorte das pálpebras é feito ao vivo). */
function getScleraSprite() {
    return sprite('sclera', 72, 32, 8, (g, w, h) => {
        const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grad.addColorStop(0, '#fff6f7');
        grad.addColorStop(0.32, '#ffc4c9');
        grad.addColorStop(0.62, '#f04b5c');
        grad.addColorStop(0.86, '#8e0a1e');
        grad.addColorStop(1, '#3a0008');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        // Sombra da pálpebra de cima
        const shade = g.createLinearGradient(0, 0, 0, h * 0.55);
        shade.addColorStop(0, 'rgba(40, 0, 6, 0.75)');
        shade.addColorStop(1, 'rgba(40, 0, 6, 0)');
        g.fillStyle = shade;
        g.fillRect(0, 0, w, h * 0.55);
    });
}

/** Órbita negra polida com borda carmesim (a pupila é desenhada ao vivo). */
function getOrbSprite() {
    return sprite('orb', 32, 32, 8, (g, w) => {
        const c = w / 2;
        const r = w / 2;
        const ball = g.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.05, c, c, r);
        ball.addColorStop(0, '#3d0a10');
        ball.addColorStop(0.45, '#0d0103');
        ball.addColorStop(1, '#000000');
        g.fillStyle = ball;
        g.beginPath();
        g.arc(c, c, r * 0.94, 0, TAU);
        g.fill();
        g.lineWidth = r * 0.07;
        g.strokeStyle = '#7a0012';
        g.stroke();
        // Reflexo especular
        g.fillStyle = 'rgba(255, 220, 225, 0.32)';
        g.beginPath();
        g.ellipse(c - r * 0.36, c - r * 0.42, r * 0.22, r * 0.12, -0.6, 0, TAU);
        g.fill();
    });
}

// --- Olhar (funções puras do tempo: mesma carta, mesmo olhar em todo frame) ---------------------

function hash01(n) {
    let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x ^= x >>> 16;
    return x / 4294967296;
}

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(t) {
    return t * t * (3 - 2 * t);
}

function gazeTarget(k, seed) {
    const h = hash01(k * 31 + seed * 7 + 3);
    return h < 0.42 ? 0 : h < 0.71 ? -0.85 : 0.85;
}

/**
 * Olho principal: a cada ~2,6s talvez olhe pro lado (desliza devagar, ~1s); pisca devagar a cada ~7s.
 * @param {{ open: number, gx: number, gy: number, rot: number }} out
 */
export function ronovaMainEye(time, seed, out) {
    const P = 2.6;
    let u = time / P + seed * 0.37;
    const k = Math.floor(u);
    u -= k;
    const a = gazeTarget(k, seed);
    const b = gazeTarget(k + 1, seed);
    out.gx = a + (b - a) * smooth(clamp01((u - 0.6) / 0.4));
    out.gy = 0.16 * Math.sin(time * 0.55 + seed);
    let v = (time + seed * 1.9) / 7.1;
    v -= Math.floor(v);
    const blink = 0.12;
    out.open = v < blink ? 1 - Math.sin((Math.PI * v) / blink) * 0.97 : 1;
    out.rot = time * 0.22 + seed;
    return out;
}

/**
 * Pupila de uma órbita: muda de direção a cada ~1s com um salto rápido (mais inquieta que o olho grande).
 * @param {{ x: number, y: number }} out direção -1..1
 */
export function ronovaOrbGaze(time, seed, index, out) {
    const P = 0.9 + index * 0.27;
    let u = time / P + seed * 0.41 + index * 0.5;
    const k = Math.floor(u);
    u -= k;
    const base = index * 1013 + seed * 17;
    const a0 = hash01(k * 17 + base) * TAU;
    const a1 = hash01((k + 1) * 17 + base) * TAU;
    const r0 = 0.45 + hash01(k * 29 + base) * 0.55;
    const r1 = 0.45 + hash01((k + 1) * 29 + base) * 0.55;
    const m = smooth(clamp01(u / 0.16));
    const x0 = Math.cos(a0) * r0;
    const y0 = Math.sin(a0) * r0;
    out.x = x0 + (Math.cos(a1) * r1 - x0) * m;
    out.y = y0 + (Math.sin(a1) * r1 - y0) * m;
    return out;
}

const scratchEye = { open: 1, gx: 0, gy: 0, rot: 0 };
const scratchOrb = { x: 0, y: 0 };

// --- Atlas das chamas -----------------------------------------------------------------------------
// As línguas de fogo (3 formatos) e o contorno em brasa das cartas marcadas numa textura só. Com tudo vindo da
// mesma imagem, os vários drawImage seguidos de uma carta (contorno + 9 chamas) viram um lote só na GPU; com
// texturas alternando, cada um era um desenho separado. Cada sprite ganha 1px de borda replicada: amostrar
// a borda dá o mesmo valor que o sprite avulso (clamp-to-edge), nunca o vizinho no atlas.
const ATLAS_SLOT_RIM_LOW = 3;
const ATLAS_SLOT_RIM_HIGH = 4;
const ATLAS_GAP = 3; // 1px replicado + 2px vazios entre sprites
let flameAtlas = null;
const atlasSX = new Float64Array(5);
const atlasSY = new Float64Array(5);
const atlasSW = new Float64Array(5);
const atlasSH = new Float64Array(5);

function getFlameAtlas() {
    if (flameAtlas) return flameAtlas;
    const parts = [getFlameSprite(0), getFlameSprite(1), getFlameSprite(2), getRimSprite(false), getRimSprite(true)];
    let width = ATLAS_GAP;
    let height = 0;
    for (let i = 0; i < parts.length; i++) {
        atlasSX[i] = width;
        atlasSY[i] = ATLAS_GAP;
        atlasSW[i] = parts[i].width;
        atlasSH[i] = parts[i].height;
        width += parts[i].width + ATLAS_GAP;
        if (parts[i].height > height) height = parts[i].height;
    }
    flameAtlas = document.createElement('canvas');
    flameAtlas.width = width;
    flameAtlas.height = height + ATLAS_GAP * 2;
    const g = flameAtlas.getContext('2d');
    for (let i = 0; i < parts.length; i++) {
        const s = parts[i];
        const x = atlasSX[i];
        const y = atlasSY[i];
        const w = s.width;
        const h = s.height;
        g.drawImage(s, x, y);
        // Borda replicada (laterais, topo/base e os 4 cantos)
        g.drawImage(s, 0, 0, 1, h, x - 1, y, 1, h);
        g.drawImage(s, w - 1, 0, 1, h, x + w, y, 1, h);
        g.drawImage(s, 0, 0, w, 1, x, y - 1, w, 1);
        g.drawImage(s, 0, h - 1, w, 1, x, y + h, w, 1);
        g.drawImage(s, 0, 0, 1, 1, x - 1, y - 1, 1, 1);
        g.drawImage(s, w - 1, 0, 1, 1, x + w, y - 1, 1, 1);
        g.drawImage(s, 0, h - 1, 1, 1, x - 1, y + h, 1, 1);
        g.drawImage(s, w - 1, h - 1, 1, 1, x + w, y + h, 1, 1);
    }
    console.log(`[DeathArt] Atlas das chamas montado: ${flameAtlas.width}x${flameAtlas.height}px.`);
    return flameAtlas;
}

/** drawImage de um sprite do atlas das chamas no retângulo (x, y, w, h). */
function drawAtlasSlot(ctx, slot, x, y, w, h) {
    ctx.drawImage(getFlameAtlas(), atlasSX[slot], atlasSY[slot], atlasSW[slot], atlasSH[slot], x, y, w, h);
}

// --- Peças desenhadas ao vivo (carta, olho gigante, cartas marcadas) -------------------------------

/** Língua de fogo ancorada pela base em (x, y). `variant` escolhe o formato (reta/curvada). */
export function drawFlame(ctx, x, y, w, h, variant = 0) {
    const v = (((variant | 0) % FLAME_LEANS.length) + FLAME_LEANS.length) % FLAME_LEANS.length;
    drawAtlasSlot(ctx, v, x - w / 2, y - h, w, h);
}

function almond(ctx, cx, cy, ew, eh) {
    ctx.beginPath();
    ctx.moveTo(cx - ew, cy);
    ctx.quadraticCurveTo(cx, cy - eh * 2, cx + ew, cy);
    ctx.quadraticCurveTo(cx, cy + eh * 2, cx - ew, cy);
    ctx.closePath();
}

/**
 * O olho da Ronova. `open` 0..1 (pálpebras), `gx/gy` -1..1 (olhar), `rot` giro do selo da íris.
 * `lashes` = quantas chamas lambem a pálpebra de cima (0 = nenhuma).
 * `inCard` = olho da carta: o brilho de trás passa das laterais e é recortado na carta (sem clip()).
 */
export function drawRonovaEye(ctx, cx, cy, ew, eh, open, gx, gy, rot, time, lashes = 5, inCard = false) {
    const lighter = GRAPHICS.compositeLighter;
    const ho = eh * open;
    ctx.save();

    // Brilho atrás do olho (respira) — contido, pra não lavar o escuro em volta
    const pulse = 0.75 + 0.25 * Math.sin(time * 2.2);
    ctx.globalCompositeOperation = lighter;
    ctx.globalAlpha = 0.3 * pulse * (0.35 + 0.65 * open);
    if (inCard) drawImageInCard(ctx, getGlowSprite(255, 40, 60), cx - ew * 1.7, cy - eh * 3.2, ew * 3.4, eh * 6.4, null);
    else ctx.drawImage(getGlowSprite(255, 40, 60), cx - ew * 1.7, cy - eh * 3.2, ew * 3.4, eh * 6.4);

    // Chamas lambendo a pálpebra de cima (seguem a curva do olho)
    if (lashes > 0) {
        ctx.globalAlpha = 0.85;
        for (let i = 0; i < lashes; i++) {
            const t = (i + 0.5) / lashes;
            const lx = cx - ew * 0.82 + ew * 1.64 * t;
            const curve = 1 - (2 * t - 1) * (2 * t - 1);
            const ly = cy - ho * curve * 0.98;
            const flick = 0.75 + 0.25 * Math.sin(time * (7 + i * 1.3) + i * 2.1);
            const fh = eh * (1.1 + curve * 0.9) * flick * (0.4 + 0.6 * open);
            // Curvam pra fora do centro, como fogo lambendo a pálpebra
            drawFlame(ctx, lx, ly + eh * 0.15, eh * 0.75, fh, t < 0.4 ? 1 : t > 0.6 ? 2 : 0);
        }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (open > 0.04) {
        ctx.save();
        almond(ctx, cx, cy, ew, ho);
        ctx.clip();
        ctx.drawImage(getScleraSprite(), cx - ew, cy - eh * 1.1, ew * 2, eh * 2.2);
        const ir = eh * 1.12;
        const ix = cx + gx * ew * 0.42;
        const iy = cy + gy * eh * 0.3;
        ctx.translate(ix, iy);
        ctx.rotate(rot);
        ctx.drawImage(getIrisSprite(), -ir, -ir, ir * 2, ir * 2);
        ctx.rotate(-rot);
        // Pupila de brasa pulsando
        ctx.globalCompositeOperation = lighter;
        ctx.globalAlpha = 0.5 + 0.35 * Math.sin(time * 3.4);
        ctx.drawImage(getGlowSprite(255, 60, 70), -ir * 0.6, -ir * 0.6, ir * 1.2, ir * 1.2);
        ctx.restore();
    }

    // Contorno das pálpebras: linha escura com veio carmesim brilhando
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    almond(ctx, cx, cy, ew, Math.max(0.6, ho));
    ctx.globalAlpha = 1;
    ctx.lineWidth = eh * 0.13;
    ctx.strokeStyle = '#120003';
    ctx.stroke();
    ctx.globalCompositeOperation = lighter;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = eh * 0.16;
    ctx.strokeStyle = 'rgb(255, 30, 55)';
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = eh * 0.04;
    ctx.strokeStyle = 'rgb(255, 110, 125)';
    ctx.stroke();
    ctx.restore();
}

/** Órbita negra com a pupila vermelha olhando em `px/py` (-1..1). */
export function drawRonovaOrb(ctx, x, y, r, px, py, time, bright = 0) {
    const lighter = GRAPHICS.compositeLighter;
    ctx.save();
    // Redemoinho de chamas girando em volta
    const a0 = time * 1.6 + x * 0.1;
    ctx.globalCompositeOperation = lighter;
    ctx.lineCap = 'round';
    // Os dois arcos de cada passada ficam em lados opostos (2.1 rad cada, meia volta de distância): nunca se
    // tocam, então um único stroke com os dois é idêntico a dois strokes, com metade das chamadas à GPU
    for (let pass = 0; pass < 2; pass++) {
        ctx.lineWidth = pass === 0 ? r * 0.32 : r * 0.08;
        ctx.strokeStyle = pass === 0 ? 'rgba(255, 30, 55, 0.3)' : 'rgba(255, 120, 132, 0.85)';
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
            const rr = r * (1.3 + k * 0.14);
            const start = a0 + k * Math.PI;
            ctx.moveTo(x + Math.cos(start) * rr, y + Math.sin(start) * rr);
            ctx.arc(x, y, rr, start, start + 2.1);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
    ctx.drawImage(getGlowSprite(255, 30, 50), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(getOrbSprite(), x - r, y - r, r * 2, r * 2);
    // Pupila vermelha
    const pr = r * 0.24;
    const qx = x + px * r * 0.42;
    const qy = y + py * r * 0.42;
    ctx.globalCompositeOperation = lighter;
    ctx.globalAlpha = 0.85 + 0.15 * bright;
    ctx.drawImage(getGlowSprite(255, 30, 50), qx - pr * 3.2, qy - pr * 3.2, pr * 6.4, pr * 6.4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff1f35';
    ctx.beginPath();
    ctx.arc(qx, qy, pr, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffd6da';
    ctx.beginPath();
    ctx.arc(qx - pr * 0.25, qy - pr * 0.25, pr * 0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
}

// --- Recorte da carta sem clip() ----------------------------------------------------------------------
// Um clip() com o retângulo arredondado numa carta girada (o leque da mão) obriga a GPU a gerar uma máscara
// por frame: era metade do custo da camada viva. Aqui o recorte vira geometria exata: nas bordas retas basta
// cortar o retângulo de origem do drawImage; onde a peça encosta num canto arredondado, ela é preenchida como
// padrão (CanvasPattern, transparente fora do sprite) dentro do pedaço exato da carta, um roundRect com raio
// só nos cantos de verdade. O que sobra de diferença (amostragem no pixel da borda) fica sob o contorno de
// 2 unidades que drawStyledFace desenha por cima.
const cardPatternMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const cardCornerRadii = [0, 0, 0, 0];
const flamePatterns = [null, null, null];

function getFlamePattern(ctx, variant) {
    let pattern = flamePatterns[variant];
    if (!pattern) {
        pattern = ctx.createPattern(getFlameSprite(variant), 'no-repeat');
        flamePatterns[variant] = pattern;
    }
    return pattern;
}

/**
 * `ctx.drawImage(img, dx, dy, dw, dh)` recortado no retângulo arredondado da carta (0,0,W,H,R), sem clip().
 * @param {CanvasPattern|null} pattern padrão 'no-repeat' do mesmo `img` (usado só quando encosta num canto)
 */
function drawImageInCard(ctx, img, dx, dy, dw, dh, pattern) {
    let x0 = dx > 0 ? dx : 0;
    let y0 = dy > 0 ? dy : 0;
    let x1 = dx + dw < W ? dx + dw : W;
    let y1 = dy + dh < H ? dy + dh : H;
    if (x1 <= x0 || y1 <= y0) return;
    const left = x0 < R;
    const right = x1 > W - R;
    const top = y0 < R;
    const bottom = y1 > H - R;
    if (!((left || right) && (top || bottom)) || !pattern) {
        // Só bordas retas: cortar o retângulo de origem é exatamente o que o clip faria
        const kx = img.width / dw;
        const ky = img.height / dh;
        ctx.drawImage(img, (x0 - dx) * kx, (y0 - dy) * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0, y0, x1 - x0, y1 - y0);
        return;
    }
    // Encosta num canto: a região vira o quadrado do canto inteiro (o padrão é transparente fora do sprite),
    // e então a interseção com a carta é um roundRect com raio R só nos cantos da própria carta
    if (left) { x0 = 0; if (x1 < R) x1 = R; }
    if (right) { x1 = W; if (x0 > W - R) x0 = W - R; }
    if (top) { y0 = 0; if (y1 < R) y1 = R; }
    if (bottom) { y1 = H; if (y0 > H - R) y0 = H - R; }
    cardCornerRadii[0] = left && top ? R : 0;
    cardCornerRadii[1] = right && top ? R : 0;
    cardCornerRadii[2] = right && bottom ? R : 0;
    cardCornerRadii[3] = left && bottom ? R : 0;
    cardPatternMatrix.a = dw / img.width;
    cardPatternMatrix.d = dh / img.height;
    cardPatternMatrix.e = dx;
    cardPatternMatrix.f = dy;
    pattern.setTransform(cardPatternMatrix);
    ctx.fillStyle = pattern;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, cardCornerRadii);
    ctx.fill();
}

/** O ponto está dentro do retângulo arredondado da carta? */
function insideCard(x, y) {
    if (x < 0 || x > W || y < 0 || y > H) return false;
    const cx = x < R ? R : x > W - R ? W - R : x;
    const cy = y < R ? R : y > H - R ? H - R : y;
    const ddx = x - cx;
    const ddy = y - cy;
    return ddx * ddx + ddy * ddy <= R * R;
}

// Chamas da carta (base x, largura, altura base) e brasas subindo
const CARD_FLAMES = Object.freeze([
    [6, 15, 34], [19, 18, 46], [33, 15, 38], [47, 19, 52], [61, 15, 40], [75, 18, 48], [90, 15, 36]
]);
const CARD_EMBERS = 10;

/**
 * Camada viva da carta Ronova (desenhada na resolução real, por cima do laminado): chamas da morte
 * subindo do pé da carta, brasas, o olho central e as duas órbitas.
 * @param {boolean} held carta sob o ponteiro na mão (as pupilas das órbitas acendem)
 */
export function drawRonovaLive(ctx, time, seed, held) {
    const lighter = GRAPHICS.compositeLighter;
    const high = GRAPHICS.isHigh;
    // Sem clip(): cada peça que pode passar da borda é recortada pela geometria (drawImageInCard/insideCard);
    // o olho e as órbitas cabem inteiros na carta
    ctx.save();

    // Chamas da morte subindo do pé da carta
    ctx.globalCompositeOperation = lighter;
    const step = high ? 1 : 2;
    for (let i = 0; i < CARD_FLAMES.length; i += step) {
        const f = CARD_FLAMES[i];
        const flick = 0.72 + 0.2 * Math.sin(time * (5.6 + i * 0.7) + i * 1.7 + seed) + 0.1 * Math.sin(time * 13.1 + i * 3);
        ctx.globalAlpha = 0.42 + 0.28 * flick;
        const v = i % FLAME_LEANS.length;
        const fw = f[1];
        const fh = f[2] * flick;
        drawImageInCard(ctx, getFlameSprite(v), f[0] + Math.sin(time * 1.4 + i * 2.2) * 2 - fw / 2, H + 4 - fh, fw, fh,
            getFlamePattern(ctx, v));
    }
    // Brasas: quadradinhos de até 1.5 unidade; com o centro dentro da carta, o que sobra pra fora cai sob o
    // contorno (2 unidades), então basta cortar nas bordas retas
    if (high) {
        ctx.fillStyle = '#ff8a5c';
        for (let e = 0; e < CARD_EMBERS; e++) {
            let v = time / (2.4 + e * 0.19) + e * 0.37 + seed * 0.13;
            v -= Math.floor(v);
            const ex = 8 + ((e * 37 + seed * 11) % 84) + Math.sin(time * 2 + e) * 3;
            const ey = H + 4 - v * (H + 12);
            if (!insideCard(ex, ey)) continue;
            const s = 0.8 + (e % 3) * 0.35;
            const top = ey - s / 2;
            const bottom = ey + s / 2 < H ? ey + s / 2 : H;
            ctx.globalAlpha = (1 - v) * 0.9;
            ctx.fillRect(ex - s / 2, top, s, bottom - top);
        }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const eye = ronovaMainEye(time, seed, scratchEye);
    drawRonovaEye(ctx, DEATH_EYE.x, DEATH_EYE.y, DEATH_EYE.ew, DEATH_EYE.eh, eye.open, eye.gx, eye.gy, eye.rot, time, high ? 5 : 3, true);
    for (let k = 0; k < DEATH_ORBS.length; k++) {
        const o = DEATH_ORBS[k];
        const g = ronovaOrbGaze(time, seed, k, scratchOrb);
        drawRonovaOrb(ctx, o.x, o.y, o.r, g.x, g.y, time, held ? 1 : 0);
    }
    ctx.restore();
}

// Chamas carmesim suaves nas cartas do marcado: pé da carta + subindo pelas laterais
const MARK_FLAMES = Object.freeze([
    [12, H + 3, 16, 30], [32, H + 3, 18, 40], [52, H + 3, 17, 34], [72, H + 3, 18, 42], [90, H + 3, 15, 28],
    [-1, H * 0.7, 10, 22], [W + 1, H * 0.62, 10, 24], [-1, H * 0.35, 8, 16], [W + 1, H * 0.3, 8, 18]
]);

// Contorno em brasa das cartas marcadas: halo largo (alfa 0,32) + fio (alfa 0,75), somados (lighter). No sprite o
// halo entra com 0,32 / 0,75 e o sprite é desenhado com o alfa do fio: a soma aditiva final é a mesma.
const RIM_PAD = 4;
const RIM_CORE_ALPHA = 0.75;
const RIM_WIDE_RATIO = 0.32 / RIM_CORE_ALPHA;
const rimSprites = [null, null];

function getRimSprite(high) {
    const i = high ? 1 : 0;
    if (rimSprites[i]) return rimSprites[i];
    rimSprites[i] = sprite(high ? 'rimHigh' : 'rimLow', W + RIM_PAD * 2, H + RIM_PAD * 2, 4, (g) => {
        g.beginPath();
        g.roundRect(RIM_PAD, RIM_PAD, W, H, R);
        if (high) {
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = RIM_WIDE_RATIO;
            g.lineWidth = 6;
            g.strokeStyle = 'rgba(255, 30, 55, 0.7)';
            g.stroke();
        }
        g.globalAlpha = 1;
        g.lineWidth = 1.4;
        g.strokeStyle = '#ff4a5c';
        g.stroke();
    });
    return rimSprites[i];
}

/**
 * Chamas carmesim suaves numa carta marcada pela Ronova (frente ou verso), em coordenadas da carta.
 * @param {number} intensity 0..1
 */
export function drawRonovaCardFlames(ctx, time, seed, intensity) {
    if (intensity <= 0) return;
    const lighter = GRAPHICS.compositeLighter;
    const high = GRAPHICS.isHigh;
    const pulse = 0.65 + 0.35 * Math.sin(time * 2.4 + seed * 0.7);
    ctx.save();
    ctx.globalCompositeOperation = lighter;
    // Contorno em brasa: um drawImage do sprite (antes eram 2 caminhos traçados por carta, por frame)
    // (vem do atlas das chamas: contorno + chamas desta carta saem num lote só)
    ctx.globalAlpha = RIM_CORE_ALPHA * pulse * intensity;
    drawAtlasSlot(ctx, high ? ATLAS_SLOT_RIM_HIGH : ATLAS_SLOT_RIM_LOW, -RIM_PAD, -RIM_PAD, W + RIM_PAD * 2, H + RIM_PAD * 2);
    // Gráfico baixo: 3 chamas espalhadas pelo pé da carta (0, 2, 4) em vez das 9 em volta
    const count = high ? MARK_FLAMES.length : 5;
    const step = high ? 1 : 2;
    for (let i = 0; i < count; i += step) {
        const f = MARK_FLAMES[i];
        const flick = 0.7 + 0.2 * Math.sin(time * (5.2 + i * 0.9) + seed + i * 2.3) + 0.1 * Math.sin(time * 12.7 + i);
        ctx.globalAlpha = (0.32 + 0.22 * flick) * intensity;
        drawFlame(ctx, f[0] + Math.sin(time * 1.7 + i + seed) * 1.5, f[1], f[2], f[3] * flick, i + seed);
    }
    if (high) {
        ctx.fillStyle = '#ff7a5c';
        for (let e = 0; e < 3; e++) {
            let v = time / (1.9 + e * 0.4) + e * 0.31 + seed * 0.17;
            v -= Math.floor(v);
            ctx.globalAlpha = (1 - v) * 0.8 * intensity;
            ctx.fillRect(12 + ((e * 31 + seed * 7) % 76), H - v * (H * 0.9), 1.4, 1.4);
        }
    }
    ctx.restore();
}

/**
 * Carta sendo consumida pelas chamas carmesim (`b` 0..1): carboniza de baixo pra cima com uma frente de
 * brasa ondulante, e as chamas crescem até engolir a carta.
 */
export function drawRonovaBurn(ctx, b, time, seed) {
    if (b <= 0) return;
    const lighter = GRAPHICS.compositeLighter;
    const front = H * (1 - b * 1.15);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();
    // Carvão subindo
    ctx.fillStyle = 'rgba(14, 0, 3, 0.88)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) {
        ctx.lineTo(x, front + Math.sin(x * 0.21 + time * 9 + seed) * 4);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    // Frente de brasa
    ctx.globalCompositeOperation = lighter;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 90, 60, 0.9)';
    ctx.beginPath();
    for (let x = 0; x <= W; x += 10) {
        const y = front + Math.sin(x * 0.21 + time * 9 + seed) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    // Chamas engolindo (fora do recorte: sobem acima da carta)
    ctx.save();
    ctx.globalCompositeOperation = lighter;
    for (let i = 0; i < 8; i++) {
        const flick = 0.75 + 0.25 * Math.sin(time * (8 + i) + i * 1.9 + seed);
        ctx.globalAlpha = Math.min(1, 0.4 + b) * (1 - b * 0.4);
        drawFlame(ctx, 6 + i * 12.5, H + 6, 22, (H * 0.35 + H * 0.95 * b) * flick, i);
    }
    ctx.restore();
}

// --- Face pintada (cache) ------------------------------------------------------------------------

function lcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Flor de 7 pétalas (a pupila da Ronova) como selo. */
function flowerSigil(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k / 7) * TAU;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, r * 0.18, a, 0, TAU);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, TAU);
    ctx.fill();
}

/** Asa carmesim da Ronova com aberturas em forma de olho (do canto do olho até a borda de cima). */
function wing(ctx, dir) {
    const x0 = DEATH_EYE.x + dir * 22;
    const y0 = DEATH_EYE.y - 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + dir * 18, y0 - 18, x0 + dir * 24, y0 - 46, x0 + dir * 22, y0 - 66);
    ctx.bezierCurveTo(x0 + dir * 12, y0 - 52, x0 + dir * 6, y0 - 40, x0 + dir * 2, y0 - 28);
    ctx.bezierCurveTo(x0 - dir * 2, y0 - 20, x0 - dir * 2, y0 - 10, x0, y0);
    ctx.closePath();
    const g = ctx.createLinearGradient(x0, y0, x0 + dir * 22, y0 - 66);
    g.addColorStop(0, 'rgba(120, 6, 22, 0.75)');
    g.addColorStop(1, 'rgba(60, 0, 12, 0.15)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(255, 70, 90, 0.45)';
    ctx.stroke();
    // Aberturas em forma de olho
    for (let k = 0; k < 2; k++) {
        const ex = x0 + dir * (10 + k * 6);
        const ey = y0 - 22 - k * 18;
        ctx.beginPath();
        ctx.ellipse(ex, ey, 3.6, 1.6, dir * -0.9, 0, TAU);
        ctx.fillStyle = '#080001';
        ctx.fill();
        ctx.fillStyle = '#ff2a3d';
        ctx.beginPath();
        ctx.arc(ex, ey, 0.7, 0, TAU);
        ctx.fill();
    }
}

/**
 * Face estática da Ronova (pintada uma vez): chamas da morte em espirais carmesim, asas com olhos,
 * redemoinhos em volta das órbitas e moldura dupla de ouro escuro e carmesim com selos de flor.
 */
export function paintRonovaFace(ctx) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const bg = ctx.createRadialGradient(DEATH_EYE.x, DEATH_EYE.y, 4, DEATH_EYE.x, DEATH_EYE.y, 110);
    bg.addColorStop(0, '#4a0610');
    bg.addColorStop(0.3, '#24020a');
    bg.addColorStop(0.65, '#0d0103');
    bg.addColorStop(1, '#030000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Chamas da morte: fios em S subindo do pé ao topo, em vários tons de carmesim
    const rand = lcg(0x52a7);
    ctx.lineCap = 'round';
    for (let i = 0; i < 36; i++) {
        const x0 = -12 + rand() * (W + 24);
        const x3 = x0 + (rand() - 0.5) * 70;
        const c1x = x0 + (rand() - 0.5) * 90;
        const c2x = x3 + (rand() - 0.5) * 90;
        const red = 140 + Math.floor(rand() * 115);
        const alpha = 0.04 + rand() * 0.16;
        const width = 0.5 + rand() * 2.6;
        ctx.beginPath();
        ctx.moveTo(x0, H + 8);
        ctx.bezierCurveTo(c1x, H * 0.68, c2x, H * 0.3, x3, -8);
        ctx.strokeStyle = `rgba(${red}, ${Math.floor(rand() * 40)}, ${30 + Math.floor(rand() * 30)}, ${alpha * 0.45})`;
        ctx.lineWidth = width * 3.2;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${red}, ${20 + Math.floor(rand() * 60)}, ${50 + Math.floor(rand() * 40)}, ${alpha})`;
        ctx.lineWidth = width;
        ctx.stroke();
    }
    // Redemoinhos horizontais abraçando o olho
    for (let k = 0; k < 7; k++) {
        ctx.beginPath();
        ctx.ellipse(DEATH_EYE.x, DEATH_EYE.y, 40 + k * 3.5, 20 + k * 2.6, (k % 2 === 0 ? 1 : -1) * 0.18, Math.PI * 0.1, Math.PI * 1.25);
        ctx.strokeStyle = `rgba(255, ${50 + k * 10}, ${70 + k * 6}, ${0.16 - k * 0.016})`;
        ctx.lineWidth = 1.4 - k * 0.12;
        ctx.stroke();
    }

    wing(ctx, -1);
    wing(ctx, 1);

    // Redemoinhos concêntricos em volta das órbitas
    for (const o of DEATH_ORBS) {
        for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(o.x, o.y, o.r * (1.55 + k * 0.32), k * 1.3, k * 1.3 + Math.PI * 1.4);
            ctx.strokeStyle = `rgba(255, ${50 + k * 20}, 70, ${0.4 - k * 0.08})`;
            ctx.lineWidth = 1.1 - k * 0.15;
            ctx.stroke();
        }
    }

    // Halo rosado atrás do olho (a esclera e as pálpebras são vivas)
    const halo = ctx.createRadialGradient(DEATH_EYE.x, DEATH_EYE.y, 6, DEATH_EYE.x, DEATH_EYE.y, 48);
    halo.addColorStop(0, 'rgba(255, 170, 180, 0.32)');
    halo.addColorStop(0.45, 'rgba(255, 40, 60, 0.12)');
    halo.addColorStop(1, 'rgba(255, 60, 80, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Brasas paradas
    for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(255, ${120 + Math.floor(rand() * 100)}, 80, ${0.3 + rand() * 0.6})`;
        const s = 0.5 + rand() * 1.1;
        ctx.fillRect(rand() * W, rand() * H, s, s);
    }

    // Moldura dupla: ouro escuro por fora, carmesim por dentro, selos de flor nos cantos
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(196, 140, 52, 0.85)';
    ctx.beginPath();
    ctx.roundRect(4.5, 4.5, W - 9, H - 9, R - 2.5);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(255, 59, 78, 0.6)';
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, R - 4);
    ctx.stroke();
    flowerSigil(ctx, 12, 12, 4.2, 'rgba(255, 70, 90, 0.85)');
    flowerSigil(ctx, W - 12, 12, 4.2, 'rgba(255, 70, 90, 0.85)');
    flowerSigil(ctx, 12, H - 12, 4.2, 'rgba(255, 70, 90, 0.85)');
    flowerSigil(ctx, W - 12, H - 12, 4.2, 'rgba(255, 70, 90, 0.85)');
    flowerSigil(ctx, W / 2, 6.5, 3, 'rgba(214, 160, 70, 0.95)');
    flowerSigil(ctx, W / 2, H - 6.5, 3, 'rgba(214, 160, 70, 0.95)');
}

// --- Laminado próprio: Eclipse Carmesim (FOIL_DEATH) ---------------------------------------------

const CORONA_RAYS = 28;

/**
 * Camada extra do FOIL_DEATH (no buffer do laminado): uma coroa de eclipse carmesim girando em volta do
 * olho, com raios que se esticam e encolhem como protuberâncias solares, e um anel de fogo respirando.
 */
function drawRonovaFoilExtra(ctx, w, h, time, phase) {
    const cx = DEATH_EYE.x;
    const cy = DEATH_EYE.y;
    const rot = time * 0.35 + phase * TAU;
    ctx.globalCompositeOperation = GRAPHICS.compositeLighter;
    ctx.lineCap = 'round';
    for (let k = 0; k < CORONA_RAYS; k++) {
        const a = rot + (k / CORONA_RAYS) * TAU;
        const flare = 0.5 + 0.5 * Math.sin(time * 3.1 + k * 1.7);
        const r0x = 42;
        const r0y = 22;
        const len = 3 + flare * flare * 9;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        ctx.globalAlpha = 0.15 + 0.35 * flare;
        ctx.strokeStyle = k % 3 === 0 ? '#ffd0a0' : '#ff3b4e';
        ctx.lineWidth = k % 3 === 0 ? 0.9 : 1.4;
        ctx.beginPath();
        ctx.moveTo(cx + ca * r0x, cy + sa * r0y);
        ctx.lineTo(cx + ca * (r0x + len), cy + sa * (r0y + len * 0.55));
        ctx.stroke();
    }
    const breathe = 0.5 + 0.5 * Math.sin(time * 1.7);
    ctx.globalAlpha = 0.25 + 0.3 * breathe;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#ff5a68';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 41, 21.5, 0, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
}

/** Preset do laminado da Ronova (registrado em card-effects.js). */
export const DEATH_FOIL = Object.freeze({
    angle: -0.75,
    bands: [
        // Véu de eclipse: faixa larga escura com borda carmesim varrendo devagar
        {
            stops: [
                [0, 'rgba(90,0,15,0)'], [0.3, 'rgba(110,0,20,0.2)'], [0.5, 'rgba(6,0,2,0.55)'],
                [0.7, 'rgba(150,8,32,0.2)'], [1, 'rgba(90,0,15,0)']
            ],
            width: 0.8, period: 4.2, sweep: 0.7, alpha: 1, composite: 'source-over', offset: 0.15
        },
        // Reflexo-navalha carmesim e ouro
        {
            stops: [
                [0, 'rgba(255,60,80,0)'], [0.4, 'rgba(255,80,95,0.5)'], [0.5, 'rgba(255,225,190,0.95)'],
                [0.6, 'rgba(255,80,95,0.5)'], [1, 'rgba(255,60,80,0)']
            ],
            width: 0.16, period: 2.3, sweep: 0.42, alpha: 0.9, composite: 'lighter', offset: 0.6
        }
    ],
    sparkles: { count: 10, color: '#ff4a3d', core: '#ffe2b0', minSize: 1.6, maxSize: 3.8, minRate: 2.6, maxRate: 5.2 },
    extra: drawRonovaFoilExtra
});

/**
 * Pinta todos os sprites da Ronova antes da hora (chamar em tempo ocioso): sem isso, a íris de 512px, as chamas
 * e os brilhos seriam pintados no 1º frame em que aparecem — exatamente quando o olho entra na tela.
 */
export function warmRonovaSprites() {
    for (let v = 0; v < FLAME_LEANS.length; v++) getFlameSprite(v);
    getGlowSprite(255, 40, 60);
    getGlowSprite(255, 60, 70);
    getGlowSprite(255, 30, 50);
    getGlowSprite(255, 20, 45);
    getGlowSprite(170, 0, 22);
    getIrisSprite();
    getScleraSprite();
    getOrbSprite();
    getRimSprite(true);
    getRimSprite(false);
    getFlameAtlas();
}
