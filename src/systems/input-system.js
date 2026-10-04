/**
 * InputSystem - Pointer Events (mouse, toque e caneta) com Drag & Drop.
 * Não conhece regras: repassa intenção via callbacks; quem decide é o GameClient.
 */
export class InputSystem {
    constructor() {
        this.pointerX = 0;
        this.pointerY = 0;
        this.draggedCard = -1;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.rectLeft = 0;
        this.rectTop = 0;
        this.pickCard = null;

        /** (cardId) => boolean  - true inicia arrasto */
        this.onCardPress = null;
        /** (cardId, x, y) */
        this.onDragMove = null;
        /** (cardId) */
        this.onDrop = null;
        /** (x, y) */
        this.onEmptyPress = null;
    }

    /**
     * @param {HTMLCanvasElement} element
     * @param {(x: number, y: number) => number} pickCard retorna o id da carta no ponto (virtual) ou -1
     * @param {import('../entities/card-pool.js').CardPool} pool
     * @param {import('../core/viewport.js').Viewport} viewport
     */
    init(element, pickCard, pool, viewport) {
        this.pickCard = pickCard;
        this.pool = pool;
        this.viewport = viewport;

        const updateRect = () => {
            const rect = element.getBoundingClientRect();
            this.rectLeft = rect.left;
            this.rectTop = rect.top;
        };
        updateRect();
        viewport.onChange(updateRect);

        element.addEventListener('pointermove', (e) => {
            this.updatePointer(e);
            if (this.draggedCard !== -1 && this.onDragMove) {
                this.onDragMove(this.draggedCard, this.pointerX - this.dragOffsetX, this.pointerY - this.dragOffsetY);
            }
        });

        element.addEventListener('pointerdown', (e) => {
            this.updatePointer(e);
            const cardId = this.pickCard(this.pointerX, this.pointerY);

            if (cardId === -1) {
                if (this.onEmptyPress) this.onEmptyPress(this.pointerX, this.pointerY);
                return;
            }

            const offsetX = this.pointerX - pool.x[cardId];
            const offsetY = this.pointerY - (pool.y[cardId] + pool.hoverOffsetY[cardId]);
            if (this.onCardPress && this.onCardPress(cardId)) {
                this.draggedCard = cardId;
                this.dragOffsetX = offsetX;
                this.dragOffsetY = offsetY;
                if (element.setPointerCapture) element.setPointerCapture(e.pointerId);
            }
        });

        const release = () => {
            if (this.draggedCard === -1) return;
            const cardId = this.draggedCard;
            this.draggedCard = -1;
            if (this.onDrop) this.onDrop(cardId);
        };
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
    }

    updatePointer(e) {
        this.pointerX = this.viewport.toVirtual(e.clientX - this.rectLeft);
        this.pointerY = this.viewport.toVirtual(e.clientY - this.rectTop);
    }

    /** Aborta o arrasto sem disparar onDrop (ex.: a carta saiu da mão por uma atualização do servidor). */
    cancelDrag() {
        this.draggedCard = -1;
    }
}
