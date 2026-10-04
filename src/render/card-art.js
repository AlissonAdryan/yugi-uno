import { CONFIG } from '../config/constants.js';
import { paintAmbushFace, paintCurseFace, paintGhostFace, paintMirrorFace } from './card-art-arcane.js';
import { paintRonovaFace } from './death-art.js';

const { CARD_TYPES, CARD_DIMENSIONS } = CONFIG;
const TAU = Math.PI * 2;
const W = CARD_DIMENSIONS.WIDTH;
const H = CARD_DIMENSIONS.HEIGHT;
const R = CARD_DIMENSIONS.RADIUS;
// Resolução máxima do cache de face pintada (px de device por unidade virtual): a carta gigante do
// Reviver chega a ~2.3x de escala em tela de alta densidade; acima disso não há ganho visível.
const MAX_CACHE_SCALE = 6;
const MIN_CACHE_SCALE = 2;

/**
 * Ícones vetoriais das cartas (100% procedurais: nítidos em qualquer escala, sem arquivo de imagem)
 * e faces "pintadas" — cartas ricas em gradientes que são desenhadas uma única vez num canvas de cache
 * e depois só coladas (drawImage) a cada frame, sem alocar gradiente nenhum no loop (Pilar 1).
 */

/** Cruz de cura em contorno (o "+" clássico de cantos arredondados), branca sobre o fundo preto. */
export function drawHealIcon(ctx, cx, cy, size) {
    const e = size;
    const a = size * 0.36;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(-a, -e); ctx.lineTo(a, -e); ctx.lineTo(a, -a); ctx.lineTo(e, -a);
    ctx.lineTo(e, a); ctx.lineTo(a, a); ctx.lineTo(a, e); ctx.lineTo(-a, e);
    ctx.lineTo(-a, a); ctx.lineTo(-e, a); ctx.lineTo(-e, -a); ctx.lineTo(-a, -a);
    ctx.closePath();
    ctx.fillStyle = 'rgba(46, 204, 113, 0.22)';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
}

/** Contorno de escudo "heater": topo em bico suave, laterais retas curvando até a ponta de baixo. */
function shieldPath(ctx, k, offsetY) {
    ctx.beginPath();
    ctx.moveTo(-0.5 * k, -0.36 * k + offsetY);
    ctx.lineTo(0, -0.5 * k + offsetY);
    ctx.lineTo(0.5 * k, -0.36 * k + offsetY);
    ctx.bezierCurveTo(0.5 * k, 0.12 * k + offsetY, 0.34 * k, 0.42 * k + offsetY, 0, 0.58 * k + offsetY);
    ctx.bezierCurveTo(-0.34 * k, 0.42 * k + offsetY, -0.5 * k, 0.12 * k + offsetY, -0.5 * k, -0.36 * k + offsetY);
    ctx.closePath();
}

/**
 * Escudo todo branco: contorno grosso por fora e, por dentro, só a metade direita preenchida
 * (a esquerda fica vazada), separadas por um vão no meio — o mesmo desenho do ícone de referência.
 * @param {number} size largura total do escudo
 */
export function drawShieldIcon(ctx, cx, cy, size) {
    const k = size;
    ctx.save();
    ctx.translate(cx, cy - 0.04 * k);
    shieldPath(ctx, k, 0);
    ctx.lineJoin = 'round';
    ctx.lineWidth = k * 0.09;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(k * 0.035, -k, k, 2 * k);
    ctx.clip();
    shieldPath(ctx, k * 0.72, k * 0.03);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
}

/** Pena/folha entre (x0,y0) e (x1,y1); `width` é o bojo (assimétrico, pra parecer pena de asa). */
function featherPath(ctx, x0, y0, x1, y1, width) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx + nx * width, my + ny * width, x1, y1);
    ctx.quadraticCurveTo(mx - nx * width * 0.55, my - ny * width * 0.55, x0, y0);
    ctx.closePath();
}

function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.42);
    ctx.bezierCurveTo(x - s * 0.62, y + s * 0.02, x - s * 0.42, y - s * 0.52, x, y - s * 0.18);
    ctx.bezierCurveTo(x + s * 0.42, y - s * 0.52, x + s * 0.62, y + s * 0.02, x, y + s * 0.42);
    ctx.closePath();
}

