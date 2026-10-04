import { CONFIG } from '../config/constants.js';
import { Easing } from '../render/animator.js';
import { BOARD_ZONES, ZONE, ZONE_COUNT } from '../utils/zones.js';

const { CARD_DIMENSIONS, ANIM, HAND_SCALE, HAND_STEP_RATIO, STACK_OFFSET } = CONFIG;

/**
 * LayoutSystem - calcula onde cada carta deve estar (mãos, pilhas, baralho) a partir das zonas do CardPool
 * e anima até lá. É a única fonte de posicionamento "de repouso"; cinemáticas só fazem desvios temporários.
 */
export class LayoutSystem {
    /**
     * @param {import('../entities/card-pool.js').CardPool} pool
     * @param {import('./board-system.js').BoardSystem} board
     * @param {import('../render/animator.js').Animator} animator
     */
    constructor(pool, board, animator) {
        this.pool = pool;
        this.board = board;
        this.animator = animator;
        this.stacks = [];
        for (let z = 0; z < ZONE_COUNT; z++) this.stacks.push([]);
        this.deckX = 0;
        this.deckY = 0;
        this._byOrder = (a, b) => this.pool.order[a] - this.pool.order[b];
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
        this.deckX = width - CARD_DIMENSIONS.WIDTH - 20;
        this.deckY = height / 2 - CARD_DIMENSIONS.HEIGHT / 2;
    }

    /** Reconstrói as pilhas visuais a partir de pool.zone/pool.order (inclui previsões locais). */
    rebuild() {
        const pool = this.pool;
        for (let z = 0; z < ZONE_COUNT; z++) this.stacks[z].length = 0;
        for (let id = 0; id < pool.maxCards; id++) {
            // Zonas só do cliente (CLIENT_ZONE) ficam de fora: a carta não tem lugar de repouso
            if (pool.active[id] === 1 && pool.zone[id] < ZONE_COUNT) this.stacks[pool.zone[id]].push(id);
        }
        for (let z = 0; z < ZONE_COUNT; z++) {
            if (this.stacks[z].length > 1) this.stacks[z].sort(this._byOrder);
        }
    }

    stack(zone) {
        return this.stacks[zone];
    }

    /**
     * Anima todas as cartas para suas posições de repouso.
     * @param {number} skipId carta sendo arrastada (não deve ser movida)
     */
    apply(skipId = -1) {
        this.spawnIndex = 0;
        this.layoutHand(this.stacks[ZONE.SELF_HAND], this.height - CARD_DIMENSIONS.HEIGHT * HAND_SCALE - 10, skipId);
        this.layoutHand(this.stacks[ZONE.OPP_HAND], 10, skipId);

        for (let i = 0; i < BOARD_ZONES.length; i++) {
            const zone = BOARD_ZONES[i];
            const rect = this.board.slots[zone];
            const stack = this.stacks[zone];
            if (!rect) continue;
            for (let j = 0; j < stack.length; j++) {
                const id = stack[j];
                if (id === skipId) continue;
                this.pool.zIndex[id] = 100 + j;
                this.moveTo(id, rect.x + j * STACK_OFFSET.X, rect.y + j * STACK_OFFSET.Y, rect.rotation, 1, ANIM.BOARD_MOVE, Easing.BackOut);
            }
        }
    }

    layoutHand(hand, y, skipId) {
        const n = hand.length;
        if (n === 0) return;

        const scaledW = CARD_DIMENSIONS.WIDTH * HAND_SCALE;
        const available = Math.max(scaledW, this.width - CONFIG.HAND_MARGIN_X * 2);
        const idealStep = scaledW * HAND_STEP_RATIO;
        const step = n > 1 ? Math.min(idealStep, (available - scaledW) / (n - 1)) : 0;
        const totalW = scaledW + step * (n - 1);
        // Carta escalada é desenhada a partir do centro; compensamos para alinhar a borda visual
        const scaleInset = (CARD_DIMENSIONS.WIDTH - scaledW) / 2;
        const startX = this.width / 2 - totalW / 2 - scaleInset;
        const yInset = (CARD_DIMENSIONS.HEIGHT - CARD_DIMENSIONS.HEIGHT * HAND_SCALE) / 2;

        for (let i = 0; i < n; i++) {
            const id = hand[i];
            const x = startX + i * step;
            const cardY = y - yInset;
            this.pool.homeX[id] = x;
            this.pool.homeY[id] = cardY;
            if (id === skipId) continue;
            this.pool.zIndex[id] = 50 + i;
            this.moveTo(id, x, cardY, 0, HAND_SCALE, ANIM.HAND_MOVE, Easing.QuadOut);
        }
    }

    moveTo(id, x, y, rotation, scale, duration, easing) {
        const pool = this.pool;
        if (pool.spawned[id] === 1) {
            pool.spawned[id] = 0;
            duration = ANIM.SPAWN_MOVE + this.spawnIndex * ANIM.SPAWN_STAGGER;
            easing = Easing.CubicOut;
            this.spawnIndex++;
        }
        this.animator.to(id, { targetX: x, targetY: y, rotation, scale }, duration, easing, null, null, pool);
    }
}
