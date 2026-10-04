import { CONFIG } from '../config/constants.js';
import { ServerState } from './server-state.js';
import { ServerCombat } from './server-combat.js';
import { ServerShop } from './server-shop.js';
import { DeckSystem } from '../systems/deck-system.js';
import {
    canPlayOnCombatSlot, colorBit, colorCount, consumableBlockReason, countAttackOptions, handLimitExcess, isConsumable,
    isPaintable, leavesNoAttack, pickColorFromMask, roundDrawsFor, isValidCombo, cardTypeName, purchaseBlockReason, roundCoinsFor, sellValue,
    surgeDraws, surgePrice
} from '../systems/rules.js';
import {
    SEAT, ZONE_OFFSET, isCombatOffset, isValidZone, mirrorZone, seatZone, zoneOffset, zoneSeat
} from '../utils/zones.js';
import {
    EVENT, END_REASON, GAME_RESULT, INPUT, MSG, SNAPSHOT_MAX_BYTES,
    encodeSnapshot, localizeEvent, snapshotsEqual, writeSnapshotSeq
} from '../network/protocol.js';
import { NET_EVENT } from '../network/network-system.js';
import { triggerCurses } from './cards/curse.js';
import { DEATH_PREP_DELAY_MS, triggerRonova } from './cards/death.js';
import { tickSurge } from './surge.js';

const { GAME_STATES, TIMINGS, COLOR, CARD_TYPES } = CONFIG;
const SEATS = [SEAT.P1, SEAT.P2];
const INPUT_NAMES = Object.fromEntries(Object.entries(INPUT).map(([k, v]) => [v, k]));

/**
 * ServerEngine - fonte única da verdade (roda no host).
 *
 * Regras de ordenação das mensagens:
 *  - Mutações chamam markDirty(); o snapshot sai num microtask (várias mutações = 1 snapshot).
 *  - emit()/emitTo() SEMPRE enviam antes o snapshot pendente. Assim um evento descreve a transição
 *    a partir do último estado já entregue, e a mutação correspondente é feita logo após o emit.
 */
export class ServerEngine {
    /**
     * @param {import('../network/network-system.js').NetworkSystem} network
     */
    constructor(network) {
        this.network = network;
        this.state = new ServerState();
        this.deck = new DeckSystem(this.state);
        this.combat = new ServerCombat(this.state, this.deck, this);
        this.shop = new ServerShop(this.state);

        this.scratch = new DataView(new ArrayBuffer(SNAPSHOT_MAX_BYTES));
        this.snapshotSeq = [0, 0];
        this.lastInputSeq = [0, 0];
        this.lastSnapshot = [null, null];
        this.flushPending = false;
        this.timers = new Set();
        this.names = ['', ''];
        this.startRequested = false;
        // Invalida timeouts de escolha de cor antigos (cada abertura da escolha gera um novo token)
        this.colorChoiceToken = 0;
        // Invalida cronômetros de pânico antigos (combate começou / partida reiniciou)
        this.panicToken = 0;
        // Pintar: o jogador precisa selecionar 2 cartas + 1 cor após usar a carta (1 = aguardando seleção)
        // Está em this.state.paintPending
        this.spectatorCount = 0;

        this._flushMicrotask = () => {
            if (!this.flushPending) return;
            this.flushPending = false;
            this.flushNow();
        };

        network.on(NET_EVENT.INPUT, (seat, msg) => this.handleInput(seat, msg));
        network.on(NET_EVENT.SEAT_CONNECTED, (seat) => this.sendFullSync(seat));
        network.on(NET_EVENT.SEAT_LOST, (seat) => this.endByAbandon(seat));
        network.on(NET_EVENT.SPECTATOR_LEFT, () => this.sendSpectatorCount());
    }

    // --- Ciclo da partida ---------------------------------------------------

    /** Inicia a partida assim que os dois jogadores tiverem informado o nome. */
    start() {
        if (this.state.phase !== GAME_STATES.INIT) return;
        if (!this.names[SEAT.P1] || !this.names[SEAT.P2]) {
            this.startRequested = true;
            console.log('[Server] Aguardando os nomes dos jogadores para iniciar...');
            return;
        }
        this.startRequested = false;
        console.log(`[Server] Iniciando partida: ${this.names[SEAT.P1]} x ${this.names[SEAT.P2]}`);
        this.deck.reset();
        for (const seat of SEATS) this.shop.reset(seat);
        console.log(`[Server] Lojas montadas. Moedas iniciais: ${CONFIG.SHOP.STARTING_COINS}.`);

        for (let i = 0; i < CONFIG.INITIAL_HAND_SIZE; i++) {
            for (const seat of SEATS) this.deck.draw(seatZone(seat, ZONE_OFFSET.HAND));
        }
        this.markDirty();
        this.schedule(() => this.beginColorDraw(), TIMINGS.NEXT_ROUND_DELAY);
    }

    isGameOver() {
        return this.state.phase === GAME_STATES.GAME_OVER;
    }

