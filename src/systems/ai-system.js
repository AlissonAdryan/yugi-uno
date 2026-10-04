import { CONFIG } from '../config/constants.js';
import {
    canPlayColor, canPlayOnCombatSlot, consumableBlockReason, countAttackOptions, isConsumable, isPaintable, leavesNoAttack,
    pickColorFromMask, purchaseBlockReason, sellValue
} from './rules.js';
import { ZONE } from '../utils/zones.js';
import {
    EVENT, INPUT, MSG, SNAPSHOT_FLAGS, SNAPSHOT_FLAGS2, SnapshotView, decodeSnapshot, isBinaryMessage, isSeqAfter
} from '../network/protocol.js';

const { GAME_STATES, CARD_TYPES, AI, COLOR } = CONFIG;

/**
 * AISystem - "jogador invisível". Funciona como um cliente remoto de verdade:
 * faz handshake, recebe apenas o SEU snapshot (cartas do oponente mascaradas) e responde com inputs.
 * Também serve de piloto automático para o jogador local em testes (?autoplay).
 */
export class AISystem {
    /**
     * @param {(message: object) => void} send envia um input ao servidor
     * @param {string} [label] nome usado nos logs
     */
    constructor(send, label = 'CPU') {
        this.send = send;
        this.label = label;
        this.view = new SnapshotView();
        this.hasView = false;
        this.thinking = false;
        this.awaitingUpdate = false;
        this.rejections = 0;
        this.inputSeq = 0;
        // consumableMask: bit (1 << tipo) de cada consumível já avaliado nesta rodada
        this.plan = { round: -1, wantsDefense: false, consumableMask: 0, shopActions: 0, buyChecked: false, ultimate: false };

        this.hand = [];
        this.playable = [];
        this.defensePlayable = [];
        this.board = []; // próprias cartas no Ataque/Defesa (índices no snapshot)
    }

    /** Mesma regra do servidor (rules.countAttackOptions): mão + Ataque + Defesa. */
    attackOptions(exceptIdx = -1) {
        const v = this.view;
        return countAttackOptions(v, this.hand, v.selfColor, exceptIdx) + countAttackOptions(v, this.board, v.selfColor, exceptIdx);
    }

    hello(token = 'local-cpu') {
        this.send({ k: MSG.HELLO, token });
        this.send({ k: MSG.INPUT, t: INPUT.SET_NAME, name: this.label });
    }

    handleMessage(msg) {
        if (isBinaryMessage(msg)) {
            if (!decodeSnapshot(msg, this.view)) return;
            if (!this.hasView) this.inputSeq = this.view.ackSeq;
            this.hasView = true;
            // Só volta a decidir quando o snapshot já reflete o último input enviado
            if (!isSeqAfter(this.inputSeq, this.view.ackSeq)) this.awaitingUpdate = false;
            this.scheduleThink();
            return;
        }
        if (msg && msg.k === MSG.EVENT && msg.t === EVENT.REJECTED) {
            console.warn(`[AISystem:${this.label}] Jogada recusada: ${msg.reason}`);
            this.rejections++;
            if (msg.seq === this.inputSeq) this.awaitingUpdate = false;
            this.scheduleThink();
        }
    }

    needsToAct() {
        const v = this.view;
        if (v.phase === GAME_STATES.PLAYING) return !v.hasFlag(SNAPSHOT_FLAGS.SELF_READY);
        if (v.phase === GAME_STATES.DISCARDING || v.phase === GAME_STATES.FORCED_DISCARDING) return v.selfDiscards > 0;
        if (v.phase === GAME_STATES.GAME_OVER) return !v.hasFlag(SNAPSHOT_FLAGS.SELF_REMATCH);
        if (v.phase === GAME_STATES.CHOOSING_COLOR) return v.hasFlag(SNAPSHOT_FLAGS.SELF_CHOOSING_COLOR);
        return false;
    }

    scheduleThink() {
        if (this.thinking || this.awaitingUpdate || !this.hasView || !this.needsToAct()) return;
        this.thinking = true;
        const delay = this.plan.round === this.view.round ? AI.ACTION_GAP_MS : AI.THINK_MS;
        setTimeout(() => {
            this.thinking = false;
            this.act();
        }, delay);
    }

