import { CONFIG } from '../config/constants.js';
import { GRAPHICS } from '../config/graphics.js';
import { Easing } from './animator.js';
import { PARTICLE_TYPES } from './particle-system.js';
import { EVENT, REL_SEAT } from '../network/protocol.js';
import { SFX } from '../config/sound-presets.js';
import { CLIENT_ZONE, ZONE } from '../utils/zones.js';
import { i18n } from '../i18n/index.js';
import { GLOW } from './cinematics-arcane.js';
import { PRISON_SIDE, ultimateHex } from './ultimate-fx.js';

/**
 * Cinemáticas dos Combos Supremos (GAME_RULES §6.18): Prisão de Cristal (3 Blocks) e Reverso Kármico
 * (3 Reversos). Cada função recebe o CinematicPlayer (`p`: tween/animate/partículas/áudio/HUD) e o evento do
 * servidor; o palco pesado (monólito, cristais, relógio, rachaduras, fita VHS, tremor) é o UltimateFx
 * (`p.ultimate`). Todas terminam dentro do tempo que o servidor reserva (TIMINGS.*), então a fila de eventos
 * dos dois jogadores nunca atrasa.
 */

const { ANIM, CARD_DIMENSIONS, CARD_TYPES } = CONFIG;
const HALF_W = CARD_DIMENSIONS.WIDTH / 2;
const HALF_H = CARD_DIMENSIONS.HEIGHT / 2;
const TAU = Math.PI * 2;

const KARMA_HEX = '#c04dff';
const VHS_MAGENTA = '#ff00c8';
const VHS_CYAN = '#00e5ff';
const DUST_HEX = '#9a8f86';
const PLATE_GAP = 46;           // distância vertical entre as placas de cristal na formação

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activeIds(p, ids) {
    const out = [];
    if (!ids) return out;
    for (const id of ids) if (p.pool.isActive(id)) out.push(id);
    return out;
}

/** Brilho da carta subindo de 0 até `peak` (kind = GLOW.*), sem travar. */
function glowCards(p, ids, kind, peak, ms) {
    const pool = p.pool;
    for (const id of ids) pool.glowKind[id] = kind;
    return p.animate(ms, (t) => {
        for (const id of ids) if (pool.isActive(id)) pool.glow[id] = peak * t;
    });
}

// --- Prisão de Cristal -------------------------------------------------------------

/**
 * Formação comum ao choque e ao golpe na vida: os 3 Blocks sobem e se alinham na vertical sobre o próprio
 * Ataque, viram placas de vidro (brilho gelado) e se fundem num monólito de cristal, que sobe pra ganhar
 * impulso. Retorna o ponto de partida do arremesso.
 */
async function formMonolith(p, evt, hex) {
    const pool = p.pool;
    const fx = p.ultimate;
    const ownerSelf = evt.seat === REL_SEAT.SELF;
    const own = p.slotCenter(ownerSelf ? ZONE.SELF_ATTACK : ZONE.OPP_ATTACK);
    const ids = activeIds(p, evt.blockIds);
    const toEnemy = ownerSelf ? -1 : 1;

    p.audio.play(SFX.PRISON_DRAG);
    p.hud.showSpecialAlert(i18n.t('PRISON_ALERT'), 'alert-prison');

    // 1) Os Blocks se aglutinam na vertical (a do topo fica mais perto do inimigo)
    const jobs = [glowCards(p, ids, GLOW.CRYSTAL, 1, ANIM.PRISON_GATHER)];
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        pool.zIndex[id] = 600 + i;
        const offset = (i - (ids.length - 1) / 2) * PLATE_GAP * toEnemy;
        jobs.push(p.tween(id, { targetX: own.x - HALF_W, targetY: own.y - HALF_H + offset, rotation: 0, scale: 1.05 }, ANIM.PRISON_GATHER, Easing.CubicOut));
    }
    await Promise.all(jobs);

    // 2) Viram vidro e fundem no monólito
    const m = fx.mono;
    fx.showMonolith(own.x, own.y, hex);
    for (const id of ids) p.particles.emitBurst(p.centerX(id), p.centerY(id), hex, 14, 160, PARTICLE_TYPES.SQUARE, 0.9);
    await p.animate(ANIM.PRISON_FORM, (t) => {
        m.alpha = t;
        m.scale = 0.55 + 0.45 * Easing.BackOut(t);
        m.glow = t;
        for (const id of ids) {
            if (!pool.isActive(id)) continue;
            pool.alpha[id] = 1 - t;
            pool.scale[id] = 1.05 - 0.35 * t;
        }
    });
    for (const id of ids) p.remove(id);
    p.particles.emitBurst(own.x, own.y, '#ffffff', 26, 240, PARTICLE_TYPES.STAR);

    // 3) Sobe (vem na direção da câmera) pra ganhar impulso
    await p.animate(ANIM.PRISON_RISE, (t) => {
        const e = Easing.QuadOut(t);
        m.y = own.y - toEnemy * 34 * e;
        m.scale = 1 + 0.35 * e;
    });
    return { x: m.x, y: m.y, toEnemy };
}

