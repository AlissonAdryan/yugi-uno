import { CONFIG } from '../../config/constants.js';
import { EVENT, MSG, localizeEvent } from '../../network/protocol.js';
import { SEAT, ZONE_OFFSET, seatZone } from '../../utils/zones.js';
import { reviveSave } from './revive.js';

const { ATTACK, HAND } = ZONE_OFFSET;
const { CARD_TYPES, TIMINGS, ULTIMATE } = CONFIG;
const SEATS = [SEAT.P1, SEAT.P2];

/** Número roubado pelo Kármico: +20%, arredondado pra cima (sempre ao menos +1). */
function karmaPower(type, power) {
    if (type !== CARD_TYPES.NUMBER || power <= 0) return power;
    return Math.ceil(power * ULTIMATE.KARMA_BOOST);
}

/**
 * Reverso Kármico (GAME_RULES §6.18.2): 3 Reversos idênticos no topo rebobinam a realidade do oponente.
 * No choque: um Reverso simples inimigo na frente pifa (sobrecarregado pela anomalia); o resto da pilha
 * da frente é roubado inteiro, sem compensação, e cada número roubado volta 20% mais forte (bônus só do
 * combate). Em seguida a mão inteira do oponente é rebobinada: descartada e trocada pela mesma quantidade
 * de cartas novas do baralho.
 * @param {import('../server-combat.js').ServerCombat} combat
 * @param {number} seat dono dos Reversos
 * @param {number[]} reverseIds os 3 Reversos (do fundo pro topo)
 */
export async function resolveKarmaClash(combat, seat, reverseIds) {
    const s = combat.state;
    const enemy = 1 - seat;
    const ownZone = seatZone(seat, ATTACK);
    const front = s.zone(enemy, ATTACK);
    const top = front.length > 0 ? front[front.length - 1] : -1;
    const fizzledId = top >= 0 && s.type[top] === CARD_TYPES.REVERSE ? top : -1;
    const stolen = [];
    for (const id of front) {
        if (id !== fizzledId) stolen.push({ id, power: karmaPower(s.type[id], s.power[id]) });
    }
    const color = s.color[reverseIds[reverseIds.length - 1]];

    console.log(`[ServerCombat] REVERSO KÁRMICO de P${seat + 1}: roubou ${stolen.length} carta(s) com +20%`
        + (fizzledId >= 0 ? ' (o Reverso simples inimigo pifou)' : '') + ` e vai rebobinar a mão de P${enemy + 1}.`);
    combat.engine.emit(EVENT.KARMA, { seat, reverseIds, fizzledId, stolen, color });

    for (const id of reverseIds) combat.deck.discard(id);
    if (fizzledId >= 0) combat.deck.discard(fizzledId);
    for (const c of stolen) {
        if (s.power[c.id] !== c.power && s.karmaBase[c.id] < 0) s.karmaBase[c.id] = s.power[c.id];
        s.power[c.id] = c.power;
        s.moveCard(c.id, ownZone);
    }
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.KARMA);

    await rewindHand(combat, enemy);
}

/**
 * Rebobina a mão de `victim`: as cartas antigas vão pro descarte e ele compra a mesma quantidade. Dois
 * eventos pra respeitar "evento antes da mutação": HAND_REWIND (antigas saindo) e, depois do snapshot com a
 * mão nova, HAND_REWIND_DONE (as novas se materializando).
 * @param {import('../server-combat.js').ServerCombat} combat
 */
export async function rewindHand(combat, victim) {
    const s = combat.state;
    const handZone = seatZone(victim, HAND);
    const oldIds = s.zones[handZone].slice();
    if (oldIds.length === 0) return;

    combat.engine.emit(EVENT.HAND_REWIND, { seat: victim, ids: oldIds });
    for (const id of oldIds) combat.deck.discard(id);
    const newIds = [];
    for (let i = 0; i < oldIds.length; i++) {
        const id = combat.deck.draw(handZone);
        if (id < 0) break;
        newIds.push(id);
    }
    console.log(`[ServerCombat] Mão de P${victim + 1} rebobinada: ${oldIds.length} carta(s) trocadas por ${newIds.length} nova(s).`);
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.HAND_REWIND);

    combat.engine.emit(EVENT.HAND_REWIND_DONE, { seat: victim, ids: newIds });
    await combat.engine.sleep(TIMINGS.HAND_REWIND_DONE);
}

/**
 * Reverso Kármico na vida: devolve ao alvo 1,2x o dano numérico que o dono levou no último combate (e no atual
 * até aqui) — a vida do alvo "buga" até congelar no valor novo — e o alvo entra em pânico: na próxima
 * preparação tem poucos segundos pra jogar. Escudo e Reviver do alvo valem normalmente.
 * @param {import('../server-combat.js').ServerCombat} combat
 * @returns {Promise<number>} assento vencedor da partida se o alvo morreu, senão -1
 */
export async function resolveKarmaDirectHit(combat, attacker, target, reverseIds) {
    const s = combat.state;
    const taken = s.lastDamageTaken[attacker] + combat.damageTaken[attacker];
    const hit = combat.previewLifeHit(target, Math.ceil(taken * ULTIMATE.KARMA_BOOST));
    console.log(`[ServerCombat] REVERSO KÁRMICO de P${attacker + 1} atingiu a vida: devolveu ${taken} x${ULTIMATE.KARMA_BOOST}`
        + ` = -${hit.damage} HP em P${target + 1}` + (hit.absorbed > 0 ? ` (Escudo segurou ${hit.absorbed})` : '')
        + `; P${target + 1} entra em pânico na próxima rodada.`);

    for (const viewer of SEATS) {
        const data = { seat: attacker, reverseIds, damage: hit.damage, hp: hit.hp, guarded: hit.guarded ? 1 : 0 };
        if (viewer === target && hit.absorbed > 0) data.absorbed = hit.absorbed;
        combat.engine.emitTo(viewer, EVENT.KARMA_HIT, data);
    }
    if (combat.engine.network.spectators && combat.engine.network.spectators.size > 0) {
        const specData = { seat: attacker, reverseIds, damage: hit.damage, hp: hit.hp, guarded: hit.guarded ? 1 : 0 };
        if (hit.absorbed > 0) specData.absorbed = hit.absorbed;
        combat.engine.network.sendToSpectators(localizeEvent({ k: MSG.EVENT, t: EVENT.KARMA_HIT, ...specData }, -1));
    }
    combat.applyLifeHit(attacker, target, hit);
    for (const id of reverseIds) combat.deck.discard(id);
    s.panic[target] = 1;

    const stolenCoins = s.coins[target];
    if (stolenCoins > 0) {
        s.coins[target] = 0;
        s.coins[attacker] = Math.min(CONFIG.SHOP.MAX_COINS, s.coins[attacker] + stolenCoins);
        console.log(`[ServerCombat] Reverso Kármico roubou ${stolenCoins} moedas de P${target + 1}.`);
    }

    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.KARMA_HIT);
    if (hit.revived) await reviveSave(combat, target);
    return s.hp[target] <= 0 ? attacker : -1;
}
