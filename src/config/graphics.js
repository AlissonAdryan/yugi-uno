export const GRAPHICS = {
    // Estado atual (pode ser modificado pela UI)
    isHigh: true,

    // Flags derivados
    get enableFoil() { return this.isHigh; },
    get enableFxLayer() { return this.isHigh; },
    get enablePlasma() { return this.isHigh; },
    get useLighter() { return this.isHigh; },
    get compositeLighter() { return this.isHigh ? 'lighter' : 'source-over'; },
    get maxDpr() { return this.isHigh ? 1.5 : 1; },
    get maxParticles() { return this.isHigh ? 2000 : 500; },
    get particleBurstRatio() { return this.isHigh ? 1 : 0.35; },

    // Salvar e carregar do localStorage
    load() {
        try {
            const saved = localStorage.getItem('yugi-uno:graphics');
            if (saved !== null) {
                this.isHigh = saved === 'true';
            }
        } catch (err) {}
        this.applyDOM();
    },
    
    setHigh(value) {
        this.isHigh = !!value;
        try {
            localStorage.setItem('yugi-uno:graphics', this.isHigh.toString());
        } catch (err) {}
        this.applyDOM();
    },

    applyDOM() {
        // constants.js importa este módulo: em contextos sem DOM (Web Worker, testes em Node) só guarda o estado
        if (typeof document === 'undefined' || !document.body) return;
        if (!this.isHigh) {
            document.body.classList.add('graphics-low');
        } else {
            document.body.classList.remove('graphics-low');
        }
    }
};

GRAPHICS.load();
