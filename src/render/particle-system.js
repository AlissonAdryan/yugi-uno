/**
 * Tipos de Partículas para o Canvas
 */
export const PARTICLE_TYPES = {
    CIRCLE: 0,
    SQUARE: 1,
    SPARK: 2,  // Linha em movimento
    STAR: 3    // Polígono estrela (magia/invocação)
};

import { GRAPHICS } from '../config/graphics.js';

/**
 * ParticleSystem - Motor de Efeitos Visuais (Pilar 1 e 2)
 * Tolerância Zero ao GC: Pré-aloca milhares de partículas em TypedArrays.
 */
export class ParticleSystem {
    constructor(maxParticles = null) {
        this.maxParticles = maxParticles || GRAPHICS.maxParticles;
        
        // TypedArrays (SoA)
        this.active = new Uint8Array(maxParticles);
        this.x = new Float32Array(maxParticles);
        this.y = new Float32Array(maxParticles);
        this.vx = new Float32Array(maxParticles);
        this.vy = new Float32Array(maxParticles);
        this.life = new Float32Array(maxParticles);
        this.maxLife = new Float32Array(maxParticles);
        this.size = new Float32Array(maxParticles);
        this.type = new Uint8Array(maxParticles);
        
        // Cores precisam ser armazenadas (rgba string ou canais separados)
        // Para máxima performance, salvaremos os canais R, G, B em Float32Array (0-255)
        // para facilitar interpolação de cor no futuro, mas por enquanto:
        this.r = new Uint8Array(this.maxParticles);
        this.g = new Uint8Array(this.maxParticles);
        this.b = new Uint8Array(this.maxParticles);
        this.colorStr = new Array(this.maxParticles).fill('rgba(255,255,255,1)');
        this.activeCount = 0;

        this.freeIndexes = [];
        for (let i = maxParticles - 1; i >= 0; i--) {
            this.freeIndexes.push(i);
        }

        // Área visível em coordenadas virtuais (atualizada pelo GameClient no resize)
        this.boundsWidth = 0;
        this.boundsHeight = 0;
    }

    setBounds(width, height) {
        this.boundsWidth = width;
        this.boundsHeight = height;
    }

    /**
     * Emite uma única partícula
     */
    emit(x, y, vx, vy, life, size, type, r, g, b) {
        if (this.freeIndexes.length === 0) return; // Pool cheio (drop silêncioso para não estourar memória)

        const idx = this.freeIndexes.pop();
        this.active[idx] = 1;
        this.x[idx] = x;
        this.y[idx] = y;
        this.vx[idx] = vx;
        this.vy[idx] = vy;
        this.life[idx] = life;
        this.maxLife[idx] = life;
        this.size[idx] = size;
        this.type[idx] = type;
        this.r[idx] = r;
        this.g[idx] = g;
        this.b[idx] = b;
        this.colorStr[idx] = `rgb(${r},${g},${b})`;
        this.activeCount++;
    }

    /**
     * Utilitário para explodir uma onda de magia ou impacto
     * @param {number} x 
     * @param {number} y 
     * @param {string} hexColor Cor em hex (ex: '#ff0000')
     * @param {number} count Quantidade
     * @param {number} speed Velocidade base
     * @param {number} type Tipo PARTICLE_TYPES
     */
    emitBurst(x, y, hexColor, count = 50, speed = 200, type = PARTICLE_TYPES.CIRCLE, sizeScale = 1) {
        count = Math.floor(count * GRAPHICS.particleBurstRatio);
        if (count <= 0) return;
        // Converte hex para RGB puro matematicamente
        const r = parseInt(hexColor.slice(1, 3), 16) || 255;
        const g = parseInt(hexColor.slice(3, 5), 16) || 255;
        const b = parseInt(hexColor.slice(5, 7), 16) || 255;

        for (let i = 0; i < count; i++) {
            // Distribuição circular aleatória
            const angle = Math.random() * Math.PI * 2;
            const velocity = (Math.random() * speed) + (speed * 0.2); // variação de velocidade
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;

            const life = (Math.random() * 0.5) + 0.5; // Duração: 0.5s a 1.0s
            const size = ((Math.random() * 6) + 2) * sizeScale; // Tamanho: 2 a 8px (x escala)

            this.emit(x, y, vx, vy, life, size, type, r, g, b);
        }
    }

