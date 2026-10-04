import { CONFIG } from '../config/constants.js';

/**
 * Easing Functions (0 a 1)
 */
export const Easing = {
    Linear: (t) => t,
    QuadIn: (t) => t * t,
    QuadOut: (t) => t * (2 - t),
    QuadInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    CubicIn: (t) => t * t * t,
    CubicOut: (t) => (--t) * t * t + 1,
    ElasticOut: (t) => {
        const p = 0.3;
        return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
    },
    BackOut: (t) => {
        const s = 1.70158;
        return --t * t * ((s + 1) * t + s) + 1;
    },
    BounceOut: (t) => {
        if (t < (1 / 2.75)) return 7.5625 * t * t;
        if (t < (2 / 2.75)) return 7.5625 * (t -= (1.5 / 2.75)) * t + 0.75;
        if (t < (2.5 / 2.75)) return 7.5625 * (t -= (2.25 / 2.75)) * t + 0.9375;
        return 7.5625 * (t -= (2.625 / 2.75)) * t + 0.984375;
    }
};

/**
 * Animator (Tween Engine) com prevenção de Tween Fighting.
 */
export class Animator {
    constructor() {
        this.tweens = [];
    }

    /**
     * @param {number|Object} target índice SoA (com poolRef) ou objeto comum
     * @param {Object} properties { prop: valorFinal }
     * @param {number} duration ms
     * @param {Function} [easing]
     * @param {Function} [onUpdate]
     * @param {Function} [onComplete]
     * @param {Object} [poolRef] pool SoA quando target é um índice
     */
    to(target, properties, duration, easing = Easing.QuadOut, onUpdate = null, onComplete = null, poolRef = null) {
        for (let i = 0; i < this.tweens.length; i++) {
            const tween = this.tweens[i];
            if (tween.target !== target || tween.poolRef !== poolRef) continue;
            let identical = true;
            let count = 0;
            for (const prop in properties) {
                count++;
                if (tween.properties[prop] !== properties[prop]) {
                    identical = false;
                    break;
                }
            }
            if (identical && count === Object.keys(tween.properties).length) {
                // Já anima para o mesmo destino: só encadeia o callback para não perdê-lo
                if (onComplete) {
                    const previous = tween.onComplete;
                    tween.onComplete = previous ? () => { previous(); onComplete(); } : onComplete;
                }
                return;
            }
        }

        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const tween = this.tweens[i];
            if (tween.target !== target || tween.poolRef !== poolRef) continue;
            for (const prop in properties) {
                if (prop in tween.properties) delete tween.properties[prop];
            }
            if (Object.keys(tween.properties).length === 0) this.tweens.splice(i, 1);
        }

        const startValues = {};
        for (const prop in properties) {
            startValues[prop] = poolRef ? poolRef[prop][target] : target[prop];
        }

        this.tweens.push({
            target,
            poolRef,
            properties,
            startValues,
            duration: Math.max(1, duration),
            easing,
            onUpdate,
            onComplete,
            elapsed: 0
        });
    }

    /**
     * Versão Promise de `to` para coreografias. Resolve ao terminar ou, no pior caso,
     * por timeout de segurança (aba em segundo plano, tween substituído), nunca travando a fila de cinemáticas.
     * @returns {Promise<void>}
     */
    toAsync(target, properties, duration, easing = Easing.QuadOut, poolRef = null) {
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(finish, duration + CONFIG.ANIM.SAFETY_MARGIN);
            this.to(target, properties, duration, easing, null, finish, poolRef);
        });
    }

    cancel(target, poolRef = null) {
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const tween = this.tweens[i];
            if (tween.target === target && tween.poolRef === poolRef) this.tweens.splice(i, 1);
        }
    }

    /**
     * @param {number} dt ms
     */
    update(dt) {
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const tween = this.tweens[i];
            if (!tween) continue;
            tween.elapsed += dt;

            let progress = tween.elapsed / tween.duration;
            if (progress > 1) progress = 1;
            const curved = tween.easing(progress);

            if (tween.poolRef) {
                const pool = tween.poolRef;
                for (const prop in tween.properties) {
                    const start = tween.startValues[prop];
                    pool[prop][tween.target] = start + (tween.properties[prop] - start) * curved;
                }
            } else {
                for (const prop in tween.properties) {
                    const start = tween.startValues[prop];
                    tween.target[prop] = start + (tween.properties[prop] - start) * curved;
                }
            }

            if (tween.onUpdate) tween.onUpdate(progress);

            if (progress === 1) {
                const idx = this.tweens.indexOf(tween);
                if (idx > -1) this.tweens.splice(idx, 1);
                if (tween.onComplete) tween.onComplete();
            }
        }
    }
}
