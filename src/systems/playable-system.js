import { CONFIG } from '../config/constants.js';
import {
    ALL_BASIC_COLORS_MASK, canPlayOnCombatSlot, colorBit, consumableBlockReason, countAttackOptions, isConsumable,
    isPaintable, isValidCombo, leavesNoAttack
} from './rules.js';
import { ZONE } from '../utils/zones.js';

/** Zonas cujas cartas ainda podem virar Ataque nesta rodada (as do campo voltam pra mão). */
const ATTACK_OPTION_ZONES = Object.freeze([ZONE.SELF_HAND, ZONE.SELF_ATTACK, ZONE.SELF_DEFENSE]);

/**
 * PlayableSystem - responde "esta carta da mão pode ir para este slot agora?" na visão do jogador local
 * (slots livres, bloqueio de defesa, cor da rodada, Espelho de Defesa) e marca pool.outlined para o contorno animado.
 * Só visual/otimista: o servidor continua validando tudo.
 */
export class PlayableSystem {
    /**
     * @param {import('../entities/card-pool.js').CardPool} pool
     * @param {import('./layout-system.js').LayoutSystem} layout pilhas visuais (já incluem previsões locais)
     * @param {import('./board-system.js').BoardSystem} board
     */
    constructor(pool, layout, board) {
        this.pool = pool;
        this.layout = layout;
        this.board = board;

        this.excludedTypes = new Uint8Array(256);
        for (const type of CONFIG.PLAYABLE_OUTLINE.EXCLUDED_TYPES) this.excludedTypes[type] = 1;
        // Status próprio (CONFIG.STATUS) do último snapshot: Cura/Escudo já ativos, Reviver já usado
        this.status = 0;
    }

    /** Cartas da mão que o Pintar pode recolorir, ignorando `exceptId` (a própria carta Pintar). */
    paintableInHand(exceptId = -1) {
        const hand = this.layout.stack(ZONE.SELF_HAND);
        let count = 0;
        for (let i = 0; i < hand.length; i++) {
            if (hand[i] !== exceptId && isPaintable(this.pool.color[hand[i]])) count++;
        }
        return count;
    }

    /**
     * Por que este consumível não pode ir pro slot USE agora (null = pode). Mesmas regras do servidor.
     * @returns {string|null}
     */
    useBlockReason(id) {
        const type = this.pool.type[id];
        const reason = consumableBlockReason(type, this.status);
        if (reason) return reason;
        if (type === CONFIG.CARD_TYPES.PAINT && this.paintableInHand(id) < CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED) {
            return 'PAINT_NOT_ENOUGH_CARDS';
        }
        return null;
    }

    /**
     * Cartas locais que ainda poderiam ir pro Ataque nesta rodada (mão + Ataque + Defesa, já com as
     * previsões do layout). Mesma regra do servidor (rules.countAttackOptions).
     * @param {number} activeColor
     * @param {number} [exceptId] carta ignorada (a que vai pra lixeira)
     * @param {number[]|null} [paintIds] cartas contadas como já pintadas de `paintColor`
     * @param {number} [paintColor]
     */
    attackOptions(activeColor, exceptId = -1, paintIds = null, paintColor = CONFIG.COLOR.NONE) {
        let count = 0;
        for (let i = 0; i < ATTACK_OPTION_ZONES.length; i++) {
            count += countAttackOptions(this.pool, this.layout.stack(ATTACK_OPTION_ZONES[i]), activeColor, exceptId, paintIds, paintColor);
        }
        return count;
    }

    /** Vender esta carta deixaria o jogador sem nenhuma opção de Ataque? (o servidor recusaria) */
    isLastAttackOption(id, activeColor) {
        return leavesNoAttack(this.attackOptions(activeColor), this.attackOptions(activeColor, id));
    }