/** Arremesso do monólito até (x, y), pontudo e acelerando; termina no instante do impacto. */
async function hurlMonolith(p, from, x, y, endScale) {
    const m = p.ultimate.mono;
    p.audio.play(SFX.PRISON_FALL);
    const tilt = (x - from.x) * 0.0015;
    await p.animate(ANIM.PRISON_FALL, (t) => {
        const e = Easing.CubicIn(t);
        m.x = from.x + (x - from.x) * e;
        m.y = from.y + (y - from.y) * e;
        m.scale = 1.35 + (endScale - 1.35) * e;
        m.rot = tilt * Math.sin(t * Math.PI);
    });
    m.rot = 0;
}

/** Impacto no chão: tremor, clarão gelado, poeira, rachaduras neon e anel de choque. */
function slamFx(p, x, y, hex, strong) {
    const fx = p.ultimate;
    fx.shake(ANIM.PRISON_SHAKE_PX * (strong ? 1 : 0.6), 700);
    p.flashScreen(strong ? 0.75 : 0.45, '#d8f7ff', 320);
    fx.crackFloor(x, y, hex, strong ? 290 : 200);
    p.particles.emitBurst(x, y, DUST_HEX, 46, 300, PARTICLE_TYPES.SQUARE, 1.4);
    p.particles.emitBurst(x, y, hex, 36, 420, PARTICLE_TYPES.SPARK, 1.2);
    p.particles.emitBurst(x, y, '#ffffff', 20, 260, PARTICLE_TYPES.STAR);
    if (p.fx) {
        p.fx.ring(x, y, 20, 260, 620, hex, 5, 0.55);
        p.fx.ring(x, y, 10, 160, 420, '#ffffff', 2, 0.55);
    }
}

/**
 * EVENT.PRISON: o monólito esmaga a pilha da frente inimiga inteira e congela Ataque + Defesa dela
 * (cristais + cadeados + "ZONAS ISOLADAS"). `locked = 0`: um Espelho refletiu a parede e os dois se dissipam.
 */
