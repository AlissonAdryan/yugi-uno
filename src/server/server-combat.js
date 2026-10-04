import { CONFIG } from '../config/constants.js';
import {
    CLASH_KIND, classifyClash, healAmount, isConsumable, isSummon, resolveNumberClash, shieldedDamage, summonCount, surgeDamage
} from '../systems/rules.js';
import { SEAT, ZONE, ZONE_OFFSET, seatZone } from '../utils/zones.js';
import { EVENT, HIT_EFFECT, MSG, localizeEvent } from '../network/protocol.js';

import { resolveSummon } from './cards/summon.js';
import { resolveLightningClash, resolveLightningDirectHit } from './cards/lightning.js';
import { resolveBlockClash, resolveBlockDirectHit } from './cards/block.js';
import { resolveReverseClash, resolveReverseDirectHit } from './cards/reverse.js';
import { applyHeals } from './cards/heal.js';
import { reviveSave } from './cards/revive.js';
import { resolveGhostPass } from './cards/ghost.js';
import { resolveMirrorClash, resolveMirrorDirectHit, resolveMirrorParadox } from './cards/mirror.js';
import { settleAmbushes, triggerAmbush, triggerPendingAmbushes } from './cards/ambush.js';
import { burnRonovaFighters, ronovaBurnsHitter } from './cards/death.js';
import { resolveUltimateClash, resolveUltimateDirectHit } from './cards/ultimate.js';

const { CARD_TYPES, TIMINGS } = CONFIG;
const { ATTACK, DEFENSE, HAND, USE } = ZONE_OFFSET;
const SEATS = [SEAT.P1, SEAT.P2];

/**
 * ServerCombat - resolução autoritativa do combate (GAME_RULES.md §3 e §6).
 * Cada passo segue o padrão: emit(evento) -> mutação -> sleep(tempo da animação).
 */
export class ServerCombat {
    /**
     * @param {import('./server-state.js').ServerState} state
     * @param {import('../systems/deck-system.js').DeckSystem} deck
     * @param {import('./server-engine.js').ServerEngine} engine
     */
    constructor(state, deck, engine) {
        this.state = state;
        this.deck = deck;
        this.engine = engine;
        this.roundWinner = -1;
        this.gameWinner = -1;
        // Dano numérico (-X ♥) que cada assento levou na rodada; Block/Reverso na vida não contam
        this.damageTaken = new Int16Array(2);
        // Dano numérico que cada assento causou na rodada (base da Cura)
        this.damageDealt = new Int16Array(2);
    }