    /**
     * Cores que o Pintar pode aplicar nas cartas escolhidas sem tirar a última opção de Ataque.
     * A cor da rodada sempre sobra (pintar pra ela nunca tira jogada), então a máscara nunca fica vazia.
     * @param {number[]} ids cartas escolhidas
     * @param {number} activeColor
     * @returns {number} máscara de rules.colorBit
     */
    paintColorMask(ids, activeColor) {
        const before = this.attackOptions(activeColor);
        let mask = 0;
        for (const color of CONFIG.BASIC_COLORS) {
            if (!leavesNoAttack(before, this.attackOptions(activeColor, -1, ids, color))) mask |= colorBit(color);
        }
        return mask || ALL_BASIC_COLORS_MASK;
    }

    /**
     * Marca as cartas da mão que podem ser escolhidas para o Pintar (contorno arco-íris).
     * @param {boolean} selecting o jogador está escolhendo as cartas agora
     */
    updatePaintable(selecting) {
        const pool = this.pool;
        pool.paintable.fill(0);
        if (!selecting) return;
        const hand = this.layout.stack(ZONE.SELF_HAND);
        for (let i = 0; i < hand.length; i++) {
            if (isPaintable(pool.color[hand[i]])) pool.paintable[hand[i]] = 1;
        }
    }

    /** Regras de slot (sem cor): tipo de carta compatível, slot livre e defesa não bloqueada. */
    slotAccepts(id, zone) {
        const type = this.pool.type[id];
        if (zone === ZONE.SELF_USE) {
            return isConsumable(type) && this.layout.stack(ZONE.SELF_USE).length === 0
                && this.useBlockReason(id) === null;
        }
        if (zone !== ZONE.SELF_ATTACK && zone !== ZONE.SELF_DEFENSE) return false;
        if (isConsumable(type)) return false;
        // Prisão de Cristal: Ataque e Defesa trancados nesta preparação (só consumíveis, loja e lixeira)
        if (this.board.fieldLocked) return false;

        const stack = this.layout.stack(zone);
        if (stack.length > 0) {
            if (stack.length >= CONFIG.COMBO_MAX_STACK) return false;
            if (!isValidCombo(this.pool, stack[stack.length - 1], id)) return false;
        }
        
        if (zone === ZONE.SELF_DEFENSE && this.board.locked[ZONE.SELF_DEFENSE] && stack.length === 0) return false;
        return true;
    }

    /** Regras de cor do slot (inclui o Espelho de Defesa). O slot USE não tem restrição de cor. */
    colorAllows(id, zone, activeColor) {
        if (zone === ZONE.SELF_USE) return true;
        
        const stack = this.layout.stack(zone);
        if (stack.length > 0) return true; // Se tem combo, slotAccepts já validou a cor/tipo

        let attackId = -1;
        if (zone === ZONE.SELF_DEFENSE) {
            const attack = this.layout.stack(ZONE.SELF_ATTACK);
            if (attack.length > 0) attackId = attack[attack.length - 1];
        }
        return canPlayOnCombatSlot(this.pool, id, activeColor, attackId);
    }

    canPlayOn(id, zone, activeColor) {
        return this.slotAccepts(id, zone) && this.colorAllows(id, zone, activeColor);
    }

    /**
     * Recalcula o contorno das cartas da mão. Chamar após layout.rebuild().
     * @param {boolean} canPrepare jogador local está na preparação e ainda não finalizou
     * @param {number} activeColor cor ativa do jogador local
     * @param {number} [status] bitmask CONFIG.STATUS do jogador local
     */
    update(canPrepare, activeColor, status = 0) {
        this.status = status;
        const pool = this.pool;
        pool.outlined.fill(0);
        if (!canPrepare) return;

        const hand = this.layout.stack(ZONE.SELF_HAND);
        for (let i = 0; i < hand.length; i++) {
            const id = hand[i];
            if (this.excludedTypes[pool.type[id]] === 1) continue;
            if (this.canPlayOn(id, ZONE.SELF_ATTACK, activeColor)
                || this.canPlayOn(id, ZONE.SELF_DEFENSE, activeColor)
                || this.canPlayOn(id, ZONE.SELF_USE, activeColor)) {
                pool.outlined[id] = 1;
            }
        }
    }
}