export async function prison(p, evt) {
    const fx = p.ultimate;
    if (!fx) return;
    const hex = ultimateHex(evt.color);
    const enemySide = evt.seat === REL_SEAT.SELF ? PRISON_SIDE.OPP : PRISON_SIDE.SELF;
    const enemyAttack = p.slotCenter(enemySide === PRISON_SIDE.OPP ? ZONE.OPP_ATTACK : ZONE.SELF_ATTACK);
    const region = fx.regionOf(enemySide);
    const target = evt.locked ? { x: region.x + region.w / 2, y: region.y + region.h / 2 } : enemyAttack;
    console.log(`[Cinematic] Prisão de Cristal (${evt.locked ? 'trancando o campo' : 'refletida pelo Espelho'}).`);

    const from = await formMonolith(p, evt, hex);
    await hurlMonolith(p, from, target.x, target.y, 1);

    const victims = activeIds(p, evt.victimIds);
    if (!evt.locked) {
        // Paradoxo: o Espelho reflete uma parede intransponível — os dois se estilhaçam, nada é trancado
        p.audio.play(SFX.MIRROR_SHATTER);
        fx.shake(8, 420);
        p.flashScreen(0.6, '#e6e0ff', 260);
        for (const id of victims) p.explode(id, '#e6e0ff', 40, 260);
        p.particles.emitBurst(target.x, target.y, hex, 60, 380, PARTICLE_TYPES.SQUARE, 1.3);
        p.particles.emitBurst(target.x, target.y, '#7a3cff', 30, 300, PARTICLE_TYPES.SPARK);
        if (p.fx) p.fx.ring(target.x, target.y, 16, 200, 480, '#e6e0ff', 4);
        fx.hideMonolith();
        await sleep(ANIM.PRISON_FREEZE);
        return;
    }

    slamFx(p, target.x, target.y, hex, true);
    for (const id of victims) p.explode(id, hex, 34, 280);
    fx.setPrison(enemySide, true, hex);
    p.audio.play(SFX.PRISON_FREEZE);

    // O monólito afunda no chão enquanto o cristal cobre os slots
    const m = fx.mono;
    await p.animate(ANIM.PRISON_FREEZE, (t) => {
        m.sink = 0.55 * Easing.QuadOut(t);
        m.glow = 1 - 0.5 * t;
    });
    await p.animate(ANIM.PRISON_SETTLE, (t) => {
        m.alpha = 1 - t;
        m.sink = 0.55 + 0.2 * t;
    });
    fx.hideMonolith();
}

/**
 * EVENT.PRISON_HIT: o monólito acerta a vida do alvo (sem tirar HP): a tela de quem levou estilhaça como
 * vidro, uma carta sai do baralho, voa até o obelisco e vira pó sem ser revelada, e o campo do alvo congela.
 */
