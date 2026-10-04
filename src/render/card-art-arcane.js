import { CONFIG } from '../config/constants.js';

/**
 * Faces pintadas das cartas "arcanas" (Fantasma, Espelho Sombrio, Emboscada, Maldição) e a geometria que
 * os efeitos animados (card-effects.js) redesenham por cima — veias do Espelho, runas, olho da Emboscada,
 * olhos da caveira da Maldição. Tudo em coordenadas de carta (100x150), pintado uma vez em cache.
 */

const { CARD_DIMENSIONS } = CONFIG;
const TAU = Math.PI * 2;
const W = CARD_DIMENSIONS.WIDTH;
const H = CARD_DIMENSIONS.HEIGHT;
const R = CARD_DIMENSIONS.RADIUS;

/** Gerador determinístico (mesmo desenho em toda sessão). */
function lcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function colorHex(color) {
    return CONFIG.COLOR_HEX[color] || '#9b59b6';
}

function diamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.7, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.7, y);
    ctx.closePath();
    ctx.fill();
}

// --- Geometria compartilhada com os efeitos --------------------------------------

/** Centro e raios do espelho oval do Espelho Sombrio. */
export const MIRROR_OVAL = Object.freeze({ x: W / 2, y: H * 0.47, rx: 29, ry: 41 });

/**
 * Veias (rachaduras de luz na obsidiana) saindo da borda do espelho: polilinhas planas [x0,y0,x1,y1,...].
 * Geradas uma vez, as mesmas na face pintada e no pulso animado.
 */
export const MIRROR_VEINS = (() => {
    // Rachaduras curtas e ramificadas coladas no aro (luz vazando da obsidiana), nunca "pernas" longas
    const rand = lcg(0x5eed);
    const veins = [];
    const o = MIRROR_OVAL;
    const count = 14;
    for (let v = 0; v < count; v++) {
        const a = (v / count) * TAU + rand() * 0.35;
        let x = o.x + Math.cos(a) * (o.rx + 1.5);
        let y = o.y + Math.sin(a) * (o.ry + 1.5);
        const pts = [x, y];
        let dir = a + (rand() - 0.5) * 0.9;
        const steps = 2 + Math.floor(rand() * 2);
        for (let s = 0; s < steps; s++) {
            const len = 2.5 + rand() * 3.5;
            x += Math.cos(dir) * len;
            y += Math.sin(dir) * len;
            pts.push(x, y);
            dir += (rand() - 0.5) * 1.4;
        }
        veins.push(new Float32Array(pts));
        // Galho curtinho saindo do meio de metade das rachaduras
        if (rand() < 0.5) {
            const bx = pts[2];
            const by = pts[3];
            const bd = dir + (rand() < 0.5 ? 1 : -1) * (0.8 + rand() * 0.6);
            veins.push(new Float32Array([bx, by, bx + Math.cos(bd) * 3.2, by + Math.sin(bd) * 3.2]));
        }
    }
    return veins;
})();

/** Traça (sem pintar) uma veia. */
export function traceVein(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
}

/**
 * Runas gravadas ao longo de uma moldura retangular (inset). Cada runa é um glifo de 3-4 traços curtos
 * pseudoaleatório; `each(ctx, i, x, y)` permite ao efeito animado pulsar runa por runa.
 */
export const RUNES = (() => {
    const rand = lcg(0xa11ce);
    const list = [];
    const inset = 7.5;
    const perSide = [5, 7];
    const add = (x, y) => {
        const strokes = [];
        const n = 3 + Math.floor(rand() * 2);
        for (let s = 0; s < n; s++) {
            strokes.push((rand() - 0.5) * 3.6, (rand() - 0.5) * 3.6, (rand() - 0.5) * 3.6, (rand() - 0.5) * 3.6);
        }
        list.push({ x, y, strokes: new Float32Array(strokes) });
    };
    for (let i = 0; i < perSide[0]; i++) {
        const x = 22 + (i / (perSide[0] - 1)) * (W - 44);
        add(x, inset);
        add(x, H - inset);
    }
    for (let i = 0; i < perSide[1]; i++) {
        const y = 24 + (i / (perSide[1] - 1)) * (H - 48);
        add(inset, y);
        add(W - inset, y);
    }
    return list;
})();

export function traceRune(ctx, rune) {
    const s = rune.strokes;
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 4) {
        ctx.moveTo(rune.x + s[i], rune.y + s[i + 1]);
        ctx.lineTo(rune.x + s[i + 2], rune.y + s[i + 3]);
    }
}

