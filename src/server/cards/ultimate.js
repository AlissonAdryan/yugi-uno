import { CONFIG } from '../../config/constants.js';
import { EVENT } from '../../network/protocol.js';
import { tripleKind } from '../../systems/rules.js';
import { SEAT, ZONE_OFFSET } from '../../utils/zones.js';
import { resolvePrisonClash, resolvePrisonDirectHit } from './prison.js';
import { resolveKarmaClash, resolveKarmaDirectHit, rewindHand } from './karma.js';

const { ATTACK } = ZONE_OFFSET;
const { CARD_TYPES, TIMINGS, ULTIMATE } = CONFIG;

/** Os 3 ids do topo (do fundo pro topo) de uma pilha que forma um Combo Supremo. */
function tripleIds(stack) {
    return stack.slice(stack.length - ULTIMATE.TRIPLE);
}

/**
 * Combos Supremos (GAME_RULES §6.18) no choque: 3 Blocks ou 3 Reversos idênticos (mesma cor) no topo
 * da linha de frente têm prioridade sobre o choque normal. Chamado antes de `ServerCombat.clash`.
 *  - Supremo x Supremo: os dois se aniquilam (colapso, as 6 cartas se desfazem).
 *  - Fantasma na frente: intangível, atravessa sem acionar nada (segue o choque normal).
 *  - Senão: Prisão de Cristal (prison.js) ou Reverso Kármico (karma.js).
 * @param {import('../server-combat.js').ServerCombat} combat
 * @returns {Promise<boolean>} true se um Supremo resolveu este passo do combate
 */
export async function resolveUltimateClash(combat) {
    const s = combat.state;
    const stack0 = s.zone(SEAT.P1, ATTACK);
    const stack1 = s.zone(SEAT.P2, ATTACK);
    const kind0 = tripleKind(s, stack0);
    const kind1 = tripleKind(s, stack1);
    if (kind0 < 0 && kind1 < 0) return false;

    if (kind0 >= 0 && kind1 >= 0) {
        const aIds = tripleIds(stack0);
        const bIds = tripleIds(stack1);
        console.log('[ServerCombat] COLAPSO: dois Combos Supremos se chocaram e se aniquilaram.');
        combat.engine.emit(EVENT.ULTIMATE_COLLAPSE, { aIds, bIds });
        for (const id of aIds) combat.deck.discard(id);
        for (const id of bIds) combat.deck.discard(id);
        combat.engine.markDirty();
        await combat.engine.sleep(TIMINGS.ULTIMATE_COLLAPSE);
        return true;
    }

    const seat = kind0 >= 0 ? SEAT.P1 : SEAT.P2;
    const kind = kind0 >= 0 ? kind0 : kind1;
    const enemyTop = s.top(1 - seat, ATTACK);
    if (s.type[enemyTop] === CARD_TYPES.GHOST) {
        console.log(`[ServerCombat] O Fantasma atravessa o Combo Supremo de P${seat + 1} sem acionar nada.`);
        return false;
    }

    const ids = tripleIds(seat === SEAT.P1 ? stack0 : stack1);
    if (kind === CARD_TYPES.BLOCK) {
        await resolvePrisonClash(combat, seat, ids, s.type[enemyTop] === CARD_TYPES.MIRROR);
    } else {
        await resolveKarmaClash(combat, seat, ids);
    }
    return true;
}

/**
 * Combo Supremo acertando a vida (a pilha do atacante passou livre). Consome as 3 cartas.
 * @param {import('../server-combat.js').ServerCombat} combat
 * @returns {Promise<number>} -1 se não há Supremo no topo; senão o vencedor da partida (ou -2: seguiu viva)
 */
export async function resolveUltimateDirectHit(combat, attacker, target) {
    const s = combat.state;
    const front = s.zone(attacker, ATTACK);
    const kind = tripleKind(s, front);
    if (kind < 0) return -1;

    const ids = tripleIds(front);
    if (kind === CARD_TYPES.BLOCK) {
        await resolvePrisonDirectHit(combat, attacker, target, ids);
        return -2;
    }
    const winner = await resolveKarmaDirectHit(combat, attacker, target, ids);
    if (winner >= 0) return winner;
    await rewindHand(combat, target);
    return -2;
}
