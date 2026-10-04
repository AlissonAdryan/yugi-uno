/**
 * ThreadManager - Gerenciador extremamente robusto para Multi-thread.
 * Funcionalidades:
 * - Pool dinâmico (navigator.hardwareConcurrency) para escalabilidade (Pilar 3)
 * - Fila de prioridades (High, Normal, Low)
 * - Timeouts por tarefa para evitar travamentos
 * - Auto-restart de workers (Graceful Recovery) em caso de crash
 * - Suporte a AbortController para cancelar tarefas na fila
 * - Broadcast (enviar mensagem para todos os workers do pool)
 */

export const PRIORITY = {
    HIGH: 0,
    NORMAL: 1,
    LOW: 2
};

export class ThreadManager {
    constructor() {
        this.pools = new Map(); // id -> { workers: [], scriptUrl, busyWorkers: Set() }
        this.taskQueues = new Map(); // id -> Priority Queue Array
        this.callbacks = new Map(); // messageId -> { resolve, reject, timer, workerIndex, id }
        this.messageIdCounter = 0;
    }

    /**
     * Inicializa um Pool de Workers.
     * @param {string} id Identificador único para o pool
     * @param {string} scriptUrl Caminho do script do Worker
     * @param {number|null} [poolSize=null] Quantidade de workers. Se null, usa hardwareConcurrency - 1.
     */
    registerWorker(id, scriptUrl, poolSize = null) {
        if (this.pools.has(id)) {
            console.warn(`[ThreadManager] Pool ${id} já registrado.`);
            return;
        }

        // Pilar 3: Dimensionamento baseado em hardwareConcurrency (deixando 1 core livre pra main thread)
        const size = poolSize || Math.max(1, (navigator.hardwareConcurrency || 4) - 1);

        this.pools.set(id, {
            scriptUrl,
            workers: [],
            busyWorkers: new Set()
        });

        this.taskQueues.set(id, []);

        for (let i = 0; i < size; i++) {
            this._spawnWorker(id, i);
        }
    }

    _spawnWorker(id, index) {
        const poolInfo = this.pools.get(id);
        if (!poolInfo) return;

        try {
            const worker = new Worker(poolInfo.scriptUrl, { type: 'module' });
            worker.onmessage = (e) => this._handleMessage(id, index, e);
            worker.onerror = (e) => this._handleError(id, index, e);
            poolInfo.workers[index] = worker;
            poolInfo.busyWorkers.delete(index);
        } catch (err) {
            console.error(`[ThreadManager] Falha ao criar Worker ${id}[${index}]:`, err);
        }
    }

    /**
     * Envia uma tarefa para um pool.
     * @param {string} id ID do pool
     * @param {string} type Tipo da mensagem
     * @param {any} payload Dados para o worker
     * @param {Object} options Configurações adicionais
     * @param {Array<Transferable>} [options.transferables] ArrayBuffer para O(1) transfer
     * @param {number} [options.priority] PRIORITY.HIGH, NORMAL ou LOW
     * @param {number} [options.timeout] MS para timeout (0 = sem timeout)
     * @param {AbortSignal} [options.signal] Para cancelar a task
     * @returns {Promise<any>}
     */
    executeTask(id, type, payload, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.pools.has(id)) {
                return reject(new Error(`[ThreadManager] Pool ${id} não encontrado.`));
            }

            const { 
                transferables = [], 
                priority = PRIORITY.NORMAL, 
                timeout = 0,
                signal = null
            } = options;

            if (signal && signal.aborted) {
                return reject(new Error('Task aborted before execution'));
            }

            const messageId = ++this.messageIdCounter;
            
            const task = {
                messageId,
                type,
                payload,
                transferables,
                priority,
                timeout,
                signal
            };

            this.callbacks.set(messageId, { 
                resolve, 
                reject,
                timer: null,
                workerIndex: null, // Preenchido no dispatch
                id
            });

            if (signal) {
                signal.addEventListener('abort', () => this._handleAbort(messageId));
            }

