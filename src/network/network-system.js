import { CONFIG } from '../config/constants.js';
import { MSG, isBinaryMessage } from './protocol.js';

export const ROLE = Object.freeze({ NONE: 'NONE', HOST: 'HOST', CLIENT: 'CLIENT', SPECTATOR: 'SPECTATOR' });

export const NET_STATUS = Object.freeze({
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    WAITING_OPPONENT: 'WAITING_OPPONENT',
    CONNECTED: 'CONNECTED',
    UNSTABLE: 'UNSTABLE',
    OPPONENT_DISCONNECTED: 'OPPONENT_DISCONNECTED',
    RECONNECTING: 'RECONNECTING',
    LOST: 'LOST',
    ROOM_FULL: 'ROOM_FULL',
    ERROR: 'ERROR'
});

export const NET_EVENT = Object.freeze({
    INPUT: 'INPUT',                     // host: (seat, inputMessage)
    SERVER_MESSAGE: 'SERVER_MESSAGE',   // cliente: (snapshotBytes | eventObject)
    SEAT_CONNECTED: 'SEAT_CONNECTED',   // host: (seat, isFirstTime)
    SEAT_LOST: 'SEAT_LOST',             // host: (seat) após o tempo de graça de reconexão
    JOINED: 'JOINED',                   // cliente: aceito pelo host pela 1ª vez
    JOINED_SPECTATOR: 'JOINED_SPECTATOR',// cliente: aceito como espectador
    SPECTATOR_LEFT: 'SPECTATOR_LEFT',   // host: espectador desconectou
    STATUS: 'STATUS'                    // ambos: (NET_STATUS)
});

const HOST_SEAT = 0;
const REMOTE_SEAT = 1;

/**
 * NetworkSystem - camada de sessão sobre qualquer NetworkAdapter.
 *
 * Host: é ao mesmo tempo servidor e o cliente do assento 0 (entregas locais via microtask,
 * sem atalhos: o cliente local recebe exatamente as mesmas mensagens que o remoto).
 * O assento 1 é preso a um token enviado no HELLO, o que permite reconectar pelo mesmo link
 * (inclusive após recarregar a página) e recusar um terceiro jogador.
 */
export class NetworkSystem {
    constructor() {
        this.adapter = null;
        this.role = ROLE.NONE;
        this.roomId = null;
        this.status = NET_STATUS.IDLE;

        this.remotePeer = null;
        this.seatToken = null;
        this.spectators = new Set();
        this.clientToken = null;
        this.hasJoined = false;
        // Nunca volta a false: distingue "ainda não conectou nenhuma vez" (erro de handshake é
        // só ruído, o adapter tenta de novo sozinho) de "conexão real quebrou depois de existir"
        // (erro de verdade, precisa virar status terminal).
        this.everConnected = false;

        this.listeners = {};
        for (const key in NET_EVENT) this.listeners[NET_EVENT[key]] = [];
        this.pendingServerMessages = [];

        this.graceTimer = null;
        this.heartbeatTimer = null;
        this.missedPings = 0;
    }

    // --- Pub/Sub -----------------------------------------------------------

    on(topic, callback) {
        this.listeners[topic].push(callback);
        if (topic === NET_EVENT.SERVER_MESSAGE && this.pendingServerMessages.length > 0) {
            const pending = this.pendingServerMessages;
            this.pendingServerMessages = [];
            for (const msg of pending) this.dispatchServerMessage(msg);
        }
    }

    emit(topic, a, b) {
        const list = this.listeners[topic];
        for (let i = 0; i < list.length; i++) {
            try {
                list[i](a, b);
            } catch (err) {
                console.error(`[NetworkSystem] Erro no listener de ${topic}:`, err);
            }
        }
    }

    setStatus(status) {
        if (this.status === status) return;
        console.log(`[NetworkSystem] Status: ${this.status} -> ${status}`);
        this.status = status;
        this.emit(NET_EVENT.STATUS, status);
    }

    // --- Início de sessão --------------------------------------------------

    /**
     * @param {import('./network-adapter.js').NetworkAdapter} adapter
     * @param {string} roomId
     */
    startHost(adapter, roomId) {
        this.role = ROLE.HOST;
        this.roomId = roomId;
        this.bindAdapter(adapter);
        this.setStatus(NET_STATUS.WAITING_OPPONENT);
        console.log(`[NetworkSystem] HOST da sala ${roomId}. Aguardando o 2º jogador...`);
        this.connectAdapter(true);
    }

