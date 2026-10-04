import { CONFIG } from '../config/constants.js';

/**
 * CardPool (cliente) - visão renderizável das cartas, indexada pelo id que vem do servidor.
 * Capacidade fixa pré-alocada + SoA/TypedArrays: nenhum objeto é criado por carta ou por frame.
 */
export class CardPool {
    constructor(capacity = CONFIG.DECK_SIZE) {
        this.maxCards = capacity;

        this.active = new Uint8Array(capacity);
        this.spawned = new Uint8Array(capacity);
        // 1 = jogável agora (contorno animado); preenchido pelo PlayableSystem
        this.outlined = new Uint8Array(capacity);
        // Pintar: 1 = pode ser escolhida (contorno arco-íris) / 1 = já escolhida
        this.paintable = new Uint8Array(capacity);
        this.paintSelected = new Uint8Array(capacity);
        // Pintar em andamento: a face nova (color) escorre por cima da antiga (paintFrom) conforme paintT 0..1
        this.paintAnim = new Uint8Array(capacity);
        this.paintFrom = new Uint8Array(capacity);
        this.paintT = new Float32Array(capacity);
        // Estados visuais das cinemáticas (zero = carta normal): opacidade (Fantasma), rachaduras 0..1
        // (Maldição), brilho 0..1 na cor CARD_GLOW[glowKind] (Maldição/Emboscada), glitch 0..1 (Espelho)
        // e a tinta do número do Espelho (0 branco, 1 vermelho-sangue do valor copiado)
        this.alpha = new Float32Array(capacity).fill(1);
        this.crack = new Float32Array(capacity);
        this.glow = new Float32Array(capacity);
        this.glowKind = new Uint8Array(capacity);
        this.glitch = new Float32Array(capacity);
        this.numberTint = new Uint8Array(capacity);
        // Ronova: 0..1 = a carta sendo consumida pelas chamas carmesim
        this.burn = new Float32Array(capacity);

        // Face e posição lógica (zona relativa) como o jogador local as conhece
        this.zone = new Uint8Array(capacity);
        this.order = new Uint8Array(capacity);
        this.type = new Uint8Array(capacity);
        this.color = new Uint8Array(capacity);
        this.power = new Int16Array(capacity);
        // CONFIG.CARD_FLAGS das próprias cartas (ex.: RESALE: comprada na loja, revende pela metade)
        this.cardFlags = new Uint8Array(capacity);

        // Transformações de renderização (animadas pelo Animator)
        this.x = new Float32Array(capacity);
        this.y = new Float32Array(capacity);
        this.targetX = new Float32Array(capacity);
        this.targetY = new Float32Array(capacity);
        this.scale = new Float32Array(capacity).fill(1);
        this.rotation = new Float32Array(capacity);
        this.hoverOffsetY = new Float32Array(capacity);
        this.homeX = new Float32Array(capacity);
        this.homeY = new Float32Array(capacity);
        this.zIndex = new Int16Array(capacity);

        this.drawOrder = new Uint16Array(capacity);
        this.drawCount = 0;
    }

    isValid(id) {
        return Number.isInteger(id) && id >= 0 && id < this.maxCards;
    }

    isActive(id) {
        return this.isValid(id) && this.active[id] === 1;
    }

    isFaceUp(id) {
        return this.type[id] !== CONFIG.CARD_TYPES.HIDDEN;
    }

    /** Ativa a carta nascendo na posição informada (normalmente o baralho). */
    activate(id, x, y) {
        this.active[id] = 1;
        this.spawned[id] = 1;
        this.outlined[id] = 0;
        this.paintable[id] = 0;
        this.paintSelected[id] = 0;
        this.paintAnim[id] = 0;
        this.resetFx(id);
        this.x[id] = x;
        this.y[id] = y;
        this.targetX[id] = x;
        this.targetY[id] = y;
        this.scale[id] = 1;
        this.rotation[id] = 0;
        this.hoverOffsetY[id] = 0;
        this.homeX[id] = x;
        this.homeY[id] = y;
        this.zIndex[id] = 0;
    }

    deactivate(id) {
        this.active[id] = 0;
        this.spawned[id] = 0;
        this.outlined[id] = 0;
        this.paintable[id] = 0;
        this.paintSelected[id] = 0;
        this.paintAnim[id] = 0;
        this.resetFx(id);
    }

    /** Volta a carta ao visual normal (sem transparência, rachadura, brilho ou glitch). */
    resetFx(id) {
        this.alpha[id] = 1;
        this.crack[id] = 0;
        this.glow[id] = 0;
        this.glowKind[id] = 0;
        this.glitch[id] = 0;
        this.numberTint[id] = 0;
        this.burn[id] = 0;
    }

    /** Ordena os ids ativos por zIndex (insertion sort estavel; verifica se precisa ordenar antes). */
    sortDrawOrder() {
        const order = this.drawOrder;
        const z = this.zIndex;
        let count = 0;
        for (let i = 0; i < this.maxCards; i++) {
            if (this.active[i] === 1) order[count++] = i;
        }
        
        let dirty = false;
        for (let i = 1; i < count; i++) {
            if (z[order[i - 1]] > z[order[i]]) {
                dirty = true;
                break;
            }
        }
        
        if (dirty) {
            for (let i = 1; i < count; i++) {
                const id = order[i];
                const key = z[id];
                let j = i - 1;
                while (j >= 0 && z[order[j]] > key) {
                    order[j + 1] = order[j];
                    j--;
                }
                order[j + 1] = id;
            }
        }
        this.drawCount = count;
    }
}
