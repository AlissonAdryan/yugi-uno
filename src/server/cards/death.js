import { CONFIG } from '../../config/constants.js';
import { EVENT, MSG, DEATH_KIND, localizeEvent } from '../../network/protocol.js';
import { SEAT, ZONE, ZONE_OFFSET, seatZone } from '../../utils/zones.js';
import { leavesNoAttack } from '../../systems/rules.js';

const { CARD_TYPES, DEATH } = CONFIG;
const { HAND, ATTACK, DEFENSE } = ZONE_OFFSET;
const SEATS = [SEAT.P1, SEAT.P2];

/**
 * Ronova, a Sombra da Morte (GAME_RULES §6.19). Plantada na preparação; a partir da preparação seguinte o
 * oponente fica marcado por DEATH.TURNS turnos. Em cada um (logo depois das compras e da cor, antes da
 * preparação abrir) o olho cobre a tela e os números da mão dele perdem POWER_LOSS. Toda carta dele que
 * entrar em combate queima nas chamas carmesim (burnRonovaFighters). Acabados os turnos, o olho volta uma
 * última vez e queima END_BURN carta(s) aleatória(s) da mão. Chamada pelo ServerEngine.commitColor.
 * @param {import('../server-engine.js').ServerEngine} engine
 * @returns {number} máscara (1 << assento) de quem viu o olho agora (o cronômetro de pânico ganha folga)
 */
export function triggerRonova(engine) {
    const s = engine.state;
    let fired = 0;
    for (const victim of SEATS) {
        const caster = 1 - victim;
        let kind;
        if (s.ronovaPending[caster]) {
            s.ronovaPending[caster] = 0;
            s.ronovaTurns[victim] = DEATH.TURNS;
            kind = DEATH_KIND.START;
        } else if (s.ronovaTurns[victim] > 1) {
            s.ronovaTurns[victim]--;
            kind = DEATH_KIND.TICK;
        } else if (s.ronovaTurns[victim] === 1) {
            s.ronovaTurns[victim] = 0;
            kind = DEATH_KIND.END;
        } else {
            continue;
        }
        markTurn(engine, victim, kind);
        fired |= 1 << victim;
    }
    return fired;
}

/** Tempo (ms) que as cinemáticas da Ronova tomam da preparação de quem é marcado. */
export const DEATH_PREP_DELAY_MS = (() => {
    const a = CONFIG.ANIM;
    return a.DEATH_EYE_IN + a.DEATH_EYE_HOLD + a.DEATH_EYE_CLOSE + a.DEATH_EYE_OUT + a.DEATH_DRAIN;
})();

/** Um turno da marca: o olho, a força drenada (START/TICK) ou a carta queimada (END). */
function markTurn(engine, victim, kind) {
    const s = engine.state;
    const hand = s.zone(victim, HAND);
    // Turnos que sobram DEPOIS deste (o contador do HP mostra quantas preparações ainda vêm)
    const turnsLeft = kind === DEATH_KIND.END ? 0 : s.ronovaTurns[victim] - 1;

    const full = [];
    const hidden = [];
    let burned = null;
    let spared = 0;
    if (kind === DEATH_KIND.END) {
        // A cor da rodada já foi sorteada entre as cores das duas mãos: queimar a última carta que pode
        // abrir o Ataque deixaria o marcado sem como Finalizar o Turno (softlock). Mesma proteção da lixeira.
        const before = engine.attackOptions(victim);
        const candidates = [];
        for (const id of hand) {
            if (leavesNoAttack(before, engine.attackOptions(victim, id))) spared = id + 1;
            else candidates.push(id);
        }
        if (candidates.length > 0) {
            const id = candidates[Math.floor(Math.random() * candidates.length)];
            burned = { id, type: s.type[id], color: s.color[id], power: s.power[id] };
        }
    } else {
        for (const id of hand) {
            if (s.type[id] !== CARD_TYPES.NUMBER || s.power[id] <= DEATH.MIN_POWER) continue;
            const to = Math.max(DEATH.MIN_POWER, s.power[id] - DEATH.POWER_LOSS);
            full.push({ id, from: s.power[id], to });
            hidden.push({ id });
        }
    }

    const label = kind === DEATH_KIND.START ? 'marcou' : kind === DEATH_KIND.TICK ? 'segue marcando' : 'se despede de';
    console.log(`[Server] DEATH ${label} P${victim + 1}: `
        + (kind === DEATH_KIND.END
            ? (burned ? `queimou a carta ${burned.id} da mão.` : 'nada a queimar (mão vazia ou só a última opção de Ataque).')
              + (spared ? ` Poupou a carta ${spared - 1}: era a única opção de Ataque.` : '')
            : `${full.length} número(s) perderam ${DEATH.POWER_LOSS} de força. Turnos restantes: ${turnsLeft}.`));

    const base = { seat: victim, kind, turns: turnsLeft };
    engine.emitTo(victim, EVENT.DEATH_MARK, Object.assign({ cards: full, burned }, base));
    engine.emitTo(1 - victim, EVENT.DEATH_MARK, Object.assign({ cards: hidden, burned: burned ? { id: burned.id } : null }, base));
    if (engine.network.spectators && engine.network.spectators.size > 0) {
        const evt = Object.assign({ k: MSG.EVENT, t: EVENT.DEATH_MARK, cards: full, burned }, base);
        engine.network.sendToSpectators(localizeEvent(evt, -1));
    }

    for (const c of full) s.power[c.id] = c.to;
    if (burned) engine.deck.discard(burned.id);
    engine.markDirty();
}

/**
 * Fim do combate: cartas do marcado que entraram em combate (reveladas) são consumidas pelas chamas em vez
 * de voltar pra mão. Uma Defesa que nunca foi revelada não lutou: volta normalmente (returnLeftovers).
 * @param {import('../server-combat.js').ServerCombat} combat
 */
export async function burnRonovaFighters(combat) {
    const s = combat.state;
    for (const seat of SEATS) {
        if (s.ronovaTurns[seat] === 0) continue;
        const ids = [];
        for (const offset of [ATTACK, DEFENSE]) {
            for (const id of s.zones[seatZone(seat, offset)]) if (s.revealed[id] === 1) ids.push(id);
        }
        if (ids.length === 0) continue;
        console.log(`[ServerCombat] Chamas da Morte consomem ${ids.length} carta(s) de P${seat + 1} que lutaram: ${ids.join(', ')}.`);
        combat.engine.emit(EVENT.DEATH_BURN, { seat, ids });
        for (const id of ids) s.moveCard(id, ZONE.DISCARD);
        combat.engine.markDirty();
        await combat.engine.sleep(CONFIG.TIMINGS.DEATH_BURN);
    }
}

/** A carta do marcado acertou a vida: queima em vez de voltar pra mão (numericHit). */
export function ronovaBurnsHitter(state, attacker) {
    return state.ronovaTurns[attacker] > 0;
}