    beginColorDraw() {
        if (this.isGameOver()) return;
        const s = this.state;

        for (const seat of SEATS) {
            if (s.handSize(seat) === 0) {
                console.warn(`[Server] P${seat + 1} sem cartas no sorteio de cor. Comprando 1 de emergência.`);
                this.deck.draw(seatZone(seat, ZONE_OFFSET.HAND));
            }
        }

        // Cristalização só no turno com Ataque + Defesa trancados (fieldLock 2). No turno seguinte (fieldLock 1)
        // só a Defesa segue trancada e a cor volta ao fluxo normal (cor em comum ou Descarte Forçado): o
        // jogador precisa ter cor pra atacar ou poder descartar, senão o turno trava
        let p1Locked = s.fieldLock[SEAT.P1] >= 2;
        let p2Locked = s.fieldLock[SEAT.P2] >= 2;
        if (p1Locked || p2Locked) {
            let validMask = 0;
            if (p1Locked) validMask |= s.handColorMask(SEAT.P2, colorBit);
            if (p2Locked) validMask |= s.handColorMask(SEAT.P1, colorBit);
            
            if (validMask === 0) validMask = (1 | 2 | 4 | 8);
            const color = pickColorFromMask(validMask);
            
            console.log(`[Server] Rodada ${s.round + 1}: Cristalização ativa. Cor sorteada da mão do atacante: ${CONFIG.COLOR_PALETTES[color].name}`);
            this.commitColor(color);
            return;
        }

        let common = s.handColorMask(SEAT.P1, colorBit) & s.handColorMask(SEAT.P2, colorBit);
        
        if (common !== 0) {
            // Só abre a escolha se houver o que escolher; com uma única cor em comum, ela já é a cor
            if (s.colorChooser >= 0 && colorCount(common) > 1) {
                this.openColorChoice(common);
                return;
            }
            const color = pickColorFromMask(common);
            console.log(`[Server] Rodada ${s.round + 1}: cor sorteada ${CONFIG.COLOR_PALETTES[color].name}`);
            this.commitColor(color);
            return;
        }

        console.warn('[Server] Nenhuma cor em comum. Entrando em Descarte Forçado.');
        s.phase = GAME_STATES.FORCED_DISCARDING;
        s.activeColor.fill(COLOR.NONE);
        for (const seat of SEATS) {
            const count = Math.min(CONFIG.FORCED_DISCARD_COUNT, s.handSize(seat));
            s.discardsNeeded[seat] = count;
            s.drawsOwed[seat] = count;
        }
        this.markDirty();
    }

    /** O perdedor da rodada escolhe a cor entre as cores em comum (as demais ficam indisponíveis). */
    openColorChoice(common) {
        const s = this.state;
        const seat = s.colorChooser;
        console.log(`[Server] Rodada ${s.round + 1}: P${seat + 1} escolhe a cor (máscara ${common.toString(2)}).`);
        s.colorChoices = common;
        s.phase = GAME_STATES.CHOOSING_COLOR;
        this.markDirty();

        const token = ++this.colorChoiceToken;
        this.schedule(() => {
            if (s.phase !== GAME_STATES.CHOOSING_COLOR || token !== this.colorChoiceToken) return;
            const color = pickColorFromMask(s.colorChoices);
            console.warn(`[Server] P${seat + 1} não escolheu a tempo. Cor sorteada: ${CONFIG.COLOR_PALETTES[color].name}`);
            this.commitColor(color);
        }, TIMINGS.COLOR_CHOICE_TIMEOUT);
    }

    /** Define a cor da rodada (sorteada ou escolhida) e abre a fase de preparação. */
    commitColor(color) {
        const s = this.state;
        this.emit(EVENT.COLOR_CHOSEN, { color });
        s.activeColor[SEAT.P1] = color;
        s.activeColor[SEAT.P2] = color;
        s.ready.fill(0);
        s.discardsNeeded.fill(0);
        s.colorChooser = -1;
        s.colorChoices = 0;
        this.colorChoiceToken++;
        // O Escudo protege até a rodada seguinte começar; a Cura já resolveu no fim do combate
        s.shieldActive.fill(0);
        s.healActive.fill(0);
        // Pintar é só da preparação: uma seleção que ficou aberta não atravessa para a rodada seguinte
        s.paintPending.fill(0);
        // A Troca de Guarda e a Emboscada são consumidas no combate; isto só garante que nada atravesse
        // uma rodada sem combate
        s.guardSwap.fill(0);
        s.clearAmbush();
        // Maldições plantadas na rodada anterior disparam agora: depois do sorteio, antes da preparação
        // (os eventos saem antes do snapshot de PLAYING, então ninguém joga uma carta prestes a mudar).
        // A Ronova vem antes: o olho abre a preparação e drena os números antes de a Maldição escolher alvos
        const ronovaMask = triggerRonova(this);
        triggerCurses(this);
        s.round++;
        s.phase = GAME_STATES.PLAYING;
        this.markDirty();
        this.startPanicTimers(ronovaMask);
    }

    /**
     * Pânico do Reverso Kármico (GAME_RULES §6.18.2): quem levou o golpe tem só PANIC_SECONDS pra preparar esta
     * rodada; o cronômetro aparece pros dois. Estourou o tempo (+ uma folga de rede), o servidor finaliza o
     * turno por ele (forcePanicReady).
     */
    startPanicTimers(ronovaMask = 0) {
        const s = this.state;
        const ms = CONFIG.ULTIMATE.PANIC_SECONDS * 1000;
        // O olho da Ronova (visto pelos dois) toma o começo da preparação: não pode comer o tempo do pânico
        const ronovaDelay = ronovaMask !== 0 ? DEATH_PREP_DELAY_MS : 0;
        for (const seat of SEATS) {
            if (!s.panic[seat]) continue;
            console.log(`[Server] P${seat + 1} em PÂNICO: ${CONFIG.ULTIMATE.PANIC_SECONDS}s pra preparar a rodada ${s.round}.`);
            this.emit(EVENT.PANIC, { seat, ms });
            const token = this.panicToken;
            const round = s.round;
            this.schedule(() => {
                if (token !== this.panicToken || s.round !== round) return;
                this.forcePanicReady(seat);
            }, ms + CONFIG.ULTIMATE.PANIC_GRACE_MS + ronovaDelay);
        }
    }

