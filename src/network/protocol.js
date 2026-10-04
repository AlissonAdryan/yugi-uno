import { CONFIG } from '../config/constants.js';
import { ZONE, ZONE_COUNT, ZONE_OFFSET, mirrorZone, zoneSeat, seatZone } from '../utils/zones.js';
import { surgePrice } from '../systems/rules.js';

/**
 * Contrato de rede entre Host (servidor autoritativo) e clientes.
 *
 * Servidor -> cliente:
 *   - Snapshot binário (Uint8Array/ArrayBuffer, 1º byte = MSG.SNAPSHOT): estado completo JÁ FILTRADO
 *     para quem vai receber (cartas ocultas vão mascaradas). Enviado só quando o estado muda,
 *     então cada snapshot também é uma resincronização completa.
 *   - Evento JSON { k: MSG.EVENT, t: EVENT.*, ...campos }: cinemáticas e avisos, na ordem exata em que
 *     devem ser tocados. O campo `seat` já chega relativo (0 = você, 1 = oponente).
 *   - { k: MSG.WELCOME, seat } / { k: MSG.ROOM_FULL } no handshake.
 *
 * Cliente -> servidor:
 *   - { k: MSG.HELLO, token }: handshake/reconexão (o token prende o assento ao mesmo jogador).
 *   - { k: MSG.INPUT, t: INPUT.*, seq, cardId?, zone? }: intenção de jogada (zona relativa ao jogador).
 *     `seq` (u16 crescente) volta no snapshot como ack, permitindo reconciliar a previsão local.
 *
 * Todo tráfego usa o canal confiável e ordenado do Trystero (um único RTCDataChannel por par),
 * o que garante que eventos e snapshots cheguem na mesma ordem em que o host os gerou.
 */

// v5: Troca de Guarda e Relâmpago. v6: Fantasma, Espelho Sombrio, Emboscada e Maldição (status em 16 bits)
// v7: Bloqueio do campo de consumível (USE_LOCKOUT / SNAPSHOT_FLAGS2)
// v8: Combos Supremos (Prisão de Cristal, Reverso Kármico) — eventos novos e campo trancado no snapshot
// v10: Ronova (marca das Chamas da Morte: eventos DEATH_MARK/DEATH_BURN e bytes 31/37 do snapshot)
export const PROTOCOL_VERSION = 12;

export const MSG = Object.freeze({
    SNAPSHOT: 1,
    EVENT: 2,
    INPUT: 3,
    HELLO: 4,
    WELCOME: 5,
    ROOM_FULL: 6,
    WELCOME_SPECTATOR: 7
});

export const INPUT = Object.freeze({
    PLAY_CARD: 1,
    RECALL_CARD: 2,
    PLAY_CONSUMABLE: 3,
    READY: 4,
    DISCARD: 5,
    SET_NAME: 6,         // { name }  (aceito em qualquer fase, sem seq)
    REMATCH: 7,          // {}  (só na fase GAME_OVER; com os dois pedidos, uma nova partida começa)
    CHOOSE_COLOR: 8,     // { color }  (só na fase CHOOSING_COLOR, só de quem escolhe, só cor em comum)
    CANCEL_READY: 9,     // {}
    SELL_CARD: 10,       // { cardId }  carta da mão na lixeira -> moedas (só na preparação, antes de finalizar)
    SHOP_BUY: 11,        // { slot }    compra o item do espaço da SUA loja (fase de preparação)
    SHOP_REROLL: 12,     // {}          renova a loja pagando rerollCost
    SHOP_FREEZE: 13,     // { slot }    congela/descongela o item (sobrevive à próxima renovação)
    PAINT_SELECT: 14,    // { cards: [id, id], color }  seleciona 2 cartas e uma cor para o Pintar
    SYNC_HINT: 15        // { slot, a, b, c }  (só do assento P1)
});

