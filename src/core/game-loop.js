import { CONFIG } from '../config/constants.js';

/**
 * GameLoop - Implementação de "Fix Your Timestep" (Pilar 3)
 * Desacopla simulação lógica de renderização, garantindo determinismo
 * independente do FPS da tela.
 */
export class GameLoop {
    constructor(updateFn, renderFn) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        
        this.lastTime = performance.now();
        this.accumulator = 0;
        this.timestep = CONFIG.PHYSICS_TIMESTEP;
        
        this.animationFrameId = null;
        this.isRunning = false;
        
        // Evita closures criadas a cada frame (Pilar 1)
        this._loop = this._loop.bind(this);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.animationFrameId = requestAnimationFrame(this._loop);
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    _loop(currentTime) {
        if (!this.isRunning) return;

        let deltaTime = currentTime - this.lastTime;
        // Prevenção contra espiral da morte se a aba ficar inativa
        if (deltaTime > 250) {
            deltaTime = 250; 
        }

        this.lastTime = currentTime;
        this.accumulator += deltaTime;

        // Atualiza a lógica em steps fixos
        while (this.accumulator >= this.timestep) {
            this.updateFn(this.timestep);
            this.accumulator -= this.timestep;
        }

        // Calcula a interpolação para o renderizador, se necessário para suavidade extra
        const alpha = this.accumulator / this.timestep;
        
        // Renderiza tudo o que foi atualizado
        this.renderFn(alpha, deltaTime);

        this.animationFrameId = requestAnimationFrame(this._loop);
    }
}