/** Olho da Emboscada (dentro do triângulo invertido). */
export const AMBUSH_EYE = Object.freeze({ x: W / 2, y: H * 0.44, w: 15, h: 7.5 });

/** Caveira da Maldição: centro, escala e a posição dos olhos (onde o fogo roxo arde). */
export const CURSE_SKULL = Object.freeze({ x: W / 2, y: H * 0.47, s: 1 });
export const CURSE_EYES = Object.freeze([[W / 2 - 6.2, H * 0.47 - 2.5], [W / 2 + 6.2, H * 0.47 - 2.5]]);

/** Caveira estilizada (crânio + maçãs + mandíbula) centrada em (cx, cy), `s` = escala. */
export function traceSkull(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - 13 * s, cy + 2 * s);
    ctx.bezierCurveTo(cx - 15 * s, cy - 14 * s, cx - 6 * s, cy - 19 * s, cx, cy - 19 * s);
    ctx.bezierCurveTo(cx + 6 * s, cy - 19 * s, cx + 15 * s, cy - 14 * s, cx + 13 * s, cy + 2 * s);
    ctx.quadraticCurveTo(cx + 12 * s, cy + 7 * s, cx + 8 * s, cy + 8 * s);
    ctx.lineTo(cx + 8 * s, cy + 13 * s);
    ctx.quadraticCurveTo(cx, cy + 16 * s, cx - 8 * s, cy + 13 * s);
    ctx.lineTo(cx - 8 * s, cy + 8 * s);
    ctx.quadraticCurveTo(cx - 12 * s, cy + 7 * s, cx - 13 * s, cy + 2 * s);
    ctx.closePath();
}

function skullDetails(ctx, cx, cy, s, socket, line) {
    // Órbitas, nariz e dentes
    ctx.fillStyle = socket;
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * 6.2 * s, cy - 2.5 * s, 4.4 * s, 3.9 * s, side * 0.25, 0, TAU);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy + 2 * s);
    ctx.lineTo(cx - 2.2 * s, cy + 6 * s);
    ctx.lineTo(cx + 2.2 * s, cy + 6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    for (let t = -3; t <= 3; t++) {
        ctx.moveTo(cx + t * 2.2 * s, cy + 9 * s);
        ctx.lineTo(cx + t * 2.2 * s, cy + 12.5 * s);
    }
    ctx.moveTo(cx - 7.5 * s, cy + 10.5 * s);
    ctx.lineTo(cx + 7.5 * s, cy + 10.5 * s);
    ctx.stroke();
}

// Caveira roxa translúcida grande (aparição da Maldição e os crânios do fundo): pintada uma vez
let skullSprite = null;
export function getSkullSprite() {
    if (skullSprite) return skullSprite;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    const s = size / 44;
    const cx = size / 2;
    const cy = size / 2 + 2 * s;
    g.shadowColor = 'rgba(170, 60, 255, 1)';
    g.shadowBlur = size * 0.08;
    traceSkull(g, cx, cy, s);
    const fill = g.createLinearGradient(0, cy - 19 * s, 0, cy + 16 * s);
    fill.addColorStop(0, 'rgba(232, 214, 255, 0.95)');
    fill.addColorStop(1, 'rgba(150, 70, 230, 0.85)');
    g.fillStyle = fill;
    g.fill();
    g.shadowBlur = 0;
    skullDetails(g, cx, cy, s, 'rgba(40, 0, 70, 0.95)', 'rgba(40, 0, 70, 0.8)');
    skullSprite = canvas;
    return canvas;
}

// --- Fantasma ----------------------------------------------------------------------

/** Carta-fantasma: silhueta de carta cuja base se desfaz em três fiapos, com dois olhos ocos. */
export function traceGhostCard(ctx, cx, cy, s) {
    const w = 17 * s;
    const top = cy - 25 * s;
    const bottom = cy + 18 * s;
    ctx.beginPath();
    ctx.moveTo(cx - w, bottom);
    ctx.lineTo(cx - w, top + 5 * s);
    ctx.quadraticCurveTo(cx - w, top, cx - w + 5 * s, top);
    ctx.lineTo(cx + w - 5 * s, top);
    ctx.quadraticCurveTo(cx + w, top, cx + w, top + 5 * s);
    ctx.lineTo(cx + w, bottom);
    // Base em fiapos ondulados (a carta "se desfaz" em ectoplasma)
    const seg = (w * 2) / 3;
    for (let i = 0; i < 3; i++) {
        const x0 = cx + w - seg * i;
        ctx.quadraticCurveTo(x0 - seg * 0.25, bottom + 9 * s, x0 - seg * 0.5, bottom + 3 * s);
        ctx.quadraticCurveTo(x0 - seg * 0.75, bottom - 3 * s, x0 - seg, bottom + (i === 2 ? 0 : 1) * s);
    }
    ctx.closePath();
}