export const EVENT = Object.freeze({
    COLOR_CHOSEN: 1,     // { color }
    RAINBOW: 2,          // {}  (só para quem usou o Trocar Cor)
    CONSUMABLE_USED: 3,  // { cardId, seat }
    REVEAL: 4,           // { cards: CardFace[] }
    SUMMON: 5,           // { cardId, seat, count }
    CLASH: 6,            // { winnerId, loserId, winnerPower }
    TIE: 7,              // { cardIds: number[] }
    BLOCK_SMASH: 8,      // { blockId, victimIds: number[] }
    REVERSE_STEAL: 9,    // { reverseId, seat }
    REVERSE_SWAP: 10,    // { reverseId, seat }
    // { cardId, seat, damage, effect, guarded } — `damage` já com o Escudo aplicado; `absorbed` (quanto o
    // Escudo segurou) só vai para o alvo, pra o uso do Escudo continuar secreto pro atacante.
    // `guarded` = 1 quando o Reviver (já revelado nesta rodada) segurou a vida em 1 de novo.
    DIRECT_HIT: 11,
    DESTROY: 12,         // { cardIds: number[] }
    GAME_OVER: 13,       // { result, reason }  (enviado separadamente para cada jogador)
    REJECTED: 14,        // { input, seq, cardId, reason }  (só para quem enviou o input)
    PLAYER_NAMES: 15,    // { selfName, oppName }  (enviado a cada jogador na sua perspectiva)
    // { seat, amount } — Cura resolvida no fim do combate (os dois veem). amount 0 = desperdiçada
    // (sem dano causado ou vida cheia): esse aviso vai só para quem usou.
    HEAL: 16,
    REVIVE_TRIGGERED: 17, // { seat }  (os dois veem: luz divina na vida do alvo + carta despedaçada)
    // { cardId, seat, coins? } — carta foi pra lixeira. `coins` só vai pra quem vendeu (moedas são secretas);
    // o oponente vê o verso da carta indo pra lixeira dele.
    CARD_SOLD: 18,
    SHOP_PURCHASED: 19,  // { cardId, slot, type, color, power }  (só pra quem comprou: a carta nasce do item)
    COINS_EARNED: 20,    // { amount, won }  moedas do fim da rodada (cada um recebe só as suas)
    SHOP_REFRESHED: 21,  // {}  a loja se renovou sozinha (cada jogador, a sua)
    SHOP_REROLLED: 22,   // { cost }  renovação paga (só pra quem pagou)
    PAINT_APPLIED: 23,   // { cards: [{ cardId, color }] }  (só pra quem pintou: as cartas mudaram de cor)
    // { self, opp, cancelled } — Troca de Guarda no início do combate, já na perspectiva de quem recebe:
    // self/opp = 1 se Ataque e Defesa daquele lado trocam; cancelled = 1 se as duas Trocas se anularam.
    // Quem usou a carta não é revelado. Nada trocando e nada anulado = a carta falhou (ninguém tinha Defesa).
    GUARD_SWAP: 24,
    // { lightningId, seat, targets: CardFace[], burned: number[] } — Relâmpago fulmina a carta da frente e
    // salta em cadeia (faces reveladas, pois as cartas atingidas podem estar ocultas na Defesa). Salto que
    // sobra sem carta no campo inimigo vai na vida: `burned` = cartas queimadas da mão do alvo.
    LIGHTNING_STRIKE: 25,
    // { passes: [{ ghostId, seat, throughId, dissolveId, damage, guarded, absorbed? }] } — Fantasma(s) atravessam
    // a carta da frente (throughId, -1 = campo vazio) e ferem a vida. `seat` de cada passe já vem relativo;
    // `absorbed` (Escudo) só vai para quem levou o golpe. dissolveId = Espelho que se desfez sem ter o que copiar.
    GHOST_PASS: 26,
    // { mirrorId, targetId, seat, copied, result } — result 0 = copiou (valor inimigo + bônus) e venceu;
    // 1 = paradoxo (Espelho x Espelho / x Block): os dois se estilhaçam
    MIRROR_CLASH: 27,
    // { cardId, seat, damage, recoil, guarded, recoilGuarded, absorbed?, recoilAbsorbed? } — Espelho na vida:
    // `damage` no alvo e `recoil` (o reflexo) no dono. Cada `*Absorbed` só vai para quem o Escudo protegeu.
    MIRROR_HIT: 28,
    // { cardId, seat, from, to } — Emboscada disparou: a carta de Defesa (agora na frente) ganhou o bônus
    AMBUSH: 29,
    // { seat, cards: [{ id, type?, color?, power?, fromType?, fromColor?, fromPower? }] } — Maldição disparou na mão
    // do alvo. Só o alvo recebe as faces (antes/depois); quem amaldiçoou recebe só os ids (versos brilhando).
    CURSE_TRIGGERED: 30,
    // { seat, topId, underId, newPower } - Fusão do 1/2 com o 0
    FUSION: 31,
    // { cardId, seat, zeroId } - Uma fusão desfeita por um bloqueio ou reverso
    UNFUSE: 32,
    // --- Combos Supremos (GAME_RULES §6.18) ---
    // { seat, blockIds, victimIds, color, locked } — Prisão de Cristal no choque: os 3 Blocks viram um monólito,
    // esmagam a pilha da frente inimiga e (locked = 1) trancam Ataque/Defesa dela na próxima rodada.
    // locked = 0: um Espelho refletiu a parede — ele e o monólito se dissipam, nada é trancado.
    PRISON: 33,
    // { seat, blockIds, color, dustId } — Prisão na vida: campo trancado, sem compras no fim da rodada e a carta
    // `dustId` (topo do baralho, nunca revelada) voa até o monólito e vira pó (-1 se o baralho estava vazio)
    PRISON_HIT: 34,
    // { seat, reverseIds, fizzledId, stolen: [{ id, power }], color } — Reverso Kármico: rouba a pilha da frente
    // inimiga (números com +20%); fizzledId = Reverso simples inimigo que pifou (-1 se nenhum)
    KARMA: 35,
    // { seat, reverseIds, damage, hp, guarded, absorbed? } — Kármico na vida: devolve 1,2x o dano levado no último
    // combate; `hp` = vida final do alvo (a vida "buga" até congelar nela); o alvo entra em pânico na próxima rodada
    KARMA_HIT: 36,
    // { seat, ids } — mão do alvo sendo rebobinada: as cartas antigas são chutadas pra fora da mesa
    HAND_REWIND: 37,
    // { seat, ids } — as cartas novas (já no snapshot) se materializam em glitch no lugar das antigas
    HAND_REWIND_DONE: 38,
    // { seat, ms } — pânico: `seat` tem `ms` pra preparar; depois o servidor finaliza o turno por ele
    PANIC: 39,
    // { aIds, bIds } — dois Combos Supremos se chocaram: os dois trios colapsam juntos
    ULTIMATE_COLLAPSE: 40,
    // { id, count } — um espectador conectou-se à partida
    SPECTATOR_JOINED: 41,
    // { count } — atualização da quantidade de espectadores
    SPECTATOR_COUNT: 42,
    ROOM_CLOSED: 43,
    // --- Ronova (GAME_RULES §6.19) ---
    // { seat, kind, turns, cards: [{ id, from?, to? }], burned: { id, type?, color?, power? } | null } — o olho
    // cobre a tela no início da preparação do marcado (`seat`). kind = DEATH_KIND.*; turns = turnos que restam
    // depois deste. `cards` = números da mão que perderam força: o marcado (e espectadores) recebem from/to,
    // quem plantou só os ids (versos ardendo). `burned` (só no END) = carta queimada da mão, face só pro marcado.
    DEATH_MARK: 44,
    // { seat, ids } — cartas do marcado que lutaram são consumidas pelas chamas carmesim em vez de voltar pra mão
    DEATH_BURN: 45,
    SURGE: 46            // { phase: SURGE_PHASE, kind: CONFIG.SURGE_KIND, turns }  Evento da Arena começou/acabou
});