    /**
     * @returns {Promise<{ roundWinner: number, gameWinner: number }>}
     */
    async resolve() {
        const s = this.state;
        this.roundWinner = -1;
        this.gameWinner = -1;
        this.damageTaken.fill(0);
        this.damageDealt.fill(0);

        // A Troca de Guarda age antes de qualquer revelação: quem entra em combate já é a pilha trocada
        await this.resolveGuardSwap();
        await this.revealCards([...s.zone(SEAT.P1, ATTACK), ...s.zone(SEAT.P2, ATTACK)], TIMINGS.REVEAL);
        // Emboscada cuja Defesa a Troca de Guarda já levou pra frente: a armadilha acompanha a carta
        await triggerPendingAmbushes(this);

        let steps = 0;
        while (steps++ < CONFIG.COMBAT_MAX_STEPS && !this.engine.isGameOver() && this.gameWinner < 0) {
            await this.applyFusions(SEAT.P1, ATTACK);
            await this.applyFusions(SEAT.P2, ATTACK);

            const top0 = s.top(SEAT.P1, ATTACK);
            const top1 = s.top(SEAT.P2, ATTACK);

            if (top0 >= 0 && isSummon(s.type[top0])) { await resolveSummon(this, SEAT.P1, top0); continue; }
            if (top1 >= 0 && isSummon(s.type[top1])) { await resolveSummon(this, SEAT.P2, top1); continue; }

            if (top0 < 0 && top1 < 0) {
                const has0 = s.zone(SEAT.P1, DEFENSE).length > 0;
                const has1 = s.zone(SEAT.P2, DEFENSE).length > 0;
                if (!has0 && !has1) break;
                console.log('[ServerCombat] Empate na linha de frente. Revelando defesas...');
                // Os 1,5s da regra contam a partir do empate, cuja pausa (TIMINGS.TIE) já passou
                await this.engine.sleep(Math.max(0, TIMINGS.TIE_DEFENSE_DELAY - TIMINGS.TIE));
                await this.promoteDefenses(has0, has1);
                continue;
            }

            if (top0 < 0 || top1 < 0) {
                const defender = top0 < 0 ? SEAT.P1 : SEAT.P2;
                if (s.zone(defender, DEFENSE).length > 0) {
                    await this.promoteDefenses(defender === SEAT.P1, defender === SEAT.P2);
                    continue;
                }
                await this.assaultLife(1 - defender);
                break;
            }

            // Combos Supremos (3 Blocks / 3 Reversos idênticos) têm prioridade sobre o choque do topo
            if (await resolveUltimateClash(this)) continue;
            await this.clash(top0, top1);
        }

        if (steps >= CONFIG.COMBAT_MAX_STEPS) {
            console.warn('[ServerCombat] Limite de passos de combate atingido. Encerrando combate por segurança.');
        }

        if (!this.engine.isGameOver() && this.gameWinner < 0) {
            await applyHeals(this);
            // Marcado pela Ronova: quem lutou queima antes de as sobras voltarem pra mão
            await burnRonovaFighters(this);
            this.returnLeftovers();
        }
        settleAmbushes(this);
        return { roundWinner: this.roundWinner, gameWinner: this.gameWinner };
    }

    /**
     * Fusão de combo (GAME_RULES §6.16): um 0 empilhado em cima de um 1 ou 2 da mesma cor (combo permitido
     * por rules.isValidCombo) se funde antes do choque — o 0 é absorvido e o 1 vira 10, o 2 vira 20. O 0
     * fica guardado em fusionChild/fusionBase pra caso Block/Reverso desfaçam a fusão (cards/block.js,
     * cards/reverse.js). Vale também quando um +2/+4 puxa essa sequência.
     */
    async applyFusions(seat, zoneOffset) {
        const s = this.state;
        const stack = s.zone(seat, zoneOffset);
        if (stack.length < 2) return;
        const zero = stack[stack.length - 1];
        const base = stack[stack.length - 2];
        if (s.type[zero] !== CARD_TYPES.NUMBER || s.power[zero] !== 0) return;
        if (s.type[base] !== CARD_TYPES.NUMBER || (s.power[base] !== 1 && s.power[base] !== 2)) return;
        if (s.color[zero] !== s.color[base]) return;

        const newPower = s.power[base] * 10;
        console.log(`[ServerCombat] P${seat + 1}: Fusão! ${s.power[base]} + 0 -> ${newPower}.`);
        this.engine.emit(EVENT.FUSION, { seat, topId: zero, underId: base, newPower });

        s.fusionBase[base] = s.power[base];
        s.power[base] = newPower;
        s.fusionChild[base] = zero;
        s.moveCard(zero, ZONE.DISCARD);

        this.engine.markDirty();
        await this.engine.sleep(TIMINGS.FUSION);
    }

    faceOf(id) {
        const s = this.state;
        return { id, type: s.type[id], color: s.color[id], power: s.power[id] };
    }