/**
 * Fantasma: roxo profundo -> preto com neblina etérea; a cor da carta vira uma aura fantasmagórica em volta
 * da silhueta. A moldura prateada (que treme) e a pulsação da silhueta são desenhadas ao vivo (ETHEREAL).
 */
export function paintGhostFace(ctx, color) {
    const hex = colorHex(color);
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a0a2e');
    bg.addColorStop(0.55, '#0e0619');
    bg.addColorStop(1, '#030106');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Neblina estática em camadas (a que se move vem por cima, ao vivo)
    const rand = lcg(0x6057);
    for (let i = 0; i < 9; i++) {
        const x = rand() * W;
        const y = 20 + rand() * (H - 40);
        const r = 14 + rand() * 20;
        const mist = ctx.createRadialGradient(x, y, 0, x, y, r);
        mist.addColorStop(0, 'rgba(190, 170, 255, 0.10)');
        mist.addColorStop(1, 'rgba(190, 170, 255, 0)');
        ctx.fillStyle = mist;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Aura da cor da carta em volta do ícone (é aqui que a cor aparece — bem mais forte que o resto,
    // pra identificar a cor à distância mesmo com a carta pequena na mão)
    const cx = W / 2;
    const cy = H * 0.5;
    const aura = ctx.createRadialGradient(cx, cy, 4, cx, cy, 48);
    aura.addColorStop(0, rgba(hex, 0.9));
    aura.addColorStop(0.45, rgba(hex, 0.5));
    aura.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, W, H);

    // Silhueta translúcida em duas camadas: um "eco" maior e muito desfocado e o corpo, fora de fase
    ctx.save();
    ctx.shadowColor = rgba(hex, 0.9);
    ctx.shadowBlur = 16;
    traceGhostCard(ctx, cx + 1.5, cy - 1, 1.32);
    ctx.fillStyle = 'rgba(230, 222, 255, 0.10)';
    ctx.fill();
    ctx.shadowBlur = 11;
    traceGhostCard(ctx, cx, cy, 1.18);
    const body = ctx.createLinearGradient(0, cy - 30, 0, cy + 32);
    body.addColorStop(0, 'rgba(248, 244, 255, 0.42)');
    body.addColorStop(0.55, 'rgba(215, 205, 255, 0.2)');
    body.addColorStop(1, 'rgba(215, 205, 255, 0)');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.stroke();
    ctx.restore();

    // Órbitas ocas, alongadas e caídas (sem boca: é um espectro, não um mascote)
    ctx.fillStyle = 'rgba(12, 3, 26, 0.9)';
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * 7, cy - 9, 3, 6.2, side * -0.28, 0, TAU);
        ctx.fill();
    }
    // Um fio de luz no fundo das órbitas
    ctx.fillStyle = rgba(hex, 0.8);
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + side * 7, cy - 7, 0.9, 0, TAU);
        ctx.fill();
    }
}