    /**
     * Partículas subindo de uma área (luz divina, cura): nascem espalhadas em volta de (x,y)
     * e flutuam pra cima com leve deriva lateral, vivendo mais que uma explosão comum.
     */
    emitRise(x, y, hexColor, count = 40, spread = 50, speed = 300, type = PARTICLE_TYPES.STAR) {
        count = Math.floor(count * GRAPHICS.particleBurstRatio);
        if (count <= 0) return;
        const r = parseInt(hexColor.slice(1, 3), 16) || 255;
        const g = parseInt(hexColor.slice(3, 5), 16) || 255;
        const b = parseInt(hexColor.slice(5, 7), 16) || 255;
        for (let i = 0; i < count; i++) {
            const px = x + (Math.random() - 0.5) * spread * 2;
            const py = y + (Math.random() - 0.5) * spread * 0.8;
            const vx = (Math.random() - 0.5) * speed * 0.35;
            const vy = -(speed * (0.45 + Math.random() * 0.55));
            const life = 0.8 + Math.random() * 0.9;
            const size = 2 + Math.random() * 5;
            this.emit(px, py, vx, vy, life, size, type, r, g, b);
        }
    }

    /** Rastro de faíscas espalhadas ao longo de um segmento (ex.: energia do slot USE indo até a vida). */
    emitLine(x0, y0, x1, y1, hexColor, count = 30, type = PARTICLE_TYPES.STAR) {
        count = Math.floor(count * GRAPHICS.particleBurstRatio);
        if (count <= 0) return;
        const r = parseInt(hexColor.slice(1, 3), 16) || 255;
        const g = parseInt(hexColor.slice(3, 5), 16) || 255;
        const b = parseInt(hexColor.slice(5, 7), 16) || 255;
        for (let i = 0; i < count; i++) {
            const t = count > 1 ? i / (count - 1) : 0;
            const px = x0 + (x1 - x0) * t + (Math.random() - 0.5) * 14;
            const py = y0 + (y1 - y0) * t + (Math.random() - 0.5) * 14;
            const vx = (Math.random() - 0.5) * 60;
            const vy = (Math.random() - 0.5) * 60;
            // Quem está mais perto do destino vive mais: o rastro "chega" e se apaga do início pro fim
            const life = 0.35 + t * 0.6 + Math.random() * 0.2;
            const size = 2 + Math.random() * 4;
            this.emit(px, py, vx, vy, life, size, type, r, g, b);
        }
    }

    /**
     * Utilitário para Efeito de Dano em Massa (Onda de Sangue/Impacto da borda da tela)
     */
    emitDamageWave(isPlayerTakingDamage, hexColor, count = 150, type = PARTICLE_TYPES.SQUARE) {
        count = Math.floor(count * GRAPHICS.particleBurstRatio);
        if (count <= 0) return;
        const r = parseInt(hexColor.slice(1, 3), 16) || 255;
        const g = parseInt(hexColor.slice(3, 5), 16) || 255;
        const b = parseInt(hexColor.slice(5, 7), 16) || 255;

        const w = this.boundsWidth;
        const h = this.boundsHeight;

        for (let i = 0; i < count; i++) {
            // Espalha a origem no eixo X em 60% da área da tela (centralizado)
            const spreadX = (w * 0.2) + (Math.random() * w * 0.6);
            
            let y, vy;
            if (isPlayerTakingDamage) {
                // Jogador toma dano: vem da parte de baixo e sobe pro centro
                y = h + 20; // Começa um pouco fora da tela embaixo
                vy = -((Math.random() * 600) + 300); // Força pra cima
            } else {
                // CPU toma dano: vem da parte de cima e desce pro centro
                y = -20; // Começa um pouco fora da tela em cima
                vy = (Math.random() * 600) + 300; // Força pra baixo
            }
            
            // Leve dispersão lateral
            const vx = (Math.random() - 0.5) * 300; 
            
            const life = (Math.random() * 0.8) + 0.6; // Vive até 1.4s
            const size = (Math.random() * 12) + 6; // Partículas brutas e grandes

            this.emit(spreadX, y, vx, vy, life, size, type, r, g, b);
        }
    }