/** Emblema do Reviver: coração dourado alado sob uma auréola. `s` ~ meia-largura das asas. */
function drawReviveEmblem(ctx, cx, cy, s) {
    const gold = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    gold.addColorStop(0, '#fff7c9');
    gold.addColorStop(0.35, '#f7d154');
    gold.addColorStop(0.7, '#d9a21b');
    gold.addColorStop(1, '#a8740c');
    const outline = '#8a5d07';

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Asas (penas de baixo pra cima, a de cima por último pra sobrepor)
    const rootY = cy - s * 0.04;
    for (let side = -1; side <= 1; side += 2) {
        const rootX = cx + side * s * 0.24;
        const feathers = [
            [cx + side * s * 0.74, cy + s * 0.14, s * 0.1],
            [cx + side * s * 0.93, cy - s * 0.17, s * 0.12],
            [cx + side * s * 0.99, cy - s * 0.5, s * 0.13]
        ];
        for (let i = 0; i < feathers.length; i++) {
            const [fx, fy, fw] = feathers[i];
            featherPath(ctx, rootX, rootY, fx, fy, fw * -side);
            ctx.fillStyle = gold;
            ctx.fill();
            ctx.lineWidth = s * 0.035;
            ctx.strokeStyle = outline;
            ctx.stroke();
            // Haste da pena (clarinha)
            ctx.beginPath();
            ctx.moveTo(rootX, rootY);
            ctx.lineTo(rootX + (fx - rootX) * 0.8, rootY + (fy - rootY) * 0.8);
            ctx.lineWidth = s * 0.018;
            ctx.strokeStyle = 'rgba(255, 248, 210, 0.85)';
            ctx.stroke();
        }
    }

    // Coração com brilho
    const hs = s * 0.8;
    const hy = cy + s * 0.06;
    ctx.shadowColor = 'rgba(255, 196, 40, 0.9)';
    ctx.shadowBlur = s * 0.35;
    heartPath(ctx, cx, hy, hs);
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = s * 0.045;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx - hs * 0.2, hy - hs * 0.2, hs * 0.1, hs * 0.06, -0.6, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fill();

    // Auréola
    const haloY = cy - s * 0.62;
    ctx.beginPath();
    ctx.ellipse(cx, haloY, s * 0.34, s * 0.095, 0, 0, TAU);
    ctx.shadowColor = 'rgba(255, 215, 0, 1)';
    ctx.shadowBlur = s * 0.3;
    ctx.lineWidth = s * 0.075;
    ctx.strokeStyle = '#f5c542';
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = s * 0.025;
    ctx.strokeStyle = '#fff6c8';
    ctx.stroke();
    ctx.restore();
}

function drawDiamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.7, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.7, y);
    ctx.closePath();
    ctx.fill();
}

/** Face estática do Reviver em coordenadas de carta (100x150): branco perolado, moldura e emblema dourados. */
function paintReviveFace(ctx) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.5, '#fdf8ea');
    bg.addColorStop(1, '#f1dfae');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Raios de sol bem sutis atrás do emblema
    const cx = W / 2;
    const cy = H * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(212, 175, 55, 0.13)';
    const rays = 18;
    for (let i = 0; i < rays; i++) {
        ctx.rotate(TAU / rays);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-3, -H);
        ctx.lineTo(3, -H);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, W * 0.6);
    glow.addColorStop(0, 'rgba(255, 236, 160, 0.8)');
    glow.addColorStop(0.5, 'rgba(255, 236, 160, 0.25)');
    glow.addColorStop(1, 'rgba(255, 236, 160, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Moldura dourada dupla
    const frame = ctx.createLinearGradient(0, 0, W, H);
    frame.addColorStop(0, '#b8860b');
    frame.addColorStop(0.25, '#ffe680');
    frame.addColorStop(0.5, '#c9971c');
    frame.addColorStop(0.75, '#fff2a8');
    frame.addColorStop(1, '#a87b12');
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = frame;
    ctx.beginPath();
    ctx.roundRect(5, 5, W - 10, H - 10, R - 3);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(201, 151, 28, 0.85)';
    ctx.beginPath();
    ctx.roundRect(9, 9, W - 18, H - 18, R - 5);
    ctx.stroke();

    // Ornamentos nos cantos e no meio das laterais
    ctx.fillStyle = '#d4a52a';
    drawDiamond(ctx, 13, 13, 3.2);
    drawDiamond(ctx, W - 13, 13, 3.2);
    drawDiamond(ctx, 13, H - 13, 3.2);
    drawDiamond(ctx, W - 13, H - 13, 3.2);
    drawDiamond(ctx, W / 2, 9, 2.4);
    drawDiamond(ctx, W / 2, H - 9, 2.4);

    drawReviveEmblem(ctx, cx, cy + 4, 40);
}

