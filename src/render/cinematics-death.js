import { CONFIG } from '../config/constants.js';
import { Easing } from './animator.js';
import { PARTICLE_TYPES } from './particle-system.js';
import { REL_SEAT, DEATH_KIND } from '../network/protocol.js';
import { SFX } from '../config/sound-presets.js';
import { zoneSeat } from '../utils/zones.js';
import { i18n } from '../i18n/index.js';
import { RonovaOverlay } from './death-overlay.js';
import { DEATH_DARK, DEATH_HEX, DEATH_LIGHT } from './death-art.js';

/**
 * Cinemáticas da Ronova, a Sombra da Morte (GAME_RULES §6.19). `p` é o CinematicPlayer.
 *   ronovaCastFx  uso da carta (só quem usou e espectadores): chamas correm do slot USE até a vida do alvo
 *   ronovaMark    DEATH_MARK: o olho cobre a tela; depois acende as cartas (START), drena os números
 *                 (START/TICK) ou queima uma carta da mão (END)
 *   ronovaBurn    DEATH_BURN: cartas do marcado que lutaram são consumidas pelas chamas carmesim
 */

const { ANIM } = CONFIG;
const GLOW_DEATH = 7;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let overlay = null;
function getOverlay() {
    if (!overlay) overlay = new RonovaOverlay();
    return overlay;
}

/**
 * O uso da carta (visto por quem usou e pelos espectadores): o fogo carmesim sobe do slot USE, corre até a
 * vida do alvo e acende as chamas lá. O alvo só vê o verso genérico explodindo.
 * @param {boolean} casterIsSelf quem usou é o "eu" desta tela (jogador, ou P1 para o espectador)
 */
export function ronovaCastFx(p, x, y, casterIsSelf) {
    const targetIsSelf = !casterIsSelf;
    const life = p.hpPoint(targetIsSelf);
    p.particles.emitRise(x, y, DEATH_HEX, 46, 40, 280, PARTICLE_TYPES.CIRCLE);
    p.particles.emitRise(x, y, DEATH_LIGHT, 24, 30, 360, PARTICLE_TYPES.STAR);
    p.particles.emitLine(x, y, life.x, life.y, DEATH_HEX, 50, PARTICLE_TYPES.STAR);
    p.particles.emitLine(x, y, life.x, life.y, DEATH_DARK, 26, PARTICLE_TYPES.CIRCLE);
    p.hud.showSpecialAlert(i18n.t('DEATH_CAST'), 'alert-death');
    if (p.fx) {
        p.fx.vignette(DEATH_HEX, 0.45, 800);
        p.fx.ring(x, y, 14, 150, 650, DEATH_HEX, 2.6);
    }
    setTimeout(() => {
        p.audio.play(SFX.DEATH_IGNITE, { volume: 0.7 });
        p.hud.flashRonova(targetIsSelf);
        p.particles.emitRise(life.x, life.y, DEATH_HEX, 34, 50, 230, PARTICLE_TYPES.STAR);
        p.particles.emitBurst(life.x, life.y, DEATH_LIGHT, 18, 200, PARTICLE_TYPES.SPARK);
        if (p.fx) p.fx.ring(life.x, life.y, 12, 110, 520, DEATH_HEX, 2.4);
    }, 380);
}

