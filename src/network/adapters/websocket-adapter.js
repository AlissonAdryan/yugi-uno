import { CONFIG } from '../../config/constants.js';
import { NetworkAdapter } from '../network-adapter.js';
import { isBinaryMessage } from '../protocol.js';

export const RELAY_PEER_ID = 'relay-peer';
const PING_TIMEOUT_MS = 4000;

/**
 * WebSocketAdapter - Camada 3, o fallback de última instância: um relay WebSocket simples (ver
 * /relay-server/, um Node.js de ~100 linhas hospedável de graça e sem cartão no Render), usado só
 * quando o WebRTC P2P (TrysteroAdapter) falha por completo. WebSocket na porta 443 atravessa até
 * firewalls corporativos com inspeção profunda de pacote, porque o tráfego é indistinguível de HTTPS
 * comum — ao custo de todo o dado do jogo passar pelo relay (não é mais P2P direto), então só entra
 * em cena como último recurso.
 *
 * Numa sala 2P só existe 1 par possível, então o peerId é sempre RELAY_PEER_ID (mesmo padrão do
 * LocalCPUAdapter com CPU_PEER_ID). Payloads binários (snapshot) vão como frame binário puro, sem
 * envelope; tudo mais (eventos JSON) vai como texto, com um envelope {__relay:'data', payload} pra
 * se distinguir das mensagens de controle do relay (join/leave/ping) — ver /relay-server/server.js.
 */
export class WebSocketAdapter extends NetworkAdapter {
    constructor(endpoint = CONFIG.NETWORK.RELAY_WS_ENDPOINT) {
        super();
        this.endpoint = endpoint;
        this.ws = null;
        this.peerPresent = false;
        this.pendingPings = new Map();
        this.nextPingId = 1;
    }

    /** @param {{ roomId: string, isHost: boolean }} config */
    connect({ roomId, isHost }) {
        if (!this.endpoint) return Promise.reject(new Error('Relay WebSocket não configurado (CONFIG.NETWORK.RELAY_WS_ENDPOINT vazio).'));

        const role = isHost ? 'host' : 'client';
        const url = `${this.endpoint}?room=${encodeURIComponent(roomId)}&role=${role}`;
        console.log(`[WebSocketAdapter] Conectando ao relay (${role}): ${this.endpoint}`);

        return new Promise((resolve, reject) => {
            let settled = false;
            const finishOpen = (ok, err) => {
                if (settled) return;
                settled = true;
                if (ok) resolve();
                else reject(err || new Error('Falha ao conectar no relay.'));
            };

            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            this.ws = ws;

            ws.onopen = () => finishOpen(true);
            ws.onerror = () => {
                finishOpen(false, new Error('Erro na conexão com o relay.'));
                if (settled && this.onError) this.onError(new Error('Erro no relay WebSocket.'));
            };
            ws.onclose = (event) => {
                finishOpen(false, new Error(`Relay fechou a conexão (${event.code}).`));
                this.failPendingPings('conexão fechada');
                if (this.peerPresent) {
                    this.peerPresent = false;
                    if (this.onPeerLeave) this.onPeerLeave(RELAY_PEER_ID);
                }
            };
            ws.onmessage = (event) => this.handleMessage(event);
        });
    }

    handleMessage(event) {
        if (event.data instanceof ArrayBuffer) {
            if (this.onMessage) this.onMessage(new Uint8Array(event.data), RELAY_PEER_ID);
            return;
        }

        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (err) {
            console.warn('[WebSocketAdapter] Mensagem de texto inválida do relay:', err);
            return;
        }

        switch (msg.__relay) {
            case 'joined':
                break; // só uma confirmação de conexão; o que importa é 'peer-joined'
            case 'peer-joined':
                this.peerPresent = true;
                if (this.onPeerJoin) this.onPeerJoin(RELAY_PEER_ID);
                break;
            case 'peer-left':
                this.peerPresent = false;
                if (this.onPeerLeave) this.onPeerLeave(RELAY_PEER_ID);
                break;
            case 'room-full':
                if (this.onError) this.onError(new Error('Sala cheia no relay.'));
                break;
            case 'pong':
                this.resolvePing(msg.id);
                break;
            case 'data':
                if (this.onMessage) this.onMessage(msg.payload, RELAY_PEER_ID);
                break;
            default:
                console.warn('[WebSocketAdapter] Mensagem de controle desconhecida:', msg);
        }
    }

    send(message, peerId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || peerId !== RELAY_PEER_ID) return;
        if (isBinaryMessage(message)) {
            this.ws.send(message);
        } else {
            this.ws.send(JSON.stringify({ __relay: 'data', payload: message }));
        }
    }

    ping(peerId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || peerId !== RELAY_PEER_ID) {
            return Promise.reject(new Error('Relay desconectado.'));
        }
        const id = this.nextPingId++;
        const sentAt = performance.now();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingPings.delete(id);
                reject(new Error('timeout'));
            }, PING_TIMEOUT_MS);
            this.pendingPings.set(id, { resolve, timer, sentAt });
            this.ws.send(JSON.stringify({ __relay: 'ping', id }));
        });
    }

    resolvePing(id) {
        const pending = this.pendingPings.get(id);
        if (!pending) return;
        this.pendingPings.delete(id);
        clearTimeout(pending.timer);
        pending.resolve(performance.now() - pending.sentAt);
    }

    failPendingPings(reason) {
        for (const [id, pending] of this.pendingPings) {
            clearTimeout(pending.timer);
            this.pendingPings.delete(id);
            console.warn(`[WebSocketAdapter] Ping ${id} cancelado: ${reason}`);
        }
    }

    disconnect() {
        this.failPendingPings('desconectado');
        if (this.ws) {
            this.ws.onopen = this.ws.onerror = this.ws.onclose = this.ws.onmessage = null;
            this.ws.close();
            this.ws = null;
        }
        this.peerPresent = false;
    }
}