    act() {
        if (!this.needsToAct()) return;
        const input = this.decide();
        if (!input) return;

        this.inputSeq = (this.inputSeq + 1) & 0xffff;
        input.k = MSG.INPUT;
        input.seq = this.inputSeq;
        this.awaitingUpdate = true;
        console.log(`[AISystem:${this.label}] Enviando input`, input);
        this.send(input);
    }

    collectHand() {
        const v = this.view;
        this.hand.length = 0;
        this.playable.length = 0;
        this.defensePlayable.length = 0;

        let attackIdx = -1;
        this.board.length = 0;
        for (let i = 0; i < v.cardCount; i++) {
            if (v.zone[i] === ZONE.SELF_ATTACK) attackIdx = i;
            if (v.zone[i] === ZONE.SELF_ATTACK || v.zone[i] === ZONE.SELF_DEFENSE) this.board.push(i);
        }

        for (let i = 0; i < v.cardCount; i++) {
            if (v.zone[i] !== ZONE.SELF_HAND) continue;
            this.hand.push(i);
            if (isConsumable(v.type[i])) continue;
            if (canPlayColor(v.color[i], v.selfColor)) this.playable.push(i);
            if (canPlayOnCombatSlot(v, i, v.selfColor, attackIdx)) this.defensePlayable.push(i);
        }
    }

    decide() {
        const v = this.view;
        if (v.phase === GAME_STATES.GAME_OVER) {
            // A nova partida recomeça na rodada 1: o plano antigo não pode ser reaproveitado
            this.plan.round = -1;
            console.log(`[AISystem:${this.label}] Pedindo revanche.`);
            return { t: INPUT.REMATCH };
        }
        if (v.phase === GAME_STATES.CHOOSING_COLOR) {
            // A CPU escolhe ao acaso entre as cores disponíveis (mesmo input de um jogador humano)
            const color = pickColorFromMask(v.colorChoices);
            console.log(`[AISystem:${this.label}] Escolhendo a cor ${CONFIG.COLOR_PALETTES[color].name}.`);
            return { t: INPUT.CHOOSE_COLOR, color };
        }
        this.collectHand();

        if (v.phase === GAME_STATES.DISCARDING || v.phase === GAME_STATES.FORCED_DISCARDING) {
            return this.decideDiscard();
        }
        
        if (v.selfStatus & CONFIG.STATUS.PAINT_PENDING) {
            return this.decidePaint();
        }

        if (this.plan.round !== v.round) {
            this.plan.round = v.round;
            this.plan.wantsDefense = Math.random() < AI.DEFENSE_CHANCE;
            this.plan.consumableMask = 0;
            this.plan.shopActions = 0;
            this.plan.buyChecked = false;
            this.plan.ultimate = false;
            this.rejections = 0;
        }

        const fieldLocked = (v.flags2 & SNAPSHOT_FLAGS2.SELF_FIELD_LOCKED) !== 0;
        if (this.rejections >= AI.MAX_REJECTIONS) {
            this.rejections = 0;
            return fieldLocked || v.countInZone(ZONE.SELF_ATTACK) > 0 ? { t: INPUT.READY } : this.randomAttack();
        }

        const consumable = this.decideConsumable();
        if (consumable) return consumable;

        const economy = this.decideEconomy();
        if (economy) return economy;

        // Troca de Guarda armada: a carta fraca vai no Ataque (vira Defesa) e a forte na Defesa (vira Ataque)
        if (v.selfStatus & CONFIG.STATUS.GUARD_SWAP) {
            const swapPlay = this.decideSwapPlay();
            if (swapPlay) return swapPlay;
        }

        // Prisão de Cristal: Ataque/Defesa trancados, só dá pra usar itens e finalizar de campo vazio
        if (fieldLocked) {
            console.log(`[AISystem:${this.label}] Campo trancado pela Prisão de Cristal: finalizando sem Ataque.`);
            return { t: INPUT.READY };
        }

        if (v.countInZone(ZONE.SELF_ATTACK) === 0) {
            const ultimate = this.ultimateGroup();
            if (ultimate && Math.random() < AI.ULTIMATE_CHANCE) {
                this.plan.ultimate = true;
                console.log(`[AISystem:${this.label}] Montando um Combo Supremo (3x ${v.type[ultimate] === CARD_TYPES.BLOCK ? 'Block' : 'Reverso'}).`);
                return { t: INPUT.PLAY_CARD, cardId: v.ids[ultimate], zone: ZONE.SELF_ATTACK };
            }
            return this.randomAttack();
        }
        if (this.plan.ultimate) {
            const next = this.ultimateNext();
            if (next >= 0) return { t: INPUT.PLAY_CARD, cardId: v.ids[next], zone: ZONE.SELF_ATTACK };
        }

        const canDefend = v.countInZone(ZONE.SELF_DEFENSE) === 0 && !v.hasFlag(SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED);
        if (this.plan.wantsDefense && canDefend && this.defensePlayable.length > 0) {
            this.plan.wantsDefense = false;
            const pick = this.pickDefenseCard();
            return { t: INPUT.PLAY_CARD, cardId: v.ids[pick], zone: ZONE.SELF_DEFENSE };
        }

        return { t: INPUT.READY };
    }

