import { CONFIG } from '../../config/constants.js';
import { EVENT } from '../../network/protocol.js';

const { TIMINGS } = CONFIG;

/**
 * O Reviver se revela para os dois: luz divina na vida do alvo e a carta se despedaça no centro.
 */
export async function reviveSave(combat, target) {
    console.log(`[ServerCombat] Reviver de P${target + 1} ativado: vida travada em ${CONFIG.CONSUMABLES.REVIVE_SURVIVE_HP} pelo resto da rodada.`);
    combat.engine.emit(EVENT.REVIVE_TRIGGERED, { seat: target });
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.REVIVE_SAVE);
}
