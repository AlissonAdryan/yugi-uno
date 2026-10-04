import { CONFIG } from '../config/constants.js';

const { VIEW } = CONFIG;

/**
 * Viewport - resolução virtual do jogo.
 *
 * Todo o layout (tabuleiro, mãos, cartas, partículas) trabalha em coordenadas virtuais com pelo menos
 * VIEW.DESIGN_WIDTH x VIEW.DESIGN_HEIGHT. A tela real é coberta com um fator de escala uniforme,
 * então as proporções são as mesmas em qualquer monitor, zoom do navegador ou celular (horizontal).
 * A HUD em DOM acompanha pela variável CSS --ui-scale (com limites para continuar legível no celular).
 */
export class Viewport {
    constructor() {
        this.cssWidth = 0;
        this.cssHeight = 0;
        this.dpr = 1;
        this.scale = 1;
        this.uiScale = 1;
        this.width = VIEW.DESIGN_WIDTH;
        this.height = VIEW.DESIGN_HEIGHT;
        this.listeners = [];

        const onResize = () => this.update();
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        this.update();
    }

    update() {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        this.cssWidth = w;
        this.cssHeight = h;
        this.dpr = Math.min(window.devicePixelRatio || 1, VIEW.MAX_DPR);
        this.scale = Math.min(w / VIEW.DESIGN_WIDTH, h / VIEW.DESIGN_HEIGHT);
        this.width = w / this.scale;
        this.height = h / this.scale;
        this.uiScale = this.scale;
        const trashCorrection = 1.0;

        document.documentElement.style.setProperty('--ui-scale', this.uiScale.toFixed(4));
        document.documentElement.style.setProperty('--scene-scale', this.scale.toFixed(4));
        document.documentElement.style.setProperty('--trash-scale', trashCorrection.toFixed(4));
        for (let i = 0; i < this.listeners.length; i++) this.listeners[i](this);
    }

    /** @param {(viewport: Viewport) => void} callback */
    onChange(callback) {
        this.listeners.push(callback);
    }

    /** Converte coordenada CSS (relativa ao canvas) para coordenada virtual do jogo. */
    toVirtual(cssValue) {
        return cssValue / this.scale;
    }
}
