import { CONFIG } from '../config/constants.js';
import { EVENT, SURGE_PHASE } from '../network/protocol.js';
import { weightedPick } from '../systems/rules.js';

const { SURGE, SURGE_KIND, TIMINGS } = CONFIG;
const KIND_NAMES = Object.freeze(Object.fromEntries(Object.entries(SURGE_KIND).map(([k, v]) => [v, k])));

/**
 * Evento da Arena (GAME_RULES §9). Chamado pelo ServerEngine logo depois de cada combate resolvido, antes das
 * compras da rodada seguinte: primeiro o evento ativo gasta um combate (e acaba ao zerar); depois, a cada
 * SURGE.EVERY_COMBATS combates, um evento novo é sorteado e vale pelos SURGE.DURATION combates seguintes.
 * Os efeitos em si moram em rules.js (surgeDraws, surgePrice, surgeDamage) e leem só state.surgeKind.
 * @param {import('./server-engine.js').ServerEngine} engine
 */
export async function tickSurge(engine) {
    const s = engine.state;
    s.surgeCombats++;

    if (s.surgeTurns > 0) {
        s.surgeTurns--;
        if (s.surgeTurns === 0) {
            const kind = s.surgeKind;
            console.log(`[Server] Evento da Arena ${KIND_NAMES[kind]} terminou.`);
            engine.emit(EVENT.SURGE, { phase: SURGE_PHASE.END, kind, turns: 0 });
            s.surgeKind = SURGE_KIND.NONE;
            engine.markDirty();
            await engine.sleep(TIMINGS.SURGE_END);
            if (engine.isGameOver()) return;
        } else {
            console.log(`[Server] Evento da Arena ${KIND_NAMES[s.surgeKind]}: ${s.surgeTurns} combate(s) restante(s).`);
            engine.markDirty();
        }
    }

    if (s.surgeCombats % SURGE.EVERY_COMBATS !== 0) return;
    const kind = weightedPick(SURGE.WEIGHTS);
    console.log(`[Server] Evento da Arena sorteado após ${s.surgeCombats} combates: ${KIND_NAMES[kind]} por ${SURGE.DURATION} turnos.`);
    // A roleta do cliente gira e crava `kind`; o estado muda logo depois do evento (regra de ordenação do emit)
    engine.emit(EVENT.SURGE, { phase: SURGE_PHASE.START, kind, turns: SURGE.DURATION });
    s.surgeKind = kind;
    s.surgeTurns = SURGE.DURATION;
    engine.markDirty();
    await engine.sleep(TIMINGS.SURGE_START);
}