    /** Avalia cada tipo de consumível da mão uma vez por rodada; usa no máximo um por decisão. */
    decideConsumable() {
        const v = this.view;
        for (const i of this.hand) {
            const type = v.type[i];
            if (!isConsumable(type)) continue;
            const bit = 1 << type;
            if (this.plan.consumableMask & bit) continue;
            this.plan.consumableMask |= bit;
            if (consumableBlockReason(type, v.selfStatus) || !this.wantsConsumable(type)) continue;
            console.log(`[AISystem:${this.label}] Usando consumível do tipo ${type} (vida ${v.selfHP}).`);
            return { t: INPUT.PLAY_CONSUMABLE, cardId: v.ids[i] };
        }
        return null;
    }

    /**
     * Economia da CPU (antes de montar o ataque): vende o número mais fraco se a mão estiver cheia
     * e, uma vez por rodada, compra o melhor item que couber no bolso.
     */
    decideEconomy() {
        const v = this.view;
        if (this.plan.shopActions >= AI.MAX_SHOP_ACTIONS_PER_ROUND) return null;

        if (this.hand.length >= AI.SELL_WHEN_HAND_AT_LEAST) {
            let weakest = -1;
            for (const i of this.hand) {
                if (v.type[i] !== CARD_TYPES.NUMBER || v.power[i] > AI.SELL_MAX_POWER) continue;
                if (sellValue(v.type[i], v.power[i], v.cardFlags[i]) < 0) continue;
                // Nunca vende a última carta que ainda pode ir pro ataque nesta rodada
                if (leavesNoAttack(this.attackOptions(), this.attackOptions(i))) continue;
                if (weakest < 0 || v.power[i] < v.power[weakest]) weakest = i;
            }
            if (weakest >= 0) {
                this.plan.shopActions++;
                console.log(`[AISystem:${this.label}] Vendendo um ${v.power[weakest]} na lixeira.`);
                return { t: INPUT.SELL_CARD, cardId: v.ids[weakest] };
            }
        }

        if (!this.plan.buyChecked) {
            this.plan.buyChecked = true;
            if (Math.random() >= AI.BUY_CHANCE) return null;
            const slot = this.bestShopSlot();
            if (slot >= 0) {
                this.plan.shopActions++;
                console.log(`[AISystem:${this.label}] Comprando o item ${slot + 1} da loja (moedas ${v.coins}).`);
                return { t: INPUT.SHOP_BUY, slot };
            }
        }
        return null;
    }

    /** Item mais valioso que dá pra comprar agora (-1 se nenhum). */
    bestShopSlot() {
        const v = this.view;
        const hand = v.handSize();
        let best = -1;
        let bestScore = 0;
        for (let slot = 0; slot < CONFIG.SHOP.SLOTS; slot++) {
            const item = v.shopItem(slot);
            if (purchaseBlockReason(item, v.coins, hand)) continue;
            if (item.type === CARD_TYPES.REVIVE && (v.selfStatus & CONFIG.STATUS.REVIVE_USED)) continue;
            if (item.type === CARD_TYPES.DEATH && (v.selfStatus & CONFIG.STATUS.DEATH_USED)) continue;
            const score = item.type === CARD_TYPES.NUMBER ? item.power : 10 + (item.flags & CONFIG.SHOP_ITEM_FLAGS.DISCOUNT ? 2 : 0);
            if (score > bestScore) {
                bestScore = score;
                best = slot;
            }
        }
        return best;
    }