export const DEATH_KIND = Object.freeze({ START: 0, TICK: 1, END: 2 });
export const SURGE_PHASE = Object.freeze({ START: 0, END: 1 });

// Byte 31 do snapshot: Ronova na perspectiva de quem recebe
export const DEATH_FLAGS = Object.freeze({
    SELF_MARKED: 1,   // eu estou marcado (público depois que o olho aparece)
    OPP_MARKED: 2,    // o oponente está marcado
    SELF_PENDING: 4,  // há uma Ronova plantada em mim (só espectadores recebem: o alvo nunca sabe)
    OPP_PENDING: 8    // há uma Ronova plantada no oponente (quem plantou e espectadores)
});

export const MIRROR_RESULT = Object.freeze({ WIN: 0, PARADOX: 1 });

// OVERLOAD: Relâmpago na vida — DIRECT_HIT ganha `burned: number[]` (cartas queimadas da mão do alvo)
export const HIT_EFFECT = Object.freeze({ NONE: 0, LOCKOUT: 1, HAND_SWAP: 2, OVERLOAD: 3, USE_LOCKOUT: 5 });
export const GAME_RESULT = Object.freeze({ NONE: 0, VICTORY: 1, DEFEAT: 2 });
export const END_REASON = Object.freeze({ HP: 0, ABANDON: 1 });
export const REL_SEAT = Object.freeze({ SELF: 0, OPPONENT: 1 });

