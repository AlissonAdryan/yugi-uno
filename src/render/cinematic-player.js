import { surgeCinematic, surgeReset } from './cinematics-surge.js';
import { CONFIG } from '../config/constants.js';
import { Easing } from './animator.js';
import { PARTICLE_TYPES } from './particle-system.js';
import { EVENT, GAME_RESULT, HIT_EFFECT, MIRROR_RESULT, REL_SEAT } from '../network/protocol.js';
import { SFX } from '../config/sound-presets.js';
import { ZONE, zoneSeat } from '../utils/zones.js';
import { i18n } from '../i18n/index.js';
import {
    ambush, ambushArmedFx, curseArmedFx, curseInstant, curseTriggered, ghostPass, mirrorClash, mirrorHit, revealFlourish
} from './cinematics-arcane.js';
import {
    collapse, handRewind, handRewindDone, karma, karmaHit, panic, prison, prisonHit, ultimateInstant
} from './cinematics-ultimate.js';
import { ronovaBurn, ronovaCastFx, ronovaHitFx, ronovaInstant, ronovaMark, ronovaReset } from './cinematics-death.js';

const { ANIM, CARD_DIMENSIONS, COLOR, CARD_TYPES } = CONFIG;
const HALF_W = CARD_DIMENSIONS.WIDTH / 2;
const HALF_H = CARD_DIMENSIONS.HEIGHT / 2;
const FIREWORK_COLORS = ['#2ecc71', '#f1c40f', '#3498db', '#9b59b6'];

// Explosão do consumível ao ser usado. Só o dono conhece o tipo (o oponente vê o verso: efeito genérico).
// `toLife`: a energia da carta corre do slot USE até a caixa de vida do dono.
const CONSUMABLE_FX_DEFAULT = Object.freeze({ color: '#9b59b6', sound: SFX.CONSUMABLE, toLife: false });
const CONSUMABLE_FX = Object.freeze({
    [CARD_TYPES.CHANGE_COLOR]: CONSUMABLE_FX_DEFAULT,
    [CARD_TYPES.HEAL]: Object.freeze({ color: '#2ecc71', sound: SFX.HEAL_USE, toLife: true }),
    [CARD_TYPES.SHIELD]: Object.freeze({ color: '#00e5ff', sound: SFX.SHIELD_UP, toLife: true }),
    [CARD_TYPES.REVIVE]: Object.freeze({ color: '#ffd700', sound: SFX.REVIVE_USE, toLife: true }),
    [CARD_TYPES.PAINT]: Object.freeze({ color: '#7b68ee', sound: SFX.PAINT_USE, toLife: false }),
    [CARD_TYPES.GUARD_SWAP]: Object.freeze({ color: '#7fdbff', sound: SFX.GUARD_SWAP_USE, toLife: false }),
    [CARD_TYPES.AMBUSH]: Object.freeze({ color: '#39ff14', sound: SFX.AMBUSH_USE, toLife: false }),
    [CARD_TYPES.CURSE]: Object.freeze({ color: '#a020f0', sound: SFX.CURSE_USE, toLife: false }),
    [CARD_TYPES.DEATH]: Object.freeze({ color: '#ff2a3d', sound: SFX.DEATH_USE, toLife: false })
});
const PAINT_SPLASH_COLORS = Object.freeze(CONFIG.BASIC_COLORS.map((c) => CONFIG.COLOR_HEX[c]));
const SWAP_COLOR = '#7fdbff';
const STORM_COLOR = '#8ff0ff';
const STORM_CORE = '#fff7b0';
const AMBUSH_GREEN = '#39ff14';
const STACK_DX = CONFIG.STACK_OFFSET.X;
const STACK_DY = CONFIG.STACK_OFFSET.Y;