            this._scheduleTask(id, task);
        });
    }

    /**
     * Dispara uma mensagem fire-and-forget para todos os workers de um pool.
     * Útil para atualizar estado global, carregar texturas em OffscreenCanvas, etc.
     */
    broadcast(id, type, payload) {
        const poolInfo = this.pools.get(id);
        if (!poolInfo) return;
        
        for (let i = 0; i < poolInfo.workers.length; i++) {
            const worker = poolInfo.workers[i];
            if (worker) {
                worker.postMessage({ type, payload });
            }
        }
    }

    terminate(id) {
        const poolInfo = this.pools.get(id);
        if (poolInfo) {
            poolInfo.workers.forEach(w => w && w.terminate());
            this.pools.delete(id);
            this.taskQueues.delete(id);
        }
    }

    // --- Métodos Privados ---

    _scheduleTask(id, task) {
        const poolInfo = this.pools.get(id);
        const queue = this.taskQueues.get(id);

        let freeWorkerIndex = -1;
        for (let i = 0; i < poolInfo.workers.length; i++) {
            if (poolInfo.workers[i] && !poolInfo.busyWorkers.has(i)) {
                freeWorkerIndex = i;
                break;
            }
        }

        if (freeWorkerIndex !== -1) {
            this._dispatchToWorker(id, freeWorkerIndex, task);
        } else {
            queue.push(task);
            // Ordena fila garantindo que High Priority processe primeiro
            queue.sort((a, b) => a.priority - b.priority);
        }
    }

    _dispatchToWorker(id, workerIndex, task) {
        if (task.signal && task.signal.aborted) {
            this._handleAbort(task.messageId);
            this._processNextInQueue(id);
            return;
        }

        const poolInfo = this.pools.get(id);
        poolInfo.busyWorkers.add(workerIndex);
        const worker = poolInfo.workers[workerIndex];

        const cbInfo = this.callbacks.get(task.messageId);
        if (cbInfo) {
            cbInfo.workerIndex = workerIndex;
            if (task.timeout > 0) {
                cbInfo.timer = setTimeout(() => this._handleTimeout(task.messageId), task.timeout);
            }
        }

        worker.postMessage({
            messageId: task.messageId,
            type: task.type,
            payload: task.payload
        }, task.transferables);
    }

    _processNextInQueue(id) {
        const queue = this.taskQueues.get(id);
        if (queue && queue.length > 0) {
            const nextTask = queue.shift();
            this._scheduleTask(id, nextTask);
        }
    }

    _handleMessage(id, workerIndex, event) {
        const { messageId, result, error } = event.data;
        const poolInfo = this.pools.get(id);
        
        if (poolInfo) {
            poolInfo.busyWorkers.delete(workerIndex);
        }

        if (messageId && this.callbacks.has(messageId)) {
            const { resolve, reject, timer } = this.callbacks.get(messageId);
            if (timer) clearTimeout(timer);
            
            if (error) reject(new Error(error));
            else resolve(result);
            
            this.callbacks.delete(messageId);
        }

        this._processNextInQueue(id);
    }

    _handleError(id, workerIndex, errorEvent) {
        console.error(`[ThreadManager] Erro critico no Worker ${id}[${workerIndex}]:`, errorEvent);
        const poolInfo = this.pools.get(id);
        
        if (!poolInfo) return;
        poolInfo.busyWorkers.delete(workerIndex);

        if (poolInfo.workers[workerIndex]) {
            poolInfo.workers[workerIndex].terminate();
        }

        // Rejeita a task que estava processando
        for (const [msgId, cbInfo] of this.callbacks.entries()) {
            if (cbInfo.id === id && cbInfo.workerIndex === workerIndex) {
                if (cbInfo.timer) clearTimeout(cbInfo.timer);
                cbInfo.reject(new Error('Worker crashed during execution'));
                this.callbacks.delete(msgId);
                break;
            }
        }

        // Recuperação Automática (Graceful Recovery)
        console.warn(`[ThreadManager] Reiniciando Worker ${id}[${workerIndex}] (Auto-Recovery)...`);
        this._spawnWorker(id, workerIndex);

        this._processNextInQueue(id);
    }

    _handleTimeout(messageId) {
        const cbInfo = this.callbacks.get(messageId);
        if (!cbInfo) return;

        console.warn(`[ThreadManager] Task ${messageId} no pool ${cbInfo.id} deu timeout! Matando thread...`);
        
        cbInfo.reject(new Error('Task timeout'));
        this.callbacks.delete(messageId);

        // Se deu timeout, o worker travou num loop infinito. Matamos e criamos outro.
        if (cbInfo.workerIndex !== null) {
            const poolInfo = this.pools.get(cbInfo.id);
            if (poolInfo && poolInfo.workers[cbInfo.workerIndex]) {
                poolInfo.workers[cbInfo.workerIndex].terminate();
                poolInfo.busyWorkers.delete(cbInfo.workerIndex);
                this._spawnWorker(cbInfo.id, cbInfo.workerIndex);
                this._processNextInQueue(cbInfo.id);
            }
        }
    }

    _handleAbort(messageId) {
        const cbInfo = this.callbacks.get(messageId);
        if (!cbInfo) return;

        if (cbInfo.timer) clearTimeout(cbInfo.timer);
        cbInfo.reject(new Error('Task aborted'));
        this.callbacks.delete(messageId);
        // Não matamos o worker num abort normal a menos que ele esteja travado (que será pego pelo timeout).
    }
}

export const threadManager = new ThreadManager();