    /**
     * Troca de Guarda (GAME_RULES §6.11): em cada campo que tiver Ataque E Defesa, as duas pilhas
     * trocam de lugar inteiras (a ordem do combo é preservada). Duas Trocas (uma de cada jogador) se
     * anulam. Um lado sem Defesa não tem o que trocar e fica como está.
     */
    async resolveGuardSwap() {
        const s = this.state;
        const users = s.guardSwap[SEAT.P1] + s.guardSwap[SEAT.P2];
        if (users === 0) return;
        
        const p1Played = s.guardSwap[SEAT.P1];
        s.guardSwap.fill(0);

        const cancelled = users % 2 === 0;
        const swaps = [0, 0];
        if (!cancelled) {
            const playerWhoPlayed = p1Played ? SEAT.P1 : SEAT.P2;
            const targetSeat = 1 - playerWhoPlayed;
            if (s.zone(targetSeat, ATTACK).length > 0 && s.zone(targetSeat, DEFENSE).length > 0) {
                swaps[targetSeat] = 1;
            }
        }
        console.log(cancelled
            ? '[ServerCombat] Duas Trocas de Guarda se anularam: ninguém troca.'
            : `[ServerCombat] Troca de Guarda! Campo trocando: P1=${swaps[0]} P2=${swaps[1]}.`);

        // Quem usou a carta continua secreto: cada um recebe só "o meu lado troca / o do oponente troca"
        for (const viewer of SEATS) {
            this.engine.emitTo(viewer, EVENT.GUARD_SWAP, {
                self: swaps[viewer], opp: swaps[1 - viewer], cancelled: cancelled ? 1 : 0
            });
        }
        if (this.engine.network.spectators && this.engine.network.spectators.size > 0) {
            this.engine.network.sendToSpectators(localizeEvent({
                k: MSG.EVENT, t: EVENT.GUARD_SWAP, self: swaps[0], opp: swaps[1], cancelled: cancelled ? 1 : 0
            }, -1));
        }
        for (const seat of SEATS) {
            if (!swaps[seat]) continue;
            const attack = s.zone(seat, ATTACK).slice();
            const defense = s.zone(seat, DEFENSE).slice();
            for (const id of defense) s.moveCard(id, seatZone(seat, ATTACK));
            for (const id of attack) s.moveCard(id, seatZone(seat, DEFENSE));
            // A Emboscada já plantada acompanha a antiga Defesa (agora na frente): dispara após a revelação
            if (s.ambush[seat]) s.ambushTarget[seat] = defense[defense.length - 1];
        }
        this.engine.markDirty();
        await this.engine.sleep(TIMINGS.GUARD_SWAP);
    }

    async revealCards(ids, waitMs) {
        const s = this.state;
        const faces = [];
        for (const id of ids) {
            if (!s.revealed[id]) faces.push(this.faceOf(id));
        }
        if (faces.length > 0) {
            this.engine.emit(EVENT.REVEAL, { cards: faces });
            for (const face of faces) s.revealed[face.id] = 1;
            this.engine.markDirty();
        }
        await this.engine.sleep(waitMs);
    }

    /** Defesa entra na linha de frente (revelada), preservando a ordem da pilha. */
    async promoteDefenses(p1, p2) {
        const s = this.state;
        const ids = [];
        if (p1) ids.push(...s.zone(SEAT.P1, DEFENSE));
        if (p2) ids.push(...s.zone(SEAT.P2, DEFENSE));

        const faces = [];
        for (const id of ids) if (!s.revealed[id]) faces.push(this.faceOf(id));
        if (faces.length > 0) this.engine.emit(EVENT.REVEAL, { cards: faces });

        // Topo de cada Defesa: é a carta que a Emboscada reforça ao entrar na frente
        const top0 = p1 ? s.top(SEAT.P1, DEFENSE) : -1;
        const top1 = p2 ? s.top(SEAT.P2, DEFENSE) : -1;
        for (const id of ids) s.revealed[id] = 1;
        if (p1) s.moveAll(seatZone(SEAT.P1, DEFENSE), seatZone(SEAT.P1, ATTACK));
        if (p2) s.moveAll(seatZone(SEAT.P2, DEFENSE), seatZone(SEAT.P2, ATTACK));
        console.log(`[ServerCombat] Defesa promovida: ${p1 ? 'P1 ' : ''}${p2 ? 'P2' : ''}`);
        this.engine.markDirty();
        await this.engine.sleep(TIMINGS.PROMOTE);
        if (p1) await triggerAmbush(this, SEAT.P1, top0);
        if (p2) await triggerAmbush(this, SEAT.P2, top1);
    }