export const SNAPSHOT_FLAGS = Object.freeze({
    SELF_READY: 1,
    OPP_READY: 2,
    SELF_DEFENSE_LOCKED: 4,
    OPP_DEFENSE_LOCKED: 8,
    SELF_REMATCH: 16,
    OPP_REMATCH: 32,
    SELF_CHOOSING_COLOR: 64,
    OPP_CHOOSING_COLOR: 128
});

export const SNAPSHOT_FLAGS2 = Object.freeze({
    SELF_USE_LOCKED: 1,
    OPP_USE_LOCKED: 2,
    SELF_FIELD_LOCKED: 4,   // Prisão de Cristal: Ataque e Defesa trancados nesta preparação
    OPP_FIELD_LOCKED: 8
});

/**
 * @typedef {{ id: number, type: number, color: number, power: number }} CardFace
 */

/** Comparação de sequência u16 com wrap-around: true se `a` veio depois de `b`. */
export function isSeqAfter(a, b) {
    const diff = (a - b) & 0xffff;
    return diff !== 0 && diff < 0x8000;
}

export function isBinaryMessage(msg) {
    return msg instanceof ArrayBuffer || ArrayBuffer.isView(msg);
}

/**
 * Cria o evento como visto por um assento específico (converte `seat` absoluto em relativo).
 * @param {object} event evento com `seat` absoluto (opcional)
 * @param {number} viewerSeat
 */
export function localizeEvent(event, viewerSeat) {
    if (event.seat === undefined) return event;
    const isSpectator = viewerSeat === -1 || viewerSeat === null;
    const effectiveViewer = isSpectator ? 0 : viewerSeat;
    const copy = Object.assign({}, event);
    copy.seat = event.seat === effectiveViewer ? REL_SEAT.SELF : REL_SEAT.OPPONENT;
    return copy;
}

// --- Snapshot binário -------------------------------------------------------
// Header (25 bytes, big-endian):
//  0 u8 MSG.SNAPSHOT | 1 u8 versão | 2 u16 seq | 4 u8 fase | 5 u16 rodada
//  7 i16 HP próprio | 9 i16 HP oponente | 11 u8 cor ativa própria | 12 u8 flags
// 13 u8 descartes próprios | 14 u8 descartes do oponente | 15 u8 resultado
// 16 u16 cartas no baralho | 18 u16 quantidade de cartas | 20 u16 último input processado (ack)
// 22 u8 cores que podem ser escolhidas (máscara de colorBit; só chega para quem está escolhendo)
// 23 u8 status próprio, byte baixo (CONFIG.STATUS: Cura/Escudo/Reviver ativos, Reviver já usado...)
// 24 u8 rodadas restantes do Reviver próprio
// 25 u16 moedas próprias | 27 u8 rodadas até a loja renovar | 28 u8 custo da renovação paga
// 29 u8 status próprio, byte alto (CONFIG.STATUS >= 256, ex.: Maldições esgotadas)
// 31 u8 Ronova (DEATH_FLAGS, na perspectiva de quem recebe)
// 37 u8 turnos de marca da Ronova restantes: nibble baixo = meus, nibble alto = do oponente
// 32 u8 status do oponente (espectador apenas, byte baixo)
// 33 u8 status do oponente (espectador apenas, byte alto)
// 34 u8 rodadas restantes do Reviver do oponente (espectador apenas)
// 35 espaço vazio
// 36 loja própria: SLOTS x 6 bytes (u8 tipo | u8 cor | i8 poder | u8 preço | u8 preço cheio | u8 flags)
// Carta (8 bytes): u16 id | u8 zona relativa | u8 ordem na zona | u8 tipo | u8 cor | i8 poder | u8 marcas
// (marcas = CONFIG.CARD_FLAGS, só nas próprias cartas)
// A cor ativa do oponente NÃO é enviada (o uso de Trocar Cor é secreto), nem as cores em comum para
// quem não está escolhendo (elas revelam um pouco da mão do oponente), nem o status do oponente
// (Cura/Escudo/Reviver usados continuam secretos até o efeito aparecer em combate), nem as moedas e
// a loja do oponente.