/** Moldura do Fantasma: prata envelhecida, cantos se desfazendo em fumaça (sprite desenhado ao vivo, tremendo). */
export function paintGhostFrame(ctx) {
    const inset = 6;
    const gap = 13;
    const frame = ctx.createLinearGradient(0, 0, W, H);
    frame.addColorStop(0, '#8e889c');
    frame.addColorStop(0.4, '#d9d4e6');
    frame.addColorStop(0.7, '#a39db3');
    frame.addColorStop(1, '#6f6980');
    ctx.strokeStyle = frame;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(inset + gap, inset);
    ctx.lineTo(W - inset - gap, inset);
    ctx.moveTo(W - inset, inset + gap);
    ctx.lineTo(W - inset, H - inset - gap);
    ctx.moveTo(W - inset - gap, H - inset);
    ctx.lineTo(inset + gap, H - inset);
    ctx.moveTo(inset, H - inset - gap);
    ctx.lineTo(inset, inset + gap);
    ctx.stroke();

    // Cantos em fumaça: volutas finas que se abrem e somem
    const corners = [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [W - inset, H - inset, -1, -1], [inset, H - inset, 1, -1]];
    for (const [x, y, sx, sy] of corners) {
        for (let k = 0; k < 3; k++) {
            ctx.globalAlpha = 0.55 - k * 0.15;
            ctx.lineWidth = 1.2 - k * 0.3;
            ctx.beginPath();
            ctx.moveTo(x + sx * (gap - 1), y + sy * k * 1.4);
            ctx.bezierCurveTo(x + sx * (gap - 6), y - sy * (2 + k * 2), x - sx * (1 + k), y + sy * (3 - k), x + sx * k * 1.4, y + sy * (gap - 1));
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
}

// --- Espelho Sombrio ---------------------------------------------------------------

/**
 * Espelho Sombrio: obsidiana polida, espelho oval escuro no centro (o "?" / o valor copiado são desenhados
 * ao vivo pelo renderer), veias de luz na cor da carta rachando a obsidiana e moldura dupla prata-negra
 * com runas gravadas. O laminado FOIL_MIRROR (reflexo girando, veias pulsando, runas) vai por cima.
 */
export function paintMirrorFace(ctx, color) {
    const hex = colorHex(color);
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0812');
    bg.addColorStop(0.45, '#1c1729');
    bg.addColorStop(0.55, '#0f0c18');
    bg.addColorStop(1, '#040308');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Polimento: faixa de brilho diagonal fixa
    const polish = ctx.createLinearGradient(0, 0, W, H);
    polish.addColorStop(0.2, 'rgba(255, 255, 255, 0)');
    polish.addColorStop(0.32, 'rgba(210, 200, 255, 0.07)');
    polish.addColorStop(0.44, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = polish;
    ctx.fillRect(0, 0, W, H);

    // Aura da cor da carta atrás do espelho (mesmo princípio do Fantasma: um halo grande e forte é o
    // jeito mais direto de identificar a cor, bem mais do que só as veias finas)
    const auraO = MIRROR_OVAL;
    const mirrorAura = ctx.createRadialGradient(auraO.x, auraO.y, 6, auraO.x, auraO.y, 52);
    mirrorAura.addColorStop(0, rgba(hex, 0.55));
    mirrorAura.addColorStop(0.55, rgba(hex, 0.22));
    mirrorAura.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = mirrorAura;
    ctx.fillRect(0, 0, W, H);

    // Veias na cor da carta (brilho largo + fio claro), agora mais grossas e opacas
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pts of MIRROR_VEINS) {
        traceVein(ctx, pts);
        ctx.strokeStyle = rgba(hex, 0.55);
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.strokeStyle = rgba(hex, 1);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // O espelho oval
    const o = MIRROR_OVAL;
    const glass = ctx.createRadialGradient(o.x - 8, o.y - 14, 3, o.x, o.y, o.ry * 1.1);
    glass.addColorStop(0, '#3b3450');
    glass.addColorStop(0.45, '#17131f');
    glass.addColorStop(1, '#05040a');
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, TAU);
    ctx.fillStyle = glass;
    ctx.fill();
    // Reflexo côncavo (arco claro no alto) e sombra em baixo
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(o.x - 6, o.y - o.ry * 0.55, o.rx * 0.7, o.ry * 0.25, -0.35, 0, TAU);
    ctx.fillStyle = 'rgba(220, 210, 255, 0.08)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(o.x, o.y + o.ry * 0.9, o.rx, o.ry * 0.4, 0, 0, TAU);
    ctx.fillStyle = rgba(hex, 0.28);
    ctx.fill();
    ctx.restore();
    // Aro duplo prata-negra
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2a2536';
    ctx.stroke();
    ctx.lineWidth = 1.3;
    const rim = ctx.createLinearGradient(o.x - o.rx, o.y - o.ry, o.x + o.rx, o.y + o.ry);
    rim.addColorStop(0, '#e8e3f5');
    rim.addColorStop(0.5, '#6d6780');
    rim.addColorStop(1, '#c9c3dd');
    ctx.strokeStyle = rim;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, o.rx + 3.5, o.ry + 3.5, 0, 0, TAU);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(201, 195, 221, 0.45)';
    ctx.stroke();

    // Moldura dupla prata-negra com runas gravadas
    const frame = ctx.createLinearGradient(0, 0, W, H);
    frame.addColorStop(0, '#d8d2ea');
    frame.addColorStop(0.3, '#4a4458');
    frame.addColorStop(0.6, '#bdb6d1');
    frame.addColorStop(1, '#2c2738');
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, R - 2);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(160, 150, 190, 0.55)';
    ctx.beginPath();
    ctx.roundRect(11, 11, W - 22, H - 22, R - 5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150, 140, 180, 0.7)';
    ctx.lineWidth = 0.7;
    for (const rune of RUNES) {
        traceRune(ctx, rune);
        ctx.stroke();
    }
    ctx.fillStyle = '#cfc8e3';
    diamond(ctx, W / 2, 4, 2.6);
    diamond(ctx, W / 2, H - 4, 2.6);
}