    /**
     * @param {import('./network-adapter.js').NetworkAdapter} adapter
     * @param {string} roomId
     * @param {string} token identificador estável deste jogador para reconexão
     */
    startClient(adapter, roomId, token) {
        this.role = ROLE.CLIENT;
        this.roomId = roomId;
        this.clientToken = token;
        this.bindAdapter(adapter);
        this.setStatus(NET_STATUS.CONNECTING);
        console.log(`[NetworkSystem] CLIENT procurando o host da sala ${roomId}...`);
        this.connectAdapter(false);
    }

    bindAdapter(adapter) {
        this.adapter = adapter;
        adapter.onPeerJoin = (peerId) => this.handlePeerJoin(peerId);
        adapter.onPeerLeave = (peerId) => this.handlePeerLeave(peerId);
        adapter.onMessage = (msg, peerId) => this.handleMessage(msg, peerId);
        adapter.onError = (err) => {
            if (!this.everConnected) {
                // Nenhum par conectou ainda nessa sessão: uma falha de handshake não derruba a sala,
                // o adapter (FallbackAdapter/Trystero) já está tentando de novo por conta própria.
                console.warn('[NetworkSystem] Tentativa de conexão falhou (sala segue aberta, tentando de novo):', err);
                return;
            }
            console.error('[NetworkSystem] Erro no transporte:', err);
            this.setStatus(NET_STATUS.ERROR);
        };
    }

    connectAdapter(isHost) {
        this.adapter.connect({ roomId: this.roomId, isHost }).catch((err) => {
            console.error('[NetworkSystem] Falha ao conectar o adapter:', err);
            this.setStatus(NET_STATUS.ERROR);
        });
    }

    shutdown() {
        this.stopHeartbeat();
        this.clearGrace();
        if (this.adapter) this.adapter.disconnect();
    }

    // --- API do servidor (host) --------------------------------------------

    /**
     * @param {number} seat
     * @param {Uint8Array|object} message
     */
    sendToSeat(seat, message) {
        if (seat === HOST_SEAT) {
            queueMicrotask(() => this.dispatchServerMessage(message));
            return;
        }
        if (this.remotePeer) this.adapter.send(message, this.remotePeer);
    }

    /** Envia mensagem para todos os espectadores. */
    sendToSpectators(message) {
        if (!this.adapter) return;
        for (const peer of this.spectators) {
            this.adapter.send(message, peer);
        }
    }

    // --- API do cliente ----------------------------------------------------

    /** @param {object} message { k: MSG.INPUT, ... } */
    sendInput(message) {
        if (this.role === ROLE.HOST) {
            queueMicrotask(() => this.emit(NET_EVENT.INPUT, HOST_SEAT, message));
            return;
        }
        if (!this.remotePeer) {
            console.warn('[NetworkSystem] Sem conexão com o host. Input descartado:', message);
            return;
        }
        this.adapter.send(message, this.remotePeer);
    }

    dispatchServerMessage(message) {
        if (this.listeners[NET_EVENT.SERVER_MESSAGE].length === 0) {
            this.pendingServerMessages.push(message);
            return;
        }
        this.emit(NET_EVENT.SERVER_MESSAGE, message);
    }

    // --- Entrada do transporte --------------------------------------------

    handlePeerJoin(peerId) {
        if (this.role === ROLE.CLIENT) {
            console.log(`[NetworkSystem] Par ${peerId} encontrado. Enviando HELLO...`);
            this.adapter.send({ k: MSG.HELLO, token: this.clientToken }, peerId);
        }
    }

    handleMessage(message, peerId) {
        if (this.role === ROLE.HOST) this.handleHostMessage(message, peerId);
        else if (this.role === ROLE.CLIENT || this.role === ROLE.SPECTATOR) this.handleClientMessage(message, peerId);
    }

    handleHostMessage(message, peerId) {
        if (isBinaryMessage(message) || !message) return;

        if (message.k === MSG.HELLO) {
            this.acceptSeat(peerId, message.token);
            return;
        }
        if (message.k === MSG.INPUT && peerId === this.remotePeer) {
            this.emit(NET_EVENT.INPUT, REMOTE_SEAT, message);
        }
    }