export async function prisonHit(p, evt) {
    const fx = p.ultimate;
    if (!fx) return;
    const pool = p.pool;
    const hex = ultimateHex(evt.color);
    const selfIsTarget = evt.seat === REL_SEAT.OPPONENT;
    const targetSide = selfIsTarget ? PRISON_SIDE.SELF : PRISON_SIDE.OPP;
    const hp = p.hpPoint(selfIsTarget);
    // A caixa de vida fica no canto (DOM por cima do canvas): o monólito para um pouco antes, na direção do
    // centro da mesa, pra queda, rachaduras e o pó da carta ficarem visíveis
    const vp = p.viewport;
    const hitX = hp.x + (vp.width / 2 - hp.x) * 0.22;
    const hitY = hp.y + (vp.height / 2 - hp.y) * 0.3;
    console.log(`[Cinematic] Prisão de Cristal na vida de ${selfIsTarget ? 'você' : 'o oponente'} (Trauma).`);

    const from = await formMonolith(p, evt, hex);
    await hurlMonolith(p, from, hitX, hitY, 0.8);

    fx.shake(ANIM.PRISON_SHAKE_PX * (selfIsTarget ? 1.3 : 0.7), 800);
    p.flashScreen(0.7, '#d8f7ff', 300);
    // A tela de quem levou estilhaça (é um bloqueio: sem o vermelho de dano)
    if (selfIsTarget) fx.crackScreen(hitX, hitY);
    else fx.crackFloor(hitX, hitY, hex, 160);
    p.particles.emitBurst(hitX, hitY, hex, 44, 360, PARTICLE_TYPES.SQUARE, 1.3);
    p.particles.emitBurst(hitX, hitY, '#ffffff', 24, 280, PARTICLE_TYPES.STAR);
    if (p.fx) p.fx.ring(hitX, hitY, 14, 220, 600, hex, 4);
    p.hud.flashGuard(selfIsTarget);
    p.hud.showFloatingText(i18n.t('HIT_TRAUMA'), selfIsTarget, 'prison');
    fx.setPrison(targetSide, true, hex);
    p.audio.play(SFX.PRISON_FREEZE);

    // Trauma de Deck: a carta do topo sai do baralho (verso), voa até o obelisco e vira pó
    const dust = evt.dustId;
    const m = fx.mono;
    if (Number.isInteger(dust) && dust >= 0 && dust < pool.maxCards && !pool.isActive(dust)) {
        pool.activate(dust, p.scene.deckX, p.scene.deckY);
        pool.type[dust] = CARD_TYPES.HIDDEN;
        pool.zone[dust] = CLIENT_ZONE.FX;
        pool.zIndex[dust] = 700;
        await p.tween(dust, {
            targetX: m.x - HALF_W, targetY: m.y - HALF_H, rotation: TAU * (selfIsTarget ? 1 : -1), scale: 0.8
        }, ANIM.PRISON_DUST * 0.6, Easing.QuadIn);
        p.audio.play(SFX.PRISON_CRUSH);
        const x = p.centerX(dust);
        const y = p.centerY(dust);
        p.particles.emitBurst(x, y, DUST_HEX, 60, 180, PARTICLE_TYPES.SQUARE, 1.1);
        p.particles.emitRise(x, y, '#cfc6bd', 30, 40, 90, PARTICLE_TYPES.CIRCLE);
        p.remove(dust);
        await sleep(ANIM.PRISON_DUST * 0.4);
    } else {
        p.audio.play(SFX.PRISON_CRUSH);
        await sleep(ANIM.PRISON_DUST);
    }

    await p.animate(ANIM.PRISON_SETTLE, (t) => {
        m.alpha = 1 - t;
        m.scale = 0.8 + 0.1 * t;
    });
    fx.hideMonolith();
}

// --- Reverso Kármico -----------------------------------------------------------------

/** Ativação: fita ejetada, relógio gigante girando ao contrário e a tela em pane (fita VHS). */
function karmaActivate(p, hex, glitchMs) {
    const fx = p.ultimate;
    const vp = p.viewport;
    p.audio.play(SFX.KARMA_EJECT);
    p.audio.play(SFX.KARMA_REWIND);
    p.audio.play(SFX.KARMA_TICK);
    p.hud.showSpecialAlert(i18n.t('KARMA_ALERT'), 'alert-karma');
    fx.showClock(vp.width / 2, vp.height / 2, hex);
    fx.spinClock(9, 28);
    fx.pulseGlitch(1, glitchMs);
    fx.shake(6, 300);
}

/** Os 3 Reversos giram ao contrário (glitch + brilho VHS) e implodem no centro do relógio. */
async function spinReverses(p, ids) {
    const pool = p.pool;
    const vp = p.viewport;
    const jobs = [glowCards(p, ids, GLOW.KARMA, 1, ANIM.KARMA_SPIN * 0.5)];
    for (const id of ids) {
        pool.zIndex[id] = 600;
        if (GRAPHICS.isHigh) pool.glitch[id] = 0.6;
        jobs.push(p.tween(id, { rotation: pool.rotation[id] - TAU * 1.5, scale: 1.25 }, ANIM.KARMA_SPIN, Easing.QuadInOut));
    }
    await Promise.all(jobs);
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const implode = [];
    for (const id of ids) {
        p.particles.emitLine(p.centerX(id), p.centerY(id), cx, cy, VHS_MAGENTA, 16, PARTICLE_TYPES.SPARK);
        implode.push(p.tween(id, { targetX: cx - HALF_W, targetY: cy - HALF_H, scale: 0.2, rotation: pool.rotation[id] - TAU }, 220, Easing.CubicIn));
    }
    await Promise.all(implode);
    for (const id of ids) p.remove(id);
    p.particles.emitBurst(cx, cy, VHS_CYAN, 30, 320, PARTICLE_TYPES.SPARK);
    p.particles.emitBurst(cx, cy, VHS_MAGENTA, 30, 260, PARTICLE_TYPES.STAR);
}

