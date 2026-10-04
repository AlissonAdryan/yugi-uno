/**
 * Zonas de carta compartilhadas por servidor, protocolo e cliente.
 *
 * No servidor as zonas são ABSOLUTAS (assento 0 = P1/host, assento 1 = P2).
 * No cliente/rede elas são RELATIVAS ao jogador que vê (SELF_* = eu, OPP_* = oponente).
 * Como os valores de SELF_* coincidem com os do assento 0, converter entre as duas
 * visões é só "espelhar" os blocos quando quem vê é o assento 1 (mirrorZone é involutiva).
 */

export const ZONE = Object.freeze({
    DECK: 0,
    DISCARD: 1,
    SELF_HAND: 2,
    SELF_ATTACK: 3,
    SELF_DEFENSE: 4,
    SELF_USE: 5,
    OPP_HAND: 6,
    OPP_ATTACK: 7,
    OPP_DEFENSE: 8,
    OPP_USE: 9
});

export const ZONE_COUNT = 10;

/**
 * Zonas que só existem na previsão local do cliente (nunca na rede nem no servidor). O layout ignora
 * cartas nelas, então a carta fica onde o jogador soltou até a cinemática/servidor decidir.
 */
export const CLIENT_ZONE = Object.freeze({
    TRASH: 200,  // carta solta na lixeira, esperando o CARD_SOLD
    FX: 201      // carta que só existe numa cinemática (ex.: a compra triturada pela Prisão de Cristal)
});

export const SEAT = Object.freeze({ P1: 0, P2: 1 });

export const ZONE_OFFSET = Object.freeze({ HAND: 0, ATTACK: 1, DEFENSE: 2, USE: 3 });

export const BOARD_ZONES = Object.freeze([
    ZONE.SELF_ATTACK, ZONE.SELF_DEFENSE, ZONE.SELF_USE,
    ZONE.OPP_ATTACK, ZONE.OPP_DEFENSE, ZONE.OPP_USE
]);

const FIRST_SEAT_ZONE = 2;
const ZONES_PER_SEAT = 4;

/**
 * @param {number} seat
 * @param {number} offset ZONE_OFFSET.*
 * @returns {number}
 */
export function seatZone(seat, offset) {
    return FIRST_SEAT_ZONE + seat * ZONES_PER_SEAT + offset;
}

/** @returns {number} assento dono da zona, ou -1 para baralho/descarte */
export function zoneSeat(zone) {
    return zone < FIRST_SEAT_ZONE ? -1 : ((zone - FIRST_SEAT_ZONE) / ZONES_PER_SEAT) | 0;
}

/** @returns {number} ZONE_OFFSET.* da zona, ou -1 para baralho/descarte */
export function zoneOffset(zone) {
    return zone < FIRST_SEAT_ZONE ? -1 : (zone - FIRST_SEAT_ZONE) % ZONES_PER_SEAT;
}

/**
 * Converte zona absoluta <-> relativa para o assento informado.
 * @param {number} zone
 * @param {number} seat
 * @returns {number}
 */
export function mirrorZone(zone, seat) {
    if (seat === SEAT.P1 || zone < FIRST_SEAT_ZONE) return zone;
    return seatZone(1 - zoneSeat(zone), zoneOffset(zone));
}

export function isValidZone(zone) {
    return Number.isInteger(zone) && zone >= 0 && zone < ZONE_COUNT;
}

export function isCombatOffset(offset) {
    return offset === ZONE_OFFSET.ATTACK || offset === ZONE_OFFSET.DEFENSE;
}

export function isBoardZone(zone) {
    const offset = zoneOffset(zone);
    return offset === ZONE_OFFSET.ATTACK || offset === ZONE_OFFSET.DEFENSE || offset === ZONE_OFFSET.USE;
}