    // sinkConsumablesToBack movido para cards/summon.js
    // summon movido para cards/summon.js

    async clash(a, b) {
        const s = this.state;
        switch (classifyClash(s.type[a], s.type[b])) {
            case CLASH_KIND.NUMBERS: {
                const diff = resolveNumberClash(s.power[a], s.power[b]);
                if (diff === 0) {
                    await this.mutualDestruction(a, b);
                    return;
                }
                const winner = diff > 0 ? a : b;
                const loser = diff > 0 ? b : a;
                const winnerPower = Math.abs(diff);
                console.log(`[ServerCombat] Choque: ${s.power[a]} x ${s.power[b]} -> vencedora fica com ${winnerPower}`);
                this.engine.emit(EVENT.CLASH, { winnerId: winner, loserId: loser, winnerPower });
                s.power[winner] = winnerPower;
                this.deck.discard(loser);
                this.engine.markDirty();
                await this.engine.sleep(TIMINGS.CLASH);
                return;
            }
            case CLASH_KIND.MUTUAL_DESTRUCTION:
                await this.mutualDestruction(a, b);
                return;
            case CLASH_KIND.A_BLOCKS:
                await resolveBlockClash(this, SEAT.P1, a);
                return;
            case CLASH_KIND.B_BLOCKS:
                await resolveBlockClash(this, SEAT.P2, b);
                return;
            case CLASH_KIND.A_REVERSES:
                await resolveReverseClash(this, SEAT.P1, a);
                return;
            case CLASH_KIND.B_REVERSES:
                await resolveReverseClash(this, SEAT.P2, b);
                return;
            case CLASH_KIND.A_LIGHTNING:
                await resolveLightningClash(this, SEAT.P1, a);
                return;
            case CLASH_KIND.B_LIGHTNING:
                await resolveLightningClash(this, SEAT.P2, b);
                return;
            case CLASH_KIND.A_GHOST:
                this.endGame(await resolveGhostPass(this, [{ seat: SEAT.P1, ghostId: a }]));
                return;
            case CLASH_KIND.B_GHOST:
                this.endGame(await resolveGhostPass(this, [{ seat: SEAT.P2, ghostId: b }]));
                return;
            case CLASH_KIND.GHOST_BOTH:
                this.endGame(await resolveGhostPass(this, [{ seat: SEAT.P1, ghostId: a }, { seat: SEAT.P2, ghostId: b }]));
                return;
            case CLASH_KIND.A_MIRROR:
                await resolveMirrorClash(this, SEAT.P1, a, b);
                return;
            case CLASH_KIND.B_MIRROR:
                await resolveMirrorClash(this, SEAT.P2, b, a);
                return;
            case CLASH_KIND.MIRROR_PARADOX:
                await resolveMirrorParadox(this, a, b);
                return;
        }
    }

    /** Uma carta matou alguém durante um choque (Fantasma): a partida acaba com esse vencedor. */
    endGame(winner) {
        if (winner >= 0) this.gameWinner = winner;
    }

    // lightning movido para cards/lightning.js

    async mutualDestruction(a, b) {
        console.log('[ServerCombat] Empate/anulação: ambas destruídas.');
        this.engine.emit(EVENT.TIE, { cardIds: [a, b] });
        this.deck.discard(a);
        this.deck.discard(b);
        this.engine.markDirty();
        await this.engine.sleep(TIMINGS.TIE);
    }

    // blockSmash e reverse movidos para cards/block.js e cards/reverse.js

