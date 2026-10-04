import { CONFIG } from '../config/constants.js';
import { Easing } from './animator.js';
import { PARTICLE_TYPES } from './particle-system.js';
import { MIRROR_RESULT, REL_SEAT } from '../network/protocol.js';
import { SFX } from '../config/sound-presets.js';
import { ZONE } from '../utils/zones.js';
import { i18n } from '../i18n/index.js';
import { TETHER } from './fx-layer.js';
import { getSkullSprite } from './card-art-arcane.js';

/**
 * Cinemáticas das cartas arcanas (Fantasma, Espelho Sombrio, Emboscada, Maldição). Cada função recebe o
 * CinematicPlayer (tween/animate/partículas/áudio/HUD/FxLayer) e o evento do servidor, e termina dentro do
 * tempo que o servidor reserva (TIMINGS.*), para a fila de eventos dos dois jogadores nunca atrasar.
 */

const { ANIM, CARD_DIMENSIONS, CARD_TYPES } = CONFIG;
const HALF_W = CARD_DIMENSIONS.WIDTH / 2;
const HALF_H = CARD_DIMENSIONS.HEIGHT / 2;
const TAU = Math.PI * 2;

const GHOST_HEX = '#b388ff';
const GHOST_MIST = [217, 204, 255];
const MIRROR_SILVER = '#e6e0ff';
const MIRROR_DARK = '#7a3cff';
const AMBUSH_HEX = '#39ff14';
const AMBUSH_RGB = [57, 255, 20];
const CURSE_HEX = '#a020f0';
const CURSE_LIGHT = '#d9a6ff';
const CURSE_VIGNETTE = '#2a004d';

