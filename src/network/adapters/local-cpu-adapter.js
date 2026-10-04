import { CONFIG } from '../../config/constants.js';
import { NetworkAdapter } from '../network-adapter.js';

export const CPU_PEER_ID = 'local-cpu';

/**
 * LocalCPUAdapter - "rede" em memória entre o Host e a IA.
 * A IA fala pelo `cpuEndpoint` exatamente como um cliente remoto falaria (handshake, snapshots, inputs),
 * com latência simulada e entrega em ordem FIFO.
 */
export class LocalCPUAdapter extends NetworkAdapter {
    constructor(latencyMs = CONFIG.NETWORK.LOCAL_CPU_LATENCY_MS) {
        super();
        this.latency = latencyMs;
        this.connected = false;

        /** Lado da CPU: a IA preenche onMessage/onConnected e usa send(). */
        this.cpuEndpoint = {
            onMessage: null,
            onConnected: null,
            send: (message) => this.fromCpu(message)
        };
    }

    async connect({ roomId }) {
        console.log(`[LocalCPUAdapter] Sala simulada: ${roomId}`);
        setTimeout(() => {
            this.connected = true;
            if (this.onPeerJoin) this.onPeerJoin(CPU_PEER_ID);
            if (this.cpuEndpoint.onConnected) this.cpuEndpoint.onConnected();
        }, this.latency);
    }

    disconnect() {
        this.connected = false;
    }

    send(message, peerId) {
        if (!this.connected || peerId !== CPU_PEER_ID) return;
        setTimeout(() => {
            if (this.cpuEndpoint.onMessage) this.cpuEndpoint.onMessage(message);
        }, this.latency);
    }

    fromCpu(message) {
        if (!this.connected) return;
        setTimeout(() => {
            if (this.onMessage) this.onMessage(message, CPU_PEER_ID);
        }, this.latency);
    }

    ping() {
        return Promise.resolve(this.latency * 2);
    }
}