    wantsConsumable(type) {
        const v = this.view;
        switch (type) {
            case CARD_TYPES.CHANGE_COLOR:
                return v.selfColor !== COLOR.RAINBOW && Math.random() < AI.CONSUMABLE_CHANCE;
            case CARD_TYPES.HEAL:
                return CONFIG.MAX_HP - v.selfHP >= AI.HEAL_MIN_MISSING_HP && Math.random() < AI.CONSUMABLE_CHANCE;
            case CARD_TYPES.SHIELD:
                return v.selfHP <= AI.SHIELD_BELOW_HP || Math.random() < AI.SHIELD_RANDOM_CHANCE;
            case CARD_TYPES.REVIVE:
                return v.selfHP <= AI.REVIVE_BELOW_HP;
            case CARD_TYPES.AMBUSH: {
                // A armadilha só serve com um número na Defesa: se usar, garante que vai montar a Defesa
                const hasNumber = this.defensePlayable.some((i) => v.type[i] === CARD_TYPES.NUMBER);
                const use = hasNumber && !v.hasFlag(SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED) && Math.random() < AI.AMBUSH_CHANCE;
                if (use) this.plan.wantsDefense = true;
                return use;
            }
            case CARD_TYPES.CURSE:
                return Math.random() < AI.CURSE_CHANCE;
            case CARD_TYPES.DEATH:
                // Lendária e de efeito longo: quanto antes, mais turnos drenando o oponente
                return true;
            case CARD_TYPES.GUARD_SWAP:
                // Só vale com Defesa disponível: a CPU monta a jogada invertida (ver decide/pickSwapPlay)
                return !v.hasFlag(SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED) && this.defensePlayable.length >= 2
                    && Math.random() < AI.GUARD_SWAP_CHANCE;
            case CARD_TYPES.PAINT: {
                let paintables = 0;
                for (const i of this.hand) {
                    if (isPaintable(v.color[i])) paintables++;
                }
                return paintables >= CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED && Math.random() < AI.CONSUMABLE_CHANCE;
            }
            default:
                return false;
        }
    }

    /**
     * Jogada da CPU com a própria Troca de Guarda armada: isca fraca no Ataque, carta forte escondida na
     * Defesa (no combate elas trocam). Retorna null quando não há o que ajustar.
     */
    decideSwapPlay() {
        const v = this.view;
        const byPower = (a, b) => v.power[a] - v.power[b];
        if (v.countInZone(ZONE.SELF_ATTACK) === 0) {
            if (this.playable.length < 2) return null;
            const weakest = this.playable.slice().sort(byPower)[0];
            console.log(`[AISystem:${this.label}] Troca de Guarda armada: isca ${v.power[weakest]} no Ataque.`);
            return { t: INPUT.PLAY_CARD, cardId: v.ids[weakest], zone: ZONE.SELF_ATTACK };
        }
        const canDefend = v.countInZone(ZONE.SELF_DEFENSE) === 0 && !v.hasFlag(SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED);
        if (!canDefend || this.defensePlayable.length === 0) return null;
        const strongest = this.defensePlayable.slice().sort(byPower)[this.defensePlayable.length - 1];
        this.plan.wantsDefense = false;
        console.log(`[AISystem:${this.label}] Troca de Guarda armada: ${v.power[strongest]} escondido na Defesa.`);
        return { t: INPUT.PLAY_CARD, cardId: v.ids[strongest], zone: ZONE.SELF_DEFENSE };
    }

    /**
     * Um Block/Reverso jogável que tenha mais 2 idênticos (tipo + cor) na mão: base de um Combo Supremo.
     * @returns {number|null} índice no snapshot (null se não houver)
     */
    ultimateGroup() {
        const v = this.view;
        const need = CONFIG.ULTIMATE.TRIPLE;
        for (const i of this.playable) {
            const type = v.type[i];
            if (type !== CARD_TYPES.BLOCK && type !== CARD_TYPES.REVERSE) continue;
            let count = 0;
            for (const j of this.hand) if (v.type[j] === type && v.color[j] === v.color[i]) count++;
            if (count >= need) return i;
        }
        return null;
    }