// 35 u16 moedas do oponente (espectador apenas)
// 38 u8  Evento da Arena: tipo (bits 0-3, CONFIG.SURGE_KIND) | combates restantes (bits 4-7)

const SHOP_OFFSET = 39;
const SHOP_ITEM_BYTES = 6;
const HEADER_BYTES = SHOP_OFFSET + CONFIG.SHOP.SLOTS * SHOP_ITEM_BYTES;
const CARD_BYTES = 8;
const SEQ_OFFSET = 2;
export const SNAPSHOT_MAX_BYTES = HEADER_BYTES + CARD_BYTES * CONFIG.DECK_SIZE;

/** Snapshot decodificado, pré-alocado e reutilizado (zero alocação por atualização). */
export class SnapshotView {
    constructor(capacity = CONFIG.DECK_SIZE) {
        this.capacity = capacity;
        this.seq = 0;
        this.phase = CONFIG.GAME_STATES.INIT;
        this.round = 0;
        this.selfHP = CONFIG.STARTING_HP;
        this.oppHP = CONFIG.STARTING_HP;
        this.selfColor = CONFIG.COLOR.NONE;
        this.flags = 0;
        this.flags2 = 0;
        this.selfDiscards = 0;
        this.oppDiscards = 0;
        this.result = GAME_RESULT.NONE;
        this.deckCount = 0;
        this.cardCount = 0;
        this.ackSeq = 0;
        this.colorChoices = 0;
        this.selfStatus = 0;
        this.reviveRounds = 0;
        this.coins = 0;
        this.shopRoundsLeft = 0;
        this.rerollCost = 0;
        this.oppStatus = 0;
        this.oppReviveRounds = 0;
        this.ronova = 0;
        this.selfRonovaTurns = 0;
        this.oppRonovaTurns = 0;
        this.surgeKind = 0;
        this.surgeTurns = 0;
        this.oppCoins = 0;
        const slots = CONFIG.SHOP.SLOTS;
        this.shopType = new Uint8Array(slots).fill(CONFIG.CARD_TYPES.HIDDEN);
        this.shopColor = new Uint8Array(slots);
        this.shopPower = new Int8Array(slots);
        this.shopPrice = new Uint8Array(slots);
        this.shopFullPrice = new Uint8Array(slots);
        this.shopFlags = new Uint8Array(slots);
        this.ids = new Uint16Array(capacity);
        this.zone = new Uint8Array(capacity);
        this.order = new Uint8Array(capacity);
        this.type = new Uint8Array(capacity);
        this.color = new Uint8Array(capacity);
        this.power = new Int8Array(capacity);
        this.cardFlags = new Uint8Array(capacity);
    }

    /** Item da loja própria (objeto novo: só para eventos/UI, nunca no loop de render). */
    shopItem(slot) {
        return {
            type: this.shopType[slot], color: this.shopColor[slot], power: this.shopPower[slot],
            price: this.shopPrice[slot], fullPrice: this.shopFullPrice[slot], flags: this.shopFlags[slot]
        };
    }

    /** Quantas cartas estão na mão do próprio jogador. */
    handSize() {
        return this.countInZone(ZONE.SELF_HAND);
    }

    hasFlag(flag) {
        return (this.flags & flag) !== 0;
    }

    /** Conta cartas em uma zona relativa. */
    countInZone(zone) {
        let n = 0;
        for (let i = 0; i < this.cardCount; i++) if (this.zone[i] === zone) n++;
        return n;
    }
}

/**
 * Serializa o estado do servidor como visto por `viewerSeat`.
 * @param {import('../server/server-state.js').ServerState} state
 * @param {number} viewerSeat
 * @param {number} seq
 * @param {number} ackSeq último input do jogador já processado pelo servidor
 * @param {DataView} scratch buffer de trabalho com SNAPSHOT_MAX_BYTES
 * @returns {Uint8Array} cópia independente pronta para envio
 */
