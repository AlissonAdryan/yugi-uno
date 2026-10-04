import { ARCANE_PRESETS } from './card-effects-arcane.js';
import { DEATH_FOIL } from './death-art.js';
import { GRAPHICS } from '../config/graphics.js';

const TAU = Math.PI * 2;

/**
 * Efeitos visuais animados sobrepostos à face de uma carta (laminado, holográfico, ...).
 *
 * Como adicionar um efeito novo:
 *   1. Crie um preset em FX_PRESETS (faixas de brilho + faíscas) ou um `draw` próprio.
 *   2. Aponte `fx: 'NOME'` em CONFIG.CARD_VISUALS para o tipo de carta que deve usá-lo.
 * Nada mais no renderer precisa mudar.
 *
 * Desempenho (Pilar 1/2): todo gradiente é rasterizado UMA vez em sprites pequenos na compilação do
 * preset; por frame, cada carta só faz alguns drawImage + caminhos curtos — zero alocação no loop.
 */

/**
 * @typedef {Object} FoilBand
 * @property {Array<[number, string]>} stops  gradiente horizontal da faixa (0..1)
 * @property {number} width      largura da faixa, fração da diagonal da carta
 * @property {number} period     segundos de um ciclo completo (varredura + pausa)
 * @property {number} sweep      fração do ciclo em que a faixa atravessa a carta (resto = pausa)
 * @property {number} alpha
 * @property {GlobalCompositeOperation} composite
 * @property {number} [offset]   defasagem 0..1 dentro do ciclo
 *
 * @typedef {Object} FoilPreset
 * @property {number} angle      inclinação das faixas (rad)
 * @property {FoilBand[]} bands
 * @property {{ count: number, color: string, core?: string, minSize: number, maxSize: number,
 *              minRate: number, maxRate: number }} [sparkles]
 */

