/**
 * NetworkAdapter - contrato de transporte (Local, WebRTC/Trystero, WebSocket...).
 * Só move mensagens entre pares; papéis, handshake e roteamento ficam no NetworkSystem.
 *
 * Callbacks preenchidos pelo NetworkSystem:
 *   onPeerJoin(peerId), onPeerLeave(peerId), onMessage(message, peerId), onError(error)
 */
export class NetworkAdapter {
    constructor() {
        this.onPeerJoin = null;
        this.onPeerLeave = null;
        this.onMessage = null;
        this.onError = null;
    }

    /**
     * @param {{ roomId: string, isHost: boolean }} config
     * @returns {Promise<void>}
     */
    async connect(config) {
        throw new Error('NetworkAdapter: connect() não implementado');
    }

    disconnect() {
        throw new Error('NetworkAdapter: disconnect() não implementado');
    }

    /**
     * Envio confiável e ordenado.
     * @param {object|ArrayBuffer|Uint8Array} message
     * @param {string} peerId
     */
    send(message, peerId) {
        throw new Error('NetworkAdapter: send() não implementado');
    }

    /**
     * @param {string} peerId
     * @returns {Promise<number>} latência em ms
     */
    ping(peerId) {
        throw new Error('NetworkAdapter: ping() não implementado');
    }
}