function hexChannel(hex, offset) {
    return parseInt(hex.slice(offset, offset + 2), 16) || 255;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rachaduras da carta gigante: polilinhas do centro pras bordas, em coordenadas de carta (100x150). */
function makeCracks() {
    const cracks = [];
    const count = 7;
    const cx = CARD_DIMENSIONS.WIDTH / 2;
    const cy = CARD_DIMENSIONS.HEIGHT * 0.48;
    for (let c = 0; c < count; c++) {
        const baseAngle = (c / count) * Math.PI * 2 + Math.random() * 0.5;
        const steps = 5;
        const pts = new Float32Array((steps + 1) * 2);
        pts[0] = cx;
        pts[1] = cy;
        let x = cx;
        let y = cy;
        for (let s = 1; s <= steps; s++) {
            const angle = baseAngle + (Math.random() - 0.5) * 0.9;
            const len = 9 + Math.random() * 9;
            x += Math.cos(angle) * len;
            y += Math.sin(angle) * len;
            pts[s * 2] = x;
            pts[s * 2 + 1] = y;
        }
        cracks.push(pts);
    }
    return cracks;
}

/**
 * CinematicPlayer - traduz eventos do servidor em animações. Não altera regras, só a visão local.
 * Toda animação resolve (no máximo) no tempo previsto: a fila do GameClient nunca trava.
 */
export class CinematicPlayer {
    /**
     * @param {{ pool: import('../entities/card-pool.js').CardPool, animator: import('./animator.js').Animator,
     *           particles: import('./particle-system.js').ParticleSystem, hud: import('../ui/hud.js').Hud,
     *           audio: import('../audio/audio-engine.js').AudioEngine }} deps
     */
    constructor({ pool, animator, particles, hud, board, viewport, audio, showcase, bolts, scene, fx, ultimate, client }) {
        this.pool = pool;
        this.client = client;
        // Palco dos Combos Supremos (monólito, cristais, relógio, rachaduras, fita VHS, tremor)
        this.ultimate = ultimate || null;
        // Anéis, correntes, fios, vinheta e aparições da mesa (FxLayer)
        this.fx = fx || null;
        // Raios do Relâmpago (BoltSystem) e a cena, onde fica o clarão de tela (scene.flash)
        this.bolts = bolts;
        this.scene = scene;
        this.board = board;
        this.viewport = viewport;
        this.animator = animator;
        this.particles = particles;
        this.hud = hud;
        this.audio = audio;
        // Carta gigante do centro (estado lido pelo renderer em scene.showcase)
        this.showcase = showcase;
        this.gameOverShown = false;
        this.fireworksTimer = null;
    }

    /**
     * Toca o evento com animação.
     * @returns {Promise<void>}
     */
    async play(evt) {
        switch (evt.t) {
            case EVENT.COLOR_CHOSEN: this.audio.play(SFX.COLOR_CHANGE); this.hud.showColorAlert(evt.color); return;
            case EVENT.RAINBOW: this.audio.play(SFX.RAINBOW); this.hud.showColorAlert(COLOR.RAINBOW); return;
            case EVENT.CONSUMABLE_USED: return this.consumable(evt.cardId, evt.seat);
            case EVENT.REVEAL: return this.reveal(evt.cards);
            case EVENT.SUMMON: return this.summon(evt.cardId);
            case EVENT.CLASH: return this.clash(evt.winnerId, evt.loserId, evt.winnerPower);
            case EVENT.TIE: return this.tie(evt.cardIds);
            case EVENT.BLOCK_SMASH: return this.blockSmash(evt.blockId, evt.victimIds);
            case EVENT.REVERSE_STEAL:
            case EVENT.REVERSE_SWAP: return this.reverse(evt.reverseId);
            case EVENT.DIRECT_HIT: return this.directHit(evt);
            case EVENT.DESTROY: return this.destroyMany(evt.cardIds);
            case EVENT.GAME_OVER: return this.gameOver(evt.result, evt.reason, evt.winnerName);
            case EVENT.HEAL: return this.heal(evt);
            case EVENT.REVIVE_TRIGGERED: return this.reviveSave(evt.seat);
            case EVENT.CARD_SOLD: return this.cardSold(evt);
            case EVENT.PAINT_APPLIED: return this.paintApplied(evt.cards);
            case EVENT.GUARD_SWAP: return this.guardSwap(evt);
            case EVENT.LIGHTNING_STRIKE: return this.lightningStrike(evt);
            case EVENT.GHOST_PASS: return ghostPass(this, evt);
            case EVENT.MIRROR_CLASH: return mirrorClash(this, evt);
            case EVENT.MIRROR_HIT: return mirrorHit(this, evt);
            case EVENT.AMBUSH: return ambush(this, evt);
            case EVENT.CURSE_TRIGGERED: return curseTriggered(this, evt);
            case EVENT.FUSION: return this.fusion(evt);
            case EVENT.UNFUSE: return this.unfuse(evt);
            case EVENT.PRISON: return prison(this, evt);
            case EVENT.PRISON_HIT: return prisonHit(this, evt);
            case EVENT.KARMA: return karma(this, evt);
            case EVENT.KARMA_HIT: return karmaHit(this, evt);
            case EVENT.HAND_REWIND: return handRewind(this, evt);
            case EVENT.HAND_REWIND_DONE: return handRewindDone(this, evt);
            case EVENT.PANIC: return panic(this, evt);
            case EVENT.ULTIMATE_COLLAPSE: return collapse(this, evt);
            case EVENT.DEATH_MARK: return ronovaMark(this, evt);
            case EVENT.SURGE: return surgeCinematic(this, evt);
            case EVENT.DEATH_BURN: return ronovaBurn(this, evt);
        }
    }

    /** Aplica só o efeito final do evento, sem animação (aba em segundo plano ou fila atrasada). */
    applyInstant(evt) {
        if (ultimateInstant(this, evt)) return;
        switch (evt.t) {
            case EVENT.COLOR_CHOSEN: this.hud.syncBackground(evt.color); break;
            case EVENT.RAINBOW: this.hud.syncBackground(COLOR.RAINBOW); break;
            case EVENT.REVEAL: for (const face of evt.cards) this.applyFace(face); break;
            case EVENT.CLASH:
                this.remove(evt.loserId);
                if (this.pool.isActive(evt.winnerId)) this.pool.power[evt.winnerId] = evt.winnerPower;
                break;
            case EVENT.TIE:
            case EVENT.DESTROY: for (const id of evt.cardIds) this.remove(id); break;
            case EVENT.BLOCK_SMASH:
                this.remove(evt.blockId);
                for (const id of evt.victimIds) this.remove(id);
                break;
            case EVENT.REVERSE_STEAL:
            case EVENT.REVERSE_SWAP: this.remove(evt.reverseId); break;
            case EVENT.SUMMON:
            case EVENT.CONSUMABLE_USED: this.remove(evt.cardId); break;
            case EVENT.DIRECT_HIT:
                // Golpe da Emboscada é numérico: a carta volta pra mão (o selo do slot vem pelo snapshot)
                if (evt.destroyed || (evt.effect !== HIT_EFFECT.NONE && evt.effect !== HIT_EFFECT.USE_LOCKOUT)) this.remove(evt.cardId);
                if (evt.burned) for (const id of evt.burned) this.remove(id);
                break;
            case EVENT.LIGHTNING_STRIKE:
                this.remove(evt.lightningId);
                for (const face of evt.targets) this.remove(face.id);
                if (evt.burned) for (const id of evt.burned) this.remove(id);
                break;
            case EVENT.FUSION:
                if (this.pool.isActive(evt.underId)) this.pool.power[evt.underId] = evt.newPower;
                this.remove(evt.topId);
                break;
            case EVENT.UNFUSE:
                if (this.pool.isActive(evt.cardId)) this.pool.power[evt.cardId] = evt.restoredPower;
                break;
            case EVENT.DEATH_MARK:
            case EVENT.DEATH_BURN:
                ronovaInstant(this, evt);
                break;
            case EVENT.SURGE:
                // Sem roleta ao pular cinemáticas: o selo já vem do snapshot
                break;
            case EVENT.GHOST_PASS:
                for (const pass of evt.passes) {
                    this.remove(pass.ghostId);
                    if (pass.dissolveId >= 0) this.remove(pass.dissolveId);
                }
                break;
            case EVENT.MIRROR_CLASH:
                this.remove(evt.targetId);
                if (evt.result === MIRROR_RESULT.PARADOX) this.remove(evt.mirrorId);
                else if (this.pool.isActive(evt.mirrorId)) this.pool.power[evt.mirrorId] = CONFIG.MIRROR.COPY_BONUS;
                break;
            case EVENT.MIRROR_HIT: this.remove(evt.cardId); break;
            case EVENT.AMBUSH: if (this.pool.isActive(evt.cardId)) this.pool.power[evt.cardId] = evt.to; break;
            case EVENT.CURSE_TRIGGERED: curseInstant(this, evt); break;
            case EVENT.GAME_OVER: this.showGameOverScreen(evt.result, evt.reason, evt.winnerName); break;
            case EVENT.CARD_SOLD: this.remove(evt.cardId); break;
            case EVENT.PAINT_APPLIED:
                for (const c of evt.cards) {
                    if (!this.pool.isActive(c.cardId)) continue;
                    this.pool.color[c.cardId] = c.color;
                    this.pool.paintAnim[c.cardId] = 0;
                }
                break;
        }
    }

    // --- Utilitários -------------------------------------------------------

    /** Centro da caixa de vida (DOM) em coordenadas virtuais do canvas, pra partículas nascerem ali. */
    hpPoint(isSelf) {
        const c = this.hud.hpCenter(isSelf);
        return { x: this.viewport.toVirtual(c.x), y: this.viewport.toVirtual(c.y) };
    }

    /**
     * Anima um valor 0..1 por `duration` ms (rAF), com timeout de segurança: nunca trava a fila de
     * eventos, nem com a aba em segundo plano (o setTimeout finaliza no valor final).
     */
    animate(duration, onUpdate) {
        return new Promise((resolve) => {
            const start = performance.now();
            let done = false;
            let timer = null;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                onUpdate(1);
                resolve();
            };
            const step = (now) => {
                if (done) return;
                const t = Math.min(1, (now - start) / duration);
                if (t >= 1) {
                    finish();
                    return;
                }
                onUpdate(t);
                requestAnimationFrame(step);
            };
            timer = setTimeout(finish, duration + ANIM.SAFETY_MARGIN);
            requestAnimationFrame(step);
        });
    }

    centerX(id) { return this.pool.targetX[id] + HALF_W; }
    centerY(id) { return this.pool.targetY[id] + HALF_H; }

    tween(id, props, duration, easing = Easing.QuadOut) {
        return this.animator.toAsync(id, props, duration, easing, this.pool);
    }

    applyFace(face) {
        if (!this.pool.isActive(face.id)) return;
        this.pool.type[face.id] = face.type;
        this.pool.color[face.id] = face.color;
        this.pool.power[face.id] = face.power;
    }

    remove(id) {
        if (!this.pool.isActive(id)) return;
        this.animator.cancel(id, this.pool);
        this.pool.deactivate(id);
    }

    explode(id, color = '#e74c3c', count = 30, speed = 180) {
        if (!this.pool.isActive(id)) return;
        this.particles.emitBurst(this.centerX(id), this.centerY(id), color, count, speed, PARTICLE_TYPES.SQUARE);
        this.particles.emitBurst(this.centerX(id), this.centerY(id), '#ffffff', 10, speed * 0.6, PARTICLE_TYPES.STAR);
        this.remove(id);
    }

    // --- Cinemáticas -------------------------------------------------------

    async reveal(cards) {
        if (cards.length === 0) return;
        this.audio.play(SFX.REVEAL);
        const jobs = [];
        for (const face of cards) {
            const id = face.id;
            if (!this.pool.isActive(id)) continue;
            jobs.push((async () => {
                await this.tween(id, { scale: 1.2 }, ANIM.FLIP_HALF);
                this.applyFace(face);
                revealFlourish(this, face);
                this.particles.emitBurst(this.centerX(id), this.centerY(id), '#ffffff', 15, 150, PARTICLE_TYPES.STAR);
                await this.tween(id, { scale: 1.0 }, ANIM.FLIP_HALF);
            })());
        }
        await Promise.all(jobs);
    }

    /** Vencedora "levanta", recua, avança sobre a perdedora e volta ao lugar (GAME_RULES §3.1). */
    async clash(winnerId, loserId, winnerPower) {
        const pool = this.pool;
        if (!pool.isActive(winnerId) || !pool.isActive(loserId)) {
            this.applyInstant({ t: EVENT.CLASH, winnerId, loserId, winnerPower });
            return;
        }

        const homeX = pool.targetX[winnerId];
        const homeY = pool.targetY[winnerId];
        const loserX = pool.targetX[loserId];
        const loserY = pool.targetY[loserId];
        const dir = Math.sign(loserY - homeY) || -1;
        const baseZ = pool.zIndex[winnerId];
        pool.zIndex[winnerId] = 500;

        await this.tween(winnerId, { scale: 1.25, targetY: homeY - dir * 25 }, ANIM.LIFT);
        await this.tween(winnerId, { scale: 1.0, targetX: loserX, targetY: loserY - dir * HALF_H }, ANIM.DASH, Easing.CubicIn);

        this.audio.play(SFX.CLASH);
        this.particles.emitBurst(this.centerX(loserId), this.centerY(loserId), '#f39c12', 30, 220, PARTICLE_TYPES.STAR);
        this.explode(loserId);
        pool.power[winnerId] = winnerPower;

        await this.tween(winnerId, { targetX: homeX, targetY: homeY }, ANIM.RETURN);
        pool.zIndex[winnerId] = baseZ;
    }

    /** Empate: as duas avançam até o meio, colidem e se destroem. */
    async tie(cardIds) {
        const [a, b] = cardIds;
        const pool = this.pool;
        if (!pool.isActive(a) || !pool.isActive(b)) {
            for (const id of cardIds) this.remove(id);
            return;
        }

        const midX = (pool.targetX[a] + pool.targetX[b]) / 2;
        const midY = (pool.targetY[a] + pool.targetY[b]) / 2;
        const dirA = Math.sign(pool.targetY[a] - midY) || 1;
        const dirB = Math.sign(pool.targetY[b] - midY) || -1;

        await Promise.all([
            this.tween(a, { scale: 1.2 }, ANIM.LIFT),
            this.tween(b, { scale: 1.2 }, ANIM.LIFT)
        ]);
        await Promise.all([
            this.tween(a, { targetX: midX, targetY: midY + dirA * 20 }, ANIM.DASH, Easing.CubicIn),
            this.tween(b, { targetX: midX, targetY: midY + dirB * 20 }, ANIM.DASH, Easing.CubicIn)
        ]);

        this.audio.play(SFX.TIE);
        this.particles.emitBurst(midX + HALF_W, midY + HALF_H, '#bdc3c7', 40, 250, PARTICLE_TYPES.SQUARE);
        this.explode(a);
        this.explode(b);
        await sleep(ANIM.RETURN);
    }

    async summon(cardId) {
        const pool = this.pool;
        if (!pool.isActive(cardId)) return;

        this.audio.play(SFX.SUMMON);
        this.particles.emitBurst(this.centerX(cardId), this.centerY(cardId), '#9b59b6', 150, 600, PARTICLE_TYPES.STAR);
        const baseX = pool.targetX[cardId];
        for (let i = 0; i < 4; i++) {
            const scale = 1.1 + i * 0.1;
            await this.tween(cardId, { targetX: baseX - 15, scale }, ANIM.SHAKE_STEP, Easing.Linear);
            await this.tween(cardId, { targetX: baseX + 15, scale }, ANIM.SHAKE_STEP, Easing.Linear);
        }
        this.particles.emitBurst(this.centerX(cardId), this.centerY(cardId), '#ffffff', 200, 900, PARTICLE_TYPES.SQUARE);
        this.remove(cardId);
    }

    async blockSmash(blockId, victimIds) {
        const pool = this.pool;
        this.audio.play(SFX.BLOCK);
        if (pool.isActive(blockId)) {
            await this.tween(blockId, { scale: 1.3 }, ANIM.LIFT);
            this.particles.emitBurst(this.centerX(blockId), this.centerY(blockId), '#ff0000', 80, 400, PARTICLE_TYPES.CIRCLE);
        }
        for (const id of victimIds) this.explode(id, '#8e44ad');
        this.explode(blockId, '#ff0000');
        await sleep(ANIM.RETURN);
    }

    async reverse(reverseId) {
        const pool = this.pool;
        if (!pool.isActive(reverseId)) return;
        this.audio.play(SFX.REVERSE);
        const rotation = pool.rotation[reverseId];
        await this.tween(reverseId, { rotation: rotation + Math.PI * 2, scale: 1.3 }, ANIM.LIFT * 2, Easing.QuadInOut);
        this.particles.emitBurst(this.centerX(reverseId), this.centerY(reverseId), '#1abc9c', 80, 400, PARTICLE_TYPES.STAR);
        this.remove(reverseId);
    }

    /**
     * A carta (face para baixo, se for do oponente) pousa no slot USE do dono e explode ali. Para o
     * dono, a explosão tem a cor/som do consumível e a energia corre até a sua caixa de vida.
     */
    async consumable(cardId, seat) {
        const pool = this.pool;
        if (!pool.isActive(cardId)) return;

        const isSelf = seat === REL_SEAT.SELF;
        const fx = (isSelf && CONSUMABLE_FX[pool.type[cardId]]) || CONSUMABLE_FX_DEFAULT;
        const type = pool.type[cardId];
        const rect = this.board.slots[isSelf ? ZONE.SELF_USE : ZONE.OPP_USE];
        pool.zIndex[cardId] = 500;
        pool.hoverOffsetY[cardId] = 0;
        if (rect) {
            await this.tween(cardId, { targetX: rect.x, targetY: rect.y, rotation: 0, scale: 1 }, ANIM.CONSUMABLE_MOVE, Easing.CubicOut);
        }
        await sleep(ANIM.CONSUMABLE_HOLD);
        await this.tween(cardId, { scale: 1.3 }, ANIM.CONSUMABLE_LIFT);
        this.audio.play(fx.sound);

        const x = this.centerX(cardId);
        const y = this.centerY(cardId);
        this.particles.emitBurst(x, y, '#ffffff', 40, 200, PARTICLE_TYPES.STAR);
        if (isSelf && type === CARD_TYPES.PAINT) {
            // Estouro de tinta: respingos grossos nas 4 cores do jogo + o aviso de que é hora de escolher
            for (const color of PAINT_SPLASH_COLORS) {
                this.particles.emitBurst(x, y, color, 26, 420, PARTICLE_TYPES.CIRCLE, 1.6);
                this.particles.emitBurst(x, y, color, 8, 650, PARTICLE_TYPES.SPARK, 1.2);
            }
            this.hud.showPaintAlert();
        }
        const isSpectator = this.client.isSpectator;
        if ((isSelf || isSpectator) && type === CARD_TYPES.AMBUSH) ambushArmedFx(this, x, y, isSelf);
        if ((isSelf || isSpectator) && type === CARD_TYPES.CURSE) curseArmedFx(this, x, y, isSelf);
        if ((isSelf || isSpectator) && type === CARD_TYPES.DEATH) ronovaCastFx(this, x, y, isSelf);
        if ((isSelf || isSpectator) && type === CARD_TYPES.GUARD_SWAP) {
            // Só quem usou vê (e o espectador): a energia corre até o campo afetado e as cartas de lá "estremecem"
            for (let i = 0; i < 3; i++) this.particles.emitBurst(x, y, SWAP_COLOR, 18, 260 + i * 120, PARTICLE_TYPES.SPARK, 1.1);
            if (isSelf) this.hud.showSpecialAlert(i18n.t('GUARD_SWAP_ALERT'), 'alert-swap');
            this.guardSwapArmedFx(x, y, isSelf);
        }
        if (fx.toLife) {
            const life = this.hpPoint(true);
            this.particles.emitLine(x, y, life.x, life.y, fx.color, 45, PARTICLE_TYPES.STAR);
            this.particles.emitRise(life.x, life.y, fx.color, 30, 45, 260, PARTICLE_TYPES.STAR);
            if (isSelf && type === CARD_TYPES.REVIVE) {
                this.particles.emitRise(x, y, '#fff3b0', 50, 40, 420, PARTICLE_TYPES.CIRCLE);
                this.hud.flashGuard(true);
            }
        }
        this.explode(cardId, fx.color);
    }

    // --- Troca de Guarda -----------------------------------------------------

    /** Centro visual de um slot do tabuleiro (coordenadas virtuais). */
    slotCenter(zone) {
        const r = this.board.slots[zone];
        return r ? { x: r.hitX + r.hitW / 2, y: r.hitY + r.hitH / 2 } : { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    }

    /** Cartas ativas numa zona relativa, do fundo pro topo (ordem da pilha). */
    cardsIn(zone) {
        const pool = this.pool;
        const ids = [];
        for (let id = 0; id < pool.maxCards; id++) {
            if (pool.active[id] === 1 && pool.zone[id] === zone) ids.push(id);
        }
        ids.sort((a, b) => pool.order[a] - pool.order[b]);
        return ids;
    }

    /**
     * Troca de Guarda armada (só quem usou vê, sem travar a fila): um feixe corre do slot USE até o campo
     * inimigo, anéis de energia orbitam Ataque e Defesa de lá e as cartas inimigas estremecem.
     */
    guardSwapArmedFx(fromX, fromY, isSelf) {
        const atkZone = isSelf ? ZONE.OPP_ATTACK : ZONE.SELF_ATTACK;
        const defZone = isSelf ? ZONE.OPP_DEFENSE : ZONE.SELF_DEFENSE;
        const atk = this.slotCenter(atkZone);
        const def = this.slotCenter(defZone);
        const mx = (atk.x + def.x) / 2;
        const my = (atk.y + def.y) / 2;
        const radius = Math.abs(def.y - atk.y) / 2 + 30;
        this.particles.emitLine(fromX, fromY, mx, my, SWAP_COLOR, 40, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(atk.x, atk.y, SWAP_COLOR, 22, 170, PARTICLE_TYPES.CIRCLE);
        this.particles.emitBurst(def.x, def.y, SWAP_COLOR, 22, 170, PARTICLE_TYPES.CIRCLE);

        const pool = this.pool;
        const shaken = this.cardsIn(atkZone).concat(this.cardsIn(defZone));
        const baseRot = shaken.map((id) => pool.rotation[id]);
        const baseZone = shaken.map((id) => pool.zone[id]);
        const r = hexChannel(SWAP_COLOR, 1);
        const g = hexChannel(SWAP_COLOR, 3);
        const b = hexChannel(SWAP_COLOR, 5);
        this.animate(ANIM.GUARD_SWAP_ORBIT * 1.4, (t) => {
            // Duas "luas" girando em volta do par Ataque/Defesa, soltando rastro
            for (let k = 0; k < 2; k++) {
                const a = t * Math.PI * 3 + k * Math.PI;
                const px = mx + Math.cos(a) * radius * 0.75;
                const py = my + Math.sin(a) * radius;
                this.particles.emit(px, py, -Math.sin(a) * 40, Math.cos(a) * 40, 0.5, 2.5 + Math.random() * 2, PARTICLE_TYPES.STAR, r, g, b);
            }
            const wobble = t < 1 ? Math.sin(t * Math.PI * 7) * 0.09 * (1 - t) : 0;
            for (let i = 0; i < shaken.length; i++) {
                const id = shaken[i];
                if (!pool.isActive(id) || pool.zone[id] !== baseZone[i]) continue;
                pool.rotation[id] = baseRot[i] + wobble;
            }
        });
    }

    /**
     * A Troca de Guarda dispara no início do combate (os dois veem, sem saber quem usou): em cada campo que
     * troca, as pilhas de Ataque e Defesa sobem, orbitam em meia-volta em volta do ponto entre os slots
     * (girando de pé pra deitada e vice-versa) e assentam no slot oposto. Duas Trocas se anulam: as pilhas
     * giram até o meio, batem e voltam.
     * @param {{ self: number, opp: number, cancelled: number }} evt
     */
    async guardSwap(evt) {
        const sides = [];
        if (evt.self) sides.push([ZONE.SELF_ATTACK, ZONE.SELF_DEFENSE]);
        if (evt.opp) sides.push([ZONE.OPP_ATTACK, ZONE.OPP_DEFENSE]);

        if (evt.cancelled) {
            this.hud.showSpecialAlert(i18n.t('GUARD_SWAP_CANCELLED'), 'alert-swap');
            await this.guardSwapCancelled();
            return;
        }
        this.hud.showSpecialAlert(i18n.t('GUARD_SWAP_ALERT'), 'alert-swap');
        if (sides.length === 0) {
            // Ninguém tinha Defesa: a carta falha (a órbita aparece e se desfaz)
            this.audio.play(SFX.FIZZLE);
            for (const zone of [ZONE.SELF_ATTACK, ZONE.OPP_ATTACK]) {
                const c = this.slotCenter(zone);
                this.particles.emitRise(c.x, c.y, '#95a5a6', 20, 40, 150, PARTICLE_TYPES.CIRCLE);
            }
            await sleep(ANIM.GUARD_SWAP_LIFT + ANIM.GUARD_SWAP_SETTLE);
            return;
        }

        this.audio.play(SFX.GUARD_SWAP);
        await Promise.all(sides.map(([atkZone, defZone]) => this.swapSide(atkZone, defZone)));
    }

    /** Um campo trocando: Ataque e Defesa em órbita de meia-volta até o slot oposto. */
    async swapSide(atkZone, defZone) {
        const pool = this.pool;
        const atkRect = this.board.slots[atkZone];
        const defRect = this.board.slots[defZone];
        if (!atkRect || !defRect) return;
        const attack = this.cardsIn(atkZone);
        const defense = this.cardsIn(defZone);
        const a = this.slotCenter(atkZone);
        const d = this.slotCenter(defZone);
        const mx = (a.x + d.x) / 2;
        const my = (a.y + d.y) / 2;
        const radius = Math.hypot(a.x - mx, a.y - my);
        // Cada carta: ângulo inicial em volta do centro, rotação inicial/final e índice na pilha
        const moving = [];
        for (let j = 0; j < attack.length; j++) moving.push({ id: attack[j], from: a, rot0: 0, rot1: Math.PI / 2, j });
        for (let j = 0; j < defense.length; j++) moving.push({ id: defense[j], from: d, rot0: Math.PI / 2, rot1: 0, j });

        for (const m of moving) {
            this.animator.cancel(m.id, pool);
            m.angle0 = Math.atan2(m.from.y - my, m.from.x - mx);
            pool.zIndex[m.id] = 520 + m.j;
            pool.hoverOffsetY[m.id] = 0;
        }
        this.particles.emitBurst(mx, my, SWAP_COLOR, 36, 240, PARTICLE_TYPES.CIRCLE, 1.3);
        this.particles.emitBurst(mx, my, '#ffffff', 14, 180, PARTICLE_TYPES.STAR);

        // 1) Sobem
        await Promise.all(moving.map((m) => this.tween(m.id, { scale: ANIM.GUARD_SWAP_SCALE }, ANIM.GUARD_SWAP_LIFT, Easing.QuadOut)));

        // 2) Meia-volta em órbita (sentido horário), girando de pé <-> deitada, com rastro de luz
        const r = hexChannel(SWAP_COLOR, 1);
        const g = hexChannel(SWAP_COLOR, 3);
        const b = hexChannel(SWAP_COLOR, 5);
        await this.animate(ANIM.GUARD_SWAP_ORBIT, (t) => {
            const e = Easing.QuadInOut(t);
            for (let i = 0; i < moving.length; i++) {
                const m = moving[i];
                if (!pool.isActive(m.id)) continue;
                const ang = m.angle0 + Math.PI * e;
                const cx = mx + Math.cos(ang) * radius;
                const cy = my + Math.sin(ang) * radius;
                pool.targetX[m.id] = cx - HALF_W + m.j * STACK_DX;
                pool.targetY[m.id] = cy - HALF_H + m.j * STACK_DY;
                pool.x[m.id] = pool.targetX[m.id];
                pool.y[m.id] = pool.targetY[m.id];
                pool.rotation[m.id] = m.rot0 + (m.rot1 - m.rot0) * e;
                if (m.j === 0 && t < 1) {
                    const vx = -Math.sin(ang) * 60;
                    const vy = Math.cos(ang) * 60;
                    this.particles.emit(cx, cy, -vx, -vy, 0.45, 3 + Math.random() * 3, PARTICLE_TYPES.STAR, r, g, b);
                }
            }
        });

        // 3) Assentam no slot novo com um estalo de luz
        for (const m of moving) {
            const rect = m.rot1 === 0 ? atkRect : defRect;
            pool.targetX[m.id] = rect.x + m.j * STACK_DX;
            pool.targetY[m.id] = rect.y + m.j * STACK_DY;
            pool.rotation[m.id] = m.rot1;
        }
        this.particles.emitBurst(a.x, a.y, SWAP_COLOR, 26, 220, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(d.x, d.y, SWAP_COLOR, 26, 220, PARTICLE_TYPES.STAR);
        await Promise.all(moving.map((m) => this.tween(m.id, { scale: 1 }, ANIM.GUARD_SWAP_SETTLE, Easing.BackOut)));
        for (const m of moving) pool.zIndex[m.id] = 100 + m.j;
    }

    /** Duas Trocas se anularam: em cada campo com Ataque e Defesa, as pilhas giram até se chocarem e voltam. */
    async guardSwapCancelled() {
        const pool = this.pool;
        const jobs = [];
        for (const [atkZone, defZone] of [[ZONE.SELF_ATTACK, ZONE.SELF_DEFENSE], [ZONE.OPP_ATTACK, ZONE.OPP_DEFENSE]]) {
            const ids = this.cardsIn(atkZone).concat(this.cardsIn(defZone));
            if (ids.length === 0) continue;
            const a = this.slotCenter(atkZone);
            const d = this.slotCenter(defZone);
            const mx = (a.x + d.x) / 2;
            const my = (a.y + d.y) / 2;
            for (const id of ids) {
                const rot = pool.rotation[id];
                jobs.push((async () => {
                    await this.tween(id, { scale: ANIM.GUARD_SWAP_SCALE, rotation: rot + 0.45 }, ANIM.GUARD_SWAP_LIFT + 120, Easing.QuadOut);
                    await this.tween(id, { scale: 1, rotation: rot }, ANIM.GUARD_SWAP_SETTLE, Easing.BackOut);
                })());
            }
            setTimeout(() => {
                this.audio.play(SFX.GUARD_SWAP_CANCEL);
                this.particles.emitBurst(mx, my, '#bdc3c7', 34, 260, PARTICLE_TYPES.SQUARE);
                this.particles.emitBurst(mx, my, SWAP_COLOR, 20, 200, PARTICLE_TYPES.SPARK);
            }, ANIM.GUARD_SWAP_LIFT + 120);
        }
        if (jobs.length === 0) this.audio.play(SFX.GUARD_SWAP_CANCEL);
        await Promise.all(jobs);
    }

    // --- Relâmpago ------------------------------------------------------------

    /** Clarão de tela aditivo que apaga sozinho (não trava a fila). */
    flashScreen(amount, color = '#cfefff', duration = 220) {
        const scene = this.scene;
        if (!scene) return;
        scene.flashColor = color;
        scene.flash = Math.max(scene.flash, amount);
        const start = scene.flash;
        this.animate(duration, (t) => { scene.flash = start * (1 - Easing.QuadOut(t)); });
    }

    /** Faíscas elétricas saltando em volta de um ponto (carga do Relâmpago), por `duration` ms. */
    crackle(x, y, spread, duration) {
        const r = hexChannel(STORM_COLOR, 1);
        const g = hexChannel(STORM_COLOR, 3);
        const b = hexChannel(STORM_COLOR, 5);
        return this.animate(duration, (t) => {
            if (t >= 1) return;
            for (let n = 0; n < 3; n++) {
                const a = Math.random() * Math.PI * 2;
                const d = spread * (0.6 + Math.random() * 0.5);
                const px = x + Math.cos(a) * d;
                const py = y + Math.sin(a) * d * 1.3;
                this.particles.emit(px, py, (x - px) * 2.2, (y - py) * 2.2, 0.28, 2 + Math.random() * 2.5, PARTICLE_TYPES.SPARK, r, g, b);
            }
        });
    }

    /** Uma carta atingida por raio: acende, explode em faíscas e some. */
    zap(id) {
        const pool = this.pool;
        if (!pool.isActive(id)) return;
        const x = this.centerX(id);
        const y = this.centerY(id);
        const hex = CONFIG.COLOR_HEX[pool.color[id]] || '#ffffff';
        this.particles.emitBurst(x, y, STORM_COLOR, 34, 380, PARTICLE_TYPES.SPARK, 1.2);
        this.particles.emitBurst(x, y, hex, 26, 240, PARTICLE_TYPES.SQUARE);
        this.particles.emitBurst(x, y, '#ffffff', 16, 200, PARTICLE_TYPES.STAR, 1.3);
        this.remove(id);
    }

    /**
     * Relâmpago em Cadeia (os dois veem): a carta se carrega crepitando, dispara um raio na carta da frente
     * inimiga e o raio salta dela para a próxima (combo ou Defesa, revelada no instante do golpe), cada
     * golpe com estalo de trovão e clarão de tela. Se o campo inimigo acabar antes dos saltos, o raio
     * segue até a mão do alvo e queima as cartas de `burned` (Sobrecarga parcial). Por fim o Relâmpago
     * se descarrega e some.
     * @param {{ lightningId: number, seat: number, targets: import('../network/protocol.js').CardFace[], burned?: number[] }} evt
     */
    async lightningStrike(evt) {
        const pool = this.pool;
        const id = evt.lightningId;
        let sx = this.viewport.width / 2;
        let sy = this.viewport.height / 2;

        if (pool.isActive(id)) {
            pool.zIndex[id] = 600;
            sx = this.centerX(id);
            sy = this.centerY(id);
            this.audio.play(SFX.LIGHTNING_CHARGE);
            await Promise.all([
                this.tween(id, { scale: 1.3 }, ANIM.LIGHTNING_CHARGE, Easing.BackOut),
                this.crackle(sx, sy, HALF_W * 1.3, ANIM.LIGHTNING_CHARGE)
            ]);
        }

        for (let k = 0; k < evt.targets.length; k++) {
            const face = evt.targets[k];
            const tid = face.id;
            // Carta oculta (Defesa) é revelada um instante antes do raio, pra todos verem o que caiu
            const wasHidden = pool.isActive(tid) && pool.type[tid] === CARD_TYPES.HIDDEN;
            this.applyFace(face);
            if (wasHidden) {
                this.audio.play(SFX.REVEAL);
                await this.tween(tid, { scale: 1.15 }, ANIM.LIGHTNING_REVEAL, Easing.QuadOut);
            }
            const tx = pool.isActive(tid) ? this.centerX(tid) : sx;
            const ty = pool.isActive(tid) ? this.centerY(tid) : sy;
            if (this.bolts) {
                this.bolts.spawn(sx, sy, tx, ty, ANIM.LIGHTNING_BOLT_LIFE, STORM_COLOR, 1.15);
                this.bolts.spawn(sx, sy, tx, ty, ANIM.LIGHTNING_BOLT_LIFE * 0.7, '#fff3a0', 0.55);
            }
            this.audio.play(SFX.LIGHTNING_STRIKE, { pitch: k * 2 });
            this.flashScreen(k === 0 ? 1 : 0.7);
            this.zap(tid);
            sx = tx;
            sy = ty;
            await sleep(ANIM.LIGHTNING_HOP);
        }

        // Saltos que sobraram atravessam até a vida: o alvo é o dono da mão oposta ao Relâmpago
        if (evt.burned && evt.burned.length > 0) {
            const selfIsTarget = evt.seat === REL_SEAT.OPPONENT;
            this.hud.showFloatingText(i18n.t('HIT_OVERLOAD'), selfIsTarget, 'overload');
            if (selfIsTarget) this.hud.flashDamage();
            await this.burnHand(evt.burned, sx, sy);
        }

        if (pool.isActive(id)) {
            const x = this.centerX(id);
            const y = this.centerY(id);
            this.particles.emitBurst(x, y, STORM_CORE, 40, 320, PARTICLE_TYPES.STAR, 1.2);
            this.particles.emitBurst(x, y, STORM_COLOR, 30, 480, PARTICLE_TYPES.SPARK);
            this.remove(id);
        }
        await sleep(ANIM.LIGHTNING_FADE);
    }

    /**
     * Sobrecarga (Relâmpago na vida): da borda por onde o Relâmpago saiu, raios caem em até 2 cartas da mão
     * do alvo, que queimam. O dono vê as próprias cartas; o atacante vê só os versos.
     */
    async overloadBurn(evt, selfIsTarget, fromX) {
        const fromY = selfIsTarget ? this.viewport.height * 0.62 : this.viewport.height * 0.38;
        await this.burnHand(evt.burned || [], fromX, fromY);
        await sleep(ANIM.LIGHTNING_FADE);
    }

    /** Raios partindo de (fromX, fromY) queimam, uma a uma, as cartas `burned` da mão do alvo. */
    async burnHand(burned, fromX, fromY) {
        const pool = this.pool;
        for (let k = 0; k < burned.length; k++) {
            const id = burned[k];
            if (!pool.isActive(id)) continue;
            const tx = this.centerX(id);
            const ty = this.centerY(id);
            pool.zIndex[id] = 600;
            if (this.bolts) this.bolts.spawn(fromX, fromY, tx, ty, ANIM.LIGHTNING_BOLT_LIFE, STORM_COLOR, 1);
            this.audio.play(SFX.LIGHTNING_STRIKE, { pitch: 3 + k * 2, volume: 0.7 });
            this.flashScreen(0.55);
            await this.tween(id, { scale: 1.2 }, ANIM.LIGHTNING_HOP * 0.5, Easing.QuadOut);
            this.zap(id);
            await sleep(ANIM.LIGHTNING_HOP * 0.5);
        }
    }

    /**
     * Carta vendida: voa girando até a lixeira do dono, encolhe e queima virando moedas. O oponente
     * vê o verso indo pra lixeira dele e a brasa, mas nunca o valor (só quem vendeu recebe `coins`).
     */
    async cardSold(evt) {
        const pool = this.pool;
        const id = evt.cardId;
        const isSelf = evt.seat === REL_SEAT.SELF;
        const t = this.hud.trashCenter(isSelf);
        const tx = this.viewport.toVirtual(t.x);
        const ty = this.viewport.toVirtual(t.y);

        if (pool.isActive(id)) {
            pool.zIndex[id] = 600;
            pool.hoverOffsetY[id] = 0;
            const spin = isSelf ? 0.6 : -0.6;
            await this.tween(id, {
                targetX: tx - HALF_W, targetY: ty - HALF_H, scale: isSelf ? 0.5 : 0.35, rotation: pool.rotation[id] + spin
            }, ANIM.SELL_FLY, Easing.CubicIn);
            await this.tween(id, { scale: 0.05, rotation: pool.rotation[id] + spin * 2 }, ANIM.SELL_BURN, Easing.QuadIn);
            this.remove(id);
        }

        this.hud.trashSold(isSelf, isSelf ? evt.coins : 0);
        this.audio.play(SFX.SELL, isSelf ? undefined : { volume: 0.5 });
        this.particles.emitBurst(tx, ty, '#ff8a00', isSelf ? 34 : 18, 260, PARTICLE_TYPES.SQUARE);
        this.particles.emitRise(tx, ty, '#7f8c8d', isSelf ? 14 : 8, 14, 140, PARTICLE_TYPES.CIRCLE);
        if (isSelf && evt.coins > 0) {
            this.particles.emitRise(tx, ty, '#ffd700', Math.min(45, 8 + evt.coins * 4), 18, 360, PARTICLE_TYPES.STAR);
            this.particles.emitBurst(tx, ty, '#fff3b0', 16, 200, PARTICLE_TYPES.CIRCLE);
        }
    }

    /**
     * Pintar confirmado (só quem pintou recebe): as cartas sobem da mão, a tinta nova escorre por
     * cima da cor antiga em tempo real (Canvas2DRenderer.drawPaintingFace) e elas voltam com um "pop".
     * @param {{ cardId: number, color: number }[]} cards
     */
    async paintApplied(cards) {
        this.audio.play(SFX.PAINT_BRUSH);
        const jobs = [];
        let stagger = 0;
        for (const c of cards) {
            if (!this.pool.isActive(c.cardId)) continue;
            jobs.push(this.paintCard(c.cardId, c.color, stagger));
            stagger += ANIM.PAINT_STAGGER;
        }
        await Promise.all(jobs);
        this.audio.play(SFX.PAINT_DONE);
    }

    async paintCard(id, color, delay) {
        const pool = this.pool;
        if (delay > 0) await sleep(delay);
        if (!pool.isActive(id)) return;

        const hex = CONFIG.COLOR_HEX[color] || '#ffffff';
        const r = hexChannel(hex, 1);
        const g = hexChannel(hex, 3);
        const b = hexChannel(hex, 5);
        const homeY = pool.targetY[id];
        const baseZ = pool.zIndex[id];
        const baseScale = pool.scale[id];
        const scale = ANIM.PAINT_SCALE;
        pool.zIndex[id] = 600;

        // 1) A carta sobe da mão e cresce
        await this.tween(id, { targetY: homeY - ANIM.PAINT_RISE, scale, rotation: 0 }, ANIM.PAINT_LIFT, Easing.BackOut);
        if (!pool.isActive(id)) return;

        const cx = this.centerX(id);
        const cy = this.centerY(id);
        const halfW = HALF_W * scale;
        const top = cy - HALF_H * scale;
        const height = CARD_DIMENSIONS.HEIGHT * scale;

        // 2) Respingo de tinta batendo no topo da carta
        this.particles.emitBurst(cx, top, hex, 34, 300, PARTICLE_TYPES.CIRCLE, 1.4);
        this.particles.emitBurst(cx, top, '#ffffff', 10, 220, PARTICLE_TYPES.STAR);

        // 3) A tinta escorre de cima pra baixo, pingando gotas na frente
        pool.paintFrom[id] = pool.color[id];
        pool.color[id] = color;
        pool.paintT[id] = 0;
        pool.paintAnim[id] = 1;
        await this.animate(ANIM.PAINT_SWEEP, (t) => {
            if (!pool.isActive(id)) return;
            const eased = Easing.QuadInOut(t);
            pool.paintT[id] = eased;
            if (t >= 1) return;
            const frontY = top + eased * height;
            for (let n = 0; n < 2; n++) {
                const px = cx + (Math.random() * 2 - 1) * halfW * 0.9;
                const vx = (Math.random() - 0.5) * 40;
                const vy = 80 + Math.random() * 140;
                const size = 2 + Math.random() * 3.5;
                this.particles.emit(px, frontY, vx, vy, 0.45 + Math.random() * 0.4, size, PARTICLE_TYPES.CIRCLE, r, g, b);
            }
        });
        pool.paintAnim[id] = 0;
        if (!pool.isActive(id)) return;

        // 4) Tinta assentou: estouro de brilho na cor nova e a carta volta pra mão com impulso
        this.particles.emitBurst(cx, cy, hex, 45, 380, PARTICLE_TYPES.STAR, 1.3);
        this.particles.emitBurst(cx, cy, '#ffffff', 18, 260, PARTICLE_TYPES.CIRCLE);
        this.particles.emitRise(cx, cy, hex, 20, halfW, 220, PARTICLE_TYPES.STAR);
        await this.tween(id, { scale: scale * 1.12 }, ANIM.PAINT_SETTLE * 0.35, Easing.QuadOut);
        await this.tween(id, { targetY: homeY, scale: baseScale }, ANIM.PAINT_SETTLE, Easing.BackOut);
        pool.zIndex[id] = baseZ;
    }

    /** Cura resolvida no fim do combate (amount 0 = desperdiçada, só quem usou recebe esse aviso). */
    async heal(evt) {
        const isSelf = evt.seat === REL_SEAT.SELF;
        const p = this.hpPoint(isSelf);
        if (!(evt.amount > 0)) {
            this.audio.play(SFX.FIZZLE);
            this.hud.playHealFizzle();
            this.particles.emitRise(p.x, p.y, '#95a5a6', 25, 40, 160, PARTICLE_TYPES.CIRCLE);
            return;
        }
        this.audio.play(SFX.HEAL);
        this.hud.playHealBurst(isSelf);
        this.particles.emitRise(p.x, p.y, '#2ecc71', 60, 70, 380, PARTICLE_TYPES.STAR);
        this.particles.emitRise(p.x, p.y, '#b6ffd6', 40, 60, 300, PARTICLE_TYPES.CIRCLE);
        this.hud.showFloatingText(`+${evt.amount} ♥`, isSelf, 'heal');
        await sleep(ANIM.HEAL_BURST);
    }

    /**
     * Reviver salvou `seat` da morte (os dois veem): luz divina na caixa de vida do alvo e, em seguida,
     * a carta do Reviver aparece gigante no centro, racha e se despedaça.
     */
    async reviveSave(seat) {
        const isSelf = seat === REL_SEAT.SELF;
        const p = this.hpPoint(isSelf);
        this.audio.play(SFX.REVIVE_SAVE);
        this.hud.playDivine(isSelf);
        this.particles.emitRise(p.x, p.y, '#ffd700', 70, 60, 420, PARTICLE_TYPES.STAR);
        this.particles.emitRise(p.x, p.y, '#ffffff', 40, 50, 320, PARTICLE_TYPES.CIRCLE);
        this.particles.emitBurst(p.x, p.y, '#fff3b0', 50, 260, PARTICLE_TYPES.STAR);
        await sleep(ANIM.DIVINE_LEAD * 0.5);
        this.particles.emitRise(p.x, p.y, '#ffe680', 50, 70, 360, PARTICLE_TYPES.STAR);
        await sleep(ANIM.DIVINE_LEAD * 0.5);
        await this.showcaseShatter(CARD_TYPES.REVIVE);
    }

    /** Carta gigante no centro: entra com impulso, fica brilhando, racha tremendo e explode em estilhaços. */
    async showcaseShatter(type) {
        const sc = this.showcase;
        if (!sc) return;
        const target = ANIM.SHOWCASE_SCALE;
        sc.type = type;
        sc.color = COLOR.BLACK;
        sc.cracks = makeCracks();
        sc.crack = 0;
        sc.shakeX = 0;
        sc.shakeY = 0;
        sc.cardVisible = true;

        this.audio.play(SFX.SPARKLE);
        await this.animate(ANIM.SHOWCASE_IN, (t) => {
            const e = Easing.BackOut(t);
            sc.scale = 0.3 + (target - 0.3) * e;
            sc.alpha = Math.min(1, t * 2);
            sc.dim = 0.5 * t;
            sc.glow = t;
            sc.rotation = -0.25 * (1 - e);
        });
        await sleep(ANIM.SHOWCASE_HOLD);

        await this.animate(ANIM.SHOWCASE_CRACK, (t) => {
            const amp = 7 * t;
            sc.crack = t;
            sc.shakeX = (Math.random() - 0.5) * amp;
            sc.shakeY = (Math.random() - 0.5) * amp;
            sc.scale = target + 0.1 * t;
        });

        const cx = this.viewport.width / 2;
        const cy = this.viewport.height / 2;
        this.audio.play(SFX.REVIVE_SHATTER);
        // Estilhaços: lascas douradas grandes, riscos de vidro, brilhos e poeira de luz
        this.particles.emitBurst(cx, cy, '#ffd700', 150, 1100, PARTICLE_TYPES.SQUARE, 2.2);
        this.particles.emitBurst(cx, cy, '#fffbe6', 90, 900, PARTICLE_TYPES.SQUARE, 1.6);
        this.particles.emitBurst(cx, cy, '#ffe9a3', 70, 1300, PARTICLE_TYPES.SPARK, 1.3);
        this.particles.emitBurst(cx, cy, '#ffffff', 80, 700, PARTICLE_TYPES.STAR, 2);
        this.particles.emitBurst(cx, cy, '#fff3b0', 40, 350, PARTICLE_TYPES.CIRCLE, 2.5);
        sc.cardVisible = false;
        sc.crack = 0;
        sc.shakeX = 0;
        sc.shakeY = 0;
        sc.flash = 1;

        await this.animate(ANIM.SHOWCASE_FADE, (t) => {
            sc.flash = 1 - Easing.QuadOut(t);
            sc.dim = 0.5 * (1 - t);
            sc.glow = 1 - t;
        });
        sc.flash = 0;
        sc.dim = 0;
        sc.glow = 0;
    }

    /** Carta sobe, recua e dispara contra a vida do alvo. `seat` é o atacante (relativo). */
    async directHit(evt) {
        const pool = this.pool;
        const id = evt.cardId;
        const selfIsTarget = evt.seat === REL_SEAT.OPPONENT;
        // Carta reforçada pela Emboscada: é um golpe numérico normal (volta pra mão) + selo no slot USE do alvo
        const ambushLock = evt.effect === HIT_EFFECT.USE_LOCKOUT;

        if (pool.isActive(id)) {
            const startX = pool.targetX[id];
            const startY = pool.targetY[id];
            const exitY = selfIsTarget ? this.viewport.height + 100 : -CARD_DIMENSIONS.HEIGHT - 100;
            const recoilY = selfIsTarget ? startY - 30 : startY + 30;
            pool.zIndex[id] = 500;

            if (ambushLock) {
                // Aura tóxica subindo da carta enquanto ela "arma o bote"
                this.particles.emitRise(this.centerX(id), this.centerY(id), AMBUSH_GREEN, 26, 45, 170, PARTICLE_TYPES.CIRCLE);
                if (this.fx) this.fx.ring(this.centerX(id), this.centerY(id), 10, 80, ANIM.DIRECT_LIFT + ANIM.DIRECT_RECOIL, AMBUSH_GREEN, 2);
            }
            await this.tween(id, { scale: 1.3 }, ANIM.DIRECT_LIFT);
            await this.tween(id, { targetY: recoilY }, ANIM.DIRECT_RECOIL);
            if (ambushLock) {
                const cx = this.centerX(id);
                const cy = this.centerY(id);
                this.particles.emitLine(cx, cy, cx, selfIsTarget ? this.viewport.height : 0, AMBUSH_GREEN, 26, PARTICLE_TYPES.SPARK);
            }
            await this.tween(id, { targetY: exitY, scale: 1.0 }, ANIM.DIRECT_DASH, Easing.CubicIn);
            this.impact(evt, selfIsTarget);

            if (evt.destroyed) {
                if (evt.death) {
                    // Marcado pela Ronova: a carta que lutou se desfaz em chamas carmesim no golpe
                    ronovaHitFx(this, selfIsTarget);
                } else {
                    // Fusão 20 instável: se despedaça no golpe em vez de voltar pra mão
                    const p = this.hpPoint(selfIsTarget);
                    this.audio.play(SFX.DESTROY);
                    this.particles.emitBurst(p.x, p.y, '#ffd23c', 50, 340, PARTICLE_TYPES.SPARK, 1.3);
                    this.particles.emitBurst(p.x, p.y, CONFIG.COLOR_HEX[pool.color[id]], 40, 260, PARTICLE_TYPES.SQUARE, 1.4);
                    if (this.fx) this.fx.ring(p.x, p.y, 10, 120, 500, '#ffd23c', 3);
                }
                this.remove(id);
                if (ambushLock) await this.sealUseSlot(selfIsTarget);
                else await sleep(ANIM.DIRECT_RETURN);
            } else if (evt.effect === HIT_EFFECT.OVERLOAD) {
                this.remove(id);
                await this.overloadBurn(evt, selfIsTarget, startX + HALF_W);
            } else if (ambushLock) {
                await Promise.all([
                    this.tween(id, { targetX: startX, targetY: startY }, ANIM.DIRECT_RETURN),
                    this.sealUseSlot(selfIsTarget)
                ]);
            } else if (evt.effect !== HIT_EFFECT.NONE) {
                this.remove(id);
                await sleep(ANIM.DIRECT_RETURN);
            } else {
                await this.tween(id, { targetX: startX, targetY: startY }, ANIM.DIRECT_RETURN);
            }
        } else {
            this.impact(evt, selfIsTarget);
            if (evt.effect === HIT_EFFECT.OVERLOAD) await this.overloadBurn(evt, selfIsTarget, this.viewport.width / 2);
            else if (ambushLock) await this.sealUseSlot(selfIsTarget);
        }
    }

    /**
     * Emboscada na vida: um fio farpado sai da vida do alvo até o slot USE dele, tece uma teia de espinhos
     * e o olho da Emboscada abre no centro. No fim, o selo animado vira o selo fixo do tabuleiro (mesmo
     * desenho, mesmo tick: não pisca) até o bloqueio acabar.
     */
    async sealUseSlot(selfIsTarget) {
        const zone = selfIsTarget ? ZONE.SELF_USE : ZONE.OPP_USE;
        const rect = this.board.slots[zone];
        if (!rect) return;
        const dur = ANIM.USE_LOCK;
        const hp = this.hpPoint(selfIsTarget);
        const cx = rect.hitX + rect.hitW / 2;
        const cy = rect.hitY + rect.hitH / 2;

        this.audio.play(SFX.USE_LOCK_THREAD);
        const seal = this.fx ? this.fx.seal(hp.x, hp.y, cx, cy, rect.hitW / 2, rect.hitH / 2, dur) : -1;
        this.particles.emitBurst(hp.x, hp.y, AMBUSH_GREEN, 22, 200, PARTICLE_TYPES.SPARK);

        // O fio chega: a teia começa a se fechar com um estalo tóxico
        await sleep(dur * 0.25);
        this.audio.play(SFX.USE_LOCK);
        if (this.fx) this.fx.ring(cx, cy, 8, 95, dur * 0.4, AMBUSH_GREEN, 2.5);
        this.particles.emitBurst(cx, cy, AMBUSH_GREEN, 36, 260, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(cx, cy, '#0f7a04', 20, 140, PARTICLE_TYPES.SQUARE, 1.3);

        // O olho abre: pulso de luz, fumaça venenosa subindo e o aviso na tela
        await sleep(dur * 0.4);
        if (this.fx) {
            this.fx.ring(cx, cy, 20, 70, dur * 0.35, '#b6ff9e', 3);
            this.fx.ring(cx, cy, 30, 130, dur * 0.45, AMBUSH_GREEN, 1.6, 1.4);
        }
        this.particles.emitRise(cx, cy, '#6dff4a', 30, rect.hitW * 0.4, 110, PARTICLE_TYPES.CIRCLE);
        this.particles.emitBurst(cx, cy, '#e9ffe0', 14, 180, PARTICLE_TYPES.STAR);
        this.hud.showSpecialAlert(i18n.t('HIT_USE_LOCKOUT'), 'alert-ambush');

        await sleep(dur * 0.35);
        this.board.setLocked(zone, true);
        if (this.fx) this.fx.endSeal(seal);
    }

    impact(evt, selfIsTarget) {
        const overload = evt.effect === HIT_EFFECT.OVERLOAD;
        const ambushLock = evt.effect === HIT_EFFECT.USE_LOCKOUT;
        const waveColor = overload ? STORM_COLOR : ambushLock ? AMBUSH_GREEN : '#ff0000';
        this.audio.play(SFX.DIRECT_HIT);
        this.particles.emitDamageWave(selfIsTarget, waveColor, 150, overload ? PARTICLE_TYPES.SPARK : PARTICLE_TYPES.SQUARE);
        if (selfIsTarget) this.hud.flashDamage();

        let text;
        let variant = '';
        if (overload) {
            text = i18n.t('HIT_OVERLOAD');
            variant = 'overload';
            this.audio.play(SFX.OVERLOAD);
            this.flashScreen(0.8);
        } else if (evt.effect === HIT_EFFECT.LOCKOUT) {
            text = i18n.t('HIT_LOCKOUT');
            this.audio.play(SFX.LOCKOUT);
        } else if (evt.effect === HIT_EFFECT.HAND_SWAP) {
            text = i18n.t('HIT_HAND_SWAP');
            this.audio.play(SFX.HAND_SWAP);
        } else {
            // NONE ou USE_LOCKOUT: os dois são golpes numéricos (o bloqueio do slot vem em sealUseSlot)
            text = `-${evt.damage} ♥`;
            this.audio.play(SFX.DAMAGE);
            if (ambushLock) {
                variant = 'ambush';
                this.audio.play(SFX.AMBUSH_STING);
                const p = this.hpPoint(selfIsTarget);
                this.particles.emitBurst(p.x, p.y, AMBUSH_GREEN, 40, 300, PARTICLE_TYPES.STAR, 1.2);
                this.particles.emitBurst(p.x, p.y, '#0f7a04', 24, 180, PARTICLE_TYPES.SQUARE, 1.4);
                this.particles.emitRise(p.x, p.y, '#6dff4a', 20, 40, 140, PARTICLE_TYPES.CIRCLE);
                if (this.fx) this.fx.ring(p.x, p.y, 16, 110, 520, AMBUSH_GREEN, 3);
            }
            // `absorbed` agora chega para ambos, revelando o segredo no momento do impacto
            if (evt.absorbed > 0) {
                variant = 'shielded';
                this.hud.flashShield(selfIsTarget);
                this.audio.play(SFX.SHIELD_HIT);
                const p = this.hpPoint(selfIsTarget);
                this.particles.emitBurst(p.x, p.y, '#7df9ff', 45, 280, PARTICLE_TYPES.STAR);
            }
            if (evt.guarded) {
                variant = 'guarded';
                this.hud.flashGuard(selfIsTarget);
                const p = this.hpPoint(selfIsTarget);
                this.particles.emitRise(p.x, p.y, '#ffd700', 35, 45, 300, PARTICLE_TYPES.STAR);
            }
        }
        this.hud.showFloatingText(text, selfIsTarget, variant);
    }

    async destroyMany(cardIds) {
        if (cardIds.length === 0) return;
        this.audio.play(SFX.DESTROY);
        for (const id of cardIds) this.explode(id, '#ff3333', 40, 220);
        await sleep(CONFIG.TIMINGS.DESTROY);
    }

    /** Cartas do perdedor explodem, e cada jogador vê sua própria tela (vitória ou derrota). */
    async gameOver(result, reason, winnerName) {
        if (this.gameOverShown) return;
        const pool = this.pool;
        const loserRelSeat = result === GAME_RESULT.VICTORY ? REL_SEAT.OPPONENT : REL_SEAT.SELF;
        const spread = CONFIG.TIMINGS.GAME_OVER_SEQUENCE * 0.8;

        for (let id = 0; id < pool.maxCards; id++) {
            if (pool.active[id] !== 1 || zoneSeat(pool.zone[id]) !== loserRelSeat) continue;
            setTimeout(() => {
                if (!pool.isActive(id)) return;
                this.particles.emitBurst(this.centerX(id), this.centerY(id), '#ff3333', 150, 600, PARTICLE_TYPES.STAR);
                this.remove(id);
            }, Math.random() * spread);
        }

        await sleep(CONFIG.TIMINGS.GAME_OVER_SEQUENCE);
        const explosionY = loserRelSeat === REL_SEAT.SELF ? this.viewport.height - 100 : 100;
        this.particles.emitBurst(this.viewport.width / 2, explosionY, '#ff0000', 300, 1000, PARTICLE_TYPES.STAR);
        this.showGameOverScreen(result, reason, winnerName);
    }

    /** Revanche: encerra os fogos de artifício e libera a tela de fim de jogo para a próxima partida. */
    reset() {
        clearInterval(this.fireworksTimer);
        this.fireworksTimer = null;
        this.gameOverShown = false;
        ronovaReset();
        surgeReset(this);
        if (this.bolts) this.bolts.clear();
        if (this.fx) this.fx.clear();
        if (this.ultimate) this.ultimate.reset();
        this.hud.hidePanic();
        if (this.scene) this.scene.flash = 0;
        if (this.showcase) {
            this.showcase.cardVisible = false;
            this.showcase.dim = 0;
            this.showcase.glow = 0;
            this.showcase.flash = 0;
        }
    }

    showGameOverScreen(result, reason, winnerName) {
        if (this.gameOverShown) return;
        this.gameOverShown = true;
        this.audio.play(result === GAME_RESULT.VICTORY ? SFX.VICTORY : SFX.DEFEAT);

        if (result === GAME_RESULT.VICTORY && !this.fireworksTimer) {
            this.fireworksTimer = setInterval(() => {
                const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
                this.particles.emitBurst(Math.random() * this.viewport.width, Math.random() * this.viewport.height / 2, color, 50, 400, PARTICLE_TYPES.STAR);
            }, 500);
        }
        this.hud.showGameOver(result, reason, winnerName, this.client.isSpectator);
    }

    /** O 0 do topo da pilha sobe, mergulha girando no 1/2 de baixo e ele vira 10/20 (GAME_RULES §6.16). */
    async fusion(evt) {
        const { topId, underId, newPower } = evt;
        const pool = this.pool;
        
        // topId (carta 0) já foi descartada no servidor e desativada no cliente pelo snapshot,
        // reativamos temporariamente para animá-la voando até sumir.
        if (pool.isValid(topId)) pool.active[topId] = 1;

        if (!pool.isActive(underId)) {
            this.applyInstant(evt);
            return;
        }
        const cx = this.centerX(underId);
        const cy = this.centerY(underId);
        const color = CONFIG.COLOR_HEX[pool.color[underId]];
        // O 0 fica quase exatamente em cima do 1/2 na pilha: sobe primeiro pra fusão ser visível
        const dir = cy < this.viewport.height / 2 ? 1 : -1;
        const liftY = pool.targetY[topId] + dir * ANIM.FUSION_LIFT_PX;

        const baseZ = pool.zIndex[underId];
        pool.zIndex[topId] = 600;
        pool.zIndex[underId] = 599;
        this.audio.play(SFX.WHOOSH);
        this.particles.emitRise(cx, cy, color, 18, 40, 160, PARTICLE_TYPES.STAR);
        await this.tween(topId, { targetY: liftY, scale: 1.2, rotation: pool.rotation[topId] - 0.25 },
            ANIM.FUSION_SPIN * 0.45, Easing.QuadOut);

        // Mergulha girando e encolhendo até sumir dentro do número de baixo
        this.audio.play(SFX.FUSION);
        this.particles.emitLine(this.centerX(topId), this.centerY(topId), cx, cy, '#ffd23c', 22, PARTICLE_TYPES.STAR);
        await this.tween(topId, {
            targetX: pool.targetX[underId], targetY: pool.targetY[underId],
            rotation: pool.rotation[topId] + Math.PI * 2.5, scale: 0.15, alpha: 0
        }, ANIM.FUSION_SPIN * 0.55, Easing.CubicIn);

        this.remove(topId);

        // Impacto: anel de choque na cor da carta + um segundo anel dourado de "poder", com confete
        if (this.fx) {
            this.fx.ring(cx, cy, 6, 90, ANIM.FUSION_FLASH, color, 3);
            this.fx.ring(cx, cy, 4, 60, ANIM.FUSION_FLASH * 0.7, '#ffd23c', 2);
        }
        this.particles.emitBurst(cx, cy, color, 26, 260, PARTICLE_TYPES.STAR);
        this.particles.emitBurst(cx, cy, '#ffd23c', 22, 320, PARTICLE_TYPES.SPARK, 1.2);
        this.particles.emitBurst(cx, cy, '#ffffff', 14, 200, PARTICLE_TYPES.CIRCLE);
        this.hud.showSpecialAlert(i18n.t('FUSION_ALERT'), 'alert-fusion');

        pool.power[underId] = newPower;
        await this.tween(underId, { scale: 1.55 }, ANIM.FUSION_FLASH * 0.35, Easing.QuadOut);
        await this.tween(underId, { scale: 1.0 }, ANIM.FUSION_FLASH * 0.65, Easing.BackOut);
        pool.zIndex[underId] = baseZ;
    }

    /** Block/Reverso quebram a fusão: o número volta ao valor original e o "0" absorvido reaparece. */
    async unfuse(evt) {
        const { cardId, zeroId, restoredPower } = evt;
        if (!this.pool.isActive(cardId)) {
            this.applyInstant(evt);
            return;
        }
        const pool = this.pool;

        this.audio.play(SFX.UNFUSE);
        const cx = this.centerX(cardId);
        const cy = this.centerY(cardId);

        if (this.fx) this.fx.ring(cx, cy, 8, 78, ANIM.UNFUSE * 0.75, '#ffffff', 2.5);
        this.particles.emitBurst(cx, cy, '#ffffff', 16, 220, PARTICLE_TYPES.SQUARE);
        this.particles.emitBurst(cx, cy, CONFIG.COLOR_HEX[pool.color[cardId]], 14, 190, PARTICLE_TYPES.STAR);

        pool.power[cardId] = restoredPower;
        await this.tween(cardId, { scale: 0.82 }, ANIM.UNFUSE * 0.25, Easing.QuadOut);
        this.tween(cardId, { scale: 1.0 }, ANIM.UNFUSE * 0.75, Easing.BackOut);

        // O "0" absorvido reaparece ejetado ao lado, bem pequeno, e "pipoca" de volta ao tamanho normal
        pool.activate(zeroId, pool.x[cardId] - HALF_W * 0.6, pool.y[cardId]);
        pool.scale[zeroId] = 0.3;
        this.tween(zeroId, { scale: 1.0 }, ANIM.UNFUSE * 0.75, Easing.BackOut);

        await sleep(ANIM.UNFUSE * 0.35);
    }
}
