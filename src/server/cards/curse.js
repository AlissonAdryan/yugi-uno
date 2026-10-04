import { CONFIG } from '../../config/constants.js';
import { EVENT, MSG, localizeEvent } from '../../network/protocol.js';
import { cursedFace, isCurseTarget } from '../../systems/rules.js';
import { SEAT, ZONE_OFFSET } from '../../utils/zones.js';

const { HAND } = ZONE_OFFSET;
const SEATS = [SEAT.P1, SEAT.P2];
const scratchFace = { type: 0, color: 0, power: 0 };

/**
 * Maldição (GAME_RULES §6.15): plantada na preparação, dispara no início da rodada seguinte, logo após o
 * sorteio da cor. Atinge até TARGETS cartas aleatórias da mão do oponente entre as que de fato sofrem:
 * números perdem POWER_LOSS (mínimo MIN_POWER); especiais são corrompidas em Número 1 na cor da rodada.
 * Consumíveis são imunes. O alvo vê as próprias cartas mudando; quem amaldiçoou vê só os versos brilhando.
 * Chamada pelo ServerEngine.commitColor antes da fase de preparação abrir.
 * @param {import('../server-engine.js').ServerEngine} engine
 */
export function triggerCurses(engine) {
    const s = engine.state;
    for (const seat of SEATS) {
        if (!s.cursePending[seat]) continue;
        s.cursePending[seat] = 0;
        const victim = 1 - seat;
        const roundColor = s.activeColor[victim];
        const targets = pickTargets(s, victim);

        const full = [];
        const hidden = [];
        for (const id of targets) {
            cursedFace(s.type[id], s.color[id], s.power[id], roundColor, scratchFace);
            full.push({
                id, fromType: s.type[id], fromColor: s.color[id], fromPower: s.power[id],
                type: scratchFace.type, color: scratchFace.color, power: scratchFace.power
            });
            hidden.push({ id });
        }
        console.log(targets.length > 0
            ? `[Server] MALDIÇÃO de P${seat + 1} disparou em P${victim + 1}: ${full.map((c) => `${c.id}(${c.fromType}/${c.fromPower} -> ${c.power})`).join(', ')}.`
            : `[Server] Maldição de P${seat + 1} desperdiçada: P${victim + 1} não tinha cartas que pudessem sofrer.`);

        engine.emitTo(victim, EVENT.CURSE_TRIGGERED, { seat, cards: full });
        engine.emitTo(seat, EVENT.CURSE_TRIGGERED, { seat, cards: hidden });
        if (engine.network.spectators && engine.network.spectators.size > 0) {
            engine.network.sendToSpectators(localizeEvent({ k: MSG.EVENT, t: EVENT.CURSE_TRIGGERED, seat, cards: full }, -1));
        }
        for (const c of full) {
            s.type[c.id] = c.type;
            s.color[c.id] = c.color;
            s.power[c.id] = c.power;
        }
        engine.markDirty();
    }
}

/** Até TARGETS cartas distintas da mão de `seat` que a Maldição realmente afeta. */
function pickTargets(s, seat) {
    const pool = s.zone(seat, HAND).filter((id) => isCurseTarget(s.type[id], s.power[id]));
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
    }
    return pool.slice(0, CONFIG.CURSE.TARGETS);
}