/**
 * EVENT.KARMA: o Reverso simples inimigo (se houver) pifa, a pilha da frente inimiga é arrancada pro lado do
 * dono girando ao contrário e cada número roubado volta 20% mais forte.
 */
export async function karma(p, evt) {
    const fx = p.ultimate;
    if (!fx) return;
    const pool = p.pool;
    const hex = ultimateHex(evt.color, KARMA_HEX);
    const ownerSelf = evt.seat === REL_SEAT.SELF;
    console.log(`[Cinematic] Reverso Kármico: ${evt.stolen.length} carta(s) roubada(s)${evt.fizzledId >= 0 ? ', Reverso inimigo pifou' : ''}.`);

    karmaActivate(p, hex, ANIM.KARMA_SPIN + ANIM.KARMA_FIZZLE + 300);
    await spinReverses(p, activeIds(p, evt.reverseIds));

    // O Reverso simples inimigo é sobrecarregado pela anomalia e se desfaz em estática
    if (pool.isActive(evt.fizzledId)) {
        const id = evt.fizzledId;
        pool.glowKind[id] = GLOW.KARMA;
        await p.animate(ANIM.KARMA_FIZZLE, (t) => {
            if (!pool.isActive(id)) return;
            if (GRAPHICS.isHigh) pool.glitch[id] = t;
            pool.glow[id] = t;
            pool.alpha[id] = (Math.random() < 0.3 ? 0.35 : 1) * (1 - t * 0.5);
        });
        p.audio.play(SFX.KARMA_ZAP, { length: 'SHORT' });
        p.particles.emitBurst(p.centerX(id), p.centerY(id), VHS_MAGENTA, 30, 300, PARTICLE_TYPES.SPARK);
        p.particles.emitBurst(p.centerX(id), p.centerY(id), VHS_CYAN, 30, 260, PARTICLE_TYPES.SQUARE);
        p.remove(id);
    } else {
        await sleep(ANIM.KARMA_FIZZLE);
    }

    // Roubo: a pilha inteira é arrancada pro Ataque do dono girando ao contrário
    const slot = p.board.slots[ownerSelf ? ZONE.SELF_ATTACK : ZONE.OPP_ATTACK];
    const stolen = evt.stolen.filter((c) => pool.isActive(c.id));
    const jobs = [];
    for (let k = 0; k < stolen.length; k++) {
        const id = stolen[k].id;
        pool.zIndex[id] = 550 + k;
        pool.glowKind[id] = GLOW.KARMA;
        pool.glow[id] = 0.8;
        const tx = slot ? slot.x + k * CONFIG.STACK_OFFSET.X : pool.targetX[id];
        const ty = slot ? slot.y + k * CONFIG.STACK_OFFSET.Y : pool.targetY[id];
        jobs.push(p.tween(id, { targetX: tx, targetY: ty, rotation: pool.rotation[id] - TAU, scale: 1.1 }, ANIM.KARMA_STEAL, Easing.CubicInOut));
    }
    if (stolen.length > 0) p.audio.play(SFX.REVERSE);
    await Promise.all(jobs);

    // +20%: cada número roubado "estala" no valor novo
    let boosted = false;
    for (const c of stolen) {
        const id = c.id;
        pool.rotation[id] = 0;
        if (pool.power[id] !== c.power) {
            boosted = true;
            pool.power[id] = c.power;
            p.particles.emitBurst(p.centerX(id), p.centerY(id), hex, 26, 260, PARTICLE_TYPES.STAR);
            p.particles.emitBurst(p.centerX(id), p.centerY(id), '#ffffff', 12, 180, PARTICLE_TYPES.SPARK);
        }
    }
    if (boosted) p.audio.play(SFX.SPARKLE);
    fx.hideClock();
    await p.animate(ANIM.KARMA_BOOST, (t) => {
        for (const c of stolen) {
            if (!pool.isActive(c.id)) continue;
            pool.scale[c.id] = 1.1 + 0.15 * Math.sin(t * Math.PI) - 0.1 * t;
            pool.glow[c.id] = 0.8 * (1 - t);
        }
    });
    for (const c of stolen) {
        if (!pool.isActive(c.id)) continue;
        pool.scale[c.id] = 1;
        pool.glow[c.id] = 0;
        pool.glowKind[c.id] = 0;
    }
}

