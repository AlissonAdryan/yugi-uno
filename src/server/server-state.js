import { CONFIG } from '../config/constants.js';
import { ZONE, ZONE_COUNT, ZONE_OFFSET, seatZone, zoneOffset } from '../utils/zones.js';

/**
 * Estado autoritativo da partida (vive apenas no host).
 * Dados numéricos das cartas em SoA/TypedArrays; cada carta está sempre em exatamente uma zona.
 */
export class ServerState {
    constructor(capacity = CONFIG.DECK_SIZE) {
        this.capacity = capacity;

        this.type = new Uint8Array(capacity);
        this.color = new Uint8Array(capacity);
        this.power = new Int16Array(capacity);
        // 1 = face pública para os dois jogadores (revelada em combate)
        this.revealed = new Uint8Array(capacity);
        this.zoneOf = new Uint8Array(capacity);
        this.fusionChild = new Int16Array(capacity);
        this.fusionBase = new Uint8Array(capacity);
        this.fusionChild.fill(-1);
        this.fusionBase.fill(0);
        // Reverso Kármico: valor original de um número roubado com +20% (-1 = sem bônus). Temporário:
        // ao voltar pra mão a carta nunca fica acima dele (ver moveCard)
        this.karmaBase = new Int16Array(capacity).fill(-1);

        this.zones = [];
        for (let z = 0; z < ZONE_COUNT; z++) this.zones.push([]);

        this.hp = new Int16Array(2);
        this.activeColor = new Uint8Array(2);
        this.ready = new Uint8Array(2);
        this.discardsNeeded = new Uint8Array(2);
        this.drawsOwed = new Uint8Array(2);
        this.defenseLock = new Uint8Array(2);
        this.useLock = new Uint8Array(2);
        // Combos Supremos (GAME_RULES §6.18):
        //  fieldLock   Prisão de Cristal: Ataque e Defesa trancados na próxima preparação
        //  drawDenied  Prisão na vida: sem compras no fim desta rodada
        //  panic       Kármico na vida: preparação da próxima rodada com tempo curto
        //  lastDamageTaken  dano numérico levado no último combate (o Kármico devolve 1,2x)
        this.fieldLock = new Uint8Array(2);
        this.drawDenied = new Uint8Array(2);
        this.panic = new Uint8Array(2);
        this.lastDamageTaken = new Int16Array(2);
        // 1 = o assento pediu revanche (só faz sentido na fase GAME_OVER)
        this.rematch = new Uint8Array(2);

        // Consumíveis de vida (GAME_RULES §6.5–6.7)
        this.healActive = new Uint8Array(2);    // Cura usada nesta rodada (resolve no fim do combate)
        this.shieldActive = new Uint8Array(2);  // Escudo: metade do dano até a próxima rodada começar
        this.reviveRounds = new Uint8Array(2);  // rodadas de guarda restantes do Reviver (0 = inativo)
        this.reviveUsed = new Uint8Array(2);    // 1 = já usou o Reviver nesta partida (limite: 1x)
        this.reviveGuard = new Uint8Array(2);   // 1 = o Reviver já salvou nesta rodada: vida não passa de 1 pra baixo
        this.paintPending = new Uint8Array(2);  // 1 = o jogador usou Pintar e precisa selecionar cartas/cor
        this.guardSwap = new Uint8Array(2);     // 1 = Troca de Guarda armada (dispara no início do combate)
        // Emboscada: armada / carta a reforçar já na frente (Troca de Guarda levou a Defesa pro Ataque) /
        // carta reforçada neste combate e seu valor original (o bônus é temporário: some quando ela volta pra mão)
        this.ambush = new Uint8Array(2);
        this.ambushTarget = new Int16Array(2).fill(-1);
        this.ambushBoosted = new Int16Array(2).fill(-1);
        this.ambushBase = new Int16Array(2);
        // Maldição: plantada pelo assento (atinge o outro na próxima rodada) e usos na partida
        this.cursePending = new Uint8Array(2);
        this.curseUses = new Uint8Array(2);
        // Ronova (GAME_RULES §6.19): plantada pelo assento (marca o OUTRO na próxima preparação), turnos de marca
        // restantes NO ALVO (contando o atual; 0 = sem marca) e se o assento já gastou a sua (1x por partida)
        this.ronovaPending = new Uint8Array(2);
        this.ronovaTurns = new Uint8Array(2);
        this.ronovaUsed = new Uint8Array(2);

        // Economia (moedas privadas, loja por assento). Itens da loja em SoA: índice = assento * SLOTS + espaço
        this.cardFlags = new Uint8Array(capacity); // CONFIG.CARD_FLAGS por carta (ex.: RESALE)
        this.coins = new Uint16Array(2);
        this.rerollCost = new Uint8Array(2);
        const shopSize = 2 * CONFIG.SHOP.SLOTS;
        this.shopType = new Uint8Array(shopSize);
        this.shopColor = new Uint8Array(shopSize);
        this.shopPower = new Int8Array(shopSize);
        this.shopPrice = new Uint8Array(shopSize);
        this.shopFullPrice = new Uint8Array(shopSize);
        this.shopFlags = new Uint8Array(shopSize);
        this.shopRoundsLeft = CONFIG.SHOP.REFRESH_EVERY_ROUNDS;
        // Evento da Arena: combates resolvidos na partida, evento ativo (CONFIG.SURGE_KIND) e combates restantes
        this.surgeCombats = 0;
        this.surgeKind = 0;
        this.surgeTurns = 0;

        this.phase = CONFIG.GAME_STATES.INIT;
        this.round = 0;
        this.winner = -1;
        // Assento que escolhe a próxima cor (-1 = sorteio) e as cores que ele pode escolher (máscara)
        this.colorChooser = -1;
        this.colorChoices = 0;

        this.reset();
    }

