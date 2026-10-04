import { PARTICLE_TYPES } from './particle-system.js';
import { SURGE_PHASE } from '../network/protocol.js';
import { SFX } from '../config/sound-presets.js';
import { i18n } from '../i18n/index.js';

/**
 * Cinemáticas do Evento da Arena (EVENT.SURGE, GAME_RULES §9). A roleta e o selo moram na HUD (SurgeHud);
 * aqui entram o tempo da fila, o estouro de partículas no instante em que a roleta crava e o aviso de fim.
 * Espectadores recebem o mesmo evento e veem a mesma coisa.
 * @param {import('./cinematic-player.js').CinematicPlayer} p
 * @param {{ phase: number, kind: number, turns: number }} evt
 */
export async function surgeCinematic(p, evt) {
    const surge = p.hud.surge;
    if (evt.phase === SURGE_PHASE.END) {
        p.audio.play(SFX.SURGE_END);
        p.hud.showSpecialAlert(i18n.t('SURGE_ENDED'), 'alert-surge');
        return;
    }
    const cx = p.viewport.width / 2;
    const cy = p.viewport.height / 2;
    await surge.playReveal(evt.kind, evt.turns, (color) => {
        p.particles.emitBurst(cx, cy, color, 70, 640, PARTICLE_TYPES.STAR);
        p.particles.emitBurst(cx, cy, '#ffffff', 28, 420, PARTICLE_TYPES.CIRCLE);
        if (p.fx) p.fx.ring(cx, cy, 30, 460, 700, color, 4);
    });
}

/** Partida nova / reconexão: a roleta em andamento some (o selo segue o snapshot). */
export function surgeReset(p) {
    p.hud.surge.cancel();
}