/** Face estática do Pintar: fundo preto profundo com paleta de pintura em néon e aura misteriosa. */
function paintPaintFace(ctx) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    // Fundo preto com gradiente sutil de profundidade
    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 5, W / 2, H * 0.45, W * 0.8);
    bg.addColorStop(0, '#1a1a2e');
    bg.addColorStop(0.5, '#111122');
    bg.addColorStop(1, '#050510');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Aura mística atrás da paleta
    const aura = ctx.createRadialGradient(W / 2, H * 0.48, 2, W / 2, H * 0.48, W * 0.55);
    aura.addColorStop(0, 'rgba(123, 104, 238, 0.35)');
    aura.addColorStop(0.5, 'rgba(123, 104, 238, 0.1)');
    aura.addColorStop(1, 'rgba(123, 104, 238, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H * 0.48;

    // Paleta (forma oval inclinada)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.15);
    ctx.beginPath();
    ctx.ellipse(0, 0, 32, 25, 0, 0, TAU);
    const palGrad = ctx.createLinearGradient(-32, -25, 32, 25);
    palGrad.addColorStop(0, '#2a2a3a');
    palGrad.addColorStop(0.5, '#1e1e2e');
    palGrad.addColorStop(1, '#151520');
    ctx.fillStyle = palGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#7b68ee';
    ctx.stroke();

    // Buraco da paleta (polegar)
    ctx.beginPath();
    ctx.ellipse(-14, 8, 5, 4, 0.3, 0, TAU);
    ctx.fillStyle = '#050510';
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = '#5b4eae';
    ctx.stroke();

    // Gotas de tinta (4 cores do jogo)
    const droplets = [
        { x: 8, y: -14, color: '#e74c3c' },
        { x: 20, y: -6, color: '#3498db' },
        { x: 16, y: 8, color: '#2ecc71' },
        { x: -2, y: -6, color: '#ffcc00' }
    ];
    for (const d of droplets) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 4.5, 0, TAU);
        const dGrad = ctx.createRadialGradient(d.x - 1, d.y - 1, 0.5, d.x, d.y, 4.5);
        dGrad.addColorStop(0, '#ffffff');
        dGrad.addColorStop(0.3, d.color);
        dGrad.addColorStop(1, d.color);
        ctx.fillStyle = dGrad;
        ctx.fill();
        ctx.shadowColor = d.color;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Pincel sobre a paleta (diagonal)
    ctx.save();
    ctx.translate(cx + 18, cy - 22);
    ctx.rotate(0.7);
    // Cabo
    const handleGrad = ctx.createLinearGradient(0, -28, 0, -4);
    handleGrad.addColorStop(0, '#c9a857');
    handleGrad.addColorStop(0.5, '#a8860b');
    handleGrad.addColorStop(1, '#7a6109');
    ctx.fillStyle = handleGrad;
    ctx.beginPath();
    ctx.roundRect(-2.5, -28, 5, 24, 1.5);
    ctx.fill();
    // Ferrule (faixa metálica)
    ctx.fillStyle = '#b0b0b0';
    ctx.fillRect(-3, -5, 6, 5);
    // Cerdas
    const bristleGrad = ctx.createLinearGradient(0, 0, 0, 12);
    bristleGrad.addColorStop(0, '#ddd');
    bristleGrad.addColorStop(0.6, '#9b59b6');
    bristleGrad.addColorStop(1, '#7b68ee');
    ctx.fillStyle = bristleGrad;
    ctx.beginPath();
    ctx.moveTo(-3.5, 0);
    ctx.lineTo(-2, 12);
    ctx.quadraticCurveTo(0, 14, 2, 12);
    ctx.lineTo(3.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Moldura dupla
    const frame = ctx.createLinearGradient(0, 0, W, H);
    frame.addColorStop(0, '#5b4eae');
    frame.addColorStop(0.4, '#9b84ff');
    frame.addColorStop(0.6, '#7b68ee');
    frame.addColorStop(1, '#4a3d8f');
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = frame;
    ctx.beginPath();
    ctx.roundRect(5, 5, W - 10, H - 10, R - 3);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(155, 132, 255, 0.5)';
    ctx.beginPath();
    ctx.roundRect(9, 9, W - 18, H - 18, R - 5);
    ctx.stroke();

    // Ornamentos nos cantos
    ctx.fillStyle = '#7b68ee';
    drawDiamond(ctx, 13, 13, 3.2);
    drawDiamond(ctx, W - 13, 13, 3.2);
    drawDiamond(ctx, 13, H - 13, 3.2);
    drawDiamond(ctx, W - 13, H - 13, 3.2);
    drawDiamond(ctx, W / 2, 9, 2.4);
    drawDiamond(ctx, W / 2, H - 9, 2.4);
}

