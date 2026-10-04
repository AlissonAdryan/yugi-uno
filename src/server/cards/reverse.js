import { CONFIG } from '../../config/constants.js';
import { EVENT, HIT_EFFECT } from '../../network/protocol.js';
import { SEAT, seatZone, ZONE_OFFSET } from '../../utils/zones.js';

const { ATTACK, HAND } = ZONE_OFFSET;
const { CARD_TYPES, TIMINGS } = CONFIG;

/**
 * Reverso sozinho: rouba a pilha inimiga e deixa uma carta 1 de compensação.
 * Reverso vindo de uma pilha: troca as duas pilhas de lado.
 */
export async function resolveReverseClash(combat, seat, reverseId) {
    const s = combat.state;
    const ownZone = seatZone(seat, ATTACK);
    const oppZone = seatZone(1 - seat, ATTACK);

    let fusedId = -1;
    let fusedIndex = -1;
    for (let i = s.zones[oppZone].length - 1; i >= 0; i--) {
        const id = s.zones[oppZone][i];
        if (s.fusionChild[id] !== -1 && s.fusionBase[id] > 0) {
            fusedId = id;
            fusedIndex = i;
            break;
        }
    }

    if (fusedId !== -1) {
        const zeroId = s.fusionChild[fusedId];
        s.fusionChild[fusedId] = -1;
        const restoredPower = s.fusionBase[fusedId];
        s.power[fusedId] = restoredPower;
        s.fusionBase[fusedId] = 0;
        
        console.log(`[ServerCombat] Reverso de P${seat + 1} foi counterado por uma Fusão! Roubou apenas a carta 0.`);
        combat.engine.emit(EVENT.UNFUSE, { cardId: fusedId, seat: 1 - seat, zeroId, restoredPower });
        combat.engine.emit(EVENT.REVERSE_STEAL, { reverseId, seat });
        
        combat.deck.discard(reverseId);
        
        const victims = s.zones[oppZone].splice(fusedIndex + 1);
        for (const id of victims) s.zones[ownZone].push(id);
        
        s.moveCard(zeroId, ownZone);
        
        combat.engine.markDirty();
        await combat.engine.sleep(TIMINGS.REVERSE_STEAL);
        return;
    }

    const isAlone = s.zones[ownZone].length === 1;

    if (isAlone) {
        console.log(`[ServerCombat] Reverso de P${seat + 1} roubou a pilha inimiga.`);
        combat.engine.emit(EVENT.REVERSE_STEAL, { reverseId, seat });
        combat.deck.discard(reverseId);
        s.moveAll(oppZone, ownZone);

        const comp = combat.deck.draw(oppZone);
        if (comp >= 0) {
            s.type[comp] = CARD_TYPES.NUMBER;
            s.color[comp] = combat.deck.randomBasicColor();
            s.power[comp] = CONFIG.REVERSE_COMPENSATION_POWER;
            s.revealed[comp] = 1;
        }
    } else {
        console.log(`[ServerCombat] Reverso de P${seat + 1} inverteu as pilhas.`);
        combat.engine.emit(EVENT.REVERSE_SWAP, { reverseId, seat });
        combat.deck.discard(reverseId);
        
        const mine = s.zones[ownZone].slice();
        const theirs = s.zones[oppZone].slice();
        for (const id of mine) s.moveCard(id, oppZone);
        for (const id of theirs) s.moveCard(id, ownZone);
    }
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.REVERSE);
}

/**
 * Atinge a vida e ativa o Efeito de Troca de Mão.
 */
export async function resolveReverseDirectHit(combat, attacker, target, cardId) {
    console.log('[ServerCombat] Reverso atingiu a vida: mãos trocadas!');
    combat.engine.emit(EVENT.DIRECT_HIT, { cardId, seat: attacker, damage: 0, effect: HIT_EFFECT.HAND_SWAP });
    
    combat.deck.discard(cardId);
    swapHands(combat);
    
    return 0; // Sem wait extra
}

function swapHands(combat) {
    const s = combat.state;
    const p1Hand = s.zone(SEAT.P1, HAND).slice();
    const p2Hand = s.zone(SEAT.P2, HAND).slice();
    for (const id of p1Hand) s.moveCard(id, seatZone(SEAT.P2, HAND));
    for (const id of p2Hand) s.moveCard(id, seatZone(SEAT.P1, HAND));
}
