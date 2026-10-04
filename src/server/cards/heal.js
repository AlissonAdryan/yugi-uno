import { EVENT } from '../../network/protocol.js';
import { healAmount } from '../../systems/rules.js';
import { SEAT } from '../../utils/zones.js';

const SEATS = [SEAT.P1, SEAT.P2];

/**
 * Fim do combate: quem usou Cura recupera metade do dano que causou (pra baixo, até a vida máxima).
 * Sem dano causado (ou vida cheia) a carta foi desperdiçada — só quem usou fica sabendo.
 */
export async function applyHeals(combat) {
    const s = combat.state;
    for (const seat of SEATS) {
        if (!s.healActive[seat]) continue;
        s.healActive[seat] = 0;
        
        const amount = healAmount(combat.damageDealt[seat], s.hp[seat]);

        if (amount <= 0) {
            console.log(`[ServerCombat] Cura de P${seat + 1} desperdiçada (dano causado: ${combat.damageDealt[seat]}, vida: ${s.hp[seat]}).`);
            combat.engine.markDirty();
            combat.engine.emitTo(seat, EVENT.HEAL, { seat, amount: 0 });
            continue;
        }

        s.hp[seat] += amount;
        console.log(`[ServerCombat] Cura de P${seat + 1} aplicou +${amount} HP.`);
        combat.engine.markDirty();
        
        // Emite para ambos verem o ganho visual
        combat.engine.emit(EVENT.HEAL, { seat, amount });
    }
}