/** Silhueta de carta (retângulo arredondado) centrada em (cx, cy). */
function miniCardPath(ctx, cx, cy, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r);
}

/** Arco com ponta de seta no fim (ângulos em rad, sentido horário). */
function arcArrow(ctx, cx, cy, r, from, to, head) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, from, to);
    ctx.stroke();
    const tx = cx + Math.cos(to) * r;
    const ty = cy + Math.sin(to) * r;
    // Tangente no fim do arco (sentido horário): perpendicular ao raio
    const ang = to + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(ang) * head, ty + Math.sin(ang) * head);
    ctx.lineTo(tx + Math.cos(ang - 2.5) * head, ty + Math.sin(ang - 2.5) * head);
    ctx.lineTo(tx + Math.cos(ang + 2.5) * head, ty + Math.sin(ang + 2.5) * head);
    ctx.closePath();
    ctx.fill();
}

/**
 * Face da Troca de Guarda: preto profundo, uma carta em pé (Ataque) e uma deitada (Defesa) cruzadas,
 * envoltas por duas setas girando. A moldura é o diferencial: aço-ciano com cantos chanfrados e
 * setinhas ⇅ no meio das laterais (sem laminado, de propósito).
 */
function paintGuardSwapFace(ctx) {
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const cx = W / 2;
    const cy = H * 0.49;
    const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, W * 0.85);
    bg.addColorStop(0, '#141b26');
    bg.addColorStop(0.55, '#0a0e15');
    bg.addColorStop(1, '#030407');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const aura = ctx.createRadialGradient(cx, cy, 2, cx, cy, 42);
    aura.addColorStop(0, 'rgba(127, 219, 255, 0.28)');
    aura.addColorStop(1, 'rgba(127, 219, 255, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, W, H);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Carta deitada (Defesa) atrás, em ciano
    miniCardPath(ctx, cx + 5, cy + 7, 30, 20, 3);
    ctx.fillStyle = 'rgba(127, 219, 255, 0.16)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7fdbff';
    ctx.stroke();

    // Carta em pé (Ataque) na frente, em branco
    miniCardPath(ctx, cx - 5, cy - 5, 20, 30, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // Espadinha (Ataque): lâmina com ponta, guarda e punho; escudinho (Defesa) na carta deitada
    const sx = cx - 5;
    ctx.beginPath();
    ctx.moveTo(sx, cy - 16);
    ctx.lineTo(sx + 2, cy - 12.5);
    ctx.lineTo(sx + 2, cy + 1);
    ctx.lineTo(sx - 2, cy + 1);
    ctx.lineTo(sx - 2, cy - 12.5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillRect(sx - 5, cy + 1.5, 10, 1.8);
    ctx.fillRect(sx - 0.9, cy + 3.3, 1.8, 4.2);
    ctx.beginPath();
    ctx.arc(sx, cy + 8.6, 1.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 14, cy + 3);
    ctx.lineTo(cx + 18, cy + 4.5);
    ctx.lineTo(cx + 17.5, cy + 9);
    ctx.lineTo(cx + 14, cy + 12);
    ctx.lineTo(cx + 10.5, cy + 9);
    ctx.lineTo(cx + 10, cy + 4.5);
    ctx.closePath();
    ctx.strokeStyle = '#7fdbff';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Duas setas girando em volta (o "giro" da troca)
    const arrow = ctx.createLinearGradient(cx - 34, cy - 34, cx + 34, cy + 34);
    arrow.addColorStop(0, '#ffffff');
    arrow.addColorStop(1, '#7fdbff');
    ctx.strokeStyle = arrow;
    ctx.fillStyle = arrow;
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(127, 219, 255, 0.9)';
    ctx.shadowBlur = 6;
    arcArrow(ctx, cx, cy, 33, Math.PI * 1.08, Math.PI * 1.82, 6);
    arcArrow(ctx, cx, cy, 33, Math.PI * 0.08, Math.PI * 0.82, 6);
    ctx.shadowBlur = 0;

    // Moldura de aço-ciano com cantos chanfrados (octógono) — o toque "levemente diferente"
    const frame = ctx.createLinearGradient(0, 0, W, H);
    frame.addColorStop(0, '#5e7c8f');
    frame.addColorStop(0.35, '#c9f1ff');
    frame.addColorStop(0.55, '#7fdbff');
    frame.addColorStop(1, '#3f5a6b');
    const inset = 6;
    const cut = 9;
    ctx.beginPath();
    ctx.moveTo(inset + cut, inset);
    ctx.lineTo(W - inset - cut, inset);
    ctx.lineTo(W - inset, inset + cut);
    ctx.lineTo(W - inset, H - inset - cut);
    ctx.lineTo(W - inset - cut, H - inset);
    ctx.lineTo(inset + cut, H - inset);
    ctx.lineTo(inset, H - inset - cut);
    ctx.lineTo(inset, inset + cut);
    ctx.closePath();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = frame;
    ctx.stroke();

    // Setinhas ⇅ no meio das laterais
    ctx.fillStyle = '#9fe6ff';
    for (let side = 0; side < 2; side++) {
        const x = side === 0 ? inset : W - inset;
        const y = H / 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x - 3.2, y - 4);
        ctx.lineTo(x + 3.2, y - 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y + 9);
        ctx.lineTo(x - 3.2, y + 4);
        ctx.lineTo(x + 3.2, y + 4);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = 'rgba(159, 230, 255, 0.8)';
    drawDiamond(ctx, W / 2, inset, 2.4);
    drawDiamond(ctx, W / 2, H - inset, 2.4);
}

/** Canal de uma cor #rrggbb multiplicado (clareia > 1, escurece < 1), como string rgb(). Só em cache. */
function shade(hex, factor) {
    const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * factor));
    const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * factor));
    const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * factor));
    return `rgb(${r}, ${g}, ${b})`;
}