/**
 * EVENT.KARMA_HIT: os Reversos giram e disparam na vida do alvo; o número da vida "buga" em altíssima
 * velocidade durante a estática e congela piscando no valor novo.
 */
export async function karmaHit(p, evt) {
    const fx = p.ultimate;
    if (!fx) return;
    const pool = p.pool;
    const hex = ultimateHex(evt.color, KARMA_HEX);
    const selfIsTarget = evt.seat === REL_SEAT.OPPONENT;
    const hp = p.hpPoint(selfIsTarget);
    console.log(`[Cinematic] Reverso Kármico na vida de ${selfIsTarget ? 'você' : 'o oponente'}: -${evt.damage}.`);

    karmaActivate(p, hex, ANIM.KARMA_SPIN + ANIM.KARMA_HP_GLITCH + 200);
    const ids = activeIds(p, evt.reverseIds);
    const jobs = [glowCards(p, ids, GLOW.KARMA, 1, ANIM.KARMA_SPIN * 0.5)];
    for (const id of ids) {
        pool.zIndex[id] = 600;
        if (GRAPHICS.isHigh) pool.glitch[id] = 0.6;
        jobs.push(p.tween(id, { rotation: pool.rotation[id] - TAU * 1.5, scale: 1.25 }, ANIM.KARMA_SPIN, Easing.QuadInOut));
    }
    await Promise.all(jobs);
    const dash = [];
    for (const id of ids) {
        dash.push(p.tween(id, { targetX: hp.x - HALF_W, targetY: hp.y - HALF_H, scale: 0.4, rotation: pool.rotation[id] - TAU }, 240, Easing.CubicIn));
    }
    await Promise.all(dash);
    for (const id of ids) p.remove(id);

    // Curto-circuito na vida
    p.audio.play(SFX.KARMA_ZAP);
    fx.shake(10, 520);
    fx.pulseGlitch(1, ANIM.KARMA_HP_GLITCH);
    p.particles.emitDamageWave(selfIsTarget, VHS_MAGENTA, 120, PARTICLE_TYPES.SPARK);
    p.particles.emitBurst(hp.x, hp.y, VHS_CYAN, 34, 300, PARTICLE_TYPES.SQUARE);
    if (selfIsTarget) p.hud.flashDamage();
    let variant = 'karma';
    if (selfIsTarget && evt.absorbed > 0) {
        variant = 'shielded';
        p.hud.flashShield(true);
        p.audio.play(SFX.SHIELD_HIT);
    }
    if (evt.guarded) {
        variant = 'guarded';
        p.hud.flashGuard(selfIsTarget);
    }
    p.hud.showFloatingText(`-${evt.damage} ♥`, selfIsTarget, variant);
    await p.hud.glitchHP(selfIsTarget, evt.hp, ANIM.KARMA_HP_GLITCH);
    fx.hideClock();
}

