/**
 * EventBus Central - Padrão Pub/Sub
 * Mantém os módulos estritamente desacoplados. (Pilar 7)
 */
class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * @param {string} eventName
     * @param {Function} callback
     */
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);
    }

    /**
     * @param {string} eventName
     * @param {Function} callback
     */
    off(eventName, callback) {
        const eventListeners = this.listeners.get(eventName);
        if (eventListeners) {
            const index = eventListeners.indexOf(callback);
            if (index > -1) {
                eventListeners.splice(index, 1);
            }
            if (eventListeners.length === 0) {
                this.listeners.delete(eventName);
            }
        }
    }

    /**
     * @param {string} eventName
     * @param {Object} [payload]
     */
    emit(eventName, payload = null) {
        const eventListeners = this.listeners.get(eventName);
        if (eventListeners) {
            // Clonamos a lista para o caso de um listener se remover durante a execução
            for (const callback of [...eventListeners]) {
                try {
                    callback(payload);
                } catch (err) {
                    console.error(`Error in EventBus listener for event ${eventName}:`, err);
                }
            }
        }
    }

    // Limpa todos os eventos (útil para reset/restart de jogo)
    clear() {
        this.listeners.clear();
    }
}

// Singleton global
export const globalEvents = new EventBus();