// Raio clássico (polígono) em coordenadas locais; a ponta de baixo é o "golpe"
const BOLT_SHAPE = Object.freeze([
    [5, -37], [-16, 3], [-3, 3], [-10, 37], [17, -9], [4, -9], [13, -37]
]);

function boltShapePath(ctx, cx, cy, k) {
    ctx.beginPath();
    for (let i = 0; i < BOLT_SHAPE.length; i++) {
        const x = cx + BOLT_SHAPE[i][0] * k;
        const y = cy + BOLT_SHAPE[i][1] * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

/**
 * Face do Relâmpago na cor da carta: fundo da cor com vinheta de tempestade, anel de energia carregado
 * e o raio branco-incandescente no centro, moldura dupla elétrica. O laminado animado (FOIL_STORM) vai
 * por cima, desenhado ao vivo.
 */
function paintLightningFace(ctx, color) {
    const hex = CONFIG.COLOR_HEX[color] || '#2c3e50';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, R);
    ctx.clip();

    const cx = W / 2;
    const cy = H * 0.48;
    const bg = ctx.createRadialGradient(cx, cy, 6, cx, cy, W * 0.95);
    bg.addColorStop(0, shade(hex, 1.25));
    bg.addColorStop(0.45, hex);
    bg.addColorStop(1, shade(hex, 0.32));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Nuvens de tempestade escurecendo o topo e a base
    ctx.fillStyle = 'rgba(8, 10, 22, 0.28)';
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(8 + i * 22, 10 + (i % 2) * 6, 22, 12, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(W - 8 - i * 22, H - 9 - (i % 2) * 5, 22, 11, 0, 0, TAU);
        ctx.fill();
    }

    // Anel de energia carregado
    const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, 40);
    halo.addColorStop(0, 'rgba(255, 255, 240, 0.75)');
    halo.addColorStop(0.45, 'rgba(190, 240, 255, 0.28)');
    halo.addColorStop(1, 'rgba(190, 240, 255, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(cx, cy, 31, 0, TAU);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.setLineDash([9, 4, 2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, 35.5, 0, TAU);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(200, 245, 255, 0.55)';
    ctx.stroke();

    // Raio: contorno escuro (contraste até na carta amarela) + corpo incandescente com brilho
    boltShapePath(ctx, cx, cy, 0.95);
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(10, 12, 30, 0.55)';
    ctx.stroke();
    const body = ctx.createLinearGradient(cx - 16, cy - 36, cx + 16, cy + 36);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.55, '#fff9c4');
    body.addColorStop(1, '#ffe36e');
    ctx.fillStyle = body;
    ctx.shadowColor = 'rgba(210, 245, 255, 1)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Filete de luz no miolo
    ctx.beginPath();
    ctx.moveTo(cx + 9 * 0.95, cy - 33 * 0.95);
    ctx.lineTo(cx - 8 * 0.95, cy + 1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Faíscas fixas em volta do anel
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.4;
        drawDiamond(ctx, cx + Math.cos(a) * 42, cy + Math.sin(a) * 42, 2.2);
    }

    // Moldura dupla elétrica: branco perolado por fora, ciano por dentro, zigue-zague no topo e na base
    const frame = ctx.createLinearGradient(0, 0, W, H);
    frame.addColorStop(0, '#fffbe0');
    frame.addColorStop(0.5, '#bff4ff');
    frame.addColorStop(1, '#fff3a8');
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = frame;
    ctx.beginPath();
    ctx.roundRect(5, 5, W - 10, H - 10, R - 3);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(191, 244, 255, 0.7)';
    ctx.beginPath();
    ctx.roundRect(9, 9, W - 18, H - 18, R - 5);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#fffbe0';
    for (let edge = 0; edge < 2; edge++) {
        const y = edge === 0 ? 5 : H - 5;
        const dir = edge === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx - 12, y);
        ctx.lineTo(cx - 4, y + dir * 4);
        ctx.lineTo(cx, y);
        ctx.lineTo(cx + 4, y + dir * 4);
        ctx.lineTo(cx + 12, y);
        ctx.stroke();
    }
    ctx.fillStyle = '#fffbe0';
    drawDiamond(ctx, 13, 13, 3);
    drawDiamond(ctx, W - 13, 13, 3);
    drawDiamond(ctx, 13, H - 13, 3);
    drawDiamond(ctx, W - 13, H - 13, 3);
}