export function encodeSnapshot(state, viewerSeat, seq, ackSeq, scratch) {
    const isSpectator = viewerSeat === -1 || viewerSeat === null;
    const effectiveViewer = isSpectator ? 0 : viewerSeat;
    const oppSeat = 1 - effectiveViewer;
    const hidden = CONFIG.CARD_TYPES.HIDDEN;
    let offset = HEADER_BYTES;
    let count = 0;

    const isPrep = state.phase === CONFIG.GAME_STATES.PLAYING;
    const oppHandZone = isSpectator ? -1 : seatZone(oppSeat, ZONE_OFFSET.HAND);
    const oppAttackZone = isSpectator ? -1 : seatZone(oppSeat, ZONE_OFFSET.ATTACK);
    const oppDefenseZone = isSpectator ? -1 : seatZone(oppSeat, ZONE_OFFSET.DEFENSE);

    for (let zone = ZONE.SELF_HAND; zone < ZONE_COUNT; zone++) {
        let cards = state.zones[zone];
        
        // Garante processar oppHandZone mesmo se vazia, caso haja cartas extras nos stacks
        if (cards.length === 0 && !(isPrep && zone === oppHandZone)) continue;

        let spoofedCards = cards;
        if (zone === oppHandZone) {
            spoofedCards = [...cards];
            if (isPrep) {
                const extraAttack = state.zones[oppAttackZone].slice(1);
                const extraDefense = state.zones[oppDefenseZone].slice(1);
                if (extraAttack.length > 0 || extraDefense.length > 0) {
                    spoofedCards.push(...extraAttack, ...extraDefense);
                }
            }
            // Sort by ID to ensure a stable visual order in the opponent's hand.
            // When a combo card is moved to the stack and we spoof it back to the hand,
            // it will fall into the exact same relative position, preventing UI shuffling.
            spoofedCards.sort((a, b) => a - b);
        } else if (isPrep && zoneSeat(zone) === oppSeat) {
            if (zone === oppAttackZone || zone === oppDefenseZone) {
                if (cards.length > 1) {
                    spoofedCards = cards.slice(0, 1);
                }
            }
        }

        if (spoofedCards.length === 0) continue;

        const relZone = mirrorZone(zone, effectiveViewer);
        const isOwn = zoneSeat(zone) === effectiveViewer;

        for (let i = 0; i < spoofedCards.length; i++) {
            const id = spoofedCards[i];
            const visible = isSpectator || isOwn || state.revealed[id] === 1;
            scratch.setUint16(offset, id);
            scratch.setUint8(offset + 2, relZone);
            scratch.setUint8(offset + 3, i > 255 ? 255 : i);
            scratch.setUint8(offset + 4, visible ? state.type[id] : hidden);
            scratch.setUint8(offset + 5, visible ? state.color[id] : 0);
            scratch.setInt8(offset + 6, visible ? state.power[id] : 0);
            scratch.setUint8(offset + 7, (isOwn || isSpectator) ? state.cardFlags[id] : 0);
            offset += CARD_BYTES;
            count++;
        }
    }

    let flags = 0;
    if (state.ready[effectiveViewer]) flags |= SNAPSHOT_FLAGS.SELF_READY;
    if (state.ready[oppSeat]) flags |= SNAPSHOT_FLAGS.OPP_READY;
    if (state.defenseLock[effectiveViewer] > 0 || state.fieldLock[effectiveViewer] === 1) flags |= SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED;
    if (state.defenseLock[oppSeat] > 0 || state.fieldLock[oppSeat] === 1) flags |= SNAPSHOT_FLAGS.OPP_DEFENSE_LOCKED;
    if (state.rematch[effectiveViewer]) flags |= SNAPSHOT_FLAGS.SELF_REMATCH;
    if (state.rematch[oppSeat]) flags |= SNAPSHOT_FLAGS.OPP_REMATCH;

    const choosing = state.phase === CONFIG.GAME_STATES.CHOOSING_COLOR;
    const viewerChooses = choosing && state.colorChooser === effectiveViewer;
    if (viewerChooses) flags |= SNAPSHOT_FLAGS.SELF_CHOOSING_COLOR;
    if (choosing && state.colorChooser === oppSeat) flags |= SNAPSHOT_FLAGS.OPP_CHOOSING_COLOR;

    let flags2 = 0;
    if (state.useLock[effectiveViewer] > 0) flags2 |= SNAPSHOT_FLAGS2.SELF_USE_LOCKED;
    if (state.useLock[oppSeat] > 0) flags2 |= SNAPSHOT_FLAGS2.OPP_USE_LOCKED;
    if (state.fieldLock[effectiveViewer] >= 2) flags2 |= SNAPSHOT_FLAGS2.SELF_FIELD_LOCKED;
    if (state.fieldLock[oppSeat] >= 2) flags2 |= SNAPSHOT_FLAGS2.OPP_FIELD_LOCKED;

    let result = GAME_RESULT.NONE;
    if (state.winner >= 0) result = state.winner === effectiveViewer ? GAME_RESULT.VICTORY : GAME_RESULT.DEFEAT;

    scratch.setUint8(0, MSG.SNAPSHOT);
    scratch.setUint8(1, PROTOCOL_VERSION);
    scratch.setUint16(SEQ_OFFSET, seq);
    scratch.setUint8(4, state.phase);
    scratch.setUint16(5, state.round);
    scratch.setInt16(7, state.hp[effectiveViewer]);
    scratch.setInt16(9, state.hp[oppSeat]);
    scratch.setUint8(11, state.activeColor[effectiveViewer]);
    scratch.setUint8(12, flags);
    scratch.setUint8(13, state.discardsNeeded[effectiveViewer]);
    scratch.setUint8(14, state.discardsNeeded[oppSeat]);
    scratch.setUint8(15, result);
    scratch.setUint16(16, state.zones[ZONE.DECK].length);
    scratch.setUint16(18, count);
    scratch.setUint16(20, ackSeq);
    scratch.setUint8(22, viewerChooses ? state.colorChoices : 0);
    const status = state.statusOf(effectiveViewer);
    scratch.setUint8(23, status & 0xff);
    scratch.setUint8(29, (status >> 8) & 0xff);
    scratch.setUint8(24, state.reviveRounds[effectiveViewer]);
    scratch.setUint16(25, state.coins[effectiveViewer]);
    scratch.setUint8(27, state.shopRoundsLeft);
    scratch.setUint8(28, surgePrice(state.rerollCost[effectiveViewer], state.surgeKind));
    scratch.setUint8(38, (state.surgeKind & 15) | ((state.surgeTurns & 15) << 4));
    scratch.setUint8(30, flags2);
    
    const oppStatus = isSpectator ? state.statusOf(oppSeat) : 0;
    scratch.setUint8(32, oppStatus & 0xff);
    scratch.setUint8(33, (oppStatus >> 8) & 0xff);
    scratch.setUint8(34, isSpectator ? state.reviveRounds[oppSeat] : 0);
    scratch.setUint16(35, isSpectator ? state.coins[oppSeat] : 0);

    // Ronova: a marca ativa é pública; a plantada só vai pra quem plantou (e espectadores, que veem tudo)
    let ronova = 0;
    if (state.ronovaTurns[effectiveViewer] > 0) ronova |= DEATH_FLAGS.SELF_MARKED;
    if (state.ronovaTurns[oppSeat] > 0) ronova |= DEATH_FLAGS.OPP_MARKED;
    if (state.ronovaPending[effectiveViewer]) ronova |= DEATH_FLAGS.OPP_PENDING;
    if (isSpectator && state.ronovaPending[oppSeat]) ronova |= DEATH_FLAGS.SELF_PENDING;
    scratch.setUint8(31, ronova);
    scratch.setUint8(37, (state.ronovaTurns[effectiveViewer] & 15) | ((state.ronovaTurns[oppSeat] & 15) << 4));

    const slots = CONFIG.SHOP.SLOTS;
    for (let slot = 0; slot < slots; slot++) {
        const i = effectiveViewer * slots + slot;
        const o = SHOP_OFFSET + slot * SHOP_ITEM_BYTES;
        scratch.setUint8(o, state.shopType[i]);
        scratch.setUint8(o + 1, state.shopColor[i]);
        scratch.setInt8(o + 2, state.shopPower[i]);
        // Super Desconto: o preço já sai reduzido e o item ganha a etiqueta de oferta (preço cheio riscado)
        const price = surgePrice(state.shopPrice[i], state.surgeKind);
        scratch.setUint8(o + 3, price);
        scratch.setUint8(o + 4, state.shopFullPrice[i]);
        scratch.setUint8(o + 5, price < state.shopPrice[i] ? state.shopFlags[i] | CONFIG.SHOP_ITEM_FLAGS.DISCOUNT : state.shopFlags[i]);
    }

    return new Uint8Array(scratch.buffer.slice(0, offset));
}