// Tipos de brilho de carta (pool.glowKind): ver CARD_GLOW em canvas2d-renderer.js
export const GLOW = Object.freeze({ CURSE: 1, AMBUSH: 2, GHOST: 3, MIRROR: 4, KARMA: 5, CRYSTAL: 6 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Golpe na vida visto na HUD: onda de partículas, texto flutuante e (se for você) o vermelho de dano.
 * Escudo (`absorbed`, só chega pra quem ele protegeu) e Reviver segurando (`guarded`) trocam a cor do texto.
 */
function lifeHitFx(p, selfIsTarget, damage, absorbed, guarded, variant, waveHex) {
    p.audio.play(SFX.DAMAGE);
    p.particles.emitDamageWave(selfIsTarget, waveHex, 110, PARTICLE_TYPES.CIRCLE);
    if (selfIsTarget) p.hud.flashDamage();
    let v = variant;
    if (selfIsTarget && absorbed > 0) {
        v = 'shielded';
        p.hud.flashShield();
        p.audio.play(SFX.SHIELD_HIT);
        const hp = p.hpPoint(true);
        p.particles.emitBurst(hp.x, hp.y, '#7df9ff', 40, 260, PARTICLE_TYPES.STAR);
    }
    if (guarded) {
        v = 'guarded';
        p.hud.flashGuard(selfIsTarget);
        const hp = p.hpPoint(selfIsTarget);
        p.particles.emitRise(hp.x, hp.y, '#ffd700', 30, 45, 300, PARTICLE_TYPES.STAR);
    }
    p.hud.showFloatingText(`-${damage} ♥`, selfIsTarget, v);
}

/** Estilhaços de vidro/espelho quebrando no ponto. */
function shatterAt(p, x, y, tintHex) {
    p.particles.emitBurst(x, y, MIRROR_SILVER, 46, 420, PARTICLE_TYPES.SQUARE, 1.5);
    p.particles.emitBurst(x, y, '#ffffff', 22, 560, PARTICLE_TYPES.SPARK, 1.2);
    p.particles.emitBurst(x, y, tintHex, 24, 300, PARTICLE_TYPES.SQUARE, 1.1);
    if (p.fx) p.fx.ring(x, y, 12, 120, 480, MIRROR_SILVER, 2.5);
}

// --- Revelação ---------------------------------------------------------------------

/** Floreio na revelação: onda de distorção etérea (Fantasma) ou clarão espelhado com glitch (Espelho). */
export function revealFlourish(p, face) {
    const id = face.id;
    if (!p.pool.isActive(id)) return;
    const x = p.centerX(id);
    const y = p.centerY(id);
    if (face.type === CARD_TYPES.GHOST) {
        if (p.fx) {
            p.fx.ring(x, y, 18, 105, 650, GHOST_HEX, 2.4);
            setTimeout(() => p.fx.ring(x, y, 10, 80, 520, '#e6dcff', 1.6), 120);
        }
        p.particles.emitRise(x, y, '#d9ccff', 18, 45, 90, PARTICLE_TYPES.CIRCLE);
        p.pool.alpha[id] = 0.5;
        p.tween(id, { alpha: 1 }, 320, Easing.QuadOut);
    } else if (face.type === CARD_TYPES.MIRROR) {
        if (p.fx) p.fx.ring(x, y, 20, 110, 420, MIRROR_SILVER, 2);
        p.particles.emitBurst(x, y, '#ffffff', 16, 220, PARTICLE_TYPES.STAR);
        p.animate(180, (t) => { if (p.pool.isActive(id)) p.pool.glitch[id] = t < 1 ? 1 - t : 0; });
    }
}

// --- Consumo (só quem usou vê o tipo) ------------------------------------------------

/** Emboscada armada: fumaça tóxica no USE e fios verdes correndo até o próprio slot de Defesa. */
export function ambushArmedFx(p, x, y, isSelf) {
    const def = p.slotCenter(isSelf ? ZONE.SELF_DEFENSE : ZONE.OPP_DEFENSE);
    p.particles.emitRise(x, y, '#2e8b22', 30, 35, 140, PARTICLE_TYPES.CIRCLE);
    p.particles.emitRise(x, y, AMBUSH_HEX, 16, 25, 200, PARTICLE_TYPES.SPARK);
    p.particles.emitLine(x, y, def.x, def.y, AMBUSH_HEX, 34, PARTICLE_TYPES.STAR);
    if (p.fx) {
        p.fx.ring(def.x, def.y, 20, 95, 600, AMBUSH_HEX, 2);
        setTimeout(() => p.fx.ring(def.x, def.y, 10, 70, 480, '#b6ff9e', 1.4), 160);
    }
}

/** Maldição plantada: chamas roxas sobem do USE e uma caveira gigante translúcida aparece e se dissipa. */
export function curseArmedFx(p, x, y, isSelf) {
    p.particles.emitRise(x, y, CURSE_HEX, 50, 40, 260, PARTICLE_TYPES.CIRCLE);
    p.particles.emitRise(x, y, CURSE_LIGHT, 26, 30, 340, PARTICLE_TYPES.STAR);
    p.hud.showSpecialAlert(i18n.t('CURSE_ALERT'), 'alert-curse');
    if (!p.fx) return;
    p.fx.apparition(getSkullSprite(), x, y - 70, 110, 190, 520, 0.8);
    p.fx.vignette(CURSE_VIGNETTE, 0.5, 700);
    p.fx.ring(x, y, 15, 140, 600, CURSE_HEX, 2.5);
}

// --- Fantasma ----------------------------------------------------------------------

/** GHOST_PASS: todos os Fantasmas do evento atravessam ao mesmo tempo (Fantasma x Fantasma se cruzam). */
export async function ghostPass(p, evt) {
    await Promise.all(evt.passes.map((pass) => ghostOne(p, pass)));
}

/**
 * Um Fantasma: fica translúcido, vira neblina à deriva, atravessa a carta da frente (que estremece — ou,
 * se for um Espelho, se desfaz), se recompõe gigante e translúcido sobre a vida do alvo e explode em éter.
 */
async function ghostOne(p, pass) {
    const pool = p.pool;
    const id = pass.ghostId;
    const selfIsTarget = pass.seat === REL_SEAT.OPPONENT;
    const hp = p.hpPoint(selfIsTarget);
    if (!pool.isActive(id)) {
        lifeHitFx(p, selfIsTarget, pass.damage, pass.absorbed, pass.guarded, 'ghost', GHOST_HEX);
        return;
    }
    // Ponto onde ele se recompõe: sobre a vida, mas empurrado pra dentro da tela (a vida fica num canto)
    const loomW = HALF_W * ANIM.GHOST_LOOM_SCALE + 12;
    const loomH = HALF_H * ANIM.GHOST_LOOM_SCALE + 12;
    const life = {
        x: Math.min(p.viewport.width - loomW, Math.max(loomW, hp.x)),
        y: Math.min(p.viewport.height - loomH, Math.max(loomH, hp.y))
    };

    p.animator.cancel(id, pool);
    pool.zIndex[id] = 650;
    pool.hoverOffsetY[id] = 0;
    const sx = p.centerX(id);
    const sy = p.centerY(id);
    p.audio.play(SFX.GHOST_PASS);
    if (p.fx) p.fx.ring(sx, sy, 20, 100, 600, GHOST_HEX, 2.5);
    p.particles.emitRise(sx, sy, '#d9ccff', 26, 42, 120, PARTICLE_TYPES.CIRCLE);
    pool.glowKind[id] = GLOW.GHOST;
    pool.glow[id] = 0.8;

    // 1) Fica fora de fase
    await p.tween(id, { alpha: ANIM.GHOST_ALPHA, scale: 1.12 }, ANIM.GHOST_FADE, Easing.QuadOut);

    // 2) Deriva como neblina passando pela carta da frente até a vida (curva de Bézier)
    const throughId = pass.dissolveId >= 0 ? pass.dissolveId : pass.throughId;
    const through = throughId >= 0 && pool.isActive(throughId) ? throughId : -1;
    const tx = through >= 0 ? p.centerX(through) : (sx + life.x) / 2;
    const ty = through >= 0 ? p.centerY(through) : (sy + life.y) / 2;
    const baseRot = pool.rotation[id];
    let crossed = false;
    await p.animate(ANIM.GHOST_DRIFT, (t) => {
        if (!pool.isActive(id)) return;
        const e = Easing.QuadInOut(t);
        const u = 1 - e;
        const x = u * u * sx + 2 * u * e * tx + e * e * life.x;
        const y = u * u * sy + 2 * u * e * ty + e * e * life.y;
        pool.targetX[id] = pool.x[id] = x - HALF_W;
        pool.targetY[id] = pool.y[id] = y - HALF_H;
        pool.rotation[id] = baseRot + Math.sin(t * Math.PI * 3) * 0.12;
        if (t < 1) {
            for (let n = 0; n < 3; n++) {
                p.particles.emit(
                    x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 50,
                    (Math.random() - 0.5) * 30, -10 - Math.random() * 30,
                    0.5 + Math.random() * 0.4, 3 + Math.random() * 4, PARTICLE_TYPES.CIRCLE,
                    GHOST_MIST[0], GHOST_MIST[1], GHOST_MIST[2]
                );
            }
        }
        if (!crossed && e >= 0.5 && through >= 0) {
            crossed = true;
            ghostThrough(p, through, through === pass.dissolveId);
        }
    });

    // 3) Silhueta gigante e translúcida sobre a vida
    p.audio.play(SFX.GHOST_HIT);
    if (p.fx) {
        p.fx.ring(hp.x, hp.y, 20, 120, 600, GHOST_HEX, 2.5);
        p.fx.ring(life.x, life.y, 30, 170, 700, GHOST_HEX, 3);
    }
    lifeHitFx(p, selfIsTarget, pass.damage, pass.absorbed, pass.guarded, 'ghost', GHOST_HEX);
    pool.rotation[id] = 0;
    await p.tween(id, { scale: ANIM.GHOST_LOOM_SCALE, alpha: 0.55 }, ANIM.GHOST_LOOM, Easing.BackOut);

    // 4) Dissipa em partículas etéreas
    if (pool.isActive(id)) {
        const x = p.centerX(id);
        const y = p.centerY(id);
        p.particles.emitBurst(x, y, GHOST_HEX, 60, 320, PARTICLE_TYPES.CIRCLE, 1.4);
        p.particles.emitBurst(x, y, '#ffffff', 20, 240, PARTICLE_TYPES.STAR);
        p.particles.emitRise(x, y, '#d9ccff', 30, 70, 160, PARTICLE_TYPES.CIRCLE);
    }
    await p.tween(id, { alpha: 0, scale: ANIM.GHOST_LOOM_SCALE + 0.35 }, ANIM.GHOST_BURST, Easing.QuadOut);
    p.remove(id);
}

/** O Fantasma passando: a carta estremece "sentindo a presença"; um Espelho (sem o que copiar) se desfaz. */
function ghostThrough(p, id, dissolve) {
    const pool = p.pool;
    const x = p.centerX(id);
    const y = p.centerY(id);
    if (p.fx) p.fx.ring(x, y, 12, 85, 450, '#e6dcff', 1.8);
    p.particles.emitBurst(x, y, '#d9ccff', 18, 150, PARTICLE_TYPES.CIRCLE);
    if (dissolve) {
        p.audio.play(SFX.FIZZLE);
        p.animate(260, (t) => { if (pool.isActive(id)) pool.glitch[id] = 1 - t; });
        p.tween(id, { alpha: 0, scale: 0.85 }, 320, Easing.QuadIn).then(() => {
            if (pool.isActive(id)) {
                p.particles.emitBurst(p.centerX(id), p.centerY(id), MIRROR_SILVER, 24, 180, PARTICLE_TYPES.SQUARE);
                p.remove(id);
            }
        });
        return;
    }
    const base = pool.rotation[id];
    p.animate(360, (t) => {
        if (pool.isActive(id)) pool.rotation[id] = base + (t < 1 ? Math.sin(t * Math.PI * 10) * 0.07 * (1 - t) : 0);
    });
}

// --- Espelho Sombrio ---------------------------------------------------------------

/** MIRROR_CLASH: cópia (+bônus) e vitória, ou paradoxo com os dois se estilhaçando. */
export async function mirrorClash(p, evt) {
    if (evt.result === MIRROR_RESULT.PARADOX) {
        await mirrorParadox(p, evt.mirrorId, evt.targetId);
        return;
    }
    const pool = p.pool;
    const m = evt.mirrorId;
    const t = evt.targetId;
    const bonus = CONFIG.MIRROR.COPY_BONUS;
    if (!pool.isActive(m) || !pool.isActive(t)) {
        p.remove(t);
        if (pool.isActive(m)) pool.power[m] = bonus;
        return;
    }

    const mx = p.centerX(m);
    const my = p.centerY(m);
    const tx = p.centerX(t);
    const ty = p.centerY(t);
    const baseZ = pool.zIndex[m];
    pool.zIndex[m] = 600;
    pool.glowKind[m] = GLOW.MIRROR;
    pool.glow[m] = 0.9;

    // 1) Absorve: energia escura corre da inimiga até o Espelho; o valor dela aparece em vermelho-sangue
    p.audio.play(SFX.MIRROR_COPY);
    pool.power[m] = evt.copied;
    pool.numberTint[m] = 1;
    if (p.fx) p.fx.ring(tx, ty, 10, 90, 420, MIRROR_DARK, 2);
    const tBase = pool.rotation[t];
    await p.animate(ANIM.MIRROR_ABSORB, (k) => {
        if (!pool.isActive(t)) return;
        pool.rotation[t] = tBase + (k < 1 ? Math.sin(k * Math.PI * 12) * 0.04 : 0);
        if (k >= 1) return;
        for (let n = 0; n < 3; n++) {
            const ox = (Math.random() - 0.5) * 60;
            const oy = (Math.random() - 0.5) * 80;
            const dark = n % 2 === 0;
            p.particles.emit(tx + ox, ty + oy, (mx - tx - ox) * 2.4, (my - ty - oy) * 2.4, 0.42, 2 + Math.random() * 3,
                PARTICLE_TYPES.SPARK, dark ? 122 : 230, dark ? 60 : 224, dark ? 255 : 255);
        }
    });

    // 2) Glitch da absorção
    await p.animate(ANIM.MIRROR_GLITCH, (k) => { if (pool.isActive(m)) pool.glitch[m] = k < 1 ? 0.6 + Math.random() * 0.4 : 0; });

    // 3) +bônus: o número pulsa pro valor que vence, em branco
    pool.power[m] = evt.copied + bonus;
    pool.numberTint[m] = 0;
    if (p.fx) p.fx.ring(mx, my, 18, 100, 380, '#ffffff', 2.2);
    p.particles.emitBurst(mx, my, '#ffffff', 22, 220, PARTICLE_TYPES.STAR);
    await p.tween(m, { scale: 1.18 }, ANIM.MIRROR_BONUS, Easing.BackOut);

    // 4) Avança deixando estilhaços flutuando atrás e estilhaça a inimiga como vidro
    const homeX = pool.targetX[m];
    const homeY = pool.targetY[m];
    const dir = Math.sign(pool.targetY[t] - homeY) || -1;
    await p.tween(m, { scale: 1.28, targetY: homeY - dir * 22 }, ANIM.MIRROR_LIFT);
    await Promise.all([
        p.tween(m, { scale: 1, targetX: pool.targetX[t], targetY: pool.targetY[t] - dir * HALF_H }, ANIM.MIRROR_DASH, Easing.CubicIn),
        p.animate(ANIM.MIRROR_DASH, (k) => {
            if (k >= 1 || !pool.isActive(m)) return;
            for (let n = 0; n < 3; n++) {
                p.particles.emit(p.centerX(m) + (Math.random() - 0.5) * 50, p.centerY(m) + (Math.random() - 0.5) * 60,
                    (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.6, 2 + Math.random() * 3, PARTICLE_TYPES.SQUARE, 225, 220, 255);
            }
        })
    ]);
    p.audio.play(SFX.MIRROR_SHATTER);
    shatterAt(p, tx, ty, CONFIG.COLOR_HEX[pool.color[t]] || MIRROR_SILVER);
    p.remove(t);
    pool.power[m] = bonus;

    // 5) Volta ao lugar com o valor que sobrou
    await p.tween(m, { targetX: homeX, targetY: homeY }, ANIM.MIRROR_RETURN);
    pool.zIndex[m] = baseZ;
    p.tween(m, { glow: 0 }, 300);
}

/** Paradoxo: as duas cartas glitcham, se lançam uma na outra e se estilhaçam juntas. */
async function mirrorParadox(p, a, b) {
    const pool = p.pool;
    if (!pool.isActive(a) || !pool.isActive(b)) {
        p.remove(a);
        p.remove(b);
        return;
    }
    p.audio.play(SFX.MIRROR_COPY, { pitch: -5 });
    pool.glowKind[a] = GLOW.MIRROR;
    pool.glow[a] = 1;
    await p.animate(ANIM.MIRROR_GLITCH + 120, (k) => {
        const g = k < 1 ? 0.5 + Math.random() * 0.5 : 0;
        if (pool.isActive(a)) pool.glitch[a] = g;
        if (pool.isActive(b)) pool.glitch[b] = g;
    });
    const midX = (pool.targetX[a] + pool.targetX[b]) / 2;
    const midY = (pool.targetY[a] + pool.targetY[b]) / 2;
    await Promise.all([p.tween(a, { scale: 1.2 }, ANIM.MIRROR_LIFT), p.tween(b, { scale: 1.2 }, ANIM.MIRROR_LIFT)]);
    await Promise.all([
        p.tween(a, { targetX: midX, targetY: midY + 20 * (Math.sign(pool.targetY[a] - midY) || 1) }, ANIM.MIRROR_DASH, Easing.CubicIn),
        p.tween(b, { targetX: midX, targetY: midY + 20 * (Math.sign(pool.targetY[b] - midY) || -1) }, ANIM.MIRROR_DASH, Easing.CubicIn)
    ]);
    p.audio.play(SFX.MIRROR_SHATTER);
    const x = midX + HALF_W;
    const y = midY + HALF_H;
    shatterAt(p, x, y, MIRROR_DARK);
    p.particles.emitBurst(x, y, MIRROR_DARK, 40, 380, PARTICLE_TYPES.SQUARE, 1.3);
    p.flashScreen(0.45, '#d9d2ff');
    p.remove(a);
    p.remove(b);
    await sleep(ANIM.MIRROR_RETURN);
}

/**
 * MIRROR_HIT: o Espelho dispara contra a vida do alvo (clarão escuro, "-X"); meio segundo depois o reflexo
 * pulsa na vida do dono, com estilhaços voando no sentido contrário e "-Y" do lado dele. Sem valor copiado
 * ele só racha e se desfaz.
 */
export async function mirrorHit(p, evt) {
    const pool = p.pool;
    const id = evt.cardId;
    const attackerIsSelf = evt.seat === REL_SEAT.SELF;
    const selfIsTarget = !attackerIsSelf;

    if (!(evt.damage > 0)) {
        p.audio.play(SFX.FIZZLE);
        if (pool.isActive(id)) {
            await p.animate(420, (k) => {
                if (!pool.isActive(id)) return;
                pool.glitch[id] = k < 1 ? 0.8 * (1 - k) : 0;
                pool.crack[id] = k;
            });
            p.particles.emitBurst(p.centerX(id), p.centerY(id), MIRROR_SILVER, 26, 200, PARTICLE_TYPES.SQUARE);
            await p.tween(id, { alpha: 0, scale: 0.8 }, 260, Easing.QuadIn);
            p.remove(id);
        }
        return;
    }

    // Se o Espelho não tinha valor, ele copia de uma carta aleatória da mão do alvo agora mesmo!
    if (evt.copyFromId >= 0 && pool.isActive(id)) {
        const tid = evt.copyFromId;
        if (pool.isActive(tid)) {
            const mx = p.centerX(id);
            const my = p.centerY(id);
            const tx = p.centerX(tid);
            const ty = p.centerY(tid);
            const baseZ = pool.zIndex[id];
            
            pool.zIndex[id] = 600;
            pool.glowKind[id] = GLOW.MIRROR;
            pool.glow[id] = 0.9;

            p.audio.play(SFX.MIRROR_COPY);
            pool.power[id] = evt.copyValue;
            pool.numberTint[id] = 1;
            
            if (p.fx) p.fx.ring(tx, ty, 10, 90, 420, MIRROR_DARK, 2);
            
            const tBase = pool.rotation[tid];
            await p.animate(ANIM.MIRROR_ABSORB, (k) => {
                if (pool.isActive(tid)) pool.rotation[tid] = tBase + (k < 1 ? Math.sin(k * Math.PI * 12) * 0.04 : 0);
                if (k >= 1 || !pool.isActive(id)) return;
                for (let n = 0; n < 3; n++) {
                    const ox = (Math.random() - 0.5) * 60;
                    const oy = (Math.random() - 0.5) * 80;
                    const dark = n % 2 === 0;
                    p.particles.emit(tx + ox, ty + oy, (mx - tx - ox) * 2.4, (my - ty - oy) * 2.4, 0.42, 2 + Math.random() * 3,
                        PARTICLE_TYPES.SPARK, dark ? 122 : 230, dark ? 60 : 224, dark ? 255 : 255);
                }
            });

            await p.animate(ANIM.MIRROR_GLITCH, (k) => { if (pool.isActive(id)) pool.glitch[id] = k < 1 ? 0.6 + Math.random() * 0.4 : 0; });
            
            pool.power[id] = evt.copyValue + CONFIG.MIRROR.COPY_BONUS;
            pool.numberTint[id] = 0;
            if (p.fx) p.fx.ring(mx, my, 18, 100, 380, '#ffffff', 2.2);
            p.particles.emitBurst(mx, my, '#ffffff', 22, 220, PARTICLE_TYPES.STAR);
            await p.tween(id, { scale: 1.18 }, ANIM.MIRROR_BONUS, Easing.BackOut);
            
            // Retorna ao normal antes de investir contra a vida
            pool.zIndex[id] = baseZ;
            await p.tween(id, { scale: 1 }, 200);
        }
    }

    const targetLife = p.hpPoint(selfIsTarget);
    if (pool.isActive(id)) {
        const startY = pool.targetY[id];
        const exitY = selfIsTarget ? p.viewport.height + 100 : -CARD_DIMENSIONS.HEIGHT - 100;
        pool.zIndex[id] = 600;
        pool.glowKind[id] = GLOW.MIRROR;
        pool.glow[id] = 0.8;
        await p.tween(id, { scale: 1.3 }, ANIM.DIRECT_LIFT);
        await p.tween(id, { targetY: selfIsTarget ? startY - 30 : startY + 30 }, ANIM.DIRECT_RECOIL);
        await p.tween(id, { targetY: exitY, scale: 1 }, ANIM.DIRECT_DASH, Easing.CubicIn);
        p.remove(id);
    }

    // Golpe no alvo: clarão escuro
    p.audio.play(SFX.MIRROR_SHATTER);
    if (p.fx) {
        p.fx.vignette(CURSE_VIGNETTE, 0.55, 520);
        p.fx.ring(targetLife.x, targetLife.y, 20, 150, 520, MIRROR_DARK, 3);
    }
    shatterAt(p, targetLife.x, targetLife.y, MIRROR_DARK);
    lifeHitFx(p, selfIsTarget, evt.damage, evt.absorbed, evt.guarded, 'mirror', MIRROR_DARK);

    await sleep(ANIM.MIRROR_RECOIL_DELAY);
    if (evt.recoil > 0) {
        // O reflexo: estilhaços voltam do alvo pro dono e o mesmo golpe pulsa do lado dele
        const ownerLife = p.hpPoint(attackerIsSelf);
        p.audio.play(SFX.MIRROR_RECOIL);
        p.particles.emitLine(targetLife.x, targetLife.y, ownerLife.x, ownerLife.y, MIRROR_SILVER, 40, PARTICLE_TYPES.SQUARE);
        if (p.fx) {
            p.fx.ring(ownerLife.x, ownerLife.y, 20, 150, 520, MIRROR_DARK, 3);
            p.fx.vignette(CURSE_VIGNETTE, 0.45, 480);
        }
        p.particles.emitBurst(ownerLife.x, ownerLife.y, MIRROR_SILVER, 30, 320, PARTICLE_TYPES.SQUARE, 1.2);
        lifeHitFx(p, attackerIsSelf, evt.recoil, evt.recoilAbsorbed, evt.recoilGuarded, 'mirror', MIRROR_DARK);
    }
    await sleep(420);
}

// --- Emboscada ---------------------------------------------------------------------

/**
 * AMBUSH: fios verdes espinhosos reaparecem e constringem a carta, o número pulsa e sobe com um clarão
 * verde, e partículas sobem em espiral. "EMBOSCADA!" em verde-néon.
 */
export async function ambush(p, evt) {
    const pool = p.pool;
    const id = evt.cardId;
    if (!pool.isActive(id)) return;
    // Os fios duram até o salto do número e se rompem nele (o X nunca cobre o valor novo)
    const bindTime = ANIM.AMBUSH_BIND + ANIM.AMBUSH_PULSE * 0.4;
    const cx = p.centerX(id);
    const cy = p.centerY(id);
    const baseZ = pool.zIndex[id];
    pool.zIndex[id] = 600;
    pool.glowKind[id] = GLOW.AMBUSH;
    pool.glow[id] = 1;
    p.audio.play(SFX.AMBUSH_TRIGGER);
    p.hud.showSpecialAlert(i18n.t('AMBUSH_ALERT'), 'alert-ambush');
    if (p.fx) {
        for (let k = 0; k < 3; k++) {
            const a = (k / 3) * TAU + 0.5;
            p.fx.tether(cx + Math.cos(a) * 140, cy + Math.sin(a) * 120, id, bindTime, TETHER.THREAD);
        }
    }

    // 1) Constringida
    const base = pool.rotation[id];
    await Promise.all([
        p.tween(id, { scale: 0.9 }, ANIM.AMBUSH_BIND, Easing.QuadIn),
        p.animate(ANIM.AMBUSH_BIND, (k) => {
            if (pool.isActive(id)) pool.rotation[id] = base + (k < 1 ? Math.sin(k * Math.PI * 14) * 0.035 : 0);
        })
    ]);

    // 2) Os fios arrebentam e o número salta (clarão verde)
    p.particles.emitBurst(cx, cy, '#9dff7a', 30, 420, PARTICLE_TYPES.SPARK, 1.2);
    pool.power[id] = evt.to;
    p.flashScreen(0.35, '#8dff6a');
    if (p.fx) p.fx.ring(cx, cy, 20, 120, 420, AMBUSH_HEX, 3);
    p.particles.emitBurst(cx, cy, AMBUSH_HEX, 40, 300, PARTICLE_TYPES.STAR, 1.2);
    await p.tween(id, { scale: 1.28 }, ANIM.AMBUSH_PULSE, Easing.BackOut);

    // 3) Espiral verde subindo enquanto a carta assenta
    await Promise.all([
        p.tween(id, { scale: 1 }, ANIM.AMBUSH_RISE, Easing.QuadOut),
        p.animate(ANIM.AMBUSH_RISE, (k) => {
            if (k >= 1) return;
            for (let n = 0; n < 3; n++) {
                const a = k * TAU * 3 + (n / 3) * TAU;
                const r = 30 + 30 * k;
                p.particles.emit(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, -Math.sin(a) * 60, -90 - k * 60, 0.6,
                    2.5 + Math.random() * 2, PARTICLE_TYPES.STAR, AMBUSH_RGB[0], AMBUSH_RGB[1], AMBUSH_RGB[2]);
            }
        })
    ]);
    pool.zIndex[id] = baseZ;
    p.tween(id, { glow: 0 }, 350);
}

// --- Maldição ----------------------------------------------------------------------

/**
 * CURSE_TRIGGERED (início da rodada, antes da preparação): vinheta roxa, correntes emergem da borda e
 * envolvem as cartas atingidas na mão do alvo, que tremem e racham; o valor cai (o alvo vê a face mudando,
 * quem amaldiçoou só vê os versos brilhando) e as correntes se estilhaçam.
 */
export async function curseTriggered(p, evt) {
    const pool = p.pool;
    const isVictim = evt.seat === REL_SEAT.OPPONENT;
    const cards = evt.cards || [];
    if (cards.length === 0) {
        // Só quem amaldiçoou recebe: a mão do alvo não tinha o que sofrer
        p.audio.play(SFX.FIZZLE);
        const c = p.slotCenter(ZONE.OPP_ATTACK);
        p.particles.emitRise(c.x, c.y - 120, CURSE_HEX, 24, 60, 150, PARTICLE_TYPES.CIRCLE);
        return;
    }

    const ids = [];
    for (const c of cards) if (pool.isActive(c.id)) ids.push(c.id);
    const total = ANIM.CURSE_CHAINS + ANIM.CURSE_SHAKE + ANIM.CURSE_DROP + ANIM.CURSE_SHATTER;
    const handAtBottom = isVictim;
    const anchorY = handAtBottom ? p.viewport.height + 60 : -60;
    const lift = handAtBottom ? -38 : 38;

    p.audio.play(SFX.CURSE_LAUGH);
    p.hud.showSpecialAlert(i18n.t('CURSE_ALERT'), 'alert-curse');
    if (p.fx) p.fx.vignette(CURSE_VIGNETTE, 0.85, total);

    const homes = ids.map((id) => ({ x: pool.targetX[id], y: pool.targetY[id], z: pool.zIndex[id], s: pool.scale[id] }));
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        p.animator.cancel(id, pool);
        pool.zIndex[id] = 700 + i;
        pool.hoverOffsetY[id] = 0;
        pool.glowKind[id] = GLOW.CURSE;
        if (p.fx) p.fx.tether(p.centerX(id) + (i % 2 === 0 ? -40 : 40), anchorY, id, total, TETHER.CHAIN);
    }

    // 1) Correntes emergem e puxam as cartas pra fora da mão
    setTimeout(() => p.audio.play(SFX.CURSE_CHAINS), 120);
    await Promise.all(ids.map((id, i) => p.tween(id, { targetY: homes[i].y + lift, scale: homes[i].s * 1.12 }, ANIM.CURSE_CHAINS, Easing.BackOut)));
    for (const id of ids) p.tween(id, { glow: 1 }, 200);

    // 2) Tremem violentamente e racham com fissuras roxas
    await p.animate(ANIM.CURSE_SHAKE, (k) => {
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (!pool.isActive(id)) continue;
            const amp = k < 1 ? 5 * (0.6 + 0.4 * k) : 0;
            pool.targetX[id] = pool.x[id] = homes[i].x + Math.sin(k * 90 + i * 2) * amp;
            pool.crack[id] = k;
        }
    });

    // 3) O valor cai (o alvo vê a face nova; quem amaldiçoou vê o verso pulsar)
    p.audio.play(SFX.CURSE_CRACK);
    p.flashScreen(0.3, '#b35cff');
    for (const c of cards) {
        const id = c.id;
        if (!pool.isActive(id)) continue;
        if (isVictim && c.type !== undefined) {
            pool.type[id] = c.type;
            pool.color[id] = c.color;
            pool.power[id] = c.power;
        }
        const x = p.centerX(id);
        const y = p.centerY(id);
        if (p.fx) p.fx.ring(x, y, 12, 100, 420, CURSE_LIGHT, 2.4);
        p.particles.emitBurst(x, y, CURSE_HEX, 34, 260, PARTICLE_TYPES.SQUARE);
        p.particles.emitBurst(x, y, CURSE_LIGHT, 14, 200, PARTICLE_TYPES.STAR);
    }
    await p.animate(ANIM.CURSE_DROP, (k) => {
        for (const id of ids) if (pool.isActive(id)) pool.glitch[id] = k < 1 ? (1 - k) * 0.7 : 0;
    });

    // 4) As correntes se estilhaçam e as cartas voltam pra mão
    p.audio.play(SFX.CURSE_CHAINS, { pitch: -4, volume: 0.7 });
    for (const id of ids) {
        if (!pool.isActive(id)) continue;
        const x = p.centerX(id);
        const y = p.centerY(id);
        p.particles.emitLine(x, y, x + (Math.random() - 0.5) * 80, anchorY, CURSE_LIGHT, 24, PARTICLE_TYPES.SQUARE);
        p.particles.emitRise(x, y, CURSE_HEX, 20, 40, 120, PARTICLE_TYPES.CIRCLE);
    }
    await Promise.all(ids.map((id, i) => Promise.all([
        p.tween(id, { targetX: homes[i].x, targetY: homes[i].y, scale: homes[i].s, glow: 0, crack: 0 }, ANIM.CURSE_SHATTER, Easing.QuadOut)
    ])));
    for (let i = 0; i < ids.length; i++) pool.zIndex[ids[i]] = homes[i].z;
}

/** Aplica só o resultado da Maldição (aba em segundo plano / fila atrasada). */
export function curseInstant(p, evt) {
    if (evt.seat !== REL_SEAT.OPPONENT) return;
    for (const c of evt.cards || []) {
        if (!p.pool.isActive(c.id) || c.type === undefined) continue;
        p.pool.type[c.id] = c.type;
        p.pool.color[c.id] = c.color;
        p.pool.power[c.id] = c.power;
    }
}
