import { CONFIG } from '../../config/constants.js';
import { EVENT } from '../../network/protocol.js';
import { ZONE_OFFSET } from '../../utils/zones.js';

const { ATTACK } = ZONE_OFFSET;
const { TIMINGS } = CONFIG;

/**
 * Prisão de Cristal (GAME_RULES §6.18.1): 3 Blocks idênticos no topo da pilha viram um monólito de cristal.
 * No choque ele esmaga a pilha da frente inimiga inteira (seja o que for, exceto o Fantasma, que atravessa)
 * e tranca Ataque e Defesa do oponente na próxima preparação — ele só pode usar consumíveis, loja e
 * lixeira e finaliza o turno de campo vazio. Um Espelho na frente reflete a parede: o Espelho e o monólito
 * se dissipam e nada é trancado.
 * @param {import('../server-combat.js').ServerCombat} combat
 * @param {number} seat dono dos Blocks
 * @param {number[]} blockIds os 3 Blocks (do fundo pro topo)
 * @param {boolean} reflected o topo inimigo é um Espelho (paradoxo)
 */
export async function resolvePrisonClash(combat, seat, blockIds, reflected) {
    const s = combat.state;
    const enemy = 1 - seat;
    const front = s.zone(enemy, ATTACK);
    const victims = reflected ? [front[front.length - 1]] : front.slice();
    const color = s.color[blockIds[blockIds.length - 1]];

    console.log(reflected
        ? `[ServerCombat] Prisão de Cristal de P${seat + 1} refletida por um Espelho: os dois se dissipam, nada é trancado.`
        : `[ServerCombat] PRISÃO DE CRISTAL de P${seat + 1}: esmagou ${victims.length} carta(s) e trancou o campo de P${enemy + 1} na próxima rodada.`);
    combat.engine.emit(EVENT.PRISON, { seat, blockIds, victimIds: victims, color, locked: reflected ? 0 : 1 });

    for (const id of blockIds) combat.deck.discard(id);
    for (const id of victims) combat.deck.discard(id);
    if (!reflected) s.fieldLock[enemy] = 2;

    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.PRISON);
}

/**
 * Prisão de Cristal na vida: não tira vida (é um bloqueio), mas o monólito tranca o campo do alvo na próxima
 * preparação e causa o "Trauma": uma carta do baralho vira pó e as compras do fim desta rodada do alvo somem.
 * @param {import('../server-combat.js').ServerCombat} combat
 */
export async function resolvePrisonDirectHit(combat, attacker, target, blockIds) {
    const s = combat.state;
    const color = s.color[blockIds[blockIds.length - 1]];
    // "Trauma de Deck": uma carta do topo do baralho é triturada sem nunca ser revelada (a face só é
    // sorteada na compra, então ela vira pó ainda em branco e vai pro descarte)
    const dustId = combat.deck.peekBlank();
    console.log(`[ServerCombat] PRISÃO DE CRISTAL de P${attacker + 1} atingiu a vida de P${target + 1}: campo trancado,`
        + ` sem compras no fim da rodada e 1 carta do baralho triturada (${dustId}).`);
    combat.engine.emit(EVENT.PRISON_HIT, { seat: attacker, blockIds, color, dustId });

    for (const id of blockIds) combat.deck.discard(id);
    if (dustId >= 0) combat.deck.discard(dustId);
    s.fieldLock[target] = 2;
    s.drawDenied[target] = 1;

    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.PRISON_HIT);
}