    /**
     * Utilitário: Magia direcional (ex: ataque de uma carta para outra)
     */
    emitTrail(startX, startY, endX, endY, hexColor, count = 20) {
        count = Math.floor(count * GRAPHICS.particleBurstRatio);
        if (count <= 0) return;
        const dx = endX - startX;
        const dy = endY - startY;
        const dist = Math.hypot(dx, dy);
        
        const r = parseInt(hexColor.slice(1, 3), 16) || 255;
        const g = parseInt(hexColor.slice(3, 5), 16) || 255;
        const b = parseInt(hexColor.slice(5, 7), 16) || 255;

        for (let i = 0; i < count; i++) {
            const spreadX = (Math.random() - 0.5) * 50;
            const spreadY = (Math.random() - 0.5) * 50;
            const vx = (dx / dist) * 300 + spreadX;
            const vy = (dy / dist) * 300 + spreadY;
            
            const life = Math.random() * 0.3 + 0.2;
            this.emit(startX, startY, vx, vy, life, 3, PARTICLE_TYPES.SPARK, r, g, b);
        }
    }

    /**
     * Atualiza a física de todas as partículas
     * @param {number} dt Delta time em segundos (ex: 0.016 para 60fps)
     */
    update(dt) {
        if (this.activeCount === 0) return;
        const max = this.maxParticles;
        const friction = 0.95; // Arrasto atmosférico
        
        for (let i = 0; i < max; i++) {
            if (this.active[i] === 1) {
                // Atualiza vida
                this.life[i] -= dt;
                
                if (this.life[i] <= 0) {
                    this.active[i] = 0;
                    this.activeCount--;
                    this.freeIndexes.push(i);
                    continue;
                }

                // Física básica (Integrador de Euler)
                this.x[i] += this.vx[i] * dt;
                this.y[i] += this.vy[i] * dt;
                
                // Aplica atrito para desacelerar partículas com o tempo
                this.vx[i] *= friction;
                this.vy[i] *= friction;
            }
        }
    }

    /**
     * Desenha as partículas. Chama diretamente do Renderer.
     * @param {CanvasRenderingContext2D} ctx 
     */
    draw(ctx) {
        if (this.activeCount === 0) return;

        // Efeito de brilho aditivo (Overlap de cores gera branco incandescente) ou opaco se gráficos baixos
        ctx.globalCompositeOperation = GRAPHICS.useLighter ? 'lighter' : 'source-over';

        const max = this.maxParticles;

        for (let i = 0; i < max; i++) {
            if (this.active[i] === 1) {
                const x = this.x[i];
                const y = this.y[i];
                const size = this.size[i];
                const type = this.type[i];
                
                // Fade out baseado na vida
                const alpha = Math.max(0, this.life[i] / this.maxLife[i]);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = this.colorStr[i];
                
                ctx.beginPath();
                
                if (type === PARTICLE_TYPES.CIRCLE) {
                    ctx.arc(x, y, size * alpha, 0, Math.PI * 2);
                    ctx.fill();
                } else if (type === PARTICLE_TYPES.SQUARE) {
                    const s = size * alpha;
                    ctx.fillRect(x - s/2, y - s/2, s, s);
                } else if (type === PARTICLE_TYPES.SPARK) {
                    // Desenha uma linha na direção do movimento
                    ctx.strokeStyle = ctx.fillStyle;
                    ctx.lineWidth = size * alpha;
                    ctx.moveTo(x, y);
                    // Rastro baseado na velocidade
                    ctx.lineTo(x - this.vx[i] * 0.05, y - this.vy[i] * 0.05);
                    ctx.stroke();
                } else if (type === PARTICLE_TYPES.STAR) {
                    // Geometria procedural da Estrela
                    const spikes = 4;
                    const outerRadius = size * alpha;
                    const innerRadius = outerRadius * 0.3;
                    let rot = Math.PI / 2 * 3;
                    let cx = x, cy = y;
                    let step = Math.PI / spikes;

                    ctx.moveTo(cx, cy - outerRadius);
                    for(let k=0; k<spikes; k++){
                        cx = x + Math.cos(rot) * outerRadius;
                        cy = y + Math.sin(rot) * outerRadius;
                        ctx.lineTo(cx, cy);
                        rot += step;

                        cx = x + Math.cos(rot) * innerRadius;
                        cy = y + Math.sin(rot) * innerRadius;
                        ctx.lineTo(cx, cy);
                        rot += step;
                    }
                    ctx.lineTo(x, y - outerRadius);
                    ctx.fill();
                }
            }
        }
        
        // Restaura alfa e composição normal para o resto do jogo
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
    }
}
