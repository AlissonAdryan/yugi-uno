import { CONFIG } from '../../config/constants.js';
import { EVENT, HIT_EFFECT } from '../../network/protocol.js';
import { ZONE_OFFSET } from '../../utils/zones.js';

const { ATTACK, DEFENSE, HAND } = ZONE_OFFSET;
const { TIMINGS } = CONFIG;

/**
 * Relâmpago em Cadeia (GAME_RULES §6.10): fulmina a carta da frente do inimigo e salta pra próxima
 * (a seguinte da pilha ou, sem ela, o topo da Defesa). Cada salto que sobra sem carta no campo
 * inimigo atravessa até a vida e queima 1 carta da mão (Sobrecarga parcial).
 */
export async function resolveLightningClash(combat, seat, lightningId) {
    const s = combat.state;
    const enemy = 1 - seat;
    const front = s.zone(enemy, ATTACK);
    const targets = [];
    
    // Do topo pra base na pilha da frente; depois o topo da Defesa
    for (let i = front.length - 1; i >= 0 && targets.length < CONFIG.LIGHTNING.CHAIN_TARGETS; i--) targets.push(front[i]);
    const defense = s.zone(enemy, DEFENSE);
    if (targets.length < CONFIG.LIGHTNING.CHAIN_TARGETS && defense.length > 0) targets.push(defense[defense.length - 1]);
    // Campo inimigo acabou antes dos saltos: o que sobra vai na vida e queima cartas da mão
    const burned = pickHandBurn(combat, enemy, CONFIG.LIGHTNING.CHAIN_TARGETS - targets.length);

    console.log(`[ServerCombat] Relâmpago de P${seat + 1} fulminou ${targets.length} carta(s) de P${enemy + 1}: ${targets.join(', ')}`
        + (burned.length > 0 ? ` e saltou para a vida, queimando ${burned.length} carta(s) da mão.` : '.'));
    combat.engine.emit(EVENT.LIGHTNING_STRIKE, { lightningId, seat, targets: targets.map((id) => combat.faceOf(id)), burned });
    
    combat.deck.discard(lightningId);
    for (const id of targets) combat.deck.discard(id);
    for (const id of burned) combat.deck.discard(id);
    
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.LIGHTNING);
}

/**
 * Atinge a vida e ativa o Efeito de Sobrecarga (GAME_RULES).
 */
export async function resolveLightningDirectHit(combat, attacker, target, cardId) {
    const burned = pickHandBurn(combat, target, CONFIG.LIGHTNING.HAND_BURN);
    console.log(`[ServerCombat] Relâmpago atingiu P${target + 1}: Sobrecarga queimou ${burned.length} carta(s) da mão.`);
    combat.engine.emit(EVENT.DIRECT_HIT, { cardId, seat: attacker, damage: 0, effect: HIT_EFFECT.OVERLOAD, burned });
    
    combat.deck.discard(cardId);
    for (const id of burned) combat.deck.discard(id);
    
    return TIMINGS.OVERLOAD_EXTRA;
}

/** Sorteia até `count` cartas diferentes da mão de `seat` (sem alterar a mão ainda). */
function pickHandBurn(combat, seat, count) {
    const hand = combat.state.zone(seat, HAND);
    if (hand.length === 0 || count <= 0) return [];
    const copy = hand.slice();
    // random sort
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
}
