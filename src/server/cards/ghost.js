import { CONFIG } from '../../config/constants.js';
import { EVENT, MSG, localizeEvent } from '../../network/protocol.js';
import { SEAT, ZONE_OFFSET } from '../../utils/zones.js';
import { reviveSave } from './revive.js';

const { ATTACK } = ZONE_OFFSET;
const { CARD_TYPES, TIMINGS } = CONFIG;
const SEATS = [SEAT.P1, SEAT.P2];

/**
 * Fantasma (GAME_RULES §6.12): intangível. Ao chocar, atravessa a carta da frente inimiga sem tocá-la
 * (ela fica intacta) e fere a vida com dano fixo; depois se dissipa (descarte). Um Espelho na frente se
 * desfaz junto (não tem o que copiar). Dois Fantasmas se cruzam e os dois ferem. Sem nada na frente
 * (campo inimigo vazio), é o mesmo golpe direto na vida.
 *
 * @param {import('../server-combat.js').ServerCombat} combat
 * @param {{ seat: number, ghostId: number }[]} ghosts 1 ou 2 Fantasmas atravessando ao mesmo tempo
 * @returns {Promise<number>} assento vencedor da partida se alguém morreu, senão -1
 */
export async function resolveGhostPass(combat, ghosts) {
    const s = combat.state;
    const passes = [];
    for (const { seat, ghostId } of ghosts) {
        const enemy = 1 - seat;
        const throughId = s.top(enemy, ATTACK);
        // Só um Fantasma sozinho dissolve o Espelho: contra outro Fantasma não há Espelho na frente
        const dissolveId = ghosts.length === 1 && throughId >= 0 && s.type[throughId] === CARD_TYPES.MIRROR ? throughId : -1;
        // Calcula agora, aplica depois do evento: o snapshot nunca mostra a vida caindo antes da animação
        const hit = combat.previewLifeHit(enemy, CONFIG.GHOST.DAMAGE);
        passes.push({ seat, enemy, ghostId, throughId: dissolveId >= 0 ? -1 : throughId, dissolveId, hit });
        console.log(`[ServerCombat] Fantasma de P${seat + 1} atravessou ${throughId >= 0 ? `a carta ${throughId}` : 'o campo vazio'}`
            + ` e causou -${hit.damage} HP em P${enemy + 1}`
            + (hit.absorbed > 0 ? ` (Escudo segurou ${hit.absorbed})` : '')
            + (dissolveId >= 0 ? '; o Espelho se desfez sem ter o que copiar.' : '.'));
    }

    // Cada um recebe os passes na própria perspectiva; o Escudo absorvendo só aparece pra quem ele protegeu
    for (const viewer of SEATS) {
        const list = passes.map((p) => {
            const data = {
                ghostId: p.ghostId, seat: p.seat === viewer ? 0 : 1, throughId: p.throughId, dissolveId: p.dissolveId,
                damage: p.hit.damage, guarded: p.hit.guarded ? 1 : 0
            };
            if (p.enemy === viewer && p.hit.absorbed > 0) data.absorbed = p.hit.absorbed;
            return data;
        });
        combat.engine.emitTo(viewer, EVENT.GHOST_PASS, { passes: list });
    }
    if (combat.engine.network.spectators && combat.engine.network.spectators.size > 0) {
        const specList = passes.map((p) => {
            const data = {
                ghostId: p.ghostId, seat: p.seat, throughId: p.throughId, dissolveId: p.dissolveId,
                damage: p.hit.damage, guarded: p.hit.guarded ? 1 : 0
            };
            if (p.hit.absorbed > 0) data.absorbed = p.hit.absorbed;
            return data;
        });
        combat.engine.network.sendToSpectators(localizeEvent({ k: MSG.EVENT, t: EVENT.GHOST_PASS, passes: specList }, -1));
    }

    for (const p of passes) {
        combat.applyLifeHit(p.seat, p.enemy, p.hit);
        combat.deck.discard(p.ghostId);
        if (p.dissolveId >= 0) combat.deck.discard(p.dissolveId);
    }
    combat.engine.markDirty();
    await combat.engine.sleep(TIMINGS.GHOST_PASS);

    for (const p of passes) {
        if (p.hit.revived) await reviveSave(combat, p.enemy);
    }
    return lethalWinner(combat, passes);
}

/** Quem venceu a partida depois dos golpes (nocaute duplo de dois Fantasmas: desempate por sorteio). */
function lethalWinner(combat, passes) {
    const hp = combat.state.hp;
    const dead = passes.filter((p) => hp[p.enemy] <= 0);
    if (dead.length === 0) return -1;
    if (dead.length === 1) return dead[0].seat;
    // Nocaute duplo (raríssimo): a vida só é zerada no mínimo, então desempata pelo sorteio
    const winner = Math.random() < 0.5 ? SEAT.P1 : SEAT.P2;
    console.warn(`[ServerCombat] Nocaute duplo de Fantasmas: P${winner + 1} vence no desempate.`);
    return winner;
}