// Pintores por tipo. Os de cartas com cor (CARD_VISUALS[tipo].colored) recebem a cor como 2º argumento
const PAINTERS = Object.freeze({
    [CARD_TYPES.REVIVE]: paintReviveFace,
    [CARD_TYPES.PAINT]: paintPaintFace,
    [CARD_TYPES.GUARD_SWAP]: paintGuardSwapFace,
    [CARD_TYPES.LIGHTNING]: paintLightningFace,
    [CARD_TYPES.GHOST]: paintGhostFace,
    [CARD_TYPES.MIRROR]: paintMirrorFace,
    [CARD_TYPES.AMBUSH]: paintAmbushFace,
    [CARD_TYPES.CURSE]: paintCurseFace,
    [CARD_TYPES.DEATH]: paintRonovaFace
});

/**
 * Cache de faces pintadas por tipo. A resolução do cache acompanha a maior escala já pedida
 * (a carta na mão pede ~2x; a carta gigante no centro pede até ~6x) e só é refeita quando precisa crescer.
 */
export class CardArt {
    constructor() {
        /** @type {Map<number, { canvas: HTMLCanvasElement, scale: number }>} */
        this.cache = new Map();
    }

    hasPainter(type) {
        return PAINTERS[type] !== undefined;
    }

    /**
     * @param {number} type CARD_TYPES.*
     * @param {number} neededScale px de device por unidade virtual onde a carta vai aparecer
     * @param {number} [color] cor da carta (só muda algo nos tipos com cor; cada cor tem seu cache)
     * @returns {HTMLCanvasElement|null}
     */
    paintedFace(type, neededScale, color = 0) {
        const painter = PAINTERS[type];
        if (!painter) return null;
        const scale = Math.min(MAX_CACHE_SCALE, Math.max(MIN_CACHE_SCALE, Math.ceil(neededScale)));
        const key = type * 16 + (color & 15);
        const cached = this.cache.get(key);
        if (cached && cached.scale >= scale) return cached.canvas;

        const canvas = cached ? cached.canvas : document.createElement('canvas');
        canvas.width = Math.ceil(W * scale);
        canvas.height = Math.ceil(H * scale);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        painter(ctx, color);
        ctx.restore();
        this.cache.set(key, { canvas, scale });
        console.log(`[CardArt] Face do tipo ${type} (cor ${color}) pintada em cache (${scale}x).`);
        return canvas;
    }
}