    /** Próxima carta idêntica pra empilhar no Ataque até fechar o trio (-1 = trio completo ou impossível). */
    ultimateNext() {
        const v = this.view;
        let top = -1;
        let order = -1;
        let count = 0;
        for (let i = 0; i < v.cardCount; i++) {
            if (v.zone[i] !== ZONE.SELF_ATTACK) continue;
            count++;
            if (v.order[i] > order) { order = v.order[i]; top = i; }
        }
        if (top < 0 || count >= CONFIG.ULTIMATE.TRIPLE) return -1;
        for (const j of this.hand) {
            if (v.type[j] === v.type[top] && v.color[j] === v.color[top] && v.power[j] === v.power[top]) return j;
        }
        this.plan.ultimate = false;
        return -1;
    }

    /** Carta da Defesa: com Emboscada armada, o número mais forte (é quem ganha o +3); senão, ao acaso. */
    pickDefenseCard() {
        const v = this.view;
        if (v.selfStatus & CONFIG.STATUS.AMBUSH) {
            let best = -1;
            for (const i of this.defensePlayable) {
                if (v.type[i] !== CARD_TYPES.NUMBER) continue;
                if (best < 0 || v.power[i] > v.power[best]) best = i;
            }
            if (best >= 0) return best;
        }
        return this.defensePlayable[Math.floor(Math.random() * this.defensePlayable.length)];
    }

    randomAttack() {
        const v = this.view;
        if (this.playable.length === 0) {
            // Só o Trocar Cor destrava cartas de outra cor pro ataque
            const changeColor = this.hand.find((i) => v.type[i] === CARD_TYPES.CHANGE_COLOR);
            if (changeColor !== undefined && v.selfColor !== COLOR.RAINBOW) {
                return { t: INPUT.PLAY_CONSUMABLE, cardId: v.ids[changeColor] };
            }
            console.warn(`[AISystem:${this.label}] Sem cartas jogáveis para o ataque.`);
            return null;
        }
        const pick = this.playable[Math.floor(Math.random() * this.playable.length)];
        return { t: INPUT.PLAY_CARD, cardId: v.ids[pick], zone: ZONE.SELF_ATTACK };
    }

    /**
     * Pintar: pinta pra cor da rodada, priorizando as cartas mais fortes que ainda não são dessa cor
     * (vira ataque/defesa jogável). Nunca tira a cor da rodada de uma carta: a mão jogável só cresce.
     */
    decidePaint() {
        const v = this.view;
        const needed = CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED;
        const colors = CONFIG.BASIC_COLORS;
        const roundColor = colors.includes(v.selfColor) ? v.selfColor : colors[Math.floor(Math.random() * colors.length)];

        const others = [];
        const same = [];
        for (const i of this.hand) {
            if (!isPaintable(v.color[i])) continue;
            (v.color[i] === roundColor ? same : others).push(i);
        }
        if (others.length + same.length < needed) {
            // O servidor só aceita o Pintar com 2 cartas coloridas na mão: não deveria acontecer
            console.warn(`[AISystem:${this.label}] Pintar pendente sem cartas suficientes para pintar.`);
            return null;
        }
        const byPower = (a, b) => v.power[b] - v.power[a];
        others.sort(byPower);
        const picks = others.concat(same).slice(0, needed);
        const cards = picks.map((i) => v.ids[i]);
        console.log(`[AISystem:${this.label}] Pintando ${cards.length} cartas de ${CONFIG.COLOR_PALETTES[roundColor].name}.`);
        return { t: INPUT.PAINT_SELECT, cards, color: roundColor };
    }

    /** Descarta (ou doa) a carta numérica mais fraca; especiais são guardadas. */
    decideDiscard() {
        const v = this.view;
        if (this.hand.length === 0) return null;
        let best = this.hand[0];
        let bestScore = Infinity;
        for (const i of this.hand) {
            const score = v.type[i] === CARD_TYPES.NUMBER ? v.power[i] : 100;
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return { t: INPUT.DISCARD, cardId: v.ids[best] };
    }
}
