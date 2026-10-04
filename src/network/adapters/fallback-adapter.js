import { NetworkAdapter } from '../network-adapter.js';
import { CONFIG } from '../../config/constants.js';

/**
 * FallbackAdapter - cicla por uma cadeia de transportes (ex.: [TrysteroAdapter, WebSocketAdapter])
 * até um par de verdade conectar. A regra de ouro: NUNCA desiste sozinho enquanto isso não acontece.
 * Uma falha de handshake (o erro clássico de SDP/ICE) não significa que a sala está quebrada — é só
 * aquela tentativa específica. Em vez de propagar isso como erro fatal (o que antes forçava o host a
 * criar uma sala nova), o adapter espera `CONNECTION_RETRY_DELAY_MS` e tenta de novo: primeiro o
 * próximo transporte da lista (se houver camada de fallback configurada), depois volta pro início e
 * repete o ciclo — indefinidamente, até conectar ou até disconnect() ser chamado (jogador saiu da sala).
 *
 * Depois que um par conecta de verdade, esse transporte vira definitivo pro resto da sessão — um erro
 * a partir daí é repassado como erro de rede de verdade (this.onError), sem trocar de transporte no
 * meio da partida (isso fica pro fluxo normal de reconexão/timeout do NetworkSystem).
 *
 * Implementa o mesmo contrato de NetworkAdapter, então NetworkSystem nunca sabe que existem vários
 * transportes por trás — é só "mais um adapter" (Pilar 7: abstração atrás de uma interface comum).
 */
export class FallbackAdapter extends NetworkAdapter {
    /**
     * @param {NetworkAdapter[]} adapters ordem de tentativa (ex.: [TrysteroAdapter, WebSocketAdapter])
     * @param {{ onRetry?: (attempt: number, switchedTransport: boolean) => void }} [options]
     *        onRetry dispara antes de CADA nova tentativa que não seja a 1ª (mesma sessão ainda sem
     *        par conectado). `switchedTransport` diz se essa tentativa é num transporte DIFERENTE do
     *        anterior (ex.: Trystero -> WebSocket) ou uma repetição do mesmo (ciclo completo).
     */
    constructor(adapters, { onRetry } = {}) {
        super();
        if (!adapters || adapters.length === 0) throw new Error('FallbackAdapter precisa de ao menos 1 adapter.');
        this.adapters = adapters;
        this.onRetryCallback = onRetry || null;
        this.index = -1;
        this.attempt = 0;
        this.connected = false;
        this.stopped = false;
        this.config = null;
        this.retryTimer = null;
    }

    /** @param {{ roomId: string, isHost: boolean }} config */
    async connect(config) {
        this.config = config;
        this.stopped = false;
        this.startAttempt();
    }

    startAttempt() {
        if (this.stopped) return;

        const previousIndex = this.index;
        this.index = (this.index + 1) % this.adapters.length;
        this.connected = false;
        this.attempt++;

        if (this.attempt > 1) {
            const switchedTransport = this.index !== previousIndex;
            console.warn(`[FallbackAdapter] Tentativa ${this.attempt} — transporte ${this.index + 1}/${this.adapters.length}${switchedTransport ? ' (trocando de transporte)' : ' (repetindo)'}...`);
            if (this.onRetryCallback) this.onRetryCallback(this.attempt, switchedTransport);
        }

        const adapter = this.current();
        adapter.onPeerJoin = (peerId) => {
            this.connected = true;
            clearTimeout(this.retryTimer);
            if (this.onPeerJoin) this.onPeerJoin(peerId);
        };
        adapter.onPeerLeave = (peerId) => {
            if (this.onPeerLeave) this.onPeerLeave(peerId);
        };
        adapter.onMessage = (msg, peerId) => {
            if (this.onMessage) this.onMessage(msg, peerId);
        };
        adapter.onError = (err) => {
            if (this.connected) {
                // Já tínhamos um par de verdade conectado por este transporte: erro real, não é caso
                // de tentar de novo no meio da partida — repassa como qualquer erro de rede.
                if (this.onError) this.onError(err);
                return;
            }
            console.warn(`[FallbackAdapter] Tentativa ${this.attempt} falhou antes de conectar:`, err.message || err);
            try { adapter.disconnect(); } catch (disconnectErr) { /* já pode estar desfeito */ }
            this.scheduleRetry();
        };

        // O connect() do Trystero resolve assim que o joinRoom() é chamado, bem antes de um par de
        // verdade conectar (ou falhar) — a Promise aqui não é o sinal de sucesso, os callbacks acima são.
        Promise.resolve(adapter.connect(this.config)).catch((err) => {
            console.warn(`[FallbackAdapter] connect() rejeitou na tentativa ${this.attempt}:`, err.message || err);
            this.scheduleRetry();
        });
    }

    scheduleRetry() {
        if (this.stopped || this.connected) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.startAttempt(), CONFIG.NETWORK.CONNECTION_RETRY_DELAY_MS);
    }

    current() {
        return this.adapters[this.index] ?? null;
    }

    send(message, peerId) {
        const adapter = this.current();
        if (adapter) adapter.send(message, peerId);
    }

    ping(peerId) {
        const adapter = this.current();
        return adapter ? adapter.ping(peerId) : Promise.reject(new Error('Nenhum transporte ativo.'));
    }

    disconnect() {
        this.stopped = true;
        clearTimeout(this.retryTimer);
        const adapter = this.current();
        if (adapter) adapter.disconnect();
    }
}