    reset() {
        for (let z = 0; z < ZONE_COUNT; z++) this.zones[z].length = 0;
        const deck = this.zones[ZONE.DECK];
        for (let id = 0; id < this.capacity; id++) {
            deck.push(id);
            this.zoneOf[id] = ZONE.DECK;
            this.revealed[id] = 0;
            this.fusionChild[id] = -1;
            this.fusionBase[id] = 0;
            this.karmaBase[id] = -1;
        }
        this.hp.fill(CONFIG.STARTING_HP);
        this.activeColor.fill(CONFIG.COLOR.NONE);
        this.ready.fill(0);
        this.discardsNeeded.fill(0);
        this.drawsOwed.fill(0);
        this.defenseLock.fill(0);
        this.useLock.fill(0);
        this.fieldLock.fill(0);
        this.drawDenied.fill(0);
        this.panic.fill(0);
        this.lastDamageTaken.fill(0);
        this.rematch.fill(0);
        this.healActive.fill(0);
        this.shieldActive.fill(0);
        this.reviveRounds.fill(0);
        this.reviveUsed.fill(0);
        this.reviveGuard.fill(0);
        this.paintPending.fill(0);
        this.guardSwap.fill(0);
        this.clearAmbush();
        this.cursePending.fill(0);
        this.curseUses.fill(0);
        this.ronovaPending.fill(0);
        this.ronovaTurns.fill(0);
        this.ronovaUsed.fill(0);
        this.cardFlags.fill(0);
        this.coins.fill(CONFIG.SHOP.STARTING_COINS);
        this.rerollCost.fill(CONFIG.SHOP.REROLL_BASE_COST);
        this.shopType.fill(CONFIG.CARD_TYPES.HIDDEN);
        this.shopColor.fill(0);
        this.shopPower.fill(0);
        this.shopPrice.fill(0);
        this.shopFullPrice.fill(0);
        this.shopFlags.fill(0);
        this.shopRoundsLeft = CONFIG.SHOP.REFRESH_EVERY_ROUNDS;
        // Evento da Arena: combates resolvidos na partida, evento ativo (CONFIG.SURGE_KIND) e combates restantes
        this.surgeCombats = 0;
        this.surgeKind = 0;
        this.surgeTurns = 0;
        this.phase = CONFIG.GAME_STATES.INIT;
        this.round = 0;
        this.winner = -1;
        this.colorChooser = -1;
        this.colorChoices = 0;
    }