// --- Emboscada ---------------------------------------------------------------------

/**
 * Emboscada: preto-esverdeado com teia translúcida verde-tóxica, triângulo invertido envolto por arame
 * farpado e a órbita do olho (o olho que pisca é desenhado ao vivo, AMBUSH_EYE). Moldura fina verde-veneno
 * com garras nos cantos.
 */
export function paintAmbushFace(ctx) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 4, W / 2, H * 0.45, W);
    bg.addColorStop(0, '#12301a');
    bg.addColorStop(0.5, '#0a1a0a');
    bg.addColorStop(1, '#020602');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Teia no canto superior esquerdo e no inferior direito
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.13)';
    ctx.lineWidth = 0.6;
    for (const [ox, oy, dir] of [[0, 0, 1], [W, H, -1]]) {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
            const a = (k / 5) * (Math.PI / 2);
            ctx.moveTo(ox, oy);
            ctx.lineTo(ox + dir * Math.cos(a) * 58, oy + dir * Math.sin(a) * 58);
        }
        for (let ring = 1; ring <= 4; ring++) {
            const r = ring * 13;
            for (let k = 0; k <= 5; k++) {
                const a = (k / 5) * (Math.PI / 2);
                const x = ox + dir * Math.cos(a) * r;
                const y = oy + dir * Math.sin(a) * r;
                if (k === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }

    const cx = W / 2;
    const cy = H * 0.47;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 40);
    glow.addColorStop(0, 'rgba(57, 255, 20, 0.22)');
    glow.addColorStop(1, 'rgba(57, 255, 20, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Arame farpado circular
    ctx.strokeStyle = 'rgba(120, 255, 90, 0.75)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, 33, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 18; k++) {
        const a = (k / 18) * TAU;
        const x = cx + Math.cos(a) * 33;
        const y = cy + Math.sin(a) * 33;
        ctx.moveTo(x - 2.4, y - 2.4);
        ctx.lineTo(x + 2.4, y + 2.4);
        ctx.moveTo(x + 2.4, y - 2.4);
        ctx.lineTo(x - 2.4, y + 2.4);
    }
    ctx.stroke();

    // Triângulo invertido (ponta pra baixo)
    ctx.save();
    ctx.shadowColor = 'rgba(57, 255, 20, 0.9)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy - 16);
    ctx.lineTo(cx + 24, cy - 16);
    ctx.lineTo(cx, cy + 25);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 40, 12, 0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#39ff14';
    ctx.stroke();
    ctx.restore();

    // Órbita do olho (o olho em si é animado)
    const e = AMBUSH_EYE;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, e.w + 1.5, e.h + 1.5, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fill();

    // Moldura verde-veneno fina com garras nos cantos
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(6, 6, W - 12, H - 12, R - 3);
    ctx.stroke();
    ctx.fillStyle = '#39ff14';
    const corners = [[6, 6, 1, 1], [W - 6, 6, -1, 1], [W - 6, H - 6, -1, -1], [6, H - 6, 1, -1]];
    for (const [x, y, sx, sy] of corners) {
        for (let k = 0; k < 3; k++) {
            const bx = x + sx * (3 + k * 5);
            const by = y + sy * (3 + (2 - k) * 5);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx + sx * 2, by - sy * 1, bx + sx * 6, by + sy * 5);
            ctx.lineTo(bx + sx * 1.2, by + sy * 1.8);
            ctx.closePath();
            ctx.fill();
        }
    }
}

// --- Maldição ----------------------------------------------------------------------