    /** A pilha sobrevivente ataca a vida do oponente em série; cartas numéricas voltam para a mão. */
    async assaultLife(attacker) {
        const s = this.state;
        const target = 1 - attacker;
        const front = s.zone(attacker, ATTACK);
        this.roundWinner = attacker;

        while (front.length > 0 && !this.engine.isGameOver()) {
            const cardId = front[front.length - 1];
            const type = s.type[cardId];

            if (isSummon(type)) {
                await resolveSummon(this, attacker, cardId);
                continue;
            }
            // Combo Supremo passando livre: Prisão de Cristal (tranca + trauma) ou Reverso Kármico (1,2x + pânico)
            if (type === CARD_TYPES.BLOCK || type === CARD_TYPES.REVERSE) {
                const winner = await resolveUltimateDirectHit(this, attacker, target);
                if (winner >= 0) {
                    this.gameWinner = winner;
                    return;
                }
                if (winner === -2) continue;
            }
            // Fantasma e Espelho resolvem o golpe inteiro (animação, Reviver e quem morreu) no próprio módulo
            if (type === CARD_TYPES.GHOST || type === CARD_TYPES.MIRROR) {
                const winner = type === CARD_TYPES.GHOST
                    ? await resolveGhostPass(this, [{ seat: attacker, ghostId: cardId }])
                    : await resolveMirrorDirectHit(this, attacker, target, cardId);
                if (winner >= 0) {
                    this.gameWinner = winner;
                    return;
                }
                continue;
            }

            let revived = false;
            let extraWait = 0;
            if (type === CARD_TYPES.LIGHTNING) {
                extraWait = await resolveLightningDirectHit(this, attacker, target, cardId);
            } else if (type === CARD_TYPES.BLOCK) {
                extraWait = await resolveBlockDirectHit(this, attacker, target, cardId);
            } else if (type === CARD_TYPES.REVERSE) {
                extraWait = await resolveReverseDirectHit(this, attacker, target, cardId);
            } else {
                // Carta reforçada pela Emboscada: o selo de espinhos fecha o slot USE do alvo (animação mais longa)
                if (s.ambushBoosted[attacker] === cardId) extraWait = TIMINGS.USE_LOCKOUT_EXTRA;
                revived = this.numericHit(attacker, target, cardId);
            }

            this.engine.markDirty();
            await this.engine.sleep(TIMINGS.DIRECT_HIT + extraWait);
            if (revived) await reviveSave(this, target);

            if (s.hp[target] <= 0) {
                this.gameWinner = attacker;
                return;
            }
        }
    }

    /**
     * Golpe numérico na vida, com os consumíveis do alvo aplicados na ordem: Escudo (metade do dano)
     * -> Reviver (um golpe que mataria deixa a vida em 1; depois de salvar, todo golpe da mesma
     * rodada também para em 1). A carta volta para a mão do atacante.
     * @returns {boolean} true se o Reviver acabou de salvar o alvo neste golpe
     */
    numericHit(attacker, target, cardId) {
        const s = this.state;
        // O evento descreve o estado antes da mutação: calcula, emite e só então aplica
        const hit = this.previewLifeHit(target, Math.max(0, s.power[cardId]));
        
        let effect = HIT_EFFECT.NONE;
        if (s.ambushBoosted[attacker] === cardId) {
            effect = HIT_EFFECT.USE_LOCKOUT;
            s.useLock[target] = 1;
        }

        console.log(`[ServerCombat] Dano direto de P${attacker + 1}: -${hit.damage} HP em P${target + 1}`
            + (hit.absorbed > 0 ? ` (Escudo segurou ${hit.absorbed})` : '')
            + (effect === HIT_EFFECT.USE_LOCKOUT ? ' -> Consumível bloqueado!' : '')
            + (hit.revived ? ' -> REVIVER salvou da morte!' : hit.guarded ? ' -> Reviver segurou a vida em 1' : ''));

        // Fusão 2+0 -> 20 é instável: acertou a vida, a carta se desfaz em vez de voltar pra mão (§6.16)
        // Marcado pela Ronova: a carta que lutou é consumida pelas chamas carmesim (§6.19)
        const marked = ronovaBurnsHitter(s, attacker);
        const unstable = marked || (s.fusionChild[cardId] !== -1 && s.fusionBase[cardId] === 2);

        const payload = { cardId, seat: attacker, damage: hit.damage, effect, guarded: hit.guarded ? 1 : 0 };
        if (hit.absorbed > 0) payload.absorbed = hit.absorbed;
        if (unstable) payload.destroyed = 1;
        if (marked) payload.death = 1;
        this.engine.emit(EVENT.DIRECT_HIT, payload);

        this.applyLifeHit(attacker, target, hit);
        if (unstable) this.deck.discard(cardId);
        else s.moveCard(cardId, seatZone(attacker, HAND));
        return hit.revived;
    }

