import { CONFIG } from '../../config/constants.js';
import { EVENT } from '../../network/protocol.js';
import { SEAT, ZONE_OFFSET, seatZone, zoneOffset } from '../../utils/zones.js';

const { ATTACK, HAND } = ZONE_OFFSET;
const { CARD_TYPES, TIMINGS } = CONFIG;
const SEATS = [SEAT.P1, SEAT.P2];

/**
 * Emboscada (GAME_RULES §6.14): a armadilha dispara quando a carta do topo da Defesa entra na linha de
 * frente — Defesa promovida depois do Ataque cair, ou levada pro Ataque pela Troca de Guarda do oponente.
 * Só cartas de número ganham o bônus; qualquer outra desperdiça a Emboscada (em silêncio: só quem usou
 * sabia dela). Os dois veem a armadilha disparar.
 * @param {import('../server-combat.js').ServerCombat} combat
 */
export async function triggerAmbush(combat, seat, cardId) {
    const s = combat.state;
    if (!s.ambush[seat]) return;
    s.ambush[seat] = 0;
    if (cardId < 0 || s.zoneOf[cardId] !== seatZone(seat, ATTACK) || s.type[cardId] !== CARD_TYPES.NUMBER) {
        console.log(`[ServerCombat] Emboscada de P${seat + 1} desperdiçada (a carta da frente não é um número).`);
        return;
    }
    const from = s.power[cardId];
    const to = from + CONFIG.AMBUSH.BONUS;
    console.log(`[ServerCombat] EMBOSCADA de P${seat + 1}: carta ${cardId} ${from} -> ${to}.`);
    combat.engine.emit(EVENT.AMBUSH, { cardId, seat, from, to });
    s.power[cardId] = to;
    s.ambushBoosted[seat] = cardId;
    s.ambushBase[seat] = from;
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.AMBUSH);
}

/** Emboscadas cuja Defesa já foi pra frente pela Troca de Guarda: disparam logo depois da revelação. */
export async function triggerPendingAmbushes(combat) {
    const s = combat.state;
    for (const seat of SEATS) {
        const target = s.ambushTarget[seat];
        if (target < 0) continue;
        s.ambushTarget[seat] = -1;
        await triggerAmbush(combat, seat, target);
    }
}

/**
 * Fim do combate: o bônus era temporário. Uma carta reforçada que volta pra mão nunca fica acima do valor
 * original (ex.: 5+3=8 contra um 1 sobra 7 -> volta como 5). Emboscadas que não dispararam se perdem.
 */
export function settleAmbushes(combat) {
    const s = combat.state;
    for (const seat of SEATS) {
        const id = s.ambushBoosted[seat];
        if (id >= 0 && zoneOffset(s.zoneOf[id]) === HAND && s.type[id] === CARD_TYPES.NUMBER && s.power[id] > s.ambushBase[seat]) {
            console.log(`[ServerCombat] Bônus da Emboscada some: carta ${id} volta de ${s.power[id]} para ${s.ambushBase[seat]}.`);
            s.power[id] = s.ambushBase[seat];
        }
        if (s.ambush[seat]) console.log(`[ServerCombat] Emboscada de P${seat + 1} desperdiçada (a Defesa não entrou em combate).`);
    }
    s.clearAmbush();
}
