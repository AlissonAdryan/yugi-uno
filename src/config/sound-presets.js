import { CONFIG } from './constants.js';

const { BUS } = CONFIG.AUDIO;

/**
 * Biblioteca de sons sintetizados em tempo real (dados puros, sem arquivos).
 * Formato documentado em src/audio/synth.js (SoundSpec). Frequências aceitam Hz ou nota ("A4", "C#5", "Eb3").
 * Qualquer som pode ser tocado curto/médio/longo e transposto: audio.play(SFX.CLASH, { length: 'LONG', pitch: -3 }).
 * Para um som novo basta adicionar uma entrada aqui; ele vira SFX.NOME automaticamente.
 */
export const SOUND_PRESETS = Object.freeze({
    // --- Interface ------------------------------------------------------------
    CLICK: {
        bus: BUS.UI, duration: 0.06, volume: 0.6, cooldown: 0.03, pitchJitter: 0.6,
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.015 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 1800, freqEnd: 900, sweepTime: 0.04 },
            { kind: 'noise', color: 'white', gain: 0.35, duration: 0.02, filter: { type: 'highpass', freq: 3500 } }
        ]
    },
    HOVER: {
        bus: BUS.UI, duration: 0.05, volume: 0.1, cooldown: 0.05, pitchJitter: 0.4,
        envelope: { attack: 0.004, decay: 0.03, sustain: 0.2, release: 0.015 },
        layers: [{ kind: 'tone', wave: 'sine', freq: 2200, freqEnd: 2600 }]
    },
    CONFIRM: {
        bus: BUS.UI, duration: 0.12, volume: 0.1,
        envelope: { attack: 0.004, decay: 0.06, sustain: 0.4, release: 0.05 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'E5' },
            { kind: 'tone', wave: 'sine', freq: 'E6', gain: 0.3 }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.09, semitones: 7 }],
        echo: { delay: 0.11, feedback: 0.25, mix: 0.2 }
    },
    ERROR: {
        bus: BUS.UI, duration: 0.22, volume: 0.1, cooldown: 0.1,
        envelope: { attack: 0.003, decay: 0.05, sustain: 0.7, release: 0.06 },
        filter: { type: 'lowpass', freq: 1400, q: 0.8 },
        layers: [
            { kind: 'tone', wave: 'square', freq: 170, freqEnd: 140, tremolo: { rate: 28, depth: 0.45 } },
            { kind: 'tone', wave: 'sawtooth', freq: 174, gain: 0.5 }
        ]
    },

    // --- Cartas ---------------------------------------------------------------
    CARD_DRAW: {
        duration: 0.2, volume: 0.3, pitchJitter: 1.5,
        envelope: { attack: 0.03, decay: 0.1, sustain: 0.3, release: 0.06 },
        layers: [
            { kind: 'noise', color: 'pink', filter: { type: 'bandpass', freq: 700, freqEnd: 3200, q: 1.2 } },
            { kind: 'tone', wave: 'sine', freq: 420, freqEnd: 900, gain: 0.15 }
        ]
    },
    CARD_PLACE: {
        duration: 0.14, volume: 0.1, pitchJitter: 1,
        envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.02 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 170, freqEnd: 60 },
            { kind: 'noise', color: 'brown', gain: 0.6, duration: 0.06, filter: { type: 'lowpass', freq: 900 } },
            { kind: 'noise', color: 'white', gain: 0.25, duration: 0.015, filter: { type: 'highpass', freq: 4000 } }
        ]
    },
    CARD_FLIP: {
        duration: 0.07, volume: 0.1, pitchJitter: 2,
        envelope: { attack: 0.002, decay: 0.05, sustain: 0, release: 0.015 },
        layers: [
            { kind: 'noise', color: 'white', filter: { type: 'bandpass', freq: 2600, q: 1.6 } },
            { kind: 'tone', wave: 'triangle', freq: 1200, freqEnd: 2100, gain: 0.2 }
        ]
    },
    SHUFFLE: {
        duration: 0.05, volume: 0.1,
        envelope: { attack: 0.002, decay: 0.04, sustain: 0, release: 0.01 },
        layers: [{ kind: 'noise', color: 'white', filter: { type: 'bandpass', freq: 2200, q: 1.4 } }],
        sequence: { step: 0.045, semitones: [0, 2, -1, 3, 1, 4, 0, 5, 2, 6] }
    },
    REVEAL: {
        duration: 0.5, volume: 0.03,
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.25 },
        layers: [
            { kind: 'fm', freq: 'E6', modRatio: 3.5, modIndex: 2.5, modIndexEnd: 0.2 },
            { kind: 'tone', wave: 'sine', freq: 'B6', gain: 0.35, delay: 0.04, tremolo: { rate: 14, depth: 0.4 } }
        ],
        echo: { delay: 0.12, feedback: 0.35, mix: 0.3 }
    },

    // --- Combate --------------------------------------------------------------
    CLASH: {
        duration: 0.4, volume: 0.1, pitchJitter: 0.8, distortion: 0.25,
        envelope: { attack: 0.001, decay: 0.18, sustain: 0.15, release: 0.18 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.7, duration: 0.25, filter: { type: 'lowpass', freq: 7000, freqEnd: 500 } },
            { kind: 'tone', wave: 'sine', freq: 190, freqEnd: 45, sweepTime: 0.3 },
            { kind: 'tone', wave: 'square', freq: 95, freqEnd: 40, gain: 0.2, duration: 0.15 }
        ]
    },
    TIE: {
        duration: 0.3, volume: 0.1, distortion: 0.2,
        envelope: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.12 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.6, duration: 0.2, filter: { type: 'lowpass', freq: 5000, freqEnd: 600 } },
            { kind: 'tone', wave: 'sine', freq: 160, freqEnd: 50 }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.08, semitones: -4, volume: 0.8 }]
    },
    DESTROY: {
        duration: 1, volume: 0.1, distortion: 0.35, pitchJitter: 1,
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.35, release: 0.55 },
        layers: [
            { kind: 'noise', color: 'brown', filter: { type: 'lowpass', freq: 2400, freqEnd: 140 } },
            { kind: 'noise', color: 'white', gain: 0.45, duration: 0.3, filter: { type: 'lowpass', freq: 9000, freqEnd: 900 } },
            { kind: 'tone', wave: 'sine', freq: 95, freqEnd: 28, gain: 0.8 }
        ]
    },
    // --- Fusão de combo (1+0 -> 10, 2+0 -> 20) -----------------------------------
    // O 0 mergulha no 1/2: arpejo ascendente de absorção + baque grave no instante do impacto
    FUSION: {
        duration: 0.68, volume: 0.12,
        envelope: { attack: 0.004, decay: 0.12, sustain: 0.35, release: 0.28 },
        layers: [
            { kind: 'fm', freq: 'A5', modRatio: 2.4, modIndex: 3.5, modIndexEnd: 0.2 },
            { kind: 'tone', wave: 'sine', freq: 'E6', gain: 0.3, tremolo: { rate: 20, depth: 0.3 } },
            { kind: 'noise', color: 'white', gain: 0.4, duration: 0.1, delay: 0.02, filter: { type: 'bandpass', freq: 1200, freqEnd: 3800, q: 1.4 } },
            { kind: 'tone', wave: 'sine', freq: 85, freqEnd: 42, gain: 0.6, delay: 0.3, duration: 0.34 }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.07, semitones: 4 }, { at: 0.14, semitones: 7 },
            { at: 0.21, semitones: 12, volume: 0.95 }
        ],
        echo: { delay: 0.14, feedback: 0.4, mix: 0.32 }
    },
    // Desfusão (Block/Reverso quebram a fusão): estalo seco e as duas partes voam em direções opostas
    UNFUSE: {
        duration: 0.42, volume: 0.11, distortion: 0.15,
        envelope: { attack: 0.001, decay: 0.14, sustain: 0.15, release: 0.18 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.7, duration: 0.05, filter: { type: 'highpass', freq: 2600 } },
            { kind: 'tone', wave: 'triangle', freq: 'C5', freqEnd: 'C6', gain: 0.4, sweepTime: 0.16 },
            { kind: 'tone', wave: 'triangle', freq: 'C4', freqEnd: 'C3', gain: 0.4, sweepTime: 0.16, delay: 0.02 },
            { kind: 'noise', color: 'brown', gain: 0.4, duration: 0.12, delay: 0.02, filter: { type: 'lowpass', freq: 600, freqEnd: 150 } }
        ],
        echo: { delay: 0.1, feedback: 0.25, mix: 0.2 }
    },

    SUMMON: {
        duration: 0.95, volume: 0.1,
        envelope: { attack: 0.08, decay: 0.2, sustain: 0.6, release: 0.3 },
        filter: { type: 'lowpass', freq: 400, freqEnd: 6000, q: 5 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 110, freqEnd: 880, sweepTime: 0.75 },
            { kind: 'tone', wave: 'sawtooth', freq: 110, freqEnd: 880, sweepTime: 0.75, detune: 14, gain: 0.6 },
            { kind: 'fm', freq: 'A5', modRatio: 2.01, modIndex: 0.5, modIndexEnd: 4, gain: 0.25, delay: 0.3 },
            { kind: 'noise', color: 'pink', gain: 0.25, filter: { type: 'bandpass', freq: 500, freqEnd: 5000, q: 2 } }
        ],
        echo: { delay: 0.16, feedback: 0.4, mix: 0.3 }
    },
    BLOCK: {
        duration: 0.75, volume: 0.1,
        envelope: { attack: 0.001, decay: 0.25, sustain: 0.2, release: 0.4 },
        layers: [
            { kind: 'fm', freq: 'A4', modRatio: 1.414, modIndex: 8, modIndexEnd: 0.4 },
            { kind: 'fm', freq: 'E5', modRatio: 2.76, modIndex: 4, modIndexEnd: 0.2, gain: 0.5 },
            { kind: 'noise', color: 'white', gain: 0.4, duration: 0.03, filter: { type: 'highpass', freq: 2500 } }
        ],
        echo: { delay: 0.09, feedback: 0.3, mix: 0.2 }
    },
    // Áudio "ao contrário": envelope com ataque longo (crescendo) e corte quase instantâneo no fim —
    // o oposto de um som normal (ataque rápido, cauda longa) — coroado por um "clique" seco bem no final,
    // imitando o transiente de um som tocado de trás pra frente.
    REVERSE: {
        duration: 0.55, volume: 0.1,
        envelope: { attack: 0.42, decay: 0.02, sustain: 1, release: 0.06 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.5, filter: { type: 'bandpass', freq: 150, freqEnd: 5500, q: 5 } },
            { kind: 'tone', wave: 'sawtooth', freq: 90, freqEnd: 1200, sweepCurve: 'exp' },
            { kind: 'tone', wave: 'sawtooth', freq: 90, freqEnd: 1200, sweepCurve: 'exp', detune: 12, gain: 0.6 },
            // O "clique" do transiente invertido: pico curto e seco no instante exato do corte
            {
                kind: 'tone', wave: 'sine', freq: 3800, delay: 0.44, duration: 0.05, gain: 0.6,
                envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.02 }
            }
        ],
        echo: { delay: 0.09, feedback: 0.25, mix: 0.2 }
    },
    DIRECT_HIT: {
        duration: 0.6, volume: 0.07, distortion: 0.45,
        envelope: { attack: 0.001, decay: 0.25, sustain: 0.2, release: 0.3 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.8, duration: 0.2, filter: { type: 'lowpass', freq: 10000, freqEnd: 700 } },
            { kind: 'noise', color: 'brown', gain: 0.8, filter: { type: 'lowpass', freq: 1200, freqEnd: 120 } },
            { kind: 'tone', wave: 'sine', freq: 140, freqEnd: 32, sweepTime: 0.45 }
        ]
    },
    DAMAGE: {
        duration: 0.45, volume: 0.1,
        envelope: { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.2 },
        filter: { type: 'lowpass', freq: 1800, freqEnd: 400 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 120, freqEnd: 50 },
            { kind: 'tone', wave: 'sawtooth', freq: 'D3', freqEnd: 'A2', gain: 0.25 },
            { kind: 'noise', color: 'brown', gain: 0.5, duration: 0.1 }
        ]
    },
    LOCKOUT: {
        duration: 0.55, volume: 0.1,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.2 },
        filter: { type: 'lowpass', freq: 2000, q: 2 },
        layers: [
            { kind: 'tone', wave: 'square', freq: 'C3', tremolo: { rate: 18, depth: 0.5 } },
            { kind: 'tone', wave: 'square', freq: 'F#3', gain: 0.7, tremolo: { rate: 18, depth: 0.5 } }
        ]
    },
    HAND_SWAP: {
        duration: 0.9, volume: 0.1,
        envelope: { attack: 0.15, decay: 0.2, sustain: 0.6, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'pink', duration: 0.45, filter: { type: 'bandpass', freq: 300, freqEnd: 3500, q: 2.5 } },
            { kind: 'noise', color: 'pink', delay: 0.4, duration: 0.5, filter: { type: 'bandpass', freq: 3500, freqEnd: 300, q: 2.5 } },
            { kind: 'tone', wave: 'sine', freq: 'E5', freqEnd: 'E6', gain: 0.2, vibrato: { rate: 6, depth: 30 } }
        ],
        echo: { delay: 0.18, feedback: 0.35, mix: 0.25 }
    },
    CONSUMABLE: {
        duration: 0.45, volume: 0.1,
        envelope: { attack: 0.002, decay: 0.15, sustain: 0.3, release: 0.2 },
        layers: [
            { kind: 'noise', color: 'pink', filter: { type: 'bandpass', freq: 1800, freqEnd: 300, q: 1.2 } },
            { kind: 'fm', freq: 'C7', modRatio: 1.5, modIndex: 3, modIndexEnd: 0, gain: 0.25, delay: 0.05 }
        ],
        echo: { delay: 0.1, feedback: 0.3, mix: 0.25 }
    },

    // --- Consumíveis de vida ---------------------------------------------------
    // Cura usada: arpejo cristalino subindo, suave
    HEAL_USE: {
        duration: 0.22, volume: 0.09,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.35, release: 0.1 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 'E5' },
            { kind: 'tone', wave: 'triangle', freq: 'E6', gain: 0.25 }
        ],
        sequence: { step: 0.06, semitones: [0, 4, 7, 12, 16] },
        echo: { delay: 0.12, feedback: 0.35, mix: 0.3 }
    },
    // Cura aplicada: acorde quente abrindo + brilho de ar
    HEAL: {
        duration: 0.9, volume: 0.1,
        envelope: { attack: 0.06, decay: 0.25, sustain: 0.5, release: 0.45 },
        filter: { type: 'lowpass', freq: 1800, freqEnd: 5200, q: 0.8 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'G4', vibrato: { rate: 5, depth: 8 } },
            { kind: 'tone', wave: 'triangle', freq: 'B4', gain: 0.8, vibrato: { rate: 5.4, depth: 8 } },
            { kind: 'tone', wave: 'sine', freq: 'D5', gain: 0.7 },
            { kind: 'tone', wave: 'sine', freq: 'G5', gain: 0.35, delay: 0.12 },
            { kind: 'noise', color: 'pink', gain: 0.12, filter: { type: 'bandpass', freq: 2500, freqEnd: 7000, q: 1.5 } }
        ],
        echo: { delay: 0.16, feedback: 0.35, mix: 0.3 }
    },
    // Cura desperdiçada: um "puff" apagado descendo
    FIZZLE: {
        duration: 0.35, volume: 0.07,
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.15 },
        layers: [
            { kind: 'noise', color: 'pink', filter: { type: 'bandpass', freq: 1400, freqEnd: 250, q: 1.5 } },
            { kind: 'tone', wave: 'sine', freq: 'A4', freqEnd: 'A3', gain: 0.35 }
        ]
    },
    // Escudo erguido: zumbido de campo de força subindo + "ping" metálico
    SHIELD_UP: {
        duration: 0.7, volume: 0.09,
        envelope: { attack: 0.04, decay: 0.2, sustain: 0.45, release: 0.3 },
        filter: { type: 'lowpass', freq: 600, freqEnd: 5000, q: 4 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 110, freqEnd: 440, sweepTime: 0.45 },
            { kind: 'tone', wave: 'sawtooth', freq: 110, freqEnd: 440, sweepTime: 0.45, detune: 12, gain: 0.6 },
            { kind: 'fm', freq: 'E6', modRatio: 1.414, modIndex: 5, modIndexEnd: 0.2, gain: 0.35, delay: 0.3 }
        ],
        echo: { delay: 0.1, feedback: 0.35, mix: 0.25 }
    },
    // Golpe absorvido pelo Escudo: "tink" de energia com reverberação curta
    SHIELD_HIT: {
        duration: 0.5, volume: 0.1, pitchJitter: 0.6,
        envelope: { attack: 0.001, decay: 0.2, sustain: 0.15, release: 0.25 },
        layers: [
            { kind: 'fm', freq: 'A5', modRatio: 1.414, modIndex: 6, modIndexEnd: 0.3 },
            { kind: 'tone', wave: 'sine', freq: 'E6', gain: 0.4, tremolo: { rate: 22, depth: 0.35 } },
            { kind: 'noise', color: 'white', gain: 0.35, duration: 0.04, filter: { type: 'highpass', freq: 3000 } }
        ],
        echo: { delay: 0.08, feedback: 0.3, mix: 0.25 }
    },
    // Reviver usado: coro angelical em cadência plagal (IV -> I, o "amém")
    REVIVE_USE: {
        duration: 1.05, volume: 0.11,
        envelope: { attack: 0.3, decay: 0.25, sustain: 0.7, release: 0.7 },
        filter: { type: 'lowpass', freq: 3200, q: 0.7 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'C5', vibrato: { rate: 5, depth: 12 } },
            { kind: 'tone', wave: 'triangle', freq: 'E5', gain: 0.8, vibrato: { rate: 5.3, depth: 12 } },
            { kind: 'tone', wave: 'triangle', freq: 'G5', gain: 0.7, vibrato: { rate: 4.8, depth: 12 } },
            { kind: 'tone', wave: 'sine', freq: 'C6', gain: 0.45, detune: 6 },
            { kind: 'tone', wave: 'sawtooth', freq: 'C4', gain: 0.1, detune: -8 },
            {
                kind: 'fm', freq: 'C7', modRatio: 3.5, modIndex: 2, modIndexEnd: 0, gain: 0.18, delay: 0.2,
                envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.3 }
            }
        ],
        notes: [{ at: 0, semitones: 5, volume: 0.85 }, { at: 0.6, semitones: 0, duration: 1.3 }],
        echo: { delay: 0.22, feedback: 0.45, mix: 0.35 }
    },
    // Reviver salvando da morte: sinos + coro crescendo, bem luminoso
    REVIVE_SAVE: {
        duration: 0.9, volume: 0.13,
        envelope: { attack: 0.12, decay: 0.3, sustain: 0.65, release: 0.8 },
        filter: { type: 'lowpass', freq: 2000, freqEnd: 6500, q: 0.8 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'D5', vibrato: { rate: 5.2, depth: 14 } },
            { kind: 'tone', wave: 'triangle', freq: 'F#5', gain: 0.8, vibrato: { rate: 5, depth: 14 } },
            { kind: 'tone', wave: 'triangle', freq: 'A5', gain: 0.75, vibrato: { rate: 5.5, depth: 14 } },
            { kind: 'tone', wave: 'sine', freq: 'D6', gain: 0.4 },
            {
                kind: 'fm', freq: 'D7', modRatio: 3.5, modIndex: 3, modIndexEnd: 0, gain: 0.3,
                envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 }
            },
            { kind: 'noise', color: 'pink', gain: 0.1, filter: { type: 'bandpass', freq: 3000, freqEnd: 9000, q: 1.2 } }
        ],
        notes: [
            { at: 0, semitones: 0 },
            { at: 0.45, semitones: 5, volume: 0.85 },
            { at: 0.9, semitones: 0, duration: 1.4 }
        ],
        echo: { delay: 0.24, feedback: 0.45, mix: 0.4 }
    },
    // Carta gigante do Reviver se despedaçando: vidro/cristal quebrando + cascata de brilhos
    REVIVE_SHATTER: {
        duration: 0.7, volume: 0.11,
        envelope: { attack: 0.001, decay: 0.25, sustain: 0.2, release: 0.4 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.8, duration: 0.3, filter: { type: 'highpass', freq: 2500, freqEnd: 6000 } },
            { kind: 'noise', color: 'pink', gain: 0.5, duration: 0.15, filter: { type: 'lowpass', freq: 3000, freqEnd: 400 } },
            {
                kind: 'fm', freq: 'E7', modRatio: 2.76, modIndex: 4, modIndexEnd: 0.1, gain: 0.3,
                envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 }
            }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.07, semitones: -3, volume: 0.6 },
            { at: 0.13, semitones: 4, volume: 0.45 }, { at: 0.2, semitones: -5, volume: 0.35 }
        ],
        echo: { delay: 0.1, feedback: 0.3, mix: 0.3 }
    },

    // --- Pintar -----------------------------------------------------------------
    // Carta usada: "splash" de tinta estourando + arpejo colorido subindo
    PAINT_USE: {
        duration: 0.7, volume: 0.1,
        envelope: { attack: 0.003, decay: 0.25, sustain: 0.3, release: 0.3 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.8, duration: 0.22, filter: { type: 'bandpass', freq: 600, freqEnd: 2600, q: 1.4 } },
            { kind: 'tone', wave: 'sine', freq: 90, freqEnd: 45, gain: 0.5, duration: 0.18 },
            {
                kind: 'tone', wave: 'triangle', freq: 'C5', gain: 0.45, delay: 0.12, duration: 0.5,
                envelope: { attack: 0.005, decay: 0.12, sustain: 0.3, release: 0.2 }
            }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.08, semitones: 4, volume: 0.6 },
            { at: 0.16, semitones: 7, volume: 0.5 }, { at: 0.24, semitones: 12, volume: 0.45 }
        ],
        echo: { delay: 0.12, feedback: 0.35, mix: 0.3 }
    },
    // Pincelada molhada: ruído "escovando" pra cima e pra baixo, com o gotejar agudo por cima
    PAINT_BRUSH: {
        duration: 0.85, volume: 0.1,
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.55, release: 0.25 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.8, filter: { type: 'bandpass', freq: 900, freqEnd: 2800, q: 2.2 }, tremolo: { rate: 7, depth: 0.4 } },
            { kind: 'noise', color: 'brown', gain: 0.5, filter: { type: 'lowpass', freq: 700 } },
            { kind: 'fm', freq: 'G6', modRatio: 1.5, modIndex: 2, modIndexEnd: 0, gain: 0.15, delay: 0.35, duration: 0.2 },
            { kind: 'fm', freq: 'D6', modRatio: 1.5, modIndex: 2, modIndexEnd: 0, gain: 0.12, delay: 0.6, duration: 0.2 }
        ]
    },
    // Tinta assentou: brilho cristalino com a cor "acendendo"
    PAINT_DONE: {
        duration: 0.16, volume: 0.09,
        envelope: { attack: 0.002, decay: 0.08, sustain: 0.3, release: 0.06 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 'E6' },
            { kind: 'fm', freq: 'E7', modRatio: 3.5, modIndex: 1.5, modIndexEnd: 0, gain: 0.3 }
        ],
        sequence: { step: 0.055, semitones: [0, 5, 9, 12, 17] },
        echo: { delay: 0.1, feedback: 0.35, mix: 0.3 }
    },

    // --- Troca de Guarda -------------------------------------------------------
    // Carta usada (só quem usou ouve): engrenagem metálica girando + dois "tics" subindo
    GUARD_SWAP_USE: {
        duration: 0.6, volume: 0.6,
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.35, release: 0.25 },
        filter: { type: 'bandpass', freq: 900, freqEnd: 3200, q: 1.6 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.6, tremolo: { rate: 16, depth: 0.6 } },
            { kind: 'fm', freq: 'A5', modRatio: 1.41, modIndex: 3, modIndexEnd: 0.4, gain: 0.45, delay: 0.05 },
            { kind: 'fm', freq: 'E6', modRatio: 1.41, modIndex: 3, modIndexEnd: 0.4, gain: 0.35, delay: 0.22 }
        ],
        echo: { delay: 0.11, feedback: 0.3, mix: 0.25 }
    },
    // A troca no combate (os dois ouvem): varredura de ar girando nos dois sentidos + "clack" no encaixe
    GUARD_SWAP: {
        duration: 0.85, volume: 0.3,
        envelope: { attack: 0.06, decay: 0.2, sustain: 0.5, release: 0.25 },
        layers: [
            { kind: 'noise', color: 'pink', duration: 0.5, filter: { type: 'bandpass', freq: 400, freqEnd: 2600, q: 2.4 } },
            { kind: 'noise', color: 'pink', delay: 0.25, duration: 0.45, filter: { type: 'bandpass', freq: 2600, freqEnd: 500, q: 2.4 } },
            { kind: 'tone', wave: 'triangle', freq: 'D5', freqEnd: 'A5', gain: 0.25, vibrato: { rate: 9, depth: 25 } },
            {
                kind: 'fm', freq: 'G4', modRatio: 2.76, modIndex: 5, modIndexEnd: 0.2, gain: 0.5, delay: 0.62,
                envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.12 }
            }
        ],
        echo: { delay: 0.12, feedback: 0.3, mix: 0.2 }
    },
    // Duas Trocas se anulando: as pilhas travam no meio do giro com um "clang" seco
    GUARD_SWAP_CANCEL: {
        duration: 0.45, volume: 0.3, distortion: 0.2,
        envelope: { attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.2 },
        layers: [
            { kind: 'fm', freq: 'C4', modRatio: 3.1, modIndex: 7, modIndexEnd: 0.3 },
            { kind: 'noise', color: 'white', gain: 0.4, duration: 0.05, filter: { type: 'highpass', freq: 2500 } }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.12, semitones: -5, volume: 0.6 }]
    },

    // --- Relâmpago ---------------------------------------------------------------
    // Carga: zumbido elétrico crescendo (a carta "enche" de energia)
    LIGHTNING_CHARGE: {
        duration: 0.4, volume: 0.09,
        envelope: { attack: 0.3, decay: 0.03, sustain: 1, release: 0.05 },
        filter: { type: 'lowpass', freq: 500, freqEnd: 7000, q: 6 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 60, freqEnd: 240, tremolo: { rate: 38, depth: 0.5 } },
            { kind: 'tone', wave: 'square', freq: 120, freqEnd: 480, gain: 0.4, detune: 9 },
            { kind: 'noise', color: 'white', gain: 0.3, filter: { type: 'highpass', freq: 3000 } }
        ]
    },
    // Estalo do raio: rachado agudo seco + trovão grave rolando
    LIGHTNING_STRIKE: {
        duration: 0.9, volume: 0.12, distortion: 0.4, pitchJitter: 0.8,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.25, release: 0.5 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.9, duration: 0.08, filter: { type: 'highpass', freq: 1800 } },
            { kind: 'noise', color: 'brown', gain: 0.9, delay: 0.04, filter: { type: 'lowpass', freq: 900, freqEnd: 90 } },
            { kind: 'tone', wave: 'sine', freq: 110, freqEnd: 30, gain: 0.7, delay: 0.03, sweepTime: 0.6 },
            {
                kind: 'fm', freq: 'E7', modRatio: 3.3, modIndex: 6, modIndexEnd: 0, gain: 0.3,
                envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 }
            }
        ],
        echo: { delay: 0.14, feedback: 0.35, mix: 0.3 }
    },
    // Sobrecarga (Relâmpago na vida): estalos rápidos queimando + chiado
    OVERLOAD: {
        duration: 0.05, volume: 0.1,
        envelope: { attack: 0.001, decay: 0.035, sustain: 0.2, release: 0.02 },
        layers: [
            { kind: 'noise', color: 'white', filter: { type: 'bandpass', freq: 3500, q: 1.2 } },
            { kind: 'tone', wave: 'square', freq: 'A5', gain: 0.35 }
        ],
        sequence: { step: 0.05, semitones: [0, 7, -2, 9, 3, 12, 5, 14] },
        echo: { delay: 0.09, feedback: 0.3, mix: 0.25 }
    },

    // --- Fantasma ---------------------------------------------------------------
    // Atravessando: sussurro reverberante (ruído em formantes de voz subindo/descendo) + tom etéreo
    GHOST_PASS: {
        duration: 0.95, volume: 0.4,
        envelope: { attack: 0.18, decay: 0.2, sustain: 0.6, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.7, filter: { type: 'bandpass', freq: 700, freqEnd: 1900, q: 7 }, tremolo: { rate: 6, depth: 0.5 } },
            { kind: 'noise', color: 'white', gain: 0.35, filter: { type: 'bandpass', freq: 2600, freqEnd: 1200, q: 9 }, tremolo: { rate: 9, depth: 0.6 } },
            { kind: 'tone', wave: 'sine', freq: 'E5', freqEnd: 'B4', gain: 0.25, vibrato: { rate: 5, depth: 35 } },
            { kind: 'tone', wave: 'triangle', freq: 'G5', gain: 0.12, detune: 14, vibrato: { rate: 4.2, depth: 30 } }
        ],
        echo: { delay: 0.23, feedback: 0.5, mix: 0.42 }
    },
    // Chegando na vida: "whoosh" grave e fundo
    GHOST_HIT: {
        duration: 0.7, volume: 0.4,
        envelope: { attack: 0.04, decay: 0.25, sustain: 0.3, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'brown', gain: 0.9, filter: { type: 'lowpass', freq: 1800, freqEnd: 120 } },
            { kind: 'noise', color: 'pink', gain: 0.5, duration: 0.4, filter: { type: 'bandpass', freq: 300, freqEnd: 2400, q: 1.8 } },
            { kind: 'tone', wave: 'sine', freq: 90, freqEnd: 32, gain: 0.8, sweepTime: 0.55 }
        ],
        echo: { delay: 0.18, feedback: 0.35, mix: 0.3 }
    },

    // --- Espelho Sombrio ---------------------------------------------------------
    // Cópia: tinido cristalino subindo (o valor sendo absorvido)
    MIRROR_COPY: {
        duration: 0.14, volume: 0.1,
        envelope: { attack: 0.001, decay: 0.09, sustain: 0.25, release: 0.07 },
        layers: [
            { kind: 'fm', freq: 'E6', modRatio: 3.5, modIndex: 3, modIndexEnd: 0.2 },
            { kind: 'tone', wave: 'sine', freq: 'B6', gain: 0.35, tremolo: { rate: 24, depth: 0.3 } }
        ],
        sequence: { step: 0.06, semitones: [0, 3, 7, 10, 15] },
        echo: { delay: 0.14, feedback: 0.45, mix: 0.38 }
    },
    // Vidro se estilhaçando
    MIRROR_SHATTER: {
        duration: 0.6, volume: 0.12,
        envelope: { attack: 0.001, decay: 0.22, sustain: 0.2, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.9, duration: 0.28, filter: { type: 'highpass', freq: 2800, freqEnd: 6500 } },
            { kind: 'noise', color: 'pink', gain: 0.5, duration: 0.12, filter: { type: 'lowpass', freq: 3500, freqEnd: 500 } },
            {
                kind: 'fm', freq: 'G7', modRatio: 2.76, modIndex: 5, modIndexEnd: 0.1, gain: 0.35,
                envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.15 }
            }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.05, semitones: 5, volume: 0.6 }, { at: 0.1, semitones: -2, volume: 0.45 },
            { at: 0.16, semitones: 8, volume: 0.35 }, { at: 0.23, semitones: 1, volume: 0.25 }
        ],
        echo: { delay: 0.09, feedback: 0.3, mix: 0.3 }
    },
    // Dano espelhado voltando pro dono: eco sombrio grave
    MIRROR_RECOIL: {
        duration: 0.9, volume: 0.11, distortion: 0.2,
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.35, release: 0.45 },
        filter: { type: 'lowpass', freq: 1400, freqEnd: 300, q: 1.5 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 'D3', freqEnd: 'A2', detune: -12 },
            { kind: 'tone', wave: 'sawtooth', freq: 'D3', freqEnd: 'A2', detune: 12, gain: 0.8 },
            { kind: 'tone', wave: 'sine', freq: 70, freqEnd: 40, gain: 0.8 },
            { kind: 'fm', freq: 'D6', modRatio: 2.76, modIndex: 3, modIndexEnd: 0, gain: 0.15, delay: 0.05 }
        ],
        echo: { delay: 0.26, feedback: 0.5, mix: 0.45 }
    },

    // --- Emboscada ---------------------------------------------------------------
    // Armada (só quem usou ouve): chiado de fumaça tóxica + nota venenosa
    AMBUSH_USE: {
        duration: 0.6, volume: 0.5,
        envelope: { attack: 0.05, decay: 0.25, sustain: 0.3, release: 0.25 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.6, filter: { type: 'bandpass', freq: 4200, freqEnd: 1500, q: 2 } },
            { kind: 'tone', wave: 'triangle', freq: 'F#4', freqEnd: 'C4', gain: 0.3, vibrato: { rate: 7, depth: 20 } }
        ],
        echo: { delay: 0.12, feedback: 0.3, mix: 0.25 }
    },
    // Disparo: mola de armadilha estalando + rugido grave
    AMBUSH_TRIGGER: {
        duration: 0.8, volume: 0.1, distortion: 0.35,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.35, release: 0.35 },
        layers: [
            {
                kind: 'tone', wave: 'square', freq: 'C6', freqEnd: 'C4', sweepTime: 0.09, gain: 0.5, duration: 0.14,
                envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.04 }
            },
            { kind: 'noise', color: 'white', gain: 0.5, duration: 0.04, filter: { type: 'highpass', freq: 3000 } },
            { kind: 'tone', wave: 'sawtooth', freq: 55, freqEnd: 42, gain: 0.8, delay: 0.08, tremolo: { rate: 26, depth: 0.55 } },
            { kind: 'noise', color: 'brown', gain: 0.7, delay: 0.08, filter: { type: 'lowpass', freq: 500, freqEnd: 180 } }
        ],
        echo: { delay: 0.11, feedback: 0.25, mix: 0.2 }
    },

    // Carta reforçada pela Emboscada acertando a vida: picada venenosa (mordida seca + chiado de veneno)
    AMBUSH_STING: {
        duration: 0.7, volume: 0.11, distortion: 0.3,
        envelope: { attack: 0.001, decay: 0.22, sustain: 0.3, release: 0.35 },
        layers: [
            {
                kind: 'tone', wave: 'square', freq: 'E5', freqEnd: 'E3', sweepTime: 0.07, gain: 0.55, duration: 0.1,
                envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.03 }
            },
            { kind: 'noise', color: 'white', gain: 0.6, delay: 0.03, filter: { type: 'bandpass', freq: 6500, freqEnd: 1800, q: 3 }, tremolo: { rate: 22, depth: 0.5 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'F#2', freqEnd: 'C2', gain: 0.5, delay: 0.04, filter: { type: 'lowpass', freq: 700 } },
            { kind: 'tone', wave: 'sine', freq: 'B5', freqEnd: 'F5', gain: 0.18, delay: 0.1, vibrato: { rate: 9, depth: 35 } }
        ],
        echo: { delay: 0.13, feedback: 0.3, mix: 0.25 }
    },
    // Fio farpado chicoteando da vida até o slot de consumível
    USE_LOCK_THREAD: {
        duration: 0.32, volume: 0.1,
        envelope: { attack: 0.005, decay: 0.12, sustain: 0.4, release: 0.12 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.8, filter: { type: 'bandpass', freq: 900, freqEnd: 7000, q: 2.5 } },
            { kind: 'tone', wave: 'triangle', freq: 'C4', freqEnd: 'C6', gain: 0.25, sweepCurve: 'exp' },
            {
                kind: 'fm', freq: 'A6', modRatio: 3.3, modIndex: 5, modIndexEnd: 1, gain: 0.25, delay: 0.24, duration: 0.07,
                envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }
            }
        ]
    },
    // Selo fechando no slot: arame farpado rangendo, trava pesada e o acorde sombrio do olho abrindo
    USE_LOCK: {
        duration: 1.1, volume: 0.12, distortion: 0.2,
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.4, release: 0.5 },
        layers: [
            { kind: 'fm', freq: 'D5', modRatio: 3.3, modIndex: 6, modIndexEnd: 1.5, gain: 0.35, duration: 0.45, tremolo: { rate: 30, depth: 0.6 } },
            { kind: 'noise', color: 'pink', gain: 0.4, duration: 0.4, filter: { type: 'bandpass', freq: 3200, freqEnd: 1200, q: 6 }, tremolo: { rate: 24, depth: 0.7 } },
            {
                kind: 'tone', wave: 'sine', freq: 110, freqEnd: 38, gain: 0.9, delay: 0.38, duration: 0.3,
                envelope: { attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.1 }
            },
            { kind: 'noise', color: 'brown', gain: 0.7, delay: 0.38, duration: 0.12, filter: { type: 'lowpass', freq: 900, freqEnd: 200 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'F#3', gain: 0.22, delay: 0.55, filter: { type: 'lowpass', freq: 1400 }, vibrato: { rate: 5, depth: 12 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'C4', gain: 0.18, delay: 0.55, detune: 9, filter: { type: 'lowpass', freq: 1400 } }
        ],
        echo: { delay: 0.18, feedback: 0.4, mix: 0.35 }
    },

    // --- Ronova, a Sombra da Morte (lendária) -------------------------------------------
    // Invocação (quem usou e espectadores): inchaço demoníaco grave, fogo crepitando e um sussurro descendo
    DEATH_USE: {
        duration: 1.3, volume: 0.5, distortion: 0.15,
        envelope: { attack: 0.12, decay: 0.3, sustain: 0.5, release: 0.55 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 'D2', freqEnd: 'A1', gain: 0.35, detune: -9, filter: { type: 'lowpass', freq: 500 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'D2', freqEnd: 'A1', gain: 0.3, detune: 9, filter: { type: 'lowpass', freq: 500 } },
            { kind: 'noise', color: 'pink', gain: 0.45, filter: { type: 'bandpass', freq: 600, freqEnd: 2600, q: 1.5 }, tremolo: { rate: 17, depth: 0.55 } },
            { kind: 'noise', color: 'pink', gain: 0.3, delay: 0.2, filter: { type: 'bandpass', freq: 1400, freqEnd: 600, q: 9 }, tremolo: { rate: 9, depth: 0.7 } },
            { kind: 'fm', freq: 'F5', modRatio: 2.76, modIndex: 4, modIndexEnd: 0.5, gain: 0.12, delay: 0.25 }
        ],
        echo: { delay: 0.28, feedback: 0.45, mix: 0.4 }
    },
    // O olho cobrindo a tela: drone sub-grave subindo, coro sombrio menor, duas batidas de coração e o rugido do fogo
    DEATH_EYE: {
        duration: 2.6, volume: 0.3, distortion: 0.12,
        envelope: { attack: 0.25, decay: 0.4, sustain: 0.75, release: 0.8 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 38, freqEnd: 52, gain: 0.9 },
            { kind: 'tone', wave: 'sawtooth', freq: 'D3', gain: 0.22, detune: -7, filter: { type: 'lowpass', freq: 900, freqEnd: 1800 }, vibrato: { rate: 4.5, depth: 10 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'F3', gain: 0.18, detune: 6, filter: { type: 'lowpass', freq: 900, freqEnd: 1800 }, vibrato: { rate: 4.1, depth: 10 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'Ab3', gain: 0.16, delay: 0.35, filter: { type: 'lowpass', freq: 1100, freqEnd: 2000 }, vibrato: { rate: 5, depth: 12 } },
            { kind: 'noise', color: 'brown', gain: 0.55, filter: { type: 'lowpass', freq: 300, freqEnd: 1400 }, tremolo: { rate: 13, depth: 0.45 } },
            {
                kind: 'tone', wave: 'sine', freq: 70, freqEnd: 42, gain: 0.95, delay: 0.55, duration: 0.18,
                envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 }
            },
            {
                kind: 'tone', wave: 'sine', freq: 62, freqEnd: 40, gain: 0.75, delay: 0.75, duration: 0.18,
                envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 }
            },
            {
                kind: 'tone', wave: 'sine', freq: 70, freqEnd: 42, gain: 0.95, delay: 1.45, duration: 0.18,
                envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 }
            },
            {
                kind: 'tone', wave: 'sine', freq: 62, freqEnd: 40, gain: 0.75, delay: 1.65, duration: 0.18,
                envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 }
            },
            { kind: 'fm', freq: 'A6', modRatio: 3.3, modIndex: 2, modIndexEnd: 5, gain: 0.05, delay: 0.4, tremolo: { rate: 7, depth: 0.6 } }
        ],
        echo: { delay: 0.32, feedback: 0.5, mix: 0.4 }
    },
    // A pálpebra fechando: batida pesada e um sopro de fogo se recolhendo
    DEATH_CLOSE: {
        duration: 0.7, volume: 0.3, distortion: 0.3,
        envelope: { attack: 0.002, decay: 0.25, sustain: 0.2, release: 0.35 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 95, freqEnd: 30, gain: 1, duration: 0.35 },
            { kind: 'noise', color: 'brown', gain: 0.8, duration: 0.25, filter: { type: 'lowpass', freq: 1200, freqEnd: 150 } },
            { kind: 'noise', color: 'pink', gain: 0.4, filter: { type: 'bandpass', freq: 3000, freqEnd: 400, q: 1.6 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'D2', gain: 0.25, delay: 0.05, filter: { type: 'lowpass', freq: 600, freqEnd: 200 } }
        ],
        echo: { delay: 0.22, feedback: 0.4, mix: 0.3 }
    },
    // A força escorrendo das cartas: brasas estalando numa escada descendente
    DEATH_DRAIN: {
        duration: 0.16, volume: 0.1,
        envelope: { attack: 0.002, decay: 0.1, sustain: 0.25, release: 0.06 },
        layers: [
            { kind: 'fm', freq: 'E5', modRatio: 1.41, modIndex: 4, modIndexEnd: 0.5 },
            { kind: 'noise', color: 'white', gain: 0.35, duration: 0.05, filter: { type: 'bandpass', freq: 2600, q: 2 } }
        ],
        sequence: { step: 0.07, semitones: [0, -2, -5, -7, -10, -12] },
        echo: { delay: 0.12, feedback: 0.35, mix: 0.3 }
    },
    // As chamas carmesim acendendo ("fwoosh")
    DEATH_IGNITE: {
        duration: 0.6, volume: 0.12,
        envelope: { attack: 0.03, decay: 0.2, sustain: 0.35, release: 0.3 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.8, filter: { type: 'bandpass', freq: 250, freqEnd: 2400, q: 1.2 } },
            { kind: 'noise', color: 'white', gain: 0.25, delay: 0.1, filter: { type: 'highpass', freq: 3500 }, tremolo: { rate: 24, depth: 0.7 } },
            { kind: 'tone', wave: 'sine', freq: 90, freqEnd: 55, gain: 0.4 }
        ]
    },
    // Carta consumida pelas chamas: sopro de fogo subindo e o chiado crepitante
    DEATH_BURN: {
        duration: 1, volume: 0.12, distortion: 0.15,
        envelope: { attack: 0.04, decay: 0.3, sustain: 0.45, release: 0.45 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.7, filter: { type: 'bandpass', freq: 300, freqEnd: 3200, q: 1.3 } },
            { kind: 'noise', color: 'white', gain: 0.35, filter: { type: 'highpass', freq: 4000 }, tremolo: { rate: 31, depth: 0.85 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'A2', freqEnd: 'D2', gain: 0.18, filter: { type: 'lowpass', freq: 700 } },
            { kind: 'fm', freq: 'C6', modRatio: 2.4, modIndex: 3, modIndexEnd: 0.2, gain: 0.08, delay: 0.5 }
        ],
        echo: { delay: 0.18, feedback: 0.3, mix: 0.25 }
    },

    // --- Evento da Arena ---------------------------------------------------------
    // Tique da roleta (toca a cada troca de nome, cada vez mais espaçado)
    SURGE_TICK: {
        duration: 0.07, volume: 0.14,
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
        layers: [
            { kind: 'tone', wave: 'square', freq: 'E6', gain: 0.5, filter: { type: 'lowpass', freq: 5200 } },
            { kind: 'noise', color: 'white', gain: 0.25, duration: 0.02, filter: { type: 'highpass', freq: 3000 } }
        ]
    },
    // A roleta crava o evento: batida grave + acorde brilhante subindo, com cauda
    SURGE_REVEAL: {
        duration: 1.5, volume: 0.22,
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.6 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 90, freqEnd: 45, gain: 0.9, duration: 0.35 },
            { kind: 'noise', color: 'pink', gain: 0.45, duration: 0.25, filter: { type: 'lowpass', freq: 2400, freqEnd: 600 } },
            { kind: 'tone', wave: 'triangle', freq: 'C5', gain: 0.35, delay: 0.05 },
            { kind: 'tone', wave: 'triangle', freq: 'E5', gain: 0.3, delay: 0.12 },
            { kind: 'tone', wave: 'triangle', freq: 'G5', gain: 0.3, delay: 0.19 },
            { kind: 'fm', freq: 'C6', modRatio: 3, modIndex: 2.5, modIndexEnd: 0.3, gain: 0.22, delay: 0.26, vibrato: { rate: 6, depth: 8 } }
        ],
        echo: { delay: 0.16, feedback: 0.3, mix: 0.3 }
    },
    // O evento acaba: arpejo descendo e apagando
    SURGE_END: {
        duration: 0.9, volume: 0.16,
        envelope: { attack: 0.01, decay: 0.25, sustain: 0.35, release: 0.4 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'G5', gain: 0.4 },
            { kind: 'noise', color: 'pink', gain: 0.18, filter: { type: 'bandpass', freq: 1800, freqEnd: 500, q: 1.2 } }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.12, semitones: -3 }, { at: 0.24, semitones: -7 }, { at: 0.36, semitones: -12, duration: 0.5 }
        ]
    },

    // --- Maldição ----------------------------------------------------------------
    // Plantada (só quem usou ouve): sussurro maligno sobre um zumbido grave
    CURSE_USE: {
        duration: 1.1, volume: 0.5,
        envelope: { attack: 0.2, decay: 0.25, sustain: 0.55, release: 0.45 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.6, filter: { type: 'bandpass', freq: 900, freqEnd: 500, q: 8 }, tremolo: { rate: 11, depth: 0.7 } },
            { kind: 'noise', color: 'white', gain: 0.3, filter: { type: 'bandpass', freq: 2200, freqEnd: 3200, q: 10 }, tremolo: { rate: 7, depth: 0.6 } },
            { kind: 'tone', wave: 'sawtooth', freq: 'A1', gain: 0.35, detune: 8, filter: { type: 'lowpass', freq: 400 } },
            { kind: 'tone', wave: 'sine', freq: 'Eb3', freqEnd: 'A2', gain: 0.3, vibrato: { rate: 3, depth: 25 } }
        ],
        echo: { delay: 0.3, feedback: 0.5, mix: 0.45 }
    },
    // Disparo: risada sombria abafada ("ha" descendo)
    CURSE_LAUGH: {
        duration: 0.13, volume: 0.1, distortion: 0.15,
        envelope: { attack: 0.01, decay: 0.08, sustain: 0.3, release: 0.05 },
        filter: { type: 'lowpass', freq: 1500, q: 1.5 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 'G3', gain: 0.6, vibrato: { rate: 18, depth: 30 } },
            { kind: 'noise', color: 'pink', gain: 0.4, filter: { type: 'bandpass', freq: 800, q: 4 } }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.16, semitones: -1 }, { at: 0.32, semitones: -3 },
            { at: 0.48, semitones: -5 }, { at: 0.66, semitones: -8, duration: 0.3 }
        ],
        echo: { delay: 0.2, feedback: 0.45, mix: 0.4 }
    },
    // Correntes: elos metálicos batendo
    CURSE_CHAINS: {
        duration: 0.07, volume: 0.1, pitchJitter: 1.5,
        envelope: { attack: 0.001, decay: 0.05, sustain: 0.1, release: 0.03 },
        layers: [
            { kind: 'fm', freq: 'A5', modRatio: 3.3, modIndex: 6, modIndexEnd: 1 },
            { kind: 'noise', color: 'white', gain: 0.4, filter: { type: 'bandpass', freq: 5000, q: 2 } }
        ],
        sequence: { step: 0.06, semitones: [0, -3, 2, -5, 1, -2, 4, -4] },
        echo: { delay: 0.08, feedback: 0.3, mix: 0.25 }
    },
    // Estalo de ossos (a carta racha e o valor cai)
    CURSE_CRACK: {
        duration: 0.35, volume: 0.1, distortion: 0.3,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0.1, release: 0.15 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.9, duration: 0.05, filter: { type: 'bandpass', freq: 1800, q: 1.5 } },
            { kind: 'noise', color: 'brown', gain: 0.7, duration: 0.15, filter: { type: 'lowpass', freq: 900, freqEnd: 200 } },
            { kind: 'tone', wave: 'square', freq: 180, freqEnd: 60, gain: 0.3, duration: 0.08 }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.07, semitones: 3, volume: 0.6 }]
    },

    // --- Combos Supremos: Reverso Kármico ------------------------------------------
    // Ativação: fita K7 ejetada com violência ("CLICK-CLACK!")
    KARMA_EJECT: {
        duration: 0.09, volume: 0.16,
        envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.9, filter: { type: 'bandpass', freq: 2400, q: 2.2 } },
            { kind: 'tone', wave: 'square', freq: 1300, freqEnd: 420, gain: 0.35, filter: { type: 'lowpass', freq: 3000 } },
            { kind: 'noise', color: 'brown', gain: 0.6, duration: 0.04, filter: { type: 'lowpass', freq: 700 } }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.12, semitones: -4, volume: 1.1 }],
        echo: { delay: 0.07, feedback: 0.2, mix: 0.18 }
    },
    // Rebobinando: fita VHS em velocidade máxima (chiado mecânico subindo)
    KARMA_REWIND: {
        duration: 1.4, volume: 0.13, distortion: 0.15,
        envelope: { attack: 0.08, decay: 0.3, sustain: 0.75, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.55, rate: 1.4, filter: { type: 'bandpass', freq: 900, freqEnd: 5200, q: 3 }, tremolo: { rate: 38, depth: 0.45 } },
            { kind: 'tone', wave: 'sawtooth', freq: 220, freqEnd: 1800, gain: 0.16, filter: { type: 'lowpass', freq: 2600 }, vibrato: { rate: 23, depth: 40 } },
            { kind: 'tone', wave: 'square', freq: 55, freqEnd: 140, gain: 0.12, filter: { type: 'lowpass', freq: 500 }, tremolo: { rate: 12, depth: 0.5 } }
        ]
    },
    // Tique-taque de engrenagem grande andando pra trás (junto do rebobinar)
    KARMA_TICK: {
        duration: 0.05, volume: 0.12,
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
        layers: [
            { kind: 'fm', freq: 'E4', modRatio: 2.7, modIndex: 5, modIndexEnd: 0.5 },
            { kind: 'noise', color: 'pink', gain: 0.5, filter: { type: 'bandpass', freq: 1400, q: 3 } }
        ],
        sequence: { step: 0.13, semitones: [0, -5, 0, -5, 0, -5, 0, -5], volumes: [1, 0.7, 1, 0.7, 1, 0.7, 0.8, 0.5] },
        echo: { delay: 0.2, feedback: 0.3, mix: 0.3 }
    },
    // Golpe na vida: curto-circuito pesado ("BZZZZT-KRRRSH") e o vazio abafado depois
    KARMA_ZAP: {
        duration: 0.9, volume: 0.15, distortion: 0.55,
        envelope: { attack: 0.002, decay: 0.2, sustain: 0.45, release: 0.4 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 60, gain: 0.6, duration: 0.5, tremolo: { rate: 50, depth: 0.5 }, filter: { type: 'lowpass', freq: 1800, freqEnd: 400 } },
            { kind: 'tone', wave: 'square', freq: 120, freqEnd: 90, gain: 0.35, duration: 0.5, vibrato: { rate: 31, depth: 60 } },
            { kind: 'noise', color: 'white', gain: 0.7, delay: 0.32, duration: 0.25, filter: { type: 'highpass', freq: 1800, freqEnd: 400 } },
            {
                kind: 'tone', wave: 'sine', freq: 'A2', gain: 0.25, delay: 0.55, duration: 0.35,
                filter: { type: 'lowpass', freq: 500 }, envelope: { attack: 0.05, decay: 0.1, sustain: 0.6, release: 0.3 }
            }
        ],
        echo: { delay: 0.25, feedback: 0.35, mix: 0.3 }
    },
    // Pânico: batida seca a cada segundo da contagem
    PANIC_TICK: {
        bus: BUS.UI, duration: 0.09, volume: 0.14,
        envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 95, freqEnd: 55, gain: 0.9 },
            { kind: 'fm', freq: 'A5', modRatio: 3, modIndex: 3, modIndexEnd: 0, gain: 0.25, duration: 0.03 }
        ]
    },

    // --- Combos Supremos: Prisão de Cristal -----------------------------------------
    // Formação: pilar de concreto pesadíssimo sendo arrastado
    PRISON_DRAG: {
        duration: 0.9, volume: 0.17, distortion: 0.2,
        envelope: { attack: 0.08, decay: 0.2, sustain: 0.7, release: 0.2 },
        layers: [
            { kind: 'noise', color: 'brown', gain: 1, rate: 0.7, filter: { type: 'lowpass', freq: 420, freqEnd: 260 }, tremolo: { rate: 17, depth: 0.45 } },
            { kind: 'noise', color: 'pink', gain: 0.35, filter: { type: 'bandpass', freq: 900, q: 1.4 }, tremolo: { rate: 9, depth: 0.6 } },
            { kind: 'tone', wave: 'triangle', freq: 48, freqEnd: 42, gain: 0.5 }
        ]
    },
    // Queda: assobio rápido + o impacto sub-grave mais pesado do jogo, com eco longo
    PRISON_FALL: {
        duration: 1.6, volume: 0.2, distortion: 0.25,
        envelope: { attack: 0.002, decay: 0.5, sustain: 0.35, release: 1 },
        layers: [
            {
                kind: 'noise', color: 'white', gain: 0.45, duration: 0.3, filter: { type: 'bandpass', freq: 5200, freqEnd: 900, q: 5 },
                envelope: { attack: 0.2, decay: 0.05, sustain: 0.2, release: 0.05 }
            },
            {
                kind: 'tone', wave: 'sine', freq: 70, freqEnd: 24, gain: 1, delay: 0.3, sweepTime: 0.9,
                envelope: { attack: 0.001, decay: 0.6, sustain: 0.4, release: 0.7 }
            },
            { kind: 'noise', color: 'brown', gain: 1, delay: 0.3, duration: 0.6, filter: { type: 'lowpass', freq: 600, freqEnd: 80 } },
            { kind: 'tone', wave: 'square', freq: 40, gain: 0.3, delay: 0.3, duration: 0.25, filter: { type: 'lowpass', freq: 220 } }
        ],
        echo: { delay: 0.42, feedback: 0.55, mix: 0.45 }
    },
    // Congelamento: cristais e estilhaços crescendo agressivamente ("Krrk-krrk-shhhhh")
    PRISON_FREEZE: {
        duration: 0.8, volume: 0.13,
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.6, filter: { type: 'highpass', freq: 5000, freqEnd: 2500 }, tremolo: { rate: 26, depth: 0.55 } },
            { kind: 'fm', freq: 'B6', modRatio: 5.4, modIndex: 4, modIndexEnd: 0.4, gain: 0.35, tremolo: { rate: 14, depth: 0.4 } },
            { kind: 'noise', color: 'pink', gain: 0.5, duration: 0.2, filter: { type: 'bandpass', freq: 2600, q: 3 } }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.09, semitones: 5, volume: 0.8 }, { at: 0.18, semitones: 2, volume: 0.6 }],
        echo: { delay: 0.11, feedback: 0.35, mix: 0.3 }
    },
    // Na vida: papel grosso esmagado, poeira num sussurro ecoado e o estalo do obelisco se fixando
    PRISON_CRUSH: {
        duration: 1.2, volume: 0.15,
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.3, release: 0.6 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.8, duration: 0.35, filter: { type: 'bandpass', freq: 1600, q: 1.2 }, tremolo: { rate: 45, depth: 0.7 } },
            {
                kind: 'noise', color: 'pink', gain: 0.4, delay: 0.35, duration: 0.6, filter: { type: 'bandpass', freq: 3000, freqEnd: 800, q: 6 },
                envelope: { attack: 0.1, decay: 0.2, sustain: 0.4, release: 0.3 }
            },
            { kind: 'fm', freq: 'C4', modRatio: 1.4, modIndex: 6, modIndexEnd: 0, gain: 0.4, delay: 0.95, duration: 0.2 }
        ],
        echo: { delay: 0.3, feedback: 0.45, mix: 0.4 }
    },

    // --- Economia (lixeira, moedas, loja) --------------------------------------
    // Moeda caindo: dois "tlins" metálicos curtinhos
    COIN: {
        bus: BUS.UI, duration: 0.16, volume: 0.09, cooldown: 0.04, pitchJitter: 0.8,
        envelope: { attack: 0.001, decay: 0.08, sustain: 0.2, release: 0.07 },
        layers: [
            { kind: 'fm', freq: 'B6', modRatio: 2.4, modIndex: 2.5, modIndexEnd: 0.3 },
            { kind: 'tone', wave: 'sine', freq: 'E7', gain: 0.35 }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.07, semitones: 5, volume: 0.8 }],
        echo: { delay: 0.06, feedback: 0.2, mix: 0.15 }
    },
    // Carta queimando na lixeira + chuva de moedas
    SELL: {
        duration: 0.55, volume: 0.1,
        envelope: { attack: 0.004, decay: 0.2, sustain: 0.25, release: 0.25 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.7, filter: { type: 'bandpass', freq: 2200, freqEnd: 400, q: 1.2 } },
            { kind: 'tone', wave: 'sine', freq: 180, freqEnd: 70, gain: 0.5, duration: 0.2 },
            {
                kind: 'fm', freq: 'A6', modRatio: 2.4, modIndex: 3, modIndexEnd: 0.2, gain: 0.35, delay: 0.14,
                envelope: { attack: 0.001, decay: 0.08, sustain: 0.1, release: 0.1 }
            }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.2, semitones: 4, volume: 0.5 }, { at: 0.29, semitones: 9, volume: 0.35 }],
        echo: { delay: 0.08, feedback: 0.25, mix: 0.2 }
    },
    // Lixeira "acorda" quando o jogador pega uma carta
    TRASH_ARM: {
        bus: BUS.UI, duration: 0.12, volume: 0.05, cooldown: 0.1,
        envelope: { attack: 0.004, decay: 0.06, sustain: 0.2, release: 0.05 },
        layers: [
            { kind: 'noise', color: 'brown', gain: 0.6, filter: { type: 'lowpass', freq: 900 } },
            { kind: 'tone', wave: 'triangle', freq: 'G4', freqEnd: 'C5', gain: 0.4 }
        ]
    },
    // Loja abrindo: sininho de porta + brilho subindo
    SHOP_OPEN: {
        bus: BUS.UI, duration: 0.3, volume: 0.09,
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.25 },
        layers: [
            { kind: 'fm', freq: 'G6', modRatio: 3.5, modIndex: 2.5, modIndexEnd: 0 },
            { kind: 'tone', wave: 'sine', freq: 'D7', gain: 0.3, delay: 0.08 },
            { kind: 'noise', color: 'pink', gain: 0.15, filter: { type: 'bandpass', freq: 1500, freqEnd: 7000, q: 1.5 } }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.11, semitones: 4, volume: 0.8 }],
        echo: { delay: 0.14, feedback: 0.35, mix: 0.3 }
    },
    SHOP_CLOSE: {
        bus: BUS.UI, duration: 0.3, volume: 0.07,
        envelope: { attack: 0.005, decay: 0.12, sustain: 0.25, release: 0.15 },
        layers: [
            { kind: 'fm', freq: 'D6', modRatio: 3.5, modIndex: 2, modIndexEnd: 0 },
            { kind: 'noise', color: 'pink', gain: 0.15, filter: { type: 'bandpass', freq: 5000, freqEnd: 900, q: 1.5 } }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.09, semitones: -5, volume: 0.7 }]
    },
    // Compra: "ka-ching" de caixa registradora
    SHOP_BUY: {
        duration: 0.7, volume: 0.06,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.35 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.5, duration: 0.05, filter: { type: 'highpass', freq: 2000 } },
            { kind: 'tone', wave: 'square', freq: 110, freqEnd: 70, gain: 0.25, duration: 0.07, filter: { type: 'lowpass', freq: 800 } },
            {
                kind: 'fm', freq: 'E6', modRatio: 3.5, modIndex: 4, modIndexEnd: 0.1, gain: 0.8, delay: 0.08,
                envelope: { attack: 0.001, decay: 0.45, sustain: 0.1, release: 0.3 }
            },
            { kind: 'tone', wave: 'sine', freq: 'B6', gain: 0.35, delay: 0.1, tremolo: { rate: 18, depth: 0.25 } }
        ],
        echo: { delay: 0.12, feedback: 0.3, mix: 0.25 }
    },
    // Renovar: embaralhada mágica
    SHOP_REROLL: {
        duration: 0.06, volume: 0.09,
        envelope: { attack: 0.002, decay: 0.04, sustain: 0.2, release: 0.02 },
        layers: [
            { kind: 'noise', color: 'white', gain: 0.6, filter: { type: 'bandpass', freq: 2600, q: 1.5 } },
            { kind: 'tone', wave: 'triangle', freq: 'C6', gain: 0.35 }
        ],
        sequence: { step: 0.04, semitones: [0, 3, 5, 7, 10, 12, 15, 17, 19] },
        echo: { delay: 0.1, feedback: 0.3, mix: 0.25 }
    },
    // Congelar: cristal de gelo
    SHOP_FREEZE: {
        bus: BUS.UI, duration: 0.5, volume: 0.08,
        envelope: { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.25 },
        layers: [
            { kind: 'fm', freq: 'A6', modRatio: 5.2, modIndex: 3, modIndexEnd: 0.1 },
            { kind: 'tone', wave: 'sine', freq: 'E7', gain: 0.3, tremolo: { rate: 26, depth: 0.4 } },
            { kind: 'noise', color: 'white', gain: 0.18, filter: { type: 'highpass', freq: 6000 } }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.06, semitones: 7, volume: 0.6 }, { at: 0.12, semitones: 12, volume: 0.4 }],
        echo: { delay: 0.09, feedback: 0.4, mix: 0.35 }
    },
    SHOP_UNFREEZE: {
        bus: BUS.UI, duration: 0.3, volume: 0.07,
        envelope: { attack: 0.002, decay: 0.12, sustain: 0.2, release: 0.15 },
        layers: [
            { kind: 'noise', color: 'pink', gain: 0.4, filter: { type: 'bandpass', freq: 3000, freqEnd: 800, q: 1.4 } },
            { kind: 'fm', freq: 'E6', modRatio: 5.2, modIndex: 2, modIndexEnd: 0, gain: 0.4 }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.07, semitones: -5, volume: 0.6 }]
    },
    // Compra/renovação negada
    SHOP_DENY: {
        bus: BUS.UI, duration: 0.18, volume: 0.08, cooldown: 0.12,
        envelope: { attack: 0.003, decay: 0.06, sustain: 0.5, release: 0.06 },
        filter: { type: 'lowpass', freq: 1500 },
        layers: [
            { kind: 'tone', wave: 'square', freq: 'E3', tremolo: { rate: 30, depth: 0.4 } },
            { kind: 'tone', wave: 'square', freq: 'Bb3', gain: 0.6 }
        ],
        notes: [{ at: 0, semitones: 0 }, { at: 0.1, semitones: -2 }]
    },
    // A loja se renovou sozinha
    SHOP_REFRESH: {
        duration: 0.18, volume: 0.08,
        envelope: { attack: 0.004, decay: 0.08, sustain: 0.3, release: 0.08 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'E5' },
            { kind: 'fm', freq: 'E6', modRatio: 3.5, modIndex: 1.5, modIndexEnd: 0, gain: 0.35 }
        ],
        sequence: { step: 0.07, semitones: [0, 7, 12, 16, 19] },
        echo: { delay: 0.13, feedback: 0.35, mix: 0.3 }
    },

    // --- Efeitos --------------------------------------------------------------
    SPARK: {
        duration: 0.035, volume: 0.1, cooldown: 0.02, pitchJitter: 4,
        envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.008 },
        layers: [
            { kind: 'noise', color: 'white', filter: { type: 'highpass', freq: 5000 } },
            { kind: 'tone', wave: 'sine', freq: 4200, freqEnd: 6500, gain: 0.3 }
        ]
    },
    SPARKLE: {
        duration: 0.14, volume: 0.1,
        envelope: { attack: 0.002, decay: 0.08, sustain: 0.2, release: 0.05 },
        layers: [
            { kind: 'tone', wave: 'sine', freq: 'C6' },
            { kind: 'tone', wave: 'triangle', freq: 'C7', gain: 0.25 }
        ],
        sequence: { step: 0.05, semitones: [0, 4, 7, 12, 16] },
        echo: { delay: 0.09, feedback: 0.35, mix: 0.3 }
    },
    WHOOSH: {
        duration: 0.35, volume: 0.1, pitchJitter: 1.5,
        envelope: { attack: 0.08, decay: 0.12, sustain: 0.4, release: 0.12 },
        layers: [{ kind: 'noise', color: 'pink', filter: { type: 'bandpass', freq: 400, freqEnd: 2800, q: 1.8 } }]
    },
    COLOR_CHANGE: {
        duration: 1.1, volume: 0.05,
        envelope: { attack: 0.003, decay: 0.35, sustain: 0.25, release: 0.6 },
        layers: [
            { kind: 'fm', freq: 'C5', modRatio: 2, modIndex: 3, modIndexEnd: 0.1 },
            { kind: 'tone', wave: 'sine', freq: 'C6', gain: 0.25 }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.05, semitones: 4 },
            { at: 0.1, semitones: 7 }, { at: 0.15, semitones: 12, volume: 0.7 }
        ],
        echo: { delay: 0.15, feedback: 0.35, mix: 0.25 }
    },
    RAINBOW: {
        duration: 0.2, volume: 0.1,
        envelope: { attack: 0.003, decay: 0.1, sustain: 0.3, release: 0.08 },
        layers: [
            { kind: 'tone', wave: 'triangle', freq: 'C5' },
            { kind: 'tone', wave: 'sine', freq: 'C6', gain: 0.3, detune: 7 }
        ],
        sequence: { step: 0.045, semitones: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] },
        echo: { delay: 0.12, feedback: 0.4, mix: 0.3 }
    },

    // --- Partida --------------------------------------------------------------
    VICTORY: {
        duration: 0.16, volume: 0.1,
        envelope: { attack: 0.005, decay: 0.08, sustain: 0.6, release: 0.08 },
        layers: [
            { kind: 'tone', wave: 'square', freq: 'C5', gain: 0.35, filter: { type: 'lowpass', freq: 3500 } },
            { kind: 'tone', wave: 'triangle', freq: 'C5' },
            { kind: 'tone', wave: 'triangle', freq: 'C4', gain: 0.5 }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.15, semitones: 4 }, { at: 0.3, semitones: 7 },
            { at: 0.45, semitones: 12, duration: 0.2 }, { at: 0.66, semitones: 7, duration: 0.12 },
            { at: 0.8, semitones: 12, duration: 0.7 }
        ],
        echo: { delay: 0.14, feedback: 0.3, mix: 0.2 }
    },
    DEFEAT: {
        duration: 0.3, volume: 0.1,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.15 },
        filter: { type: 'lowpass', freq: 1600, freqEnd: 500, time: 2 },
        layers: [
            { kind: 'tone', wave: 'sawtooth', freq: 'G4', gain: 0.5 },
            { kind: 'tone', wave: 'triangle', freq: 'G3', vibrato: { rate: 5, depth: 15 } }
        ],
        notes: [
            { at: 0, semitones: 0 }, { at: 0.3, semitones: -1 },
            { at: 0.6, semitones: -2 }, { at: 0.9, semitones: -5, duration: 0.9 }
        ]
    }
});

/** Nomes dos sons (SFX.CLASH === 'CLASH'): evita strings soltas nas chamadas. */
export const SFX = Object.freeze(Object.fromEntries(Object.keys(SOUND_PRESETS).map((name) => [name, name])));

/** Nomes dos samples gravados registrados em CONFIG.AUDIO.SAMPLES (SAMPLES.CARD_MOVE === 'CARD_MOVE'). */
export const SAMPLES = Object.freeze(
    Object.fromEntries(Object.keys(CONFIG.AUDIO.SAMPLES).map((name) => [name, name]))
);