    /**
     * Calcula um golpe na vida de `target` com o Escudo (metade) e o Reviver (um golpe letal deixa a vida em
     * 1; depois de salvar, todo golpe da rodada para em 1) aplicados, sem mudar nada.
     * @returns {{ damage: number, absorbed: number, revived: boolean, guarded: boolean, hp: number }}
     */
    previewLifeHit(target, raw) {
        const s = this.state;
        // Frenesi (Evento da Arena): todo golpe na vida cresce antes do Escudo
        raw = surgeDamage(raw, s.surgeKind);
        const damage = shieldedDamage(raw, s.shieldActive[target] === 1);
        let hp = s.hp[target] - damage;
        let revived = false;
        let guarded = false;
        if (hp <= 0 && damage > 0) {
            if (s.reviveGuard[target]) {
                hp = CONFIG.CONSUMABLES.REVIVE_SURVIVE_HP;
                guarded = true;
            } else if (s.reviveRounds[target] > 0) {
                hp = CONFIG.CONSUMABLES.REVIVE_SURVIVE_HP;
                revived = true;
            }
        }
        return { damage, absorbed: raw - damage, revived, guarded, hp: Math.max(0, hp) };
    }

    /**
     * Aplica um golpe calculado por previewLifeHit: vida, contadores da rodada (cor escolhida pelo
     * perdedor, Cura) e o Reviver consumido. `attacker` = -1 quando ninguém causou (reflexo do Espelho).
     */
    applyLifeHit(attacker, target, hit) {
        const s = this.state;
        s.hp[target] = hit.hp;
        this.damageTaken[target] += hit.damage;
        if (attacker >= 0 && attacker !== target) this.damageDealt[attacker] += hit.damage;
        if (hit.revived) {
            s.reviveRounds[target] = 0;
            s.reviveGuard[target] = 1;
        }
    }

    /** previewLifeHit + applyLifeHit, para quem monta o evento depois com o resultado em mãos. */
    hitLife(attacker, target, raw) {
        const hit = this.previewLifeHit(target, raw);
        this.applyLifeHit(attacker, target, hit);
        return hit;
    }

    // reviveSave movido para cards/revive.js

    // applyHeals movido para cards/heal.js
    // pickHandBurn e swapHands movidos para suas respectivas cartas

    /** Defesas intactas voltam para a mão sem nunca terem sido reveladas. */
    returnLeftovers() {
        const s = this.state;
        for (const seat of [SEAT.P1, SEAT.P2]) {
            const hand = seatZone(seat, HAND);
            // Um Espelho que volta pra mão esquece o que copiou (o valor só existe no combate)
            for (const id of s.zone(seat, ATTACK)) if (s.type[id] === CARD_TYPES.MIRROR) s.power[id] = 0;
            for (const id of s.zone(seat, DEFENSE)) if (s.type[id] === CARD_TYPES.MIRROR) s.power[id] = 0;
            s.moveAll(seatZone(seat, DEFENSE), hand);
            s.moveAll(seatZone(seat, ATTACK), hand);
            s.moveAll(seatZone(seat, USE), ZONE.DISCARD);
        }
        this.engine.markDirty();
    }
}