/** DEATH_MARK: o olho cobre a tela e, depois que fecha, o efeito do turno acontece na mesa. */
export async function ronovaMark(p, evt) {
    const victimIsSelf = evt.seat === REL_SEAT.SELF;
    // O aviso da fase anterior (ex.: "escolhendo a cor") não fica por cima dos alertas; o snapshot seguinte o refaz
    p.hud.setPhaseMessage(null);
    // O olho cobrindo a tela é só pra quem foi marcado (nem quem usou, nem espectador): os outros veem só a mesa
    if (victimIsSelf && !p.client.isSpectator) {
        p.audio.play(SFX.DEATH_EYE);
        await getOverlay().play(() => p.audio.play(SFX.DEATH_CLOSE));
    } else {
        p.audio.play(SFX.DEATH_IGNITE, { volume: 0.7 });
    }
    p.hud.flashRonova(victimIsSelf);

    if (evt.kind === DEATH_KIND.END) {
        p.hud.showSpecialAlert(i18n.t('DEATH_END_ALERT'), 'alert-death');
        if (evt.burned && p.pool.isActive(evt.burned.id)) await burnCards(p, [evt.burned.id]);
        // A marca se desfaz (o snapshot seguinte confirma)
        if (victimIsSelf) p.scene.ronovaSelf = false;
        else p.scene.ronovaOpp = false;
        return;
    }
    if (evt.kind === DEATH_KIND.START) {
        p.hud.showSpecialAlert(i18n.t('DEATH_ALERT'), 'alert-death');
        await igniteCards(p, victimIsSelf);
    }
    await drainCards(p, evt.cards || [], victimIsSelf);
}

/** As chamas carmesim tomam todas as cartas do marcado (mão e campo, frente ou verso). */
async function igniteCards(p, victimIsSelf) {
    const pool = p.pool;
    const side = victimIsSelf ? 0 : 1;
    p.audio.play(SFX.DEATH_IGNITE);
    let n = 0;
    for (let id = 0; id < pool.maxCards; id++) {
        if (pool.active[id] !== 1 || zoneSeat(pool.zone[id]) !== side) continue;
        const x = p.centerX(id);
        const y = p.centerY(id);
        const delay = (n++ % 15) * 28;
        setTimeout(() => {
            if (!pool.isActive(id)) return;
            p.particles.emitRise(x, y + 40, DEATH_HEX, 14, 30, 200, PARTICLE_TYPES.STAR);
            p.particles.emitRise(x, y + 40, DEATH_DARK, 8, 28, 150, PARTICLE_TYPES.CIRCLE);
        }, delay);
    }
    // As chamas aparecem já (o snapshot seguinte confirma a marca)
    if (victimIsSelf) p.scene.ronovaSelf = true;
    else p.scene.ronovaOpp = true;
    const life = p.hpPoint(victimIsSelf);
    if (p.fx) p.fx.ring(life.x, life.y, 14, 130, 600, DEATH_HEX, 2.8);
    await sleep(ANIM.DEATH_IGNITE);
}

/**
 * Os números da mão perdem força: as cartas sobem um pouco num brilho carmesim, a força escorre delas em
 * brasas e o valor cai (o marcado e os espectadores veem o número novo; quem usou vê os versos arderem).
 */
async function drainCards(p, cards, victimIsSelf) {
    const pool = p.pool;
    const ids = [];
    for (const c of cards) if (pool.isActive(c.id)) ids.push(c.id);
    if (ids.length === 0) return;

    const lift = victimIsSelf ? -26 : 26;
    const homes = ids.map((id) => ({ y: pool.targetY[id], z: pool.zIndex[id] }));
    p.audio.play(SFX.DEATH_DRAIN);
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        p.animator.cancel(id, pool);
        pool.zIndex[id] = 700 + i;
        pool.hoverOffsetY[id] = 0;
        pool.glowKind[id] = GLOW_DEATH;
        p.tween(id, { targetY: homes[i].y + lift, glow: 1 }, ANIM.DEATH_DRAIN * 0.4, Easing.BackOut);
    }
    await sleep(ANIM.DEATH_DRAIN * 0.4);

    // A força cai: brasas escorrem da carta e o número muda
    for (const c of cards) {
        const id = c.id;
        if (!pool.isActive(id)) continue;
        if (c.to !== undefined) pool.power[id] = c.to;
        const x = p.centerX(id);
        const y = p.centerY(id);
        p.particles.emitBurst(x, y, DEATH_HEX, 16, 150, PARTICLE_TYPES.SQUARE);
        p.particles.emitRise(x, y, DEATH_LIGHT, 8, 25, 120, PARTICLE_TYPES.STAR);
        if (p.fx) p.fx.ring(x, y, 10, 70, 380, DEATH_HEX, 2);
    }
    await sleep(ANIM.DEATH_DRAIN * 0.15);
    await Promise.all(ids.map((id, i) => p.tween(id, { targetY: homes[i].y, glow: 0 }, ANIM.DEATH_DRAIN * 0.45, Easing.QuadOut)));
    for (let i = 0; i < ids.length; i++) pool.zIndex[ids[i]] = homes[i].z;
}