/** Compara dois snapshots ignorando o número de sequência. */
export function snapshotsEqual(a, b) {
    if (!a || !b || a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
        if (i === SEQ_OFFSET || i === SEQ_OFFSET + 1) continue;
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function writeSnapshotSeq(bytes, seq) {
    bytes[SEQ_OFFSET] = (seq >> 8) & 0xff;
    bytes[SEQ_OFFSET + 1] = seq & 0xff;
}

/**
 * @param {ArrayBuffer|ArrayBufferView} data
 * @param {SnapshotView} view
 * @returns {boolean} false se a mensagem não for um snapshot válido
 */
export function decodeSnapshot(data, view) {
    const dv = data instanceof ArrayBuffer
        ? new DataView(data)
        : new DataView(data.buffer, data.byteOffset, data.byteLength);

    if (dv.byteLength < HEADER_BYTES) return false;
    if (dv.getUint8(0) !== MSG.SNAPSHOT) return false;
    if (dv.getUint8(1) !== PROTOCOL_VERSION) {
        console.warn(`[Protocol] Versão de snapshot incompatível: ${dv.getUint8(1)} (esperado ${PROTOCOL_VERSION})`);
        return false;
    }

    const count = dv.getUint16(18);
    if (count > view.capacity || dv.byteLength < HEADER_BYTES + count * CARD_BYTES) return false;

    view.seq = dv.getUint16(SEQ_OFFSET);
    view.phase = dv.getUint8(4);
    view.round = dv.getUint16(5);
    view.selfHP = dv.getInt16(7);
    view.oppHP = dv.getInt16(9);
    view.selfColor = dv.getUint8(11);
    view.flags = dv.getUint8(12);
    view.selfDiscards = dv.getUint8(13);
    view.oppDiscards = dv.getUint8(14);
    view.result = dv.getUint8(15);
    view.deckCount = dv.getUint16(16);
    view.cardCount = count;
    view.ackSeq = dv.getUint16(20);
    view.colorChoices = dv.getUint8(22);
    view.selfStatus = dv.getUint8(23) | (dv.getUint8(29) << 8);
    view.reviveRounds = dv.getUint8(24);
    view.coins = dv.getUint16(25);
    view.shopRoundsLeft = dv.getUint8(27);
    view.rerollCost = dv.getUint8(28);
    view.flags2 = dv.getUint8(30);
    view.oppStatus = dv.getUint8(32) | (dv.getUint8(33) << 8);
    view.oppReviveRounds = dv.getUint8(34);
    view.oppCoins = dv.getUint16(35);
    view.ronova = dv.getUint8(31);
    const ronovaTurns = dv.getUint8(37);
    view.selfRonovaTurns = ronovaTurns & 15;
    view.oppRonovaTurns = ronovaTurns >> 4;
    const surge = dv.getUint8(38);
    view.surgeKind = surge & 15;
    view.surgeTurns = surge >> 4;
    for (let slot = 0; slot < CONFIG.SHOP.SLOTS; slot++) {
        const o = SHOP_OFFSET + slot * SHOP_ITEM_BYTES;
        view.shopType[slot] = dv.getUint8(o);
        view.shopColor[slot] = dv.getUint8(o + 1);
        view.shopPower[slot] = dv.getInt8(o + 2);
        view.shopPrice[slot] = dv.getUint8(o + 3);
        view.shopFullPrice[slot] = dv.getUint8(o + 4);
        view.shopFlags[slot] = dv.getUint8(o + 5);
    }

    let offset = HEADER_BYTES;
    for (let i = 0; i < count; i++) {
        view.ids[i] = dv.getUint16(offset);
        view.zone[i] = dv.getUint8(offset + 2);
        view.order[i] = dv.getUint8(offset + 3);
        view.type[i] = dv.getUint8(offset + 4);
        view.color[i] = dv.getUint8(offset + 5);
        view.power[i] = dv.getInt8(offset + 6);
        view.cardFlags[i] = dv.getUint8(offset + 7);
        offset += CARD_BYTES;
    }
    return true;
}
