import { CONFIG } from '../config/constants.js';
import { ZONE } from '../utils/zones.js';

const { CARD_TYPES, COLOR, CARD_SPAWN_WEIGHTS, BASIC_COLORS, NUMBER_RANGE } = CONFIG;
const COLORLESS = new Set(CONFIG.COLORLESS_SPECIALS);

/**
 * DeckSystem - baralho autoritativo (roda só no host).
 * A face de cada carta é sorteada no momento da compra; o descarte é reciclado quando o baralho acaba.
 */
export class DeckSystem {
    /**
     * @param {import('../server/server-state.js').ServerState} state
     * @param {() => number} [random]
     */
    constructor(state, random = Math.random) {
        this.state = state;
        this.random = random;

        // Só tipos com a tag DECK nascem do baralho (cartas "só de loja" ficam de fora)
        this.specialWeights = [];
        let total = 0;
        for (const key in CARD_SPAWN_WEIGHTS.SPECIALS) {
            const entry = CONFIG.CARD_CATALOG[key];
            if (entry && (entry.tags & CONFIG.CARD_TAGS.DECK) === 0) continue;
            this.specialWeights.push([key, CARD_SPAWN_WEIGHTS.SPECIALS[key]]);
            total += CARD_SPAWN_WEIGHTS.SPECIALS[key];
        }
        this.totalSpecialWeight = total;
        this.totalBaseWeight = CARD_SPAWN_WEIGHTS.NUMBER + CARD_SPAWN_WEIGHTS.SPECIAL_BASE;
    }

    /** Fisher-Yates in-place */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            const temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }

    reset() {
        this.state.reset();
        this.shuffle(this.state.zones[ZONE.DECK]);
    }

    /**
     * Compra uma carta para a zona informada, sorteando sua face.
     * @param {number} toZone zona absoluta
     * @returns {number} id da carta ou -1 se não houver cartas em jogo
     */
    draw(toZone) {
        const zones = this.state.zones;
        if (zones[ZONE.DECK].length === 0) {
            if (zones[ZONE.DISCARD].length === 0) return -1;
            this.state.moveAll(ZONE.DISCARD, ZONE.DECK);
            this.shuffle(zones[ZONE.DECK]);
        }

        const deck = zones[ZONE.DECK];
        const id = deck[deck.length - 1];
        this.rollFace(id);
        this.state.moveCard(id, toZone);
        return id;
    }

    discard(id) {
        this.state.moveCard(id, ZONE.DISCARD);
    }

    randomBasicColor() {
        return BASIC_COLORS[Math.floor(this.random() * BASIC_COLORS.length)];
    }

    /**
     * Pega uma carta "em branco" do topo do baralho sem sortear a face (quem chama define a face —
     * ex.: a compra na loja). Recicla o descarte se o baralho acabou.
     * @returns {number} id ou -1 se não houver cartas fora de jogo
     */
    peekBlank() {
        const zones = this.state.zones;
        if (zones[ZONE.DECK].length === 0) {
            if (zones[ZONE.DISCARD].length === 0) return -1;
            this.state.moveAll(ZONE.DISCARD, ZONE.DECK);
            this.shuffle(zones[ZONE.DECK]);
        }
        const deck = zones[ZONE.DECK];
        return deck[deck.length - 1];
    }

    rollFace(id) {
        const s = this.state;
        s.cardFlags[id] = 0;
        if (this.random() * this.totalBaseWeight >= CARD_SPAWN_WEIGHTS.SPECIAL_BASE) {
            s.type[id] = CARD_TYPES.NUMBER;
            s.color[id] = this.randomBasicColor();
            s.power[id] = NUMBER_RANGE.MIN + Math.floor(this.random() * (NUMBER_RANGE.MAX - NUMBER_RANGE.MIN + 1));
            return;
        }

        const roll = this.random() * this.totalSpecialWeight;
        let acc = 0;
        let chosen = this.specialWeights.length > 0 ? this.specialWeights[0][0] : 'PLUS2';
        for (let i = 0; i < this.specialWeights.length; i++) {
            acc += this.specialWeights[i][1];
            if (roll < acc) {
                chosen = this.specialWeights[i][0];
                break;
            }
        }

        s.type[id] = CARD_TYPES[chosen];
        s.power[id] = 0;
        s.color[id] = COLORLESS.has(chosen) ? COLOR.BLACK : this.randomBasicColor();
    }
}