/** @type {Record<string, FoilPreset>} */
const FX_PRESETS = {
    // Carta branca com laminado dourado: um véu dourado varre a carta e um reflexo estreito acende as partes em ouro
    FOIL_GOLD: {
        angle: -0.5,
        bands: [
            {
                stops: [[0, 'rgba(255,196,60,0)'], [0.5, 'rgba(255,196,60,0.34)'], [1, 'rgba(255,196,60,0)']],
                width: 0.7, period: 2.8, sweep: 0.75, alpha: 1, composite: 'source-over', offset: 0.35
            },
            {
                stops: [
                    [0, 'rgba(255,215,90,0)'], [0.35, 'rgba(255,215,110,0.45)'], [0.5, 'rgba(255,255,235,0.95)'],
                    [0.65, 'rgba(255,205,80,0.45)'], [1, 'rgba(255,215,90,0)']
                ],
                width: 0.26, period: 1.8, sweep: 0.5, alpha: 0.9, composite: 'lighter'
            }
        ],
        sparkles: {
            count: 9, color: '#f2b91d', core: '#fffbe6', minSize: 2.2, maxSize: 4.6, minRate: 3.2, maxRate: 6.4
        }
    },
    // Holográfico arco-íris (pronto para cartas futuras de fundo escuro)
    FOIL_HOLO: {
        angle: 0.6,
        bands: [
            {
                stops: [
                    [0, 'rgba(255,0,128,0)'], [0.2, 'rgba(255,60,160,0.25)'], [0.4, 'rgba(80,160,255,0.28)'],
                    [0.6, 'rgba(60,255,180,0.28)'], [0.8, 'rgba(255,230,80,0.25)'], [1, 'rgba(255,230,80,0)']
                ],
                width: 0.9, period: 5, sweep: 0.8, alpha: 1, composite: 'lighter'
            },
            {
                stops: [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']],
                width: 0.18, period: 2.8, sweep: 0.45, alpha: 0.8, composite: 'lighter', offset: 0.2
            }
        ],
        sparkles: { count: 7, color: '#ffffff', minSize: 1.8, maxSize: 3.6, minRate: 2, maxRate: 3.6 }
    },
    // Tempestade (Relâmpago): véu elétrico ciano-violeta rápido + reflexo branco, faíscas azuladas e,
    // por cima, raios vivos que caem das bordas no anel central e fazem a carta inteira piscar
    FOIL_STORM: {
        angle: -0.9,
        bands: [
            {
                stops: [
                    [0, 'rgba(90,120,255,0)'], [0.3, 'rgba(120,90,255,0.22)'], [0.5, 'rgba(120,235,255,0.42)'],
                    [0.7, 'rgba(120,90,255,0.22)'], [1, 'rgba(90,120,255,0)']
                ],
                width: 0.55, period: 2.1, sweep: 0.55, alpha: 1, composite: 'lighter'
            },
            {
                stops: [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(235,252,255,0.85)'], [1, 'rgba(255,255,255,0)']],
                width: 0.12, period: 1.5, sweep: 0.4, alpha: 0.85, composite: 'lighter', offset: 0.45
            }
        ],
        sparkles: {
            count: 8, color: '#8ff0ff', core: '#ffffff', minSize: 1.6, maxSize: 3.4, minRate: 4.5, maxRate: 8.5
        },
        extra: drawStormArcs
    },
    // Fantasma, Emboscada, Espelho Sombrio e Maldição (card-effects-arcane.js)
    ...ARCANE_PRESETS,
    // Ronova (lendária): Eclipse Carmesim — véu escuro, reflexo-navalha e a coroa de fogo em volta do olho
    FOIL_DEATH: DEATH_FOIL
};

// --- Raios vivos do FOIL_STORM --------------------------------------------------
const STORM_ARCS = 2;          // raios independentes por carta
const STORM_PERIOD = 1.45;     // s entre descargas do mesmo raio
const STORM_VISIBLE = 0.2;     // fração do ciclo em que o raio aparece
const STORM_FLICKER_HZ = 22;   // o zigue-zague se redesenha (tremida elétrica)
const STORM_POINTS = 9;
const STORM_GLOW = 'rgba(140, 230, 255, 0.55)';
const STORM_CORE = '#ffffff';
const STORM_FLASH = 'rgba(190, 235, 255, 1)';

/**
 * Descargas que caem de um ponto da borda até o anel do centro, com zigue-zague que treme (redesenhado
 * STORM_FLICKER_HZ vezes por segundo) e um clarão na carta no instante do golpe. Pseudoaleatório por
 * hash inteiro (sem Math.random, sem alocar): mesma carta, mesmo raio em todos os frames da tremida.
 * @param {Float32Array} pts buffer de trabalho do preset (STORM_POINTS * 2)
 */
function drawStormArcs(ctx, w, h, time, phase, seed, pts) {
    for (let a = 0; a < STORM_ARCS; a++) {
        let u = time / STORM_PERIOD + phase + a * 0.53;
        const cycle = Math.floor(u);
        u -= cycle;
        if (u > STORM_VISIBLE) continue;
        const life = 1 - u / STORM_VISIBLE;

        let s = (Math.imul(cycle + 7, 73856093) ^ Math.imul(seed + a * 131 + 3, 19349663)
            ^ Math.imul(Math.floor(time * STORM_FLICKER_HZ), 83492791)) >>> 0;
        // Ponto de partida fixo durante o ciclo (só o zigue-zague treme)
        let e = (Math.imul(cycle + 11, 2654435761) ^ Math.imul(seed + a * 977, 40503)) >>> 0;
        e = (Math.imul(e, 1664525) + 1013904223) >>> 0;
        const side = e & 3;
        e = (Math.imul(e, 1664525) + 1013904223) >>> 0;
        const along = 0.15 + (e / 4294967296) * 0.7;
        const x0 = side === 0 ? w * along : side === 1 ? w * along : side === 2 ? 0 : w;
        const y0 = side === 0 ? 0 : side === 1 ? h : h * along;
        const x1 = w * 0.5;
        const y1 = h * 0.48;

        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const amp = len * 0.14;
        for (let i = 0; i < STORM_POINTS; i++) {
            const t = i / (STORM_POINTS - 1);
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            const off = i === 0 || i === STORM_POINTS - 1 ? 0 : ((s / 4294967296) - 0.5) * 2 * amp * Math.sin(t * Math.PI);
            pts[i * 2] = x0 + dx * t + nx * off;
            pts[i * 2 + 1] = y0 + dy * t + ny * off;
        }

        ctx.globalCompositeOperation = 'lighter';
        // Clarão da carta inteira no instante do golpe
        if (u < STORM_VISIBLE * 0.3) {
            ctx.globalAlpha = 0.16 * life;
            ctx.fillStyle = STORM_FLASH;
            ctx.fillRect(0, 0, w, h);
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 1; i < STORM_POINTS; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
            ctx.globalAlpha = pass === 0 ? 0.8 * life : life;
            ctx.strokeStyle = pass === 0 ? STORM_GLOW : STORM_CORE;
            ctx.lineWidth = pass === 0 ? 4.5 : 1.3;
            ctx.stroke();
        }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
}

export const CARD_FX_NAMES = Object.freeze(Object.keys(FX_PRESETS));

function makeBandSprite(stops) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

/** Gerador determinístico (mesma posição de faíscas em toda sessão, sem depender de Math.random). */
function lcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Brilho de 4 pontas côncavas (estrela de laminado). */
function sparklePath(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.closePath();
}

function compile(name, preset) {
    const bands = preset.bands.map((b) => ({
        sprite: makeBandSprite(b.stops),
        width: b.width, period: b.period, sweep: b.sweep, alpha: b.alpha,
        composite: b.composite, offset: b.offset || 0
    }));

    const sp = preset.sparkles;
    const count = sp ? sp.count : 0;
    const rand = lcg(name.length * 7919 + count * 104729);
    const sparkleX = new Float32Array(count);
    const sparkleY = new Float32Array(count);
    const sparkleSize = new Float32Array(count);
    const sparkleRate = new Float32Array(count);
    const sparklePhase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        sparkleX[i] = 0.12 + rand() * 0.76;
        sparkleY[i] = 0.08 + rand() * 0.84;
        sparkleSize[i] = sp.minSize + rand() * (sp.maxSize - sp.minSize);
        sparkleRate[i] = sp.minRate + rand() * (sp.maxRate - sp.minRate);
        sparklePhase[i] = rand() * TAU;
    }

    return {
        angle: preset.angle, bands, count,
        sparkleX, sparkleY, sparkleSize, sparkleRate, sparklePhase,
        sparkleColor: sp ? sp.color : '#ffffff',
        sparkleCore: sp && sp.core ? sp.core : null,
        sparkleSprite: null,
        // Camada desenhada à mão por cima (ex.: raios do FOIL_STORM) com um buffer de trabalho próprio
        extra: preset.extra || null,
        scratch: preset.extra ? new Float32Array(64) : null
    };
}

// --- Atlas do laminado -------------------------------------------------------------------------------
// Cada laminado é pintado num buffer à parte e depois "carimbado" na carta (é o que recorta o efeito no
// formato da carta e mantém a mistura das camadas). Carimbar um canvas noutro faz o navegador tirar uma foto
// dele; reescrever o mesmo buffer pra carta seguinte obriga a copiar essa foto (copy-on-write): uma cópia por
// carta por frame, na thread principal. Com o atlas, as cartas do frame são pintadas antes (pré-passada do
// renderer), cada uma na sua célula, e carimbadas depois: uma foto por frame. Dois atlas alternados: o do
// frame anterior ainda pode estar em uso pela GPU quando o seguinte começa a ser pintado.
const ATLAS_COLS = 8;
const ATLAS_ROWS = 6;
const ATLAS_CELLS = ATLAS_COLS * ATLAS_ROWS;
const ATLAS_GAP = 2; // px transparentes entre células: a amostragem nas bordas nunca puxa a carta vizinha

export class CardEffects {
    constructor() {
        /** @type {Map<string, ReturnType<typeof compile>>} */
        this.compiled = new Map();

        // Buffer avulso: cartas desenhadas fora da pré-passada do frame (loja, painel de info, vitrine)
        this.scratchCanvas = document.createElement('canvas');
        this.scratchCanvas.width = 1;
        this.scratchCanvas.height = 1;
        this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently: false });

        this.atlases = [null, null];
        this.atlasCtxs = [null, null];
        this.atlasIndex = 0;
        this.atlasCellW = 0;
        this.atlasCellH = 0;
        // Células pintadas neste frame (SoA): os parâmetros que definem o laminado de cada uma
        this.cellCount = 0;
        this.cellName = new Array(ATLAS_CELLS).fill(null);
        this.cellSeed = new Float64Array(ATLAS_CELLS);
        this.cellTime = new Float64Array(ATLAS_CELLS);
        this.cellColor = new Int32Array(ATLAS_CELLS);
        this.cellHeld = new Uint8Array(ATLAS_CELLS);
        this.cellRadius = new Float64Array(ATLAS_CELLS);
    }

    /** Presets são compilados sob demanda (só custam memória se alguma carta com o efeito aparecer). */
    get(name) {
        let fx = this.compiled.get(name);
        if (fx) return fx;
        const preset = FX_PRESETS[name];
        if (!preset) {
            console.warn(`[CardEffects] Efeito desconhecido: "${name}".`);
            this.compiled.set(name, null);
            return null;
        }
        fx = compile(name, preset);
        this.compiled.set(name, fx);
        return fx;
    }

    /** Faísca do preset pintada uma vez (4 pontas côncavas + núcleo opcional), guardada no próprio preset. */
    sparkleSpriteFor(fx) {
        if (fx.sparkleSprite) return fx.sparkleSprite;
        const sc = document.createElement('canvas');
        sc.width = 32;
        sc.height = 32;
        const sct = sc.getContext('2d', { willReadFrequently: false });
        sct.translate(16, 16);
        sct.fillStyle = fx.sparkleColor;
        sparklePath(sct, 0, 0, 16);
        sct.fill();
        if (fx.sparkleCore) {
            sct.fillStyle = fx.sparkleCore;
            sparklePath(sct, 0, 0, 16 * 0.45);
            sct.fill();
        }
        fx.sparkleSprite = sc;
        return sc;
    }

    /** Início de um frame do tabuleiro: alterna o atlas e esvazia as células. Chamar antes de `prepare`. */
    beginFrame() {
        this.atlasIndex ^= 1;
        this.cellCount = 0;
    }

    /** Atlas atual com células de w x h (criado na primeira vez, ou de novo se o tamanho da carta mudar). */
    ensureAtlas(w, h) {
        if (this.atlasCellW !== w || this.atlasCellH !== h) {
            this.atlasCellW = w;
            this.atlasCellH = h;
            this.atlases[0] = null;
            this.atlases[1] = null;
        }
        const i = this.atlasIndex;
        if (this.atlases[i]) return this.atlasCtxs[i];
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_COLS * (w + ATLAS_GAP);
        canvas.height = ATLAS_ROWS * (h + ATLAS_GAP);
        this.atlases[i] = canvas;
        this.atlasCtxs[i] = canvas.getContext('2d', { willReadFrequently: false });
        console.log(`[CardEffects] Atlas ${i} do laminado criado: ${canvas.width}x${canvas.height}px (${ATLAS_CELLS} células).`);
        return this.atlasCtxs[i];
    }

    /**
     * Pré-passada: pinta o laminado de uma carta na próxima célula livre do atlas, com os mesmos parâmetros
     * que o `draw` dela vai receber. Sem efeito, laminado desligado ou atlas cheio: não faz nada e o `draw`
     * dessa carta usa o buffer avulso.
     */
    prepare(name, w, h, radius, time, seed, color = 0, held = false) {
        const fx = this.get(name);
        if (!fx || !GRAPHICS.enableFoil || this.cellCount >= ATLAS_CELLS) return;
        const g = this.ensureAtlas(w, h);
        const cell = this.cellCount++;
        this.cellName[cell] = name;
        this.cellSeed[cell] = seed;
        this.cellTime[cell] = time;
        this.cellColor[cell] = color;
        this.cellHeld[cell] = held ? 1 : 0;
        this.cellRadius[cell] = radius;
        this.paint(g, (cell % ATLAS_COLS) * (w + ATLAS_GAP), ((cell / ATLAS_COLS) | 0) * (h + ATLAS_GAP),
            fx, w, h, radius, time, seed, color, held);
    }

    /** Célula deste frame pintada com exatamente estes parâmetros (-1 se não houver). */
    findCell(name, w, h, radius, time, seed, color, held) {
        if (w !== this.atlasCellW || h !== this.atlasCellH) return -1;
        const heldBit = held ? 1 : 0;
        for (let c = 0; c < this.cellCount; c++) {
            if (this.cellSeed[c] === seed && this.cellName[c] === name && this.cellTime[c] === time
                && this.cellColor[c] === color && this.cellHeld[c] === heldBit && this.cellRadius[c] === radius) {
                return c;
            }
        }
        return -1;
    }

    /**
     * Pinta o laminado em (ox, oy) de `g`, recortado no retângulo w x h e no formato da carta. Mesmo resultado,
     * pixel a pixel, do antigo buffer avulso de w x h.
     */
    paint(g, ox, oy, fx, w, h, radius, time, seed, color, held) {
        g.setTransform(1, 0, 0, 1, ox, oy);
        g.save();
        // Recorte retangular alinhado aos pixels (o mais barato que existe): nada vaza pra célula vizinha e o
        // destination-in do fim só age dentro desta célula
        g.beginPath();
        g.rect(0, 0, w, h);
        g.clip();
        g.clearRect(0, 0, w, h);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';

        const diag = Math.sqrt(w * w + h * h);
        const phase = (seed * 0.6180339887) % 1;

        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(fx.angle);
        for (let i = 0; i < fx.bands.length; i++) {
            const band = fx.bands[i];
            let u = time / band.period + phase + band.offset;
            u -= Math.floor(u);
            if (u > band.sweep) continue;
            const bw = diag * band.width;
            const x = -diag / 2 - bw + (u / band.sweep) * (diag + bw);
            g.globalAlpha = band.alpha;
            g.globalCompositeOperation = (band.composite === 'lighter' && !GRAPHICS.useLighter) ? 'source-over' : band.composite;
            g.drawImage(band.sprite, x, -diag / 2, bw, diag);
        }
        g.restore();

        g.globalCompositeOperation = 'source-over';
        if (fx.count > 0) {
            const sc = this.sparkleSpriteFor(fx);
            for (let i = 0; i < fx.count; i++) {
                let a = Math.sin(time * fx.sparkleRate[i] + fx.sparklePhase[i] + phase * TAU);
                if (a <= 0) continue;
                a = a * a * a;
                const x = fx.sparkleX[i] * w;
                const y = fx.sparkleY[i] * h;
                const r = fx.sparkleSize[i] * (0.45 + 0.55 * a);
                g.globalAlpha = a;
                g.drawImage(sc, x - r, y - r, r * 2, r * 2);
            }
        }

        if (fx.extra) {
            g.globalAlpha = 1;
            g.globalCompositeOperation = 'source-over';
            fx.extra(g, w, h, time, phase, seed | 0, fx.scratch, color, held);
        }

        // Formato da carta: o que ficou fora do retângulo arredondado some (só dentro do recorte da célula)
        g.globalCompositeOperation = 'destination-in';
        g.globalAlpha = 1;
        g.fillStyle = '#fff';
        g.beginPath();
        g.roundRect(0, 0, w, h, radius);
        g.fill();
        g.restore();
        g.setTransform(1, 0, 0, 1, 0, 0);
    }

    /**
     * Desenha o efeito sobre uma face já desenhada em (0,0,w,h).
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} name chave de FX_PRESETS
     * @param {number} time segundos (relógio global de animação)
     * @param {number} seed id da carta: defasa a animação para cartas iguais não piscarem em sincronia
     * @param {number} [color] cor da carta (camadas que tingem pela cor, ex.: veias do Espelho)
     * @param {boolean} [held] a carta está na mão do jogador sob o ponteiro (ex.: runas acesas)
     */
    draw(ctx, name, w, h, radius, time, seed, color = 0, held = false) {
        const fx = this.get(name);
        if (!fx || !GRAPHICS.enableFoil) return;

        let source;
        let sx = 0;
        let sy = 0;
        const cell = this.findCell(name, w, h, radius, time, seed, color, held);
        if (cell >= 0) {
            source = this.atlases[this.atlasIndex];
            sx = (cell % ATLAS_COLS) * (w + ATLAS_GAP);
            sy = ((cell / ATLAS_COLS) | 0) * (h + ATLAS_GAP);
        } else {
            // Fora da pré-passada: buffer avulso (o caminho antigo, uma foto por carta)
            if (this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) {
                this.scratchCanvas.width = w;
                this.scratchCanvas.height = h;
            }
            this.paint(this.scratchCtx, 0, 0, fx, w, h, radius, time, seed, color, held);
            source = this.scratchCanvas;
        }

        // Carimbar o resultado no canvas principal
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
        ctx.restore();
    }
}
