import { resolveNumberClash } from '../systems/rules.js';
import { CONFIG } from '../config/constants.js';

/**
 * GameWorker - ponto de entrada pronto para mover regras pesadas para fora da main thread
 * (via ThreadManager). Hoje a simulação é leve o bastante para rodar no host sem Worker.
 */
self.onmessage = function (event) {
    const { messageId, type, payload } = event.data;

    try {
        let result = null;
        switch (type) {
            case CONFIG.WORKER_MESSAGES.INIT:
                result = { status: 'Worker Initialized' };
                break;
            case CONFIG.WORKER_MESSAGES.CALCULATE_BATTLE:
                result = { diff: resolveNumberClash(payload.powerA, payload.powerB) };
                break;
            default:
                throw new Error(`Mensagem não suportada pelo worker: ${type}`);
        }
        self.postMessage({ messageId, result });
    } catch (error) {
        self.postMessage({ messageId, error: error.message });
    }
};