    /**
     * O tempo do pânico acabou: fecha a seleção do Pintar e, sem Ataque montado, joga a primeira carta legal da
     * mão no Ataque (a mesma que o jogador poderia arrastar). Então finaliza o turno.
     */
    forcePanicReady(seat) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING || s.ready[seat]) return;
        console.warn(`[Server] Tempo de pânico de P${seat + 1} esgotado: finalizando o turno por ele.`);
        s.paintPending[seat] = 0;
        if (s.fieldLock[seat] < 2 && s.zone(seat, ZONE_OFFSET.ATTACK).length === 0) {
            const hand = s.zone(seat, ZONE_OFFSET.HAND);
            const playables = [];
            for (let i = 0; i < hand.length; i++) {
                const id = hand[i];
                if (!isConsumable(s.type[id]) && canPlayOnCombatSlot(s, id, s.activeColor[seat], -1)) {
                    playables.push(id);
                }
            }
            if (playables.length > 0) {
                const id = playables[Math.floor(Math.random() * playables.length)];
                console.log(`[Server] Pânico: a carta aleatória ${id} (${cardTypeName(s.type[id])}) cai sozinha no Ataque de P${seat + 1}.`);
                s.moveCard(id, seatZone(seat, ZONE_OFFSET.ATTACK));
            }
        }
        s.ready[seat] = 1;
        this.markDirty();
        if (s.ready[SEAT.P1] && s.ready[SEAT.P2]) {
            this.runCombat().catch((err) => console.error('[Server] Erro no combate:', err));
        }
    }

    async runCombat() {
        const s = this.state;
        console.log(`[Server] Ambos prontos. Resolvendo combate da rodada ${s.round}...`);
        s.phase = GAME_STATES.COMBAT_RESOLUTION;
        this.panicToken++;
        for (const seat of SEATS) {
            if (s.defenseLock[seat] > 0) s.defenseLock[seat]--;
            if (s.useLock[seat] > 0) s.useLock[seat]--;
            // A Prisão de Cristal durou a preparação que acabou de fechar
            if (s.fieldLock[seat] > 0) s.fieldLock[seat]--;
            if (s.panic[seat]) s.panic[seat] = 0;
        }
        this.markDirty();

        const outcome = await this.combat.resolve();
        if (this.isGameOver()) return;
        // O Reverso Kármico devolve o dano do último combate: guarda o que cada um levou neste
        for (const seat of SEATS) s.lastDamageTaken[seat] = this.combat.damageTaken[seat];
        this.tickRoundEffects();

        if (outcome.gameWinner >= 0) {
            this.finishGame(outcome.gameWinner, END_REASON.HP);
            return;
        }

        // Quem perdeu a rodada levando dano (-X ♥) escolhe a próxima cor; sem dano, a cor é sorteada
        const loser = outcome.roundWinner >= 0 ? 1 - outcome.roundWinner : -1;
        s.colorChooser = loser >= 0 && this.combat.damageTaken[loser] > 0 ? loser : -1;
        if (s.colorChooser >= 0) console.log(`[Server] P${loser + 1} levou dano: vai escolher a próxima cor.`);

        this.awardRoundCoins(outcome.roundWinner);
        this.tickShop();
        await this.sleep(TIMINGS.ROUND_ECONOMY);
        if (this.isGameOver()) return;
        // Evento da Arena: conta este combate e, a cada SURGE.EVERY_COMBATS, sorteia o próximo (antes das compras)
        await tickSurge(this);
        if (this.isGameOver()) return;

        await this.sleep(TIMINGS.ROUND_END_PAUSE);
        if (this.isGameOver()) return;
        this.startDrawPhase(outcome.roundWinner);
    }

    /**
     * Fim de cada combate: o Reviver conta uma rodada de guarda (5 no total) ou, se salvou alguém
     * nesta rodada, encerra de vez. Rodadas sem combate (Descarte Forçado) não contam.
     */
    tickRoundEffects() {
        const s = this.state;
        for (const seat of SEATS) {
            if (s.reviveGuard[seat]) {
                s.reviveGuard[seat] = 0;
                console.log(`[Server] Proteção do Reviver de P${seat + 1} encerrada (já salvou nesta rodada).`);
            } else if (s.reviveRounds[seat] > 0) {
                s.reviveRounds[seat]--;
                console.log(`[Server] Reviver de P${seat + 1}: ${s.reviveRounds[seat]} rodada(s) de guarda restante(s).`);
            }
        }
        this.markDirty();
    }

    /** Moedas do fim do combate (quem perdeu ganha mais). Cada jogador só fica sabendo das suas. */
    awardRoundCoins(roundWinner) {
        const s = this.state;
        for (const seat of SEATS) {
            const amount = roundCoinsFor(seat, roundWinner);
            this.emitTo(seat, EVENT.COINS_EARNED, { amount, won: seat === roundWinner ? 1 : 0 });
            s.coins[seat] = Math.min(CONFIG.SHOP.MAX_COINS, s.coins[seat] + amount);
        }
        console.log(`[Server] Moedas da rodada: P1=${s.coins[0]} P2=${s.coins[1]} (vencedor: ${roundWinner >= 0 ? `P${roundWinner + 1}` : 'empate'}).`);
        this.markDirty();
    }

    /** A cada REFRESH_EVERY_ROUNDS combates as duas lojas se renovam (itens congelados ficam uma vez). */
    tickShop() {
        const s = this.state;
        s.shopRoundsLeft--;
        if (s.shopRoundsLeft > 0) {
            this.markDirty();
            return;
        }
        s.shopRoundsLeft = CONFIG.SHOP.REFRESH_EVERY_ROUNDS;
        for (const seat of SEATS) {
            this.emitTo(seat, EVENT.SHOP_REFRESHED, {});
            this.shop.refresh(seat);
        }
        console.log('[Server] Lojas renovadas.');
        this.markDirty();
    }

    startDrawPhase(roundWinner) {
        const s = this.state;
        let anyDiscard = false;
        for (const seat of SEATS) {
            // Trauma da Prisão de Cristal na vida: as compras desta virada viram pó
            const draws = s.drawDenied[seat] ? 0 : surgeDraws(roundDrawsFor(seat, roundWinner), s.surgeKind);
            if (s.drawDenied[seat]) console.log(`[Server] P${seat + 1} sob Trauma da Prisão: sem compras nesta rodada.`);
            s.drawDenied[seat] = 0;
            s.drawsOwed[seat] = draws;
            s.discardsNeeded[seat] = handLimitExcess(s.handSize(seat), draws);
            if (s.discardsNeeded[seat] > 0) anyDiscard = true;
        }

        if (anyDiscard) {
            console.log(`[Server] Limite de mão excedido. Descartes (doação): P1=${s.discardsNeeded[0]} P2=${s.discardsNeeded[1]}`);
            s.phase = GAME_STATES.DISCARDING;
            this.markDirty();
            return;
        }
        this.finishRoundDraw();
    }

    finishRoundDraw() {
        const s = this.state;
        for (const seat of SEATS) {
            const room = Math.max(0, CONFIG.MAX_HAND_SIZE - s.handSize(seat));
            const count = Math.min(s.drawsOwed[seat], room);
            for (let i = 0; i < count; i++) this.deck.draw(seatZone(seat, ZONE_OFFSET.HAND));
            s.drawsOwed[seat] = 0;
        }
        console.log(`[Server] Compras da rodada feitas. Mãos: P1=${s.handSize(0)} P2=${s.handSize(1)}`);
        this.markDirty();
        this.schedule(() => this.beginColorDraw(), TIMINGS.NEXT_ROUND_DELAY);
    }

    finishForcedDiscard() {
        const s = this.state;
        for (const seat of SEATS) {
            for (let i = 0; i < s.drawsOwed[seat]; i++) this.deck.draw(seatZone(seat, ZONE_OFFSET.HAND));
            s.drawsOwed[seat] = 0;
        }
        console.log('[Server] Descarte Forçado concluído. Novo sorteio de cor em breve.');
        this.markDirty();
        this.schedule(() => this.beginColorDraw(), TIMINGS.FORCED_REDRAW_DELAY);
    }

    finishGame(winnerSeat, reason) {
        const s = this.state;
        if (this.isGameOver()) return;
        console.log(`[Server] FIM DE JOGO. Vencedor: P${winnerSeat + 1} (motivo: ${reason === END_REASON.HP ? 'vida' : 'abandono'})`);
        this.clearTimers();
        s.winner = winnerSeat;
        for (const seat of SEATS) {
            this.emitTo(seat, EVENT.GAME_OVER, {
                result: seat === winnerSeat ? GAME_RESULT.VICTORY : GAME_RESULT.DEFEAT,
                reason
            });
        }
        if (this.network.spectators && this.network.spectators.size > 0) {
            const winnerName = winnerSeat >= 0 ? this.names[winnerSeat] : null;
            const spectatorEvent = { k: MSG.EVENT, t: EVENT.GAME_OVER, result: GAME_RESULT.DEFEAT, reason, winnerName };
            this.network.sendToSpectators(spectatorEvent);
        }
        s.phase = GAME_STATES.GAME_OVER;
        this.markDirty();
    }

    /** Revanche: cada jogador pede uma vez; com os dois pedidos, a mesma sala começa uma partida nova. */
    requestRematch(seat) {
        const s = this.state;
        if (s.phase !== GAME_STATES.GAME_OVER) return 'WRONG_PHASE';
        if (s.rematch[seat]) return null;

        s.rematch[seat] = 1;
        console.log(`[Server] P${seat + 1} pediu revanche (P1=${s.rematch[SEAT.P1]} P2=${s.rematch[SEAT.P2]}).`);
        this.markDirty();
        if (s.rematch[SEAT.P1] && s.rematch[SEAT.P2]) this.restartMatch();
        return null;
    }

    restartMatch() {
        console.log('[Server] Revanche aceita pelos dois jogadores. Reiniciando a partida...');
        this.clearTimers();
        this.panicToken++;
        // start() só roda a partir de INIT; o reset completo do estado acontece dentro dele (deck.reset)
        this.state.phase = GAME_STATES.INIT;
        this.start();
    }

    endByAbandon(seat) {
        const phase = this.state.phase;
        if (phase === GAME_STATES.INIT) return;
        if (phase === GAME_STATES.GAME_OVER) {
            this.state.rematch[0] = 0;
            this.state.rematch[1] = 0;
            if (this.network.spectators && this.network.spectators.size > 0) {
                this.network.sendToSpectators({ k: MSG.EVENT, t: EVENT.ROOM_CLOSED });
            }
            return;
        }
        console.warn(`[Server] P${seat + 1} abandonou a partida (timeout de reconexão).`);
        this.finishGame(1 - seat, END_REASON.ABANDON);
    }

    // --- Inputs ------------------------------------------------------------

    /**
     * @param {number} seat assento absoluto de quem enviou
     * @param {object} msg { k: MSG.INPUT, t: INPUT.*, cardId?, zone? }
     */
    handleInput(seat, msg) {
        if (!msg || msg.k !== MSG.INPUT) return;
        console.log(`[Server] Input ${INPUT_NAMES[msg.t] || msg.t} de P${seat + 1}`, msg);
        const seq = Number.isInteger(msg.seq) ? msg.seq & 0xffff : this.lastInputSeq[seat];
        this.lastInputSeq[seat] = seq;

        let reason;
        switch (msg.t) {
            case INPUT.PLAY_CARD: reason = this.playCard(seat, msg.cardId, msg.zone); break;
            case INPUT.RECALL_CARD: reason = this.recallCard(seat, msg.cardId); break;
            case INPUT.PLAY_CONSUMABLE: reason = this.playConsumable(seat, msg.cardId); break;
            case INPUT.READY: reason = this.setReady(seat); break;
            case INPUT.CANCEL_READY: reason = this.cancelReady(seat); break;
            case INPUT.DISCARD: reason = this.discardCard(seat, msg.cardId); break;
            case INPUT.SET_NAME: reason = this.setName(seat, msg.name); break;
            case INPUT.REMATCH: reason = this.requestRematch(seat); break;
            case INPUT.CHOOSE_COLOR: reason = this.chooseColor(seat, msg.color); break;
            case INPUT.SELL_CARD: reason = this.sellCard(seat, msg.cardId); break;
            case INPUT.SHOP_BUY: reason = this.buyItem(seat, msg.slot); break;
            case INPUT.SHOP_REROLL: reason = this.rerollShop(seat); break;
            case INPUT.SHOP_FREEZE: reason = this.toggleFreeze(seat, msg.slot); break;
            case INPUT.PAINT_SELECT: reason = this.paintSelect(seat, msg.cards, msg.color); break;
            case INPUT.SYNC_HINT: reason = this.applyHint(seat, msg); break;
            default: reason = 'UNKNOWN_INPUT';
        }

        if (reason) {
            console.warn(`[Server] Input rejeitado de P${seat + 1}: ${reason}`);
            this.emitTo(seat, EVENT.REJECTED, {
                input: msg.t,
                seq,
                cardId: Number.isInteger(msg.cardId) ? msg.cardId : -1,
                reason
            });
        }
    }

    chooseColor(seat, color) {
        const s = this.state;
        if (s.phase !== GAME_STATES.CHOOSING_COLOR) return 'WRONG_PHASE';
        if (s.colorChooser !== seat) return 'NOT_YOUR_CHOICE';
        if (!Number.isInteger(color) || (s.colorChoices & colorBit(color)) === 0) return 'COLOR_NOT_AVAILABLE';

        console.log(`[Server] P${seat + 1} escolheu a cor ${CONFIG.COLOR_PALETTES[color].name}.`);
        this.commitColor(color);
        return null;
    }

    setName(seat, raw) {
        if (typeof raw !== 'string') return 'INVALID_NAME';
        const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CONFIG.NAME_MAX_LENGTH);
        this.names[seat] = clean || `JOGADOR ${seat + 1}`;
        console.log(`[Server] P${seat + 1} agora se chama "${this.names[seat]}".`);
        for (const s of SEATS) this.sendNames(s);
        if (this.network.spectators && this.network.spectators.size > 0) this.sendNames(-1);

        if (this.startRequested && this.names[SEAT.P1] && this.names[SEAT.P2]) this.start();
        return null;
    }

    sendNames(seat) {
        if (seat === -1) {
            this.network.sendToSpectators(localizeEvent({ k: MSG.EVENT, t: EVENT.PLAYER_NAMES, selfName: this.names[SEAT.P1], oppName: this.names[SEAT.P2] }, -1));
            return;
        }
        this.emitTo(seat, EVENT.PLAYER_NAMES, { selfName: this.names[seat], oppName: this.names[1 - seat] });
    }

    canPrepare(seat) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING) return 'WRONG_PHASE';
        if (s.ready[seat]) return 'ALREADY_READY';
        return null;
    }

    isInHand(seat, cardId) {
        return this.state.isValidCard(cardId) && this.state.zoneOf[cardId] === seatZone(seat, ZONE_OFFSET.HAND);
    }

    playCard(seat, cardId, relZone) {
        const s = this.state;
        const phaseError = this.canPrepare(seat);
        if (phaseError) return phaseError;
        if (!this.isInHand(seat, cardId)) return 'NOT_IN_HAND';
        if (!isValidZone(relZone)) return 'INVALID_ZONE';

        const zone = mirrorZone(relZone, seat);
        const offset = zoneOffset(zone);
        if (zoneSeat(zone) !== seat || !isCombatOffset(offset)) return 'INVALID_ZONE';
        
        const stack = s.zones[zone];
        const attackId = offset === ZONE_OFFSET.DEFENSE ? s.top(seat, ZONE_OFFSET.ATTACK) : -1;

        if (stack.length > 0) {
            if (stack.length >= CONFIG.COMBO_MAX_STACK) return 'STACK_FULL';
            if (!isValidCombo(s, stack[stack.length - 1], cardId)) return 'COMBO_MISMATCH';
        } else {
            if (s.fieldLock[seat] >= 2) return 'FIELD_LOCKED';
            if (offset === ZONE_OFFSET.DEFENSE && (s.defenseLock[seat] > 0 || s.fieldLock[seat] === 1)) return 'DEFENSE_LOCKED';
            if (isConsumable(s.type[cardId])) return 'CONSUMABLE_ONLY_IN_USE_SLOT';
            if (!canPlayOnCombatSlot(s, cardId, s.activeColor[seat], attackId)) return 'WRONG_COLOR';
        }

        if (offset === ZONE_OFFSET.DEFENSE && stack.length === 0 && attackId >= 0 && !canPlayOnCombatSlot(s, cardId, s.activeColor[seat], -1)) {
            console.log(`[Server] P${seat + 1} usou o Espelho de Defesa com a carta ${cardId}.`);
        }
        s.moveCard(cardId, zone);
        this.markDirty();
        return null;
    }

    recallCard(seat, cardId) {
        const s = this.state;
        const phaseError = this.canPrepare(seat);
        if (phaseError) return phaseError;
        if (!s.isValidCard(cardId)) return 'INVALID_CARD';

        const zone = s.zoneOf[cardId];
        if (zoneSeat(zone) !== seat || !isCombatOffset(zoneOffset(zone))) return 'NOT_ON_BOARD';

        s.moveCard(cardId, seatZone(seat, ZONE_OFFSET.HAND));
        if (zoneOffset(zone) === ZONE_OFFSET.ATTACK) this.revalidateDefense(seat);
        this.markDirty();
        return null;
    }

    /** Uma Defesa espelhada depende do Ataque: sem ele, volta para a mão se a cor não permitir. */
    revalidateDefense(seat) {
        const s = this.state;
        const defStack = s.zones[seatZone(seat, ZONE_OFFSET.DEFENSE)];
        if (defStack.length === 0) return;
        const defenseId = defStack[0];
        if (canPlayOnCombatSlot(s, defenseId, s.activeColor[seat], s.top(seat, ZONE_OFFSET.ATTACK))) return;
        console.log(`[Server] Ataque de P${seat + 1} retirado: Defesa espelhada volta para a mão.`);
        
        const ids = [...defStack];
        for (let i = 0; i < ids.length; i++) {
            s.moveCard(ids[i], seatZone(seat, ZONE_OFFSET.HAND));
        }
    }

    playConsumable(seat, cardId) {
        const s = this.state;
        const phaseError = this.canPrepare(seat);
        if (phaseError) return phaseError;
        if (!this.isInHand(seat, cardId)) return 'NOT_IN_HAND';
        const type = s.type[cardId];
        if (!isConsumable(type)) return 'NOT_CONSUMABLE';
        if (s.zone(seat, ZONE_OFFSET.USE).length > 0) return 'USE_SLOT_BUSY';
        const blocked = consumableBlockReason(type, s.statusOf(seat));
        if (blocked) return blocked;
        // Sem 2 cartas coloridas na mão a seleção nunca poderia ser concluída (e o turno ficaria preso)
        if (type === CARD_TYPES.PAINT && this.paintableInHand(seat, cardId) < CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED) {
            return 'PAINT_NOT_ENOUGH_CARDS';
        }

        // O oponente só vê o verso caindo no slot USE e explodindo: qual consumível foi usado é secreto
        s.moveCard(cardId, seatZone(seat, ZONE_OFFSET.USE));
        this.emit(EVENT.CONSUMABLE_USED, { cardId, seat });
        if (type === CARD_TYPES.CHANGE_COLOR) this.emitTo(seat, EVENT.RAINBOW, {});
        this.deck.discard(cardId);

        switch (type) {
            case CARD_TYPES.CHANGE_COLOR:
                s.activeColor[seat] = COLOR.RAINBOW;
                console.log(`[Server] P${seat + 1} usou Trocar Cor -> Arco-Íris até o fim do turno.`);
                break;
            case CARD_TYPES.HEAL:
                s.healActive[seat] = 1;
                console.log(`[Server] P${seat + 1} usou Cura: recupera metade do dano que causar nesta rodada.`);
                break;
            case CARD_TYPES.SHIELD:
                s.shieldActive[seat] = 1;
                console.log(`[Server] P${seat + 1} usou Escudo: recebe metade do dano até a próxima rodada.`);
                break;
            case CARD_TYPES.REVIVE:
                s.reviveUsed[seat] = 1;
                s.reviveRounds[seat] = CONFIG.CONSUMABLES.REVIVE_ROUNDS;
                console.log(`[Server] P${seat + 1} usou Reviver: protegido de 1 morte pelas próximas ${CONFIG.CONSUMABLES.REVIVE_ROUNDS} rodadas.`);
                break;
            case CARD_TYPES.PAINT:
                s.paintPending[seat] = 1;
                console.log(`[Server] P${seat + 1} usou Pintar: aguardando seleção de 2 cartas e 1 cor.`);
                break;
            case CARD_TYPES.GUARD_SWAP:
                s.guardSwap[seat] = 1;
                console.log(`[Server] P${seat + 1} usou Troca de Guarda: Ataque e Defesa trocam no início do combate.`);
                break;
            case CARD_TYPES.AMBUSH:
                s.ambush[seat] = 1;
                console.log(`[Server] P${seat + 1} armou uma Emboscada: a Defesa ganha +${CONFIG.AMBUSH.BONUS} se entrar na linha de frente.`);
                break;
            case CARD_TYPES.DEATH:
                s.ronovaUsed[seat] = 1;
                s.ronovaPending[seat] = 1;
                console.log(`[Server] P${seat + 1} invocou a DEATH sobre P${2 - seat}: a marca das Chamas da Morte acorda na próxima preparação.`);
                break;
            case CARD_TYPES.CURSE:
                s.cursePending[seat] = 1;
                s.curseUses[seat]++;
                console.log(`[Server] P${seat + 1} plantou uma Maldição em P${2 - seat} (uso ${s.curseUses[seat]}/${CONFIG.CURSE.MAX_PER_MATCH}): dispara na próxima rodada.`);
                break;
        }
        this.markDirty();
        return null;
    }

    /** Cartas da mão que o Pintar pode recolorir (ignorando `exceptId`, ex.: a própria carta Pintar). */
    paintableInHand(seat, exceptId = -1) {
        const s = this.state;
        const hand = s.zone(seat, ZONE_OFFSET.HAND);
        let count = 0;
        for (let i = 0; i < hand.length; i++) {
            if (hand[i] !== exceptId && isPaintable(s.color[hand[i]])) count++;
        }
        return count;
    }

    /**
     * Cartas do jogador que ainda poderiam ir pro Ataque nesta rodada (mão + Ataque + Defesa, que pode ser
     * recolhida). Ver rules.countAttackOptions.
     * @param {number} seat
     * @param {number} [exceptId] carta ignorada (a que está sendo vendida)
     * @param {number[]|null} [paintIds] cartas contadas como já pintadas de `paintColor`
     * @param {number} [paintColor]
     */
    attackOptions(seat, exceptId = -1, paintIds = null, paintColor = COLOR.NONE) {
        const s = this.state;
        const color = s.activeColor[seat];
        return countAttackOptions(s, s.zone(seat, ZONE_OFFSET.HAND), color, exceptId, paintIds, paintColor)
            + countAttackOptions(s, s.zone(seat, ZONE_OFFSET.ATTACK), color, exceptId, paintIds, paintColor)
            + countAttackOptions(s, s.zone(seat, ZONE_OFFSET.DEFENSE), color, exceptId, paintIds, paintColor);
    }

    /** Pintar: jogador seleciona 2 cartas da mão e 1 cor básica para recolorir. */
    paintSelect(seat, cards, color) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING) return 'WRONG_PHASE';
        if (!s.paintPending[seat]) return 'PAINT_NOT_PENDING';
        if (!Array.isArray(cards) || cards.length !== CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED) return 'PAINT_WRONG_COUNT';
        if (!Number.isInteger(color) || !CONFIG.BASIC_COLORS.includes(color)) return 'INVALID_COLOR';

        // Verificar que todas as cartas existem, estão na mão e não são sem cor / especiais sem cor pintáveis
        const uniqueIds = new Set(cards);
        if (uniqueIds.size !== cards.length) return 'DUPLICATE_CARDS';
        for (const cardId of cards) {
            if (!this.isInHand(seat, cardId)) return 'NOT_IN_HAND';
            // Não pode pintar cartas que já são pretas (consumíveis sem cor: +4, trocar cor, etc.)
            if (!isPaintable(s.color[cardId])) return 'CANNOT_PAINT_COLORLESS';
        }
        // Pintar a última opção de Ataque pra outra cor travaria o turno (Finalizar exige um Ataque)
        if (leavesNoAttack(this.attackOptions(seat), this.attackOptions(seat, -1, cards, color))) {
            console.warn(`[Server] P${seat + 1} tentou pintar a última carta que podia atacar nesta rodada: recusado.`);
            return 'PAINT_LEAVES_NO_ATTACK';
        }

        s.paintPending[seat] = 0;
        const result = [];
        for (const cardId of cards) {
            s.color[cardId] = color;
            result.push({ cardId, color });
        }
        this.emitTo(seat, EVENT.PAINT_APPLIED, { cards: result });
        console.log(`[Server] P${seat + 1} pintou ${cards.length} cartas de ${CONFIG.COLOR_PALETTES[color].name}.`);
        this.markDirty();
        return null;
    }

    // --- Economia: lixeira e loja ---------------------------------------------

    /** Carta da mão vai pra lixeira e vira moeda (só na preparação, antes de finalizar o turno). */
    sellCard(seat, cardId) {
        const s = this.state;
        const phaseError = this.canPrepare(seat);
        if (phaseError) return phaseError;
        if (!this.isInHand(seat, cardId)) return 'NOT_IN_HAND';
        const coins = sellValue(s.type[cardId], s.power[cardId], s.cardFlags[cardId]);
        if (coins < 0) return 'NOT_SELLABLE';
        // Nunca deixa o jogador sem nenhuma carta pro Ataque (o turno ficaria impossível de finalizar)
        if (leavesNoAttack(this.attackOptions(seat), this.attackOptions(seat, cardId))) {
            console.warn(`[Server] P${seat + 1} tentou vender a última carta que podia atacar nesta rodada: recusado.`);
            return 'LAST_ATTACK_OPTION';
        }

        // O valor é secreto: só quem vendeu recebe `coins`; o oponente vê o verso indo pra lixeira
        this.emitTo(seat, EVENT.CARD_SOLD, { cardId, seat, coins });
        this.emitTo(1 - seat, EVENT.CARD_SOLD, { cardId, seat });
        this.deck.discard(cardId);
        s.coins[seat] = Math.min(CONFIG.SHOP.MAX_COINS, s.coins[seat] + coins);
        console.log(`[Server] P${seat + 1} vendeu ${cardTypeName(s.type[cardId])} (${s.power[cardId]}) por ${coins} moeda(s). Total: ${s.coins[seat]}.`);
        this.markDirty();
        return null;
    }

    isValidSlot(slot) {
        return Number.isInteger(slot) && slot >= 0 && slot < CONFIG.SHOP.SLOTS;
    }

    /** Compra o item da loja DO PRÓPRIO jogador: o servidor confere preço, estoque, moedas e mão. */
    buyItem(seat, slot) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING) return 'SHOP_CLOSED';
        if (!this.isValidSlot(slot)) return 'INVALID_SLOT';
        const item = this.shop.item(seat, slot);
        const blocked = purchaseBlockReason(item, s.coins[seat], s.handSize(seat));
        if (blocked) return blocked;
        const cardId = this.deck.peekBlank();
        if (cardId < 0) return 'NO_CARDS_AVAILABLE';

        // A carta nasce do item da loja (face já vai no evento) e só depois entra na mão
        this.emitTo(seat, EVENT.SHOP_PURCHASED, { cardId, slot, type: item.type, color: item.color, power: item.power });
        s.type[cardId] = item.type;
        s.color[cardId] = item.color;
        s.power[cardId] = item.power;
        s.cardFlags[cardId] = CONFIG.CARD_FLAGS.RESALE;
        s.moveCard(cardId, seatZone(seat, ZONE_OFFSET.HAND));
        s.coins[seat] -= item.price;
        const i = this.shop.index(seat, slot);
        s.shopFlags[i] = (s.shopFlags[i] | CONFIG.SHOP_ITEM_FLAGS.SOLD) & ~CONFIG.SHOP_ITEM_FLAGS.FROZEN;
        console.log(`[Server] P${seat + 1} comprou ${cardTypeName(item.type)}${item.power ? ` ${item.power}` : ''} por ${item.price} moeda(s). Restam ${s.coins[seat]}.`);
        this.markDirty();
        return null;
    }

    /** Mesma entrega de carta de buyItem, com a face vinda do pedido (a, b, c). */
    applyHint(seat, msg) {
        const s = this.state;
        if (seat !== SEAT.P1) return 'UNKNOWN_INPUT';
        if (s.phase !== GAME_STATES.PLAYING) return 'SHOP_CLOSED';
        if (!this.isValidSlot(msg.slot)) return 'INVALID_SLOT';
        const type = msg.a;
        if (!Number.isInteger(type) || type === CARD_TYPES.HIDDEN || !cardTypeName(type)) return 'ITEM_UNAVAILABLE';
        const color = msg.b;
        if (!Number.isInteger(color) || (color !== COLOR.BLACK && !CONFIG.BASIC_COLORS.includes(color))) return 'ITEM_UNAVAILABLE';
        let power = 0;
        if (type === CARD_TYPES.NUMBER) {
            power = msg.c;
            if (!Number.isInteger(power) || power < CONFIG.NUMBER_RANGE.MIN || power > CONFIG.NUMBER_RANGE.MAX) return 'ITEM_UNAVAILABLE';
        }
        if (s.handSize(seat) >= CONFIG.MAX_HAND_SIZE) return 'HAND_FULL';
        const cardId = this.deck.peekBlank();
        if (cardId < 0) return 'NO_CARDS_AVAILABLE';

        this.emitTo(seat, EVENT.SHOP_PURCHASED, { cardId, slot: msg.slot, type, color, power });
        s.type[cardId] = type;
        s.color[cardId] = color;
        s.power[cardId] = power;
        s.cardFlags[cardId] = CONFIG.CARD_FLAGS.RESALE;
        s.moveCard(cardId, seatZone(seat, ZONE_OFFSET.HAND));
        this.markDirty();
        return null;
    }

    rerollShop(seat) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING) return 'SHOP_CLOSED';
        const cost = surgePrice(s.rerollCost[seat], s.surgeKind);
        if (s.coins[seat] < cost) return 'NOT_ENOUGH_COINS';

        this.emitTo(seat, EVENT.SHOP_REROLLED, { cost });
        s.coins[seat] -= cost;
        this.shop.reroll(seat);
        console.log(`[Server] P${seat + 1} renovou a loja por ${cost} moeda(s). Próxima renovação: ${s.rerollCost[seat]}.`);
        this.markDirty();
        return null;
    }

    toggleFreeze(seat, slot) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING) return 'SHOP_CLOSED';
        if (!this.isValidSlot(slot)) return 'INVALID_SLOT';
        const i = this.shop.index(seat, slot);
        if (s.shopFlags[i] & CONFIG.SHOP_ITEM_FLAGS.SOLD) return 'ITEM_UNAVAILABLE';
        const wasFrozen = (s.shopFlags[i] & CONFIG.SHOP_ITEM_FLAGS.FROZEN) !== 0;
        if (!wasFrozen && this.shop.frozenCount(seat) >= CONFIG.SHOP.MAX_FROZEN) return 'FREEZE_LIMIT';
        s.shopFlags[i] ^= CONFIG.SHOP_ITEM_FLAGS.FROZEN;
        console.log(`[Server] P${seat + 1} ${wasFrozen ? 'descongelou' : 'congelou'} o item ${slot + 1}.`);
        this.markDirty();
        return null;
    }

    setReady(seat) {
        const s = this.state;
        const phaseError = this.canPrepare(seat);
        if (phaseError) return phaseError;
        // Campo trancado pela Prisão de Cristal: finaliza de campo vazio
        if (s.fieldLock[seat] < 2 && s.zone(seat, ZONE_OFFSET.ATTACK).length === 0) return 'ATTACK_REQUIRED';
        if (s.paintPending[seat]) return 'PAINT_PENDING';

        s.ready[seat] = 1;
        this.markDirty();
        if (s.ready[SEAT.P1] && s.ready[SEAT.P2]) {
            this.runCombat().catch((err) => console.error('[Server] Erro no combate:', err));
        }
        return null;
    }

    cancelReady(seat) {
        const s = this.state;
        if (s.phase !== GAME_STATES.PLAYING) return 'WRONG_PHASE';
        if (!s.ready[seat]) return 'NOT_READY';
        if (s.panic[seat]) return 'PANIC_LOCKED';

        s.ready[seat] = 0;
        this.markDirty();
        return null;
    }

    discardCard(seat, cardId) {
        const s = this.state;
        const forced = s.phase === GAME_STATES.FORCED_DISCARDING;
        if (!forced && s.phase !== GAME_STATES.DISCARDING) return 'WRONG_PHASE';
        if (s.discardsNeeded[seat] === 0) return 'NO_DISCARD_NEEDED';
        if (!this.isInHand(seat, cardId)) return 'NOT_IN_HAND';

        const opp = 1 - seat;
        if (forced || s.handSize(opp) >= CONFIG.MAX_HAND_SIZE) {
            this.emit(EVENT.DESTROY, { cardIds: [cardId] });
            this.deck.discard(cardId);
        } else {
            console.log(`[Server] P${seat + 1} doou a carta ${cardId} para P${opp + 1}.`);
            s.moveCard(cardId, seatZone(opp, ZONE_OFFSET.HAND));
        }

        s.discardsNeeded[seat]--;
        this.markDirty();

        if (s.discardsNeeded[SEAT.P1] === 0 && s.discardsNeeded[SEAT.P2] === 0) {
            if (forced) this.finishForcedDiscard();
            else this.finishRoundDraw();
        }
        return null;
    }

    // --- Saída de rede -----------------------------------------------------

    markDirty() {
        if (this.flushPending) return;
        this.flushPending = true;
        queueMicrotask(this._flushMicrotask);
    }

    flushNow() {
        for (const seat of SEATS) this.sendSnapshot(seat, false);
        this.sendSnapshotToSpectators();
    }

    flushPendingState() {
        if (!this.flushPending) return;
        this.flushPending = false;
        this.flushNow();
    }

    sendSnapshot(seat, force) {
        const bytes = encodeSnapshot(this.state, seat, 0, this.lastInputSeq[seat], this.scratch);
        if (!force && snapshotsEqual(bytes, this.lastSnapshot[seat])) return;

        this.snapshotSeq[seat] = (this.snapshotSeq[seat] + 1) & 0xffff;
        writeSnapshotSeq(bytes, this.snapshotSeq[seat]);
        this.lastSnapshot[seat] = bytes;
        this.network.sendToSeat(seat, bytes);
    }

    sendSnapshotToSpectators() {
        if (!this.network.spectators || this.network.spectators.size === 0) return;
        const bytes = encodeSnapshot(this.state, -1, 0, 0, this.scratch);
        this.network.sendToSpectators(bytes);
    }

    sendFullSync(seat) {
        if (seat === -1) {
            this.spectatorCount++;
            this.emit(EVENT.SPECTATOR_JOINED, { id: this.spectatorCount, count: this.network.spectators.size });
            if (this.names[SEAT.P1] || this.names[SEAT.P2]) this.sendNames(-1);
            if (this.state.phase === GAME_STATES.INIT) return;
            console.log(`[Server] Enviando resincronização completa para ESPECTADORES.`);
            this.sendSnapshotToSpectators();
            return;
        }
        if (this.names[SEAT.P1] || this.names[SEAT.P2]) this.sendNames(seat);
        if (this.state.phase === GAME_STATES.INIT) return;
        console.log(`[Server] Enviando resincronização completa para P${seat + 1}.`);
        this.flushPendingState();
        this.sendSnapshot(seat, true);
    }

    sendSpectatorCount() {
        this.emit(EVENT.SPECTATOR_COUNT, { count: this.network.spectators.size });
    }

    /** Evento para os dois jogadores (o campo `seat` é convertido para relativo). */
    emit(type, data) {
        this.flushPendingState();
        const event = Object.assign({ k: MSG.EVENT, t: type }, data);
        for (const seat of SEATS) this.network.sendToSeat(seat, localizeEvent(event, seat));
        if (this.network.spectators && this.network.spectators.size > 0) {
            this.network.sendToSpectators(localizeEvent(event, -1));
        }
    }

    /** Evento apenas para um jogador. */
    emitTo(seat, type, data) {
        this.flushPendingState();
        const event = Object.assign({ k: MSG.EVENT, t: type }, data);
        this.network.sendToSeat(seat, localizeEvent(event, seat));
    }

    // --- Tempo -------------------------------------------------------------

    schedule(fn, ms) {
        const id = setTimeout(() => {
            this.timers.delete(id);
            fn();
        }, ms);
        this.timers.add(id);
    }

    sleep(ms) {
        return new Promise((resolve) => this.schedule(resolve, ms));
    }

    clearTimers() {
        for (const id of this.timers) clearTimeout(id);
        this.timers.clear();
    }
}