/** EVENT.HAND_REWIND: a mão do alvo é chutada pra fora da tela em pane, carta por carta. */
export async function handRewind(p, evt) {
    const fx = p.ultimate;
    const pool = p.pool;
    const victimSelf = evt.seat === REL_SEAT.SELF;
    const ids = activeIds(p, evt.ids);
    console.log(`[Cinematic] Mão ${victimSelf ? 'própria' : 'do oponente'} rebobinada: ${ids.length} carta(s) chutadas.`);
    if (fx) fx.pulseGlitch(0.8, ANIM.REWIND_KICK + 200);
    if (fx) fx.shake(7, 360);
    p.audio.play(SFX.KARMA_EJECT);
    p.audio.play(SFX.WHOOSH);
    p.hud.showFloatingText(i18n.t('HAND_REWOUND'), victimSelf, 'karma');

    const vp = p.viewport;
    const jobs = [];
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const delay = i * ANIM.REWIND_STAGGER;
        jobs.push((async () => {
            if (delay > 0) await sleep(delay);
            if (!pool.isActive(id)) return;
            pool.zIndex[id] = 650 + i;
            pool.hoverOffsetY[id] = 0;
            if (GRAPHICS.isHigh && pool.type[id] !== CARD_TYPES.HIDDEN) pool.glitch[id] = 0.7;
            p.particles.emitBurst(p.centerX(id), p.centerY(id), (i & 1) === 0 ? VHS_MAGENTA : VHS_CYAN, 8, 200, PARTICLE_TYPES.SPARK);
            const tx = pool.targetX[id] + (Math.random() - 0.5) * vp.width * 0.8;
            const ty = -CARD_DIMENSIONS.HEIGHT * 2 - Math.random() * 200;
            const spin = (Math.random() < 0.5 ? -1 : 1) * (TAU + Math.random() * TAU);
            await p.tween(id, { targetX: tx, targetY: ty, rotation: pool.rotation[id] + spin, scale: 0.75 }, ANIM.REWIND_KICK - delay, Easing.QuadIn);
            p.remove(id);
        })());
    }
    await Promise.all(jobs);
}

/** EVENT.HAND_REWIND_DONE: as cartas novas (já no snapshot) se materializam em glitch no lugar das antigas. */
export async function handRewindDone(p, evt) {
    const pool = p.pool;
    const ids = activeIds(p, evt.ids);
    if (ids.length === 0) return;
    const high = GRAPHICS.isHigh;
    for (const id of ids) {
        // Surgem direto na mão (sem o voo do baralho): silhuetas de estática ganhando forma
        pool.x[id] = pool.targetX[id];
        pool.y[id] = pool.targetY[id];
        pool.alpha[id] = 0;
        if (high && pool.type[id] !== CARD_TYPES.HIDDEN) pool.glitch[id] = 1;
        p.particles.emitBurst(p.centerX(id), p.centerY(id), VHS_CYAN, 10, 160, PARTICLE_TYPES.SQUARE, 0.8);
    }
    p.audio.play(SFX.KARMA_TICK, { length: 'SHORT' });
    await p.animate(ANIM.REWIND_MATERIALIZE, (t) => {
        for (const id of ids) {
            if (!pool.isActive(id)) continue;
            // Cintila como sinal fraco e firma no fim
            pool.alpha[id] = t >= 1 ? 1 : t * (Math.random() < 0.25 ? 0.3 : 1);
            if (high) pool.glitch[id] = t >= 1 ? 0 : 1 - t;
        }
    });
    for (const id of ids) {
        if (!pool.isActive(id)) continue;
        pool.alpha[id] = 1;
        pool.glitch[id] = 0;
    }
}

/** EVENT.PANIC: contagem do pânico na HUD (não trava a fila: a preparação já está aberta). */
export function panic(p, evt) {
    p.hud.showPanic(evt.seat === REL_SEAT.SELF, evt.ms);
}