/** Pentagrama invertido (ponta pra baixo) inscrito no raio r: sequência dos 5 vértices em salto de 2. */
function pentagramPoints(cx, cy, r) {
    const pts = [];
    for (let k = 0; k < 5; k++) {
        const a = Math.PI / 2 + (k * 2 * TAU) / 5;
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return pts;
}

/**
 * Maldição: preto-púrpura com crânios e correntes flutuando no fundo, caveira com órbitas escuras (o fogo
 * roxo dos olhos é ao vivo) dentro de um pentagrama invertido de correntes, moldura dupla roxa e prata
 * envelhecida com inscrições arcanas. FOIL_CURSE (névoa, relâmpagos roxos, crânios girando) vai por cima.
 */
export function paintCurseFace(ctx) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const bg = ctx.createRadialGradient(W / 2, H * 0.47, 5, W / 2, H * 0.47, W * 0.95);
    bg.addColorStop(0, '#2a0845');
    bg.addColorStop(0.5, '#0d0015');
    bg.addColorStop(1, '#030006');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Correntes diagonais apagadas no fundo
    ctx.strokeStyle = 'rgba(170, 110, 230, 0.12)';
    ctx.lineWidth = 1;
    for (let c = 0; c < 2; c++) {
        const y0 = c === 0 ? 18 : H - 30;
        for (let k = 0; k < 11; k++) {
            ctx.beginPath();
            ctx.ellipse(6 + k * 9, y0 + k * 1.2, 4.6, k % 2 === 0 ? 2.4 : 0.8, 0.13, 0, TAU);
            ctx.stroke();
        }
    }

    const cx = CURSE_SKULL.x;
    const cy = CURSE_SKULL.y;
    const aura = ctx.createRadialGradient(cx, cy, 3, cx, cy, 44);
    aura.addColorStop(0, 'rgba(160, 32, 240, 0.5)');
    aura.addColorStop(0.5, 'rgba(160, 32, 240, 0.14)');
    aura.addColorStop(1, 'rgba(160, 32, 240, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, W, H);

    // Pentagrama de correntes: elos ao longo das 5 arestas
    const star = pentagramPoints(cx, cy + 1, 37);
    ctx.lineWidth = 1.1;
    for (let k = 0; k < 5; k++) {
        const x0 = star[k * 2];
        const y0 = star[k * 2 + 1];
        const x1 = star[((k + 1) % 5) * 2];
        const y1 = star[((k + 1) % 5) * 2 + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const n = Math.floor(len / 5.2);
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            ctx.beginPath();
            ctx.ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 3.1, i % 2 === 0 ? 1.6 : 0.5, ang, 0, TAU);
            ctx.strokeStyle = i % 2 === 0 ? 'rgba(200, 190, 215, 0.8)' : 'rgba(160, 150, 175, 0.7)';
            ctx.stroke();
        }
    }
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 39.5, 0, TAU);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = 'rgba(164, 92, 255, 0.55)';
    ctx.stroke();

    // A caveira
    ctx.save();
    ctx.shadowColor = 'rgba(160, 32, 240, 0.85)';
    ctx.shadowBlur = 9;
    traceSkull(ctx, cx, cy, 1);
    const bone = ctx.createLinearGradient(0, cy - 19, 0, cy + 16);
    bone.addColorStop(0, '#f1eaf7');
    bone.addColorStop(0.6, '#cbbbd9');
    bone.addColorStop(1, '#8c78a3');
    ctx.fillStyle = bone;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(60, 20, 90, 0.7)';
    traceSkull(ctx, cx, cy, 1);
    ctx.stroke();
    skullDetails(ctx, cx, cy, 1, '#14001f', 'rgba(40, 10, 60, 0.85)');
    // Rachadura no crânio
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 19);
    ctx.lineTo(cx + 1, cy - 14);
    ctx.lineTo(cx + 4, cy - 11);
    ctx.lineTo(cx + 2, cy - 7);
    ctx.strokeStyle = 'rgba(60, 20, 90, 0.8)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Moldura dupla: roxa por fora, prata envelhecida por dentro, inscrições arcanas entre as duas
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#5a1a8f';
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, R - 2);
    ctx.stroke();
    const silver = ctx.createLinearGradient(0, 0, W, H);
    silver.addColorStop(0, '#b6aec4');
    silver.addColorStop(0.5, '#6e6680');
    silver.addColorStop(1, '#a79fb8');
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = silver;
    ctx.beginPath();
    ctx.roundRect(11, 11, W - 22, H - 22, R - 5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(164, 92, 255, 0.5)';
    ctx.lineWidth = 0.7;
    for (const rune of RUNES) {
        traceRune(ctx, rune);
        ctx.stroke();
    }
    ctx.fillStyle = '#a45cff';
    diamond(ctx, W / 2, 4, 2.6);
    diamond(ctx, W / 2, H - 4, 2.6);
}
