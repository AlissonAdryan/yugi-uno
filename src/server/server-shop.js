import { CONFIG } from '../config/constants.js';
import { surgePrice, weightedPick } from '../systems/rules.js';

const { CARD_TYPES, CARD_CATALOG, CARD_TAGS, SHOP, SHOP_ITEM_FLAGS, BASIC_COLORS, COLOR } = CONFIG;
const SLOTS = SHOP.SLOTS;
const COLORLESS = new Set(CONFIG.COLORLESS_SPECIALS);

/**
 * ServerShop - a loja de cada assento (roda só no host, autoritativa).
 *
 * Cada jogador tem os seus SLOTS itens, sorteados a partir de CONFIG.CARD_CATALOG (só tipos com a tag
 * SHOP): números só 8/9 com preço um pouco abaixo do valor, especiais com preço de catálogo, e de vez
 * em quando uma oferta. O estado fica no ServerState (SoA), então o snapshot e a validação da compra
 * leem exatamente o que o jogador está vendo.
 */
export class ServerShop {
    /**
     * @param {import('./server-state.js').ServerState} state
     * @param {() => number} [random]
     */
    constructor(state, random = Math.random) {
        this.state = state;
        this.random = random;
        // [nomeDoTipo, peso] de tudo que pode aparecer na loja
        this.pool = [];
        for (const name in CARD_CATALOG) {
            const entry = CARD_CATALOG[name];
            if ((entry.tags & CARD_TAGS.SHOP) && entry.shopWeight > 0 && CARD_TYPES[name] !== undefined) {
                this.pool.push([name, entry.shopWeight]);
            }
        }
    }

    index(seat, slot) {
        return seat * SLOTS + slot;
    }

    /** Sorteia a face e o preço de um item novo no espaço (sem repetir os outros espaços, se der). */
    rollSlot(seat, slot) {
        const s = this.state;
        const i = this.index(seat, slot);
        for (let attempt = 0; attempt < SHOP.UNIQUE_TRIES; attempt++) {
            this.rollFace(i);
            if (!this.duplicates(seat, slot)) break;
        }

        let price = s.shopPrice[i];
        let flags = 0;
        if (this.random() < SHOP.DISCOUNT_CHANCE) {
            const discounted = Math.max(SHOP.MIN_PRICE, price - weightedPick(SHOP.DISCOUNT_AMOUNTS, this.random));
            if (discounted < price) {
                price = discounted;
                flags |= SHOP_ITEM_FLAGS.DISCOUNT;
            }
        }
        s.shopPrice[i] = price;
        s.shopFlags[i] = flags;
    }

    rollFace(i) {
        const s = this.state;
        const name = weightedPick(this.pool, this.random);
        const type = CARD_TYPES[name];
        s.shopType[i] = type;
        if (type === CARD_TYPES.NUMBER) {
            const power = weightedPick(SHOP.NUMBER_POWERS, this.random);
            s.shopPower[i] = power;
            s.shopColor[i] = BASIC_COLORS[Math.floor(this.random() * BASIC_COLORS.length)];
            if (power === 0 || power === 1) {
                s.shopFullPrice[i] = SHOP.NUMBER_LOW_PRICE;
            } else {
                s.shopFullPrice[i] = Math.max(SHOP.MIN_PRICE, power - weightedPick(SHOP.NUMBER_MARKDOWN, this.random));
            }
        } else {
            s.shopPower[i] = 0;
            s.shopColor[i] = COLORLESS.has(name) ? COLOR.BLACK : BASIC_COLORS[Math.floor(this.random() * BASIC_COLORS.length)];
            s.shopFullPrice[i] = CARD_CATALOG[name].price;
        }
        s.shopPrice[i] = s.shopFullPrice[i];
    }

    /** Quantos itens deste assento estão congelados agora. */
    frozenCount(seat) {
        const s = this.state;
        let count = 0;
        for (let slot = 0; slot < SLOTS; slot++) {
            if (s.shopFlags[this.index(seat, slot)] & SHOP_ITEM_FLAGS.FROZEN) count++;
        }
        return count;
    }

    duplicates(seat, slot) {
        const s = this.state;
        const i = this.index(seat, slot);
        for (let other = 0; other < SLOTS; other++) {
            if (other === slot) continue;
            const j = this.index(seat, other);
            if (s.shopType[j] === s.shopType[i] && s.shopPower[j] === s.shopPower[i] && s.shopColor[j] === s.shopColor[i]) return true;
        }
        return false;
    }

    /**
     * Renovação automática (a cada REFRESH_EVERY_ROUNDS combates): itens congelados ficam — e
     * descongelam, pois o gelo só vale para uma renovação —, mas saem FREEZE_SURCHARGE moedas mais
     * caros (senão congelar seria uma reserva de graça). O resto é sorteado de novo.
     */
    refresh(seat) {
        const s = this.state;
        for (let slot = 0; slot < SLOTS; slot++) {
            const i = this.index(seat, slot);
            if (s.shopFlags[i] & SHOP_ITEM_FLAGS.FROZEN) {
                s.shopFlags[i] &= ~SHOP_ITEM_FLAGS.FROZEN;
                s.shopPrice[i] += SHOP.FREEZE_SURCHARGE;
                s.shopFullPrice[i] += SHOP.FREEZE_SURCHARGE;
                continue;
            }
            this.rollSlot(seat, slot);
        }
        s.rerollCost[seat] = SHOP.REROLL_BASE_COST;
    }

    /** Renovação paga pelo jogador: sorteia de novo tudo que não estiver congelado. */
    reroll(seat) {
        const s = this.state;
        for (let slot = 0; slot < SLOTS; slot++) {
            if (s.shopFlags[this.index(seat, slot)] & SHOP_ITEM_FLAGS.FROZEN) continue;
            this.rollSlot(seat, slot);
        }
        s.rerollCost[seat] *= SHOP.REROLL_COST_STEP;
    }

    /** Loja nova do zero (início de partida/revanche). */
    reset(seat) {
        const s = this.state;
        for (let slot = 0; slot < SLOTS; slot++) {
            s.shopFlags[this.index(seat, slot)] = 0;
            this.rollSlot(seat, slot);
        }
        s.rerollCost[seat] = SHOP.REROLL_BASE_COST;
    }

    /** @returns {{ type, color, power, price, fullPrice, flags }} leitura do item (para validação/log), já com o
     *  preço que vale agora (Super Desconto do Evento da Arena incluído) */
    item(seat, slot) {
        const s = this.state;
        const i = this.index(seat, slot);
        return {
            type: s.shopType[i], color: s.shopColor[i], power: s.shopPower[i],
            price: surgePrice(s.shopPrice[i], s.surgeKind), fullPrice: s.shopFullPrice[i], flags: s.shopFlags[i]
        };
    }
}