    acceptSeat(peerId, token) {
        if (typeof token !== 'string' || token.length === 0 || token.length > 64) return;

        if (this.seatToken !== null && token !== this.seatToken) {
            console.log(`[NetworkSystem] Par ${peerId} entrou como espectador.`);
            this.spectators.add(peerId);
            this.adapter.send({ k: MSG.WELCOME_SPECTATOR }, peerId);
            // Também enviamos um full sync imediato para o espectador
            queueMicrotask(() => this.emit(NET_EVENT.SEAT_CONNECTED, -1, true)); // -1 para avisar o ServerEngine a syncar spectador
            return;
        }

        const isFirst = this.seatToken === null;
        this.seatToken = token;
        this.remotePeer = peerId;
        this.everConnected = true;
        this.clearGrace();
        console.log(`[NetworkSystem] Jogador 2 ${isFirst ? 'entrou' : 'reconectou'} (${peerId}).`);
        this.adapter.send({ k: MSG.WELCOME, seat: REMOTE_SEAT }, peerId);
        this.setStatus(NET_STATUS.CONNECTED);
        this.startHeartbeat();
        this.emit(NET_EVENT.SEAT_CONNECTED, REMOTE_SEAT, isFirst);
    }

    handleClientMessage(message, peerId) {
        if (isBinaryMessage(message)) {
            if (peerId === this.remotePeer) this.dispatchServerMessage(message);
            return;
        }
        if (!message) return;

        switch (message.k) {
            case MSG.WELCOME:
                this.remotePeer = peerId;
                this.everConnected = true;
                this.clearGrace();
                this.setStatus(NET_STATUS.CONNECTED);
                this.startHeartbeat();
                if (!this.hasJoined) {
                    this.hasJoined = true;
                    console.log('[NetworkSystem] Aceito pelo host. Entrando na partida.');
                    this.emit(NET_EVENT.JOINED);
                } else {
                    console.log('[NetworkSystem] Reconectado ao host.');
                }
                break;
            case MSG.ROOM_FULL:
                if (!this.remotePeer) this.setStatus(NET_STATUS.ROOM_FULL);
                break;
            case MSG.WELCOME_SPECTATOR:
                this.remotePeer = peerId; // Guarda o host
                this.everConnected = true;
                this.clearGrace();
                this.role = ROLE.SPECTATOR;
                this.setStatus(NET_STATUS.CONNECTED);
                this.startHeartbeat();
                if (!this.hasJoined) {
                    this.hasJoined = true;
                    console.log('[NetworkSystem] Aceito pelo host como ESPECTADOR.');
                    this.emit(NET_EVENT.JOINED_SPECTATOR);
                }
                break;
            case MSG.EVENT:
                if (peerId === this.remotePeer) this.dispatchServerMessage(message);
                break;
        }
    }

    handlePeerLeave(peerId) {
        if (this.spectators.has(peerId)) {
            this.spectators.delete(peerId);
            this.emit(NET_EVENT.SPECTATOR_LEFT, peerId);
            return;
        }
        if (peerId !== this.remotePeer) return;
        this.remotePeer = null;
        this.stopHeartbeat();
        this.setStatus(this.role === ROLE.HOST ? NET_STATUS.OPPONENT_DISCONNECTED : NET_STATUS.RECONNECTING);

        this.clearGrace();
        this.graceTimer = setTimeout(() => {
            this.graceTimer = null;
            console.warn('[NetworkSystem] Tempo de reconexão esgotado.');
            this.setStatus(NET_STATUS.LOST);
            if (this.role === ROLE.HOST) this.emit(NET_EVENT.SEAT_LOST, REMOTE_SEAT);
        }, CONFIG.NETWORK.RECONNECT_GRACE_MS);
    }

    clearGrace() {
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }
    }

    // --- Heartbeat ---------------------------------------------------------

    startHeartbeat() {
        this.stopHeartbeat();
        this.missedPings = 0;
        this.heartbeatTimer = setInterval(() => this.heartbeat(), CONFIG.NETWORK.HEARTBEAT_INTERVAL_MS);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    heartbeat() {
        const peer = this.remotePeer;
        if (!peer) return;

        let timeoutId = null;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('timeout')), CONFIG.NETWORK.HEARTBEAT_TIMEOUT_MS);
        });

        Promise.race([this.adapter.ping(peer), timeout])
            .then(() => {
                this.missedPings = 0;
                if (this.status === NET_STATUS.UNSTABLE && this.remotePeer === peer) this.setStatus(NET_STATUS.CONNECTED);
            })
            .catch(() => {
                if (this.remotePeer !== peer) return;
                this.missedPings++;
                console.warn(`[NetworkSystem] Heartbeat sem resposta (${this.missedPings}).`);
                if (this.missedPings >= CONFIG.NETWORK.UNSTABLE_AFTER_MISSES) this.setStatus(NET_STATUS.UNSTABLE);
            })
            .finally(() => clearTimeout(timeoutId));
    }
}
