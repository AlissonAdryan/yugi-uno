import { CONFIG } from '../../config/constants.js';
import { EVENT } from '../../network/protocol.js';
import { isConsumable, summonCount } from '../../systems/rules.js';
import { seatZone, ZONE_OFFSET } from '../../utils/zones.js';

const { ATTACK } = ZONE_OFFSET;
const { TIMINGS } = CONFIG;

/**
 * +2/+4 explodem e puxam cartas públicas do baralho para o mesmo slot.
 */
export async function resolveSummon(combat, seat, cardId) {
    const s = combat.state;
    const count = summonCount(s.type[cardId]);
    console.log(`[ServerCombat] P${seat + 1} ativou +${count}!`);
    combat.engine.emit(EVENT.SUMMON, { cardId, seat, count });

    combat.deck.discard(cardId);
    const zone = seatZone(seat, ATTACK);
    const drawn = [];
    for (let i = 0; i < count; i++) {
        const id = combat.deck.draw(zone);
        if (id < 0) break;
        s.revealed[id] = 1;
        drawn.push(id);
    }
    sinkConsumablesToBack(combat, zone, drawn);
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.SUMMON_BASE + count * TIMINGS.SUMMON_PER_CARD);
}

/**
 * Consumíveis puxados por +2/+4 não têm força pra lutar e nunca devem ser
 * as primeiras a entrar em combate: empurra-as para o fundo da pilha recém-puxada.
 */
function sinkConsumablesToBack(combat, zone, drawnIds) {
    if (drawnIds.length < 2) return;
    const s = combat.state;
    const consumables = drawnIds.filter((id) => isConsumable(s.type[id]));
    if (consumables.length === 0 || consumables.length === drawnIds.length) return;

    const others = drawnIds.filter((id) => !isConsumable(s.type[id]));
    const arr = s.zones[zone];
    arr.splice(arr.length - drawnIds.length, drawnIds.length, ...consumables, ...others);
}