/**
 * Cartas consumidas pelas chamas carmesim: carbonizam de baixo pra cima, as chamas crescem até engolir a
 * carta e ela some em brasas e fumaça.
 */
export async function burnCards(p, ids) {
    const pool = p.pool;
    const live = ids.filter((id) => pool.isActive(id));
    if (live.length === 0) return;
    p.audio.play(SFX.DEATH_BURN);
    for (let i = 0; i < live.length; i++) {
        const id = live[i];
        p.animator.cancel(id, pool);
        pool.zIndex[id] = 720 + i;
        pool.hoverOffsetY[id] = 0;
        pool.burn[id] = 0;
        p.tween(id, { burn: 1 }, ANIM.DEATH_BURN * 0.85, Easing.QuadIn);
        p.tween(id, { targetY: pool.targetY[id] - 16, scale: pool.scale[id] * 1.06 }, ANIM.DEATH_BURN, Easing.QuadOut);
        const x = p.centerX(id);
        const y = p.centerY(id);
        p.particles.emitRise(x, y + 50, DEATH_HEX, 30, 40, 260, PARTICLE_TYPES.STAR);
        p.particles.emitRise(x, y + 50, DEATH_DARK, 18, 36, 180, PARTICLE_TYPES.CIRCLE);
    }
    await sleep(ANIM.DEATH_BURN * 0.7);
    for (const id of live) {
        if (!pool.isActive(id)) continue;
        const x = p.centerX(id);
        const y = p.centerY(id);
        p.particles.emitRise(x, y, '#ff8a5c', 22, 46, 220, PARTICLE_TYPES.SQUARE);
        p.particles.emitRise(x, y, '#2a0a0a', 16, 40, 120, PARTICLE_TYPES.CIRCLE);
        if (p.fx) p.fx.ring(x, y, 12, 90, 420, DEATH_HEX, 2.2);
        p.tween(id, { alpha: 0 }, ANIM.DEATH_BURN * 0.3, Easing.QuadIn);
    }
    await sleep(ANIM.DEATH_BURN * 0.3);
    for (const id of live) p.remove(id);
}

/** DEATH_BURN: as cartas do marcado que lutaram queimam em vez de voltar pra mão. */
export async function ronovaBurn(p, evt) {
    await burnCards(p, evt.ids || []);
}

/** Golpe na vida de uma carta marcada: ela se desfaz em chamas carmesim no impacto. */
export function ronovaHitFx(p, selfIsTarget) {
    const life = p.hpPoint(selfIsTarget);
    p.audio.play(SFX.DEATH_BURN, { volume: 0.8 });
    p.particles.emitBurst(life.x, life.y, DEATH_HEX, 46, 320, PARTICLE_TYPES.STAR, 1.2);
    p.particles.emitRise(life.x, life.y, DEATH_DARK, 26, 50, 200, PARTICLE_TYPES.CIRCLE);
    p.particles.emitRise(life.x, life.y, '#ff8a5c', 22, 40, 260, PARTICLE_TYPES.SQUARE);
    if (p.fx) p.fx.ring(life.x, life.y, 10, 120, 500, DEATH_HEX, 3);
}

/** Revanche/partida nova: um olho que ainda estivesse na tela some na hora. */
export function ronovaReset() {
    if (overlay) overlay.finish();
}

/** Só o resultado (aba em segundo plano / fila atrasada). */
export function ronovaInstant(p, evt) {
    const pool = p.pool;
    if (evt.cards) {
        for (const c of evt.cards) if (pool.isActive(c.id) && c.to !== undefined) pool.power[c.id] = c.to;
    }
    if (evt.burned) p.remove(evt.burned.id);
    if (evt.ids) for (const id of evt.ids) p.remove(id);
}