/** EVENT.ULTIMATE_COLLAPSE: dois Combos Supremos se chocam no centro e implodem juntos. */
export async function collapse(p, evt) {
    const pool = p.pool;
    const fx = p.ultimate;
    const vp = p.viewport;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const ids = activeIds(p, [...(evt.aIds || []), ...(evt.bIds || [])]);
    console.log('[Cinematic] Colapso: dois Combos Supremos se aniquilando.');
    p.hud.showSpecialAlert(i18n.t('COLLAPSE_ALERT'), 'alert-collapse');
    p.audio.play(SFX.PRISON_DRAG);
    if (fx) fx.pulseGlitch(0.6, ANIM.ULTIMATE_COLLAPSE);

    const half = ANIM.ULTIMATE_COLLAPSE * 0.55;
    const jobs = [glowCards(p, ids, GLOW.KARMA, 1, half)];
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        pool.zIndex[id] = 600 + i;
        const a = (i / Math.max(1, ids.length)) * TAU;
        jobs.push(p.tween(id, {
            targetX: cx - HALF_W + Math.cos(a) * 60, targetY: cy - HALF_H + Math.sin(a) * 40,
            rotation: pool.rotation[id] + (i & 1 ? TAU : -TAU), scale: 0.9
        }, half, Easing.CubicIn));
    }
    await Promise.all(jobs);

    p.audio.play(SFX.PRISON_FALL);
    p.audio.play(SFX.KARMA_ZAP, { length: 'SHORT' });
    p.flashScreen(1, '#ffffff', 420);
    if (fx) fx.shake(16, 700);
    for (const id of ids) p.explode(id, (pool.color[id] && CONFIG.COLOR_HEX[pool.color[id]]) || '#ffffff', 26, 340);
    p.particles.emitBurst(cx, cy, VHS_MAGENTA, 50, 460, PARTICLE_TYPES.SPARK, 1.3);
    p.particles.emitBurst(cx, cy, '#8fe9ff', 50, 420, PARTICLE_TYPES.SQUARE, 1.3);
    if (p.fx) {
        p.fx.ring(cx, cy, 20, 420, 700, '#ffffff', 6);
        p.fx.ring(cx, cy, 10, 300, 520, VHS_MAGENTA, 3);
    }
    await sleep(ANIM.ULTIMATE_COLLAPSE - half);
}

/**
 * Efeito final de cada evento dos Combos Supremos sem animação (aba em segundo plano / fila atrasada).
 * @returns {boolean} true se o evento era um dos Supremos
 */
export function ultimateInstant(p, evt) {
    const fx = p.ultimate;
    switch (evt.t) {
        case EVENT.PRISON:
            for (const id of evt.blockIds) p.remove(id);
            for (const id of evt.victimIds) p.remove(id);
            if (fx && evt.locked) fx.setPrison(evt.seat === REL_SEAT.SELF ? PRISON_SIDE.OPP : PRISON_SIDE.SELF, true, ultimateHex(evt.color));
            break;
        case EVENT.PRISON_HIT:
            for (const id of evt.blockIds) p.remove(id);
            if (fx) fx.setPrison(evt.seat === REL_SEAT.SELF ? PRISON_SIDE.OPP : PRISON_SIDE.SELF, true, ultimateHex(evt.color));
            break;
        case EVENT.KARMA:
            for (const id of evt.reverseIds) p.remove(id);
            p.remove(evt.fizzledId);
            for (const c of evt.stolen) if (p.pool.isActive(c.id)) p.pool.power[c.id] = c.power;
            break;
        case EVENT.KARMA_HIT:
            for (const id of evt.reverseIds) p.remove(id);
            break;
        case EVENT.HAND_REWIND:
            for (const id of evt.ids) p.remove(id);
            break;
        case EVENT.HAND_REWIND_DONE:
            break;
        case EVENT.PANIC:
            panic(p, evt);
            break;
        case EVENT.ULTIMATE_COLLAPSE:
            for (const id of evt.aIds) p.remove(id);
            for (const id of evt.bIds) p.remove(id);
            break;
        default:
            return false;
    }
    if (fx) {
        fx.hideMonolith();
        fx.hideClock();
    }
    return true;
}
