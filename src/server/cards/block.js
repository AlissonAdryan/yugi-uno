import { CONFIG } from '../../config/constants.js';
import { EVENT, HIT_EFFECT } from '../../network/protocol.js';
import { ZONE, ZONE_OFFSET } from '../../utils/zones.js';

const { ATTACK } = ZONE_OFFSET;
const { TIMINGS } = CONFIG;

/**
 * Block se sacrifica e anula a pilha inteira do oponente naquele slot.
 */
export async function resolveBlockClash(combat, seat, blockId) {
    const s = combat.state;
    const oppZone = s.zone(1 - seat, ATTACK);
    
    let fusedId = -1;
    let fusedIndex = -1;
    for (let i = oppZone.length - 1; i >= 0; i--) {
        const id = oppZone[i];
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
        
        const victims = oppZone.slice(fusedIndex + 1);
        
        console.log(`[ServerCombat] Block de P${seat + 1} foi barrado por uma Fusão (carta ${fusedId}). O Bloqueio morre, destrói ${victims.length} cartas de cima e a carta 0 fundida.`);
        combat.engine.emit(EVENT.UNFUSE, { cardId: fusedId, seat: 1 - seat, zeroId, restoredPower });
        combat.engine.emit(EVENT.BLOCK_SMASH, { blockId, victimIds: [...victims, zeroId] });
        
        combat.deck.discard(blockId);
        for (const id of victims) combat.deck.discard(id);
        s.moveCard(zeroId, ZONE.DISCARD);
        
        combat.engine.markDirty();
        await combat.engine.sleep(TIMINGS.BLOCK_SMASH);
        return;
    }

    const victims = oppZone.slice();
    console.log(`[ServerCombat] Block de P${seat + 1} anulou ${victims.length} carta(s).`);
    combat.engine.emit(EVENT.BLOCK_SMASH, { blockId, victimIds: victims });
    
    combat.deck.discard(blockId);
    for (const id of victims) combat.deck.discard(id);
    
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.BLOCK_SMASH);
}

/**
 * Atinge a vida e ativa o Efeito Lockout.
 */
export async function resolveBlockDirectHit(combat, attacker, target, cardId) {
    console.log(`[ServerCombat] Block atingiu P${target + 1}: defesa bloqueada na próxima rodada.`);
    combat.engine.emit(EVENT.DIRECT_HIT, { cardId, seat: attacker, damage: 0, effect: HIT_EFFECT.LOCKOUT });
    
    combat.state.defenseLock[target] = 1;
    combat.deck.discard(cardId);
    
    return 0; // Sem wait extra
}