    isValidCard(id) {
        return Number.isInteger(id) && id >= 0 && id < this.capacity;
    }

    /** @returns {number[]} array vivo da zona do assento */
    zone(seat, offset) {
        return this.zones[seatZone(seat, offset)];
    }

    /** Bitmask CONFIG.STATUS do assento (enviado só para o próprio jogador). */
    statusOf(seat) {
        const { STATUS } = CONFIG;
        let bits = 0;
        if (this.healActive[seat]) bits |= STATUS.HEAL;
        if (this.shieldActive[seat]) bits |= STATUS.SHIELD;
        if (this.reviveRounds[seat] > 0) bits |= STATUS.REVIVE_ACTIVE;
        if (this.reviveUsed[seat]) bits |= STATUS.REVIVE_USED;
        if (this.paintPending[seat]) bits |= STATUS.PAINT_PENDING;
        if (this.guardSwap[seat]) bits |= STATUS.GUARD_SWAP;
        if (this.ambush[seat]) bits |= STATUS.AMBUSH;
        if (this.cursePending[seat]) bits |= STATUS.CURSE_PENDING;
        if (this.curseUses[seat] >= CONFIG.CURSE.MAX_PER_MATCH) bits |= STATUS.CURSE_SPENT;
        if (this.useLock[seat] > 0) bits |= STATUS.USE_LOCKED;
        if (this.ronovaUsed[seat]) bits |= STATUS.DEATH_USED;
        return bits;
    }

    /** Emboscadas armadas/pendentes voltam ao zero (fim do combate ou nova rodada). */
    clearAmbush() {
        this.ambush.fill(0);
        this.ambushTarget.fill(-1);
        this.ambushBoosted.fill(-1);
        this.ambushBase.fill(0);
    }

    handSize(seat) {
        return this.zones[seatZone(seat, ZONE_OFFSET.HAND)].length;
    }

    /** @returns {number} carta do topo da zona ou -1 */
    top(seat, offset) {
        const arr = this.zones[seatZone(seat, offset)];
        return arr.length > 0 ? arr[arr.length - 1] : -1;
    }

    /**
     * Move a carta para o topo (fim) da zona de destino.
     * Entrar em mão/baralho/descarte torna a carta secreta novamente.
     */
    moveCard(id, toZone) {
        const from = this.zones[this.zoneOf[id]];
        const idx = from.lastIndexOf(id);
        if (idx > -1) from.splice(idx, 1);

        this.zones[toZone].push(id);
        this.zoneOf[id] = toZone;

        if (toZone === ZONE.DECK || toZone === ZONE.DISCARD || zoneOffset(toZone) === ZONE_OFFSET.HAND) {
            this.revealed[id] = 0;
            this.fusionChild[id] = -1;
            this.fusionBase[id] = 0;
            // O +20% do Reverso Kármico era só do combate: de volta à mão, a carta volta ao valor original
            if (this.karmaBase[id] >= 0) {
                if (zoneOffset(toZone) === ZONE_OFFSET.HAND && this.power[id] > this.karmaBase[id]) this.power[id] = this.karmaBase[id];
                this.karmaBase[id] = -1;
            }
        }
    }

    /** Move todas as cartas preservando a ordem da pilha. */
    moveAll(fromZone, toZone) {
        const src = this.zones[fromZone];
        while (src.length > 0) this.moveCard(src[0], toZone);
    }

    /** Máscara de bits das cores presentes na mão (ver rules.colorBit). */
    handColorMask(seat, colorBit) {
        const hand = this.zone(seat, ZONE_OFFSET.HAND);
        let mask = 0;
        for (let i = 0; i < hand.length; i++) mask |= colorBit(this.color[hand[i]]);
        return mask;
    }
}
