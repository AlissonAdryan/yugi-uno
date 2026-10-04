const COLOR = Object.freeze({
    NONE: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    BLACK: 5,
    RAINBOW: 6
});

const CARD_TYPES = Object.freeze({
    NUMBER: 0,
    PLUS2: 1,
    PLUS4: 2,
    BLOCK: 3,
    REVERSE: 4,
    CHANGE_COLOR: 5,
    HEAL: 6,
    SHIELD: 7,
    REVIVE: 8,
    PAINT: 9,
    GUARD_SWAP: 10,  // consumível: Ataque e Defesa trocam de lugar no início do combate
    LIGHTNING: 11,   // especial de campo com cor (laminado): fulmina em cadeia, vence o Block
    GHOST: 12,       // especial de campo com cor: atravessa a carta inimiga e fere a vida (dano fixo)
    MIRROR: 13,      // especial de campo com cor (laminado): copia o valor inimigo +1; dano na vida volta pro dono
    AMBUSH: 14,      // consumível: a Defesa ganha +3 ao entrar na linha de frente
    CURSE: 15,       // consumível laminado: na próxima rodada, 2 cartas da mão inimiga enfraquecem/corrompem
    DEATH: 16,      // consumível lendário (1x por partida): marca o oponente com as Chamas da Morte por 3 turnos
    HIDDEN: 255
});

// Estados que um consumível deixa ativos no assento (bitmask). Só o próprio jogador recebe os seus.
const STATUS = Object.freeze({
    HEAL: 1,
    SHIELD: 2,
    REVIVE_ACTIVE: 4,
    REVIVE_USED: 8,
    PAINT_PENDING: 16,
    GUARD_SWAP: 32,  // Troca de Guarda armada: dispara no início do próximo combate
    AMBUSH: 64,      // Emboscada armada: dispara quando a Defesa entrar na linha de frente neste combate
    CURSE_PENDING: 128, // Maldição plantada: dispara no início da próxima rodada
    CURSE_SPENT: 256,   // as Maldições da partida acabaram (CONFIG.CURSE.MAX_PER_MATCH)
    USE_LOCKED: 512,    // campo USE bloqueado pela Emboscada
    DEATH_USED: 1024   // já usou a Ronova nesta partida (lendária: 1x por jogador)
});

/*
 * Etiquetas de catálogo (bitmask) — dizem por onde cada tipo de carta circula:
 *   DECK     pode sair do baralho          SHOP      pode aparecer na loja
 *   SELLABLE pode ir para a lixeira (vira moeda)
 * Carta só de loja = SHOP sem DECK. Especial não comprável = sem SHOP. Nada mais no código muda.
 */
const CARD_TAGS = Object.freeze({
    DECK: 1,
    SHOP: 2,
    SELLABLE: 4
});
const ALL_TAGS = CARD_TAGS.DECK | CARD_TAGS.SHOP | CARD_TAGS.SELLABLE;

// Estado de cada item da loja (bitmask)
const SHOP_ITEM_FLAGS = Object.freeze({
    DISCOUNT: 1,  // veio em oferta (preço cheio riscado)
    FROZEN: 2,    // congelado: sobrevive à próxima renovação automática
    SOLD: 4       // já comprado neste ciclo
});

// Marcas por carta (bitmask, só o dono recebe as suas no snapshot)
const CARD_FLAGS = Object.freeze({
    RESALE: 1     // comprada na loja: revende por CONFIG.SHOP.RESALE_RATIO do valor (evita lucro infinito)
});

import { GRAPHICS } from './graphics.js';

export const CONFIG = Object.freeze({
    CANVAS_ID: 'game-canvas',
    PHYSICS_TIMESTEP: 1000 / 30,

    DECK_SIZE: 255,
    INITIAL_HAND_SIZE: 9,
    MAX_HAND_SIZE: 15,
    STARTING_HP: 30,
    // Teto de vida para cura (a Cura nunca passa disso)
    MAX_HP: 30,
    NAME_MAX_LENGTH: 16,
    FORCED_DISCARD_COUNT: 2,
    ROUND_DRAWS: Object.freeze({ WINNER: 2, LOSER: 2, TIE: 1 }),
    NUMBER_RANGE: Object.freeze({ MIN: 0, MAX: 9 }),
    REVERSE_COMPENSATION_POWER: 1,
    // Trava de segurança contra loops de combate (cadeias de +2/+4 são finitas, mas nunca confiamos cegamente)
    COMBAT_MAX_STEPS: 200,
    COMBO_MAX_STACK: 3,

    // O código normaliza pelo total, então os pesos não precisam somar 100
    CARD_SPAWN_WEIGHTS: Object.freeze({
        NUMBER: 75,
        SPECIAL_BASE: 25,
        SPECIALS: Object.freeze({
            PLUS2: 8,
            PLUS4: 4,
            BLOCK: 7,
            REVERSE: 5,
            CHANGE_COLOR: 10,
            HEAL: 8,
            SHIELD: 5,
            REVIVE: 2,
            PAINT: 5,
            GUARD_SWAP: 8,
            LIGHTNING: 3,
            GHOST: 5,
            MIRROR: 3,
            AMBUSH: 6,
            CURSE: 2,
            DEATH: 1
        })
    }),
    
    /*
     * Catálogo econômico por tipo de carta (chave = nome em CARD_TYPES):
     *   tags        CARD_TAGS (por onde a carta circula)
     *   sell        moedas ao jogar na lixeira ('POWER' = o valor atual do número)
     *   price       preço base na loja (números: calculado por CONFIG.SHOP.NUMBER_*)
     *   shopWeight  chance relativa de aparecer num espaço da loja
     * O peso de nascer do baralho continua em CARD_SPAWN_WEIGHTS (só vale para quem tem a tag DECK).
     */
    CARD_CATALOG: Object.freeze({
        NUMBER: Object.freeze({ tags: ALL_TAGS, sell: 'POWER', shopWeight: 25 }),
        PLUS2: Object.freeze({ tags: ALL_TAGS, sell: 2, price: 9, shopWeight: 14 }),
        PLUS4: Object.freeze({ tags: ALL_TAGS, sell: 4, price: 15, shopWeight: 3 }),
        BLOCK: Object.freeze({ tags: ALL_TAGS, sell: 3, price: 6, shopWeight: 9 }),
        REVERSE: Object.freeze({ tags: ALL_TAGS, sell: 3, price: 8, shopWeight: 7 }),
        CHANGE_COLOR: Object.freeze({ tags: ALL_TAGS, sell: 1, price: 3, shopWeight: 12 }),
        HEAL: Object.freeze({ tags: ALL_TAGS, sell: 2, price: 5, shopWeight: 10 }),
        SHIELD: Object.freeze({ tags: ALL_TAGS, sell: 2, price: 6, shopWeight: 9 }),
        REVIVE: Object.freeze({ tags: ALL_TAGS, sell: 5, price: 16, shopWeight: 3 }),
        PAINT: Object.freeze({ tags: ALL_TAGS, sell: 3, price: 7, shopWeight: 6 }),
        GUARD_SWAP: Object.freeze({ tags: ALL_TAGS, sell: 1, price: 2, shopWeight: 8 }),
        // Laminado raro: mais caro que Block/Reverso porque vence o Block e fulmina 2 cartas
        LIGHTNING: Object.freeze({ tags: ALL_TAGS, sell: 5, price: 12, shopWeight: 3 }),
        GHOST: Object.freeze({ tags: ALL_TAGS, sell: 3, price: 5, shopWeight: 9 }),
        MIRROR: Object.freeze({ tags: ALL_TAGS, sell: 5, price: 8, shopWeight: 4 }),
        AMBUSH: Object.freeze({ tags: ALL_TAGS, sell: 2, price: 4, shopWeight: 9 }),
        CURSE: Object.freeze({ tags: ALL_TAGS, sell: 5, price: 10, shopWeight: 3 }),
        // Lendária: a mais cara da loja e a mais rara de aparecer (o uso continua 1x por partida)
        DEATH: Object.freeze({ tags: ALL_TAGS, sell: 6, price: 25, shopWeight: 1 })
    }),

    // Resolução virtual de referência: altura mínima para mãos + tabuleiro com respiro (~870px ocupados)
    // Mantém a proporção 20:13 de 1425x926; (canvas + HUD) levemente para cima.
    VIEW: Object.freeze({
        DESIGN_WIDTH: 1425,
        DESIGN_HEIGHT: 926,
        get MAX_DPR() { return GRAPHICS.maxDpr; },
        UI_SCALE_MIN: 0.6,
        UI_SCALE_MAX: 1.25
    }),

    CARD_DIMENSIONS: Object.freeze({
        WIDTH: 100,
        HEIGHT: 150,
        RADIUS: 10
    }),
    HAND_SCALE: 0.9,
    HAND_MARGIN_X: 170,
    HAND_STEP_RATIO: 0.72,
    STACK_OFFSET: Object.freeze({ X: -2, Y: -4 }),

    COLOR,
    BASIC_COLORS: Object.freeze([COLOR.RED, COLOR.BLUE, COLOR.GREEN, COLOR.YELLOW]),
    COLOR_HEX: Object.freeze(['#2c3e50', '#e74c3c', '#3498db', '#2ecc71', '#ffcc00', '#111111', '#ffffff']),
    // `name` é só pra log de servidor/depuração (Pilar 10) — nunca mostrado ao jogador. O texto na
    // tela vem de i18n.t(COLOR_NAME_KEYS[cor]), que existe em todos os idiomas (ver Pilar 7/CLAUDE.md).
    COLOR_PALETTES: Object.freeze([
        null,
        { name: 'VERMELHO', bg: ['#4a0f0f', '#721616ff', '#370606', '#680202ff'] },
        { name: 'AZUL', bg: ['#0f204a', '#153366', '#061337', '#0c2b49ff'] },
        { name: 'VERDE', bg: ['#0f4a15', '#156620', '#06370f', '#265500ff'] },
        { name: 'AMARELO', bg: ['#4a4a0f', '#666615', '#373706', '#474417ff'] },
        null,
        // Rainbow: bg é fallback-only; as cores reais são sempre calculadas dinamicamente por Hud._rainbowBg()
        { name: 'QUALQUER COR!', bg: ['#1e0f61', '#153366', '#156620', '#666615'] }
    ]),
    // Chave de i18n por cor (mesmos índices de COLOR_PALETTES) — usar sempre isto, nunca .name, pra texto na tela.
    COLOR_NAME_KEYS: Object.freeze([null, 'COLOR_RED', 'COLOR_BLUE', 'COLOR_GREEN', 'COLOR_YELLOW', null, 'COLOR_RAINBOW']),
    DEFAULT_BACKGROUND: Object.freeze(['#1e0f61', '#152066', '#37064a', '#2e1060']),

    CARD_TYPES,
    STATUS,
    CARD_TAGS,
    SHOP_ITEM_FLAGS,
    CARD_FLAGS,


    SHOP: Object.freeze({
        SLOTS: 3,
        REFRESH_EVERY_ROUNDS: 2,        // rodadas de combate entre renovações automáticas
        STARTING_COINS: 3,
        MAX_COINS: 999,
        // Ao fim de cada combate (o oposto das compras de carta, pra equilibrar)
        ROUND_COINS: Object.freeze({ WINNER: 1, LOSER: 3, TIE: 1 }),
        // Números na loja: só estes valores, [valor, peso] (peso = chance relativa entre eles; 0 desliga o valor)
        NUMBER_POWERS: Object.freeze([[0, 15], [1, 15], [8, 30], [9, 30]]),
        // 0 e 1 custam este preço fixo; 8 e 9 custam o valor menos [desconto, peso]
        NUMBER_LOW_PRICE: 4,
        NUMBER_MARKDOWN: Object.freeze([[1, 75], [2, 25]]),
        // Ofertas relâmpago em qualquer item: [moedas a menos, peso]
        DISCOUNT_CHANCE: 0.2,
        DISCOUNT_AMOUNTS: Object.freeze([[1, 70], [2, 30]]),
        MIN_PRICE: 1,
        RESALE_RATIO: 0.5,
        // Renovar a loja na hora: custo começa em BASE e sobe STEP a cada uso (zera na renovação automática)
        REROLL_BASE_COST: 1,
        REROLL_COST_STEP: 2,
        // Tentativas de evitar itens repetidos na mesma loja
        UNIQUE_TRIES: 4,
        // Congelar: só 1 item por vez (força escolher qual guardar), e ele fica mais caro ao "descongelar"
        // na renovação seguinte (senão seria só uma reserva de graça, sem custo nenhum)
        MAX_FROZEN: 1,
        FREEZE_SURCHARGE: 1
    }),

    // Especiais sem cor (podem ser jogadas em qualquer cor e não contam no sorteio de cores em comum)
    COLORLESS_SPECIALS: Object.freeze(['PLUS4', 'CHANGE_COLOR', 'HEAL', 'SHIELD', 'REVIVE', 'PAINT', 'GUARD_SWAP', 'AMBUSH', 'CURSE', 'DEATH']),

    // Ronova, a Sombra da Morte (GAME_RULES §6.19): marca o oponente por TURNS preparações. Em cada uma, os
    // números da mão dele perdem POWER_LOSS (mínimo MIN_POWER) e toda carta dele que entrar em combate queima.
    // Acabados os turnos, o olho volta uma última vez e queima END_BURN carta(s) da mão.
    // Evento da Arena (GAME_RULES §9): a cada EVERY_COMBATS combates resolvidos sorteia um evento global
    // (pesos em WEIGHTS: [SURGE_KIND, peso]) que vale pelos DURATION combates seguintes (compras, loja e combate).
    SURGE: Object.freeze({
        EVERY_COMBATS: 5,
        DURATION: 3,
        WEIGHTS: Object.freeze([[1, 25], [2, 25], [3, 25], [4, 25]]),
        // SURGE_KIND -> efeitos ligados (SURGE_EFFECT)
        EFFECTS: Object.freeze([0, 1, 2, 4, 7]),
        DRAW_MULT: 2,            // Dobro de Cartas: compras do início do turno multiplicadas
        DISCOUNT_RATIO: 0.5,     // Super Desconto: preço x ratio, arredondado pra cima (itens e renovação)
        FRENZY_DAMAGE_MULT: 1.25 // Frenesi: todo golpe na vida x mult, arredondado pra cima
    }),
    SURGE_KIND: Object.freeze({ NONE: 0, DOUBLE_DRAW: 1, DISCOUNT: 2, FRENZY: 3, ALL: 4 }),
    SURGE_EFFECT: Object.freeze({ DRAW: 1, DISCOUNT: 2, FRENZY: 4 }),

    DEATH: Object.freeze({
        TURNS: 3,
        POWER_LOSS: 2,
        MIN_POWER: 0,
        END_BURN: 2
    }),

    // Fantasma (GAME_RULES §6.12): dano fixo na vida ao atravessar (Escudo e Reviver valem normalmente)
    GHOST: Object.freeze({
        DAMAGE: 3
    }),

    // Espelho Sombrio (GAME_RULES §6.13): quanto ele passa do valor copiado (vence por isso e fica com isso)
    MIRROR: Object.freeze({
        COPY_BONUS: 1
    }),

    // Emboscada (GAME_RULES §6.14): bônus temporário da Defesa (só cartas de número)
    AMBUSH: Object.freeze({
        BONUS: 3
    }),

    // Combos Supremos (GAME_RULES §6.18): 3 especiais idênticos no topo da pilha
    //  Prisão de Cristal (3 Blocks) e Reverso Kármico (3 Reversos)
    ULTIMATE: Object.freeze({
        TRIPLE: 3,
        KARMA_BOOST: 1.2,         // números roubados pelo Kármico / dano devolvido na vida
        PANIC_SECONDS: 6,         // tempo de preparação de quem levou o Kármico na vida
        PANIC_GRACE_MS: 1500,     // folga do servidor (rede + cinemáticas antes da preparação abrir)
        FIELD_LOCK_MSG_MS: 3500   // quanto tempo o aviso "campo trancado" fica na tela
    }),

    // Maldição (GAME_RULES §6.15): cartas atingidas, quanto perdem (mínimo MIN_POWER), usos por partida
    CURSE: Object.freeze({
        TARGETS: 2,
        POWER_LOSS: 3,
        MIN_POWER: 1,
        CORRUPT_POWER: 1,
        MAX_PER_MATCH: 2
    }),

    // Relâmpago (GAME_RULES §6.10): quantas cartas o raio fulmina no choque (a da frente + saltos) e
    // quantas cartas da mão do alvo ele queima ao atingir a vida (Sobrecarga)
    LIGHTNING: Object.freeze({
        CHAIN_TARGETS: 2,
        HAND_BURN: 2
    }),

    // Regras numéricas dos consumíveis de vida (GAME_RULES §6.5–6.7)
    CONSUMABLES: Object.freeze({
        HEAL_RATIO: 0.5,            // cura = floor(dano causado na rodada * ratio)
        SHIELD_DAMAGE_RATIO: 0.5,   // dano recebido por golpe = floor(dano * ratio)
        REVIVE_ROUNDS: 5,           // rodadas de combate em que o Reviver fica de guarda
        REVIVE_SURVIVE_HP: 1,       // vida que sobra quando o Reviver impede a morte
        PAINT_CARDS_NEEDED: 2       // quantas cartas o Pintar recolore
    }),

    /*
     * Visual por tipo de carta, além do padrão (fundo = cor da carta, ícone branco).
     * - background/border: cores da face e da moldura
     * - painted: face estática pintada uma vez num cache (card-art.js) em vez de redesenhada a cada frame
     * - fx: efeito animado sobreposto à face (card-effects.js: 'FOIL_GOLD', 'FOIL_HOLO', ...)
     * Para dar um efeito novo a qualquer carta no futuro: registre o preset em card-effects.js e
     * aponte `fx` para ele aqui — nenhuma outra parte do renderer precisa mudar.
     */
    CARD_VISUALS: Object.freeze({
        [CARD_TYPES.REVIVE]: Object.freeze({ background: '#fbf7ea', border: '#d4af37', painted: true, fx: 'FOIL_GOLD' }),
        [CARD_TYPES.PAINT]: Object.freeze({ background: '#111111', border: '#7b68ee', painted: true, fx: 'FOIL_HOLO' }),
        // Sem laminado de propósito: só a moldura de aço-ciano recortada a diferencia dos outros consumíveis
        [CARD_TYPES.GUARD_SWAP]: Object.freeze({ background: '#07090e', border: '#7fdbff', painted: true }),
        // colored: a face pintada em cache é uma por cor (a carta tem cor e segue a cor da rodada)
        [CARD_TYPES.LIGHTNING]: Object.freeze({ background: '#2c3e50', border: '#fffbe0', painted: true, colored: true, fx: 'FOIL_STORM' }),
        // Normais com vida própria (sem laminado): neblina e silhueta pulsando / olho que pisca
        [CARD_TYPES.GHOST]: Object.freeze({ background: '#1a0a2e', border: '#b9b3c9', painted: true, colored: true, fx: 'ETHEREAL' }),
        [CARD_TYPES.AMBUSH]: Object.freeze({ background: '#0a1a0a', border: '#39ff14', painted: true, fx: 'AMBUSH_EYE' }),
        // Laminados novos: obsidiana espelhada e tempestade roxa contida
        [CARD_TYPES.MIRROR]: Object.freeze({ background: '#08060d', border: '#c9c3dd', painted: true, colored: true, fx: 'FOIL_MIRROR' }),
        [CARD_TYPES.CURSE]: Object.freeze({ background: '#0d0015', border: '#a45cff', painted: true, fx: 'FOIL_CURSE' }),
        // Lendária: laminado de eclipse carmesim + chamas da morte e os três olhos vivos (death-art.js)
        [CARD_TYPES.DEATH]: Object.freeze({ background: '#120004', border: '#ff3b4e', painted: true, fx: 'FOIL_DEATH' })
    }),

    // Contorno animado (sentido horário) nas cartas da mão que podem ser jogadas agora. Só visual e só local.
    PLAYABLE_OUTLINE: Object.freeze({
        // Tipos que nunca recebem o contorno, mesmo quando jogáveis
        EXCLUDED_TYPES: Object.freeze([
            CARD_TYPES.CHANGE_COLOR, CARD_TYPES.HEAL, CARD_TYPES.SHIELD, CARD_TYPES.REVIVE, CARD_TYPES.PAINT, CARD_TYPES.GUARD_SWAP,
            CARD_TYPES.AMBUSH, CARD_TYPES.CURSE, CARD_TYPES.DEATH
        ]),
        COLOR: '#7df9ff',
        GLOW_COLOR: 'rgba(0, 229, 255, 0.35)',
        LINE_WIDTH: 3,
        GLOW_WIDTH: 9,
        PADDING: 3,
        DASH_COUNT: 4,
        DASH_FILL: 0.5,
        SPEED: 140
    }),

    GAME_STATES: Object.freeze({
        INIT: 0,
        MENU: 1,
        PLAYING: 2,
        COMBAT_RESOLUTION: 3,
        DISCARDING: 4,
        FORCED_DISCARDING: 5,
        GAME_OVER: 6,
        // Perdedor da rodada (que levou dano) escolhe a próxima cor entre as cores em comum
        CHOOSING_COLOR: 7
    }),

    // Pausas do servidor (ms). Cada pausa é >= à animação correspondente no cliente,
    // assim os dois jogadores nunca acumulam atraso em relação ao host.
    TIMINGS: Object.freeze({
        REVEAL: 450,
        PROMOTE: 650,
        SUMMON_BASE: 900,
        SUMMON_PER_CARD: 180,
        CLASH: 1150,
        TIE: 950,
        TIE_DEFENSE_DELAY: 1500,
        BLOCK_SMASH: 1000,
        REVERSE: 1000,
        DIRECT_HIT: 1400,
        DESTROY: 350,
        ROUND_END_PAUSE: 700,
        NEXT_ROUND_DELAY: 600,
        FORCED_REDRAW_DELAY: 700,
        GAME_OVER_SEQUENCE: 3000,
        COLOR_CHOICE_TIMEOUT: 10000,
        HEAL: 1300,
        // Luz divina na vida + carta gigante se despedaçando (ver ANIM.DIVINE_LEAD + SHOWCASE_*)
        REVIVE_SAVE: 2800,
        // Troca de Guarda: Ataque e Defesa orbitam e trocam de lugar antes da revelação (>= ANIM.GUARD_SWAP_*)
        GUARD_SWAP: 1250,
        // Relâmpago: carga + raio na carta da frente + salto em cadeia (>= ANIM.LIGHTNING_*)
        LIGHTNING: 1350,
        // Sobrecarga (Relâmpago na vida): tempo extra além do DIRECT_HIT pros raios queimarem a mão
        OVERLOAD_EXTRA: 450,
        // Fantasma: vira neblina, atravessa a carta inimiga e se recompõe gigante sobre a vida
        GHOST_PASS: 1650,
        // Espelho Sombrio: absorve o valor inimigo (glitch), avança com estilhaços e estilhaça o alvo
        MIRROR_CLASH: 1650,
        // Espelho na vida: golpe no alvo e, meio segundo depois, o reflexo no dono
        MIRROR_HIT: 1900,
        // Emboscada disparando: fios constringem a Defesa e o número sobe
        AMBUSH: 1250,
        // Maldição disparando no início da rodada (correntes, rachaduras e o valor caindo)
        CURSE: 2300,
        // Ronova: cartas do marcado que lutaram queimam nas chamas carmesim no fim do combate (>= ANIM.DEATH_BURN)
        DEATH_BURN: 1150,
        // Moedas do fim da rodada e renovação da loja (pausa curta pra a animação respirar)
        ROUND_ECONOMY: 500,
        // Evento da Arena: roleta + revelação (>= ANIM.SURGE_SPIN + ANIM.SURGE_REVEAL) e o aviso de fim
        SURGE_START: 3300,
        SURGE_END: 1300,
        // Carta reforçada pela Emboscada na vida: pausa extra além do DIRECT_HIT pro selo fechar o slot USE
        // (cinemática: ~650ms até o impacto + ANIM.USE_LOCK)
        USE_LOCKOUT_EXTRA: 500,
        // Fusão de combo (1+0 -> 10, 2+0 -> 20, §6.1) e desfazimento (Block/Reverso quebram a fusão)
        FUSION: 1150,
        UNFUSE: 650,
        // Prisão de Cristal: Blocks viram monólito (formação), queda, impacto + cristais crescendo (>= ANIM.PRISON_*)
        PRISON: 2700,
        // Prisão na vida: formação, queda na vida, tela rachada e a compra virando pó
        PRISON_HIT: 2900,
        // Reverso Kármico: glitch + relógio, o Reverso simples pifa, a pilha roubada atravessa a mesa
        KARMA: 2300,
        // Mão rebobinada: as cartas são chutadas pra fora / as novas se materializam em glitch
        HAND_REWIND: 1000,
        HAND_REWIND_DONE: 850,
        // Kármico na vida: golpe + a vida "bugando" até congelar no valor novo
        KARMA_HIT: 2300,
        // Dois combos supremos se chocando: as duas pilhas colapsam
        ULTIMATE_COLLAPSE: 1500
    }),

    ANIM: Object.freeze({
        LIFT: 250,
        DASH: 180,
        RETURN: 300,
        FLIP_HALF: 150,
        SHAKE_STEP: 50,
        HAND_MOVE: 450,
        BOARD_MOVE: 350,
        SPAWN_MOVE: 400,
        SPAWN_STAGGER: 90,
        HOVER: 200,
        // Tempos próprios do consumível (não reaproveitam SPAWN_MOVE/LIFT: mudar isso não afeta
        // choque/empate/bloqueio nem a distribuição de cartas). Consumo total ~640ms (era ~1000ms).
        CONSUMABLE_MOVE: 280,
        CONSUMABLE_HOLD: 200,
        CONSUMABLE_LIFT: 160,
        HOVER_LIFT: -20,
        DIRECT_LIFT: 300,
        DIRECT_RECOIL: 200,
        DIRECT_DASH: 150,
        DIRECT_RETURN: 400,
        SAFETY_MARGIN: 150,
        RENDER_SMOOTHING: 0.6,
        HEAL_BURST: 1100,
        DIVINE_LEAD: 850,
        // Carta gigante no centro: entra, fica, racha e se despedaça (soma <= TIMINGS.REVIVE_SAVE - DIVINE_LEAD)
        SHOWCASE_IN: 450,
        SHOWCASE_HOLD: 450,
        SHOWCASE_CRACK: 420,
        SHOWCASE_FADE: 320,
        SHOWCASE_SCALE: 2.3,
        // Carta indo pra lixeira e virando moeda
        SELL_FLY: 260,
        SELL_BURN: 220,
        // Pintar: a carta sobe da mão, a tinta escorre de cima pra baixo e ela volta com um "pop"
        PAINT_LIFT: 260,
        PAINT_SWEEP: 800,
        PAINT_SETTLE: 380,
        PAINT_STAGGER: 170,
        PAINT_RISE: 70,
        PAINT_SCALE: 1.3,
        PAINT_WAVE_AMP: 5,
        PAINT_DRIPS: 3,
        // Troca de Guarda: as pilhas sobem, orbitam em meia-volta até o slot oposto e assentam
        GUARD_SWAP_LIFT: 170,
        GUARD_SWAP_ORBIT: 560,
        GUARD_SWAP_SETTLE: 240,
        GUARD_SWAP_SCALE: 1.14,
        // Relâmpago: carga elétrica, raio na carta da frente e salto em cadeia até a próxima
        LIGHTNING_CHARGE: 360,
        LIGHTNING_HOP: 210,
        LIGHTNING_REVEAL: 110,
        LIGHTNING_BOLT_LIFE: 300,
        LIGHTNING_FADE: 260,
        // Fantasma (soma <= TIMINGS.GHOST_PASS)
        GHOST_FADE: 260,
        GHOST_DRIFT: 620,
        GHOST_LOOM: 380,
        GHOST_BURST: 260,
        GHOST_ALPHA: 0.32,
        GHOST_LOOM_SCALE: 2.1,
        // Espelho Sombrio (soma <= TIMINGS.MIRROR_CLASH)
        MIRROR_ABSORB: 420,
        MIRROR_GLITCH: 200,
        MIRROR_BONUS: 200,
        MIRROR_LIFT: 200,
        MIRROR_DASH: 190,
        MIRROR_RETURN: 280,
        MIRROR_RECOIL_DELAY: 500,
        // Emboscada (soma <= TIMINGS.AMBUSH)
        AMBUSH_BIND: 380,
        AMBUSH_PULSE: 260,
        AMBUSH_RISE: 420,
        // Selo de espinhos no slot USE (Emboscada na vida): fio viaja (25%), teia se fecha e o olho abre
        USE_LOCK: 1100,
        // Maldição (soma <= TIMINGS.CURSE)
        CURSE_CHAINS: 520,
        CURSE_SHAKE: 520,
        CURSE_DROP: 360,
        CURSE_SHATTER: 520,
        // Ronova: o olho cobre a tela (entra, fica 1,5s olhando em volta, fecha e sai), as chamas tomam as
        // cartas do marcado, os números perdem 1 e cartas são consumidas pelas chamas carmesim
        DEATH_EYE_IN: 320,
        DEATH_EYE_HOLD: 1500,
        DEATH_EYE_CLOSE: 300,
        DEATH_EYE_OUT: 380,
        DEATH_IGNITE: 520,
        DEATH_DRAIN: 700,
        DEATH_BURN: 950,
        // Evento da Arena: a roleta gira desacelerando (SURGE_SPIN), crava o evento e fica na tela (SURGE_REVEAL)
        SURGE_SPIN: 1500,
        SURGE_REVEAL: 1600,
        MUSIC_FADE_S: 0.9,
        // Fusão 10/20: o 0 sobe (45% do SPIN), mergulha girando no 1/2 (55%) e o número pulsa (soma <= TIMINGS.FUSION)
        FUSION_SPIN: 560,
        FUSION_FLASH: 520,
        FUSION_LIFT_PX: 70,
        // Desfusão: o número volta ao valor original e o "0" reaparece com um "pop" (soma <= TIMINGS.UNFUSE)
        UNFUSE: 650,
        // Prisão de Cristal (soma <= TIMINGS.PRISON / PRISON_HIT)
        PRISON_GATHER: 520,       // os 3 Blocks sobem e se alinham na vertical
        PRISON_FORM: 380,         // viram placas de cristal e fundem no monólito
        PRISON_RISE: 220,
        PRISON_FALL: 380,         // arremessado na metade inimiga
        PRISON_FREEZE: 700,       // afunda enquanto o cristal cobre os slots
        PRISON_SETTLE: 300,
        PRISON_SHAKE_PX: 14,
        PRISON_DUST: 650,         // a compra negada voando do baralho e virando pó (só na vida)
        // Reverso Kármico (soma <= TIMINGS.KARMA)
        KARMA_SPIN: 700,
        KARMA_FIZZLE: 300,
        KARMA_STEAL: 520,
        KARMA_BOOST: 380,
        KARMA_CLOCK_FADE: 260,
        // Mão rebobinada
        REWIND_KICK: 700,
        REWIND_STAGGER: 45,
        REWIND_MATERIALIZE: 420,
        // Kármico na vida: tempo da vida bugando
        KARMA_HP_GLITCH: 1100,
        ULTIMATE_COLLAPSE: 1100
    }),

    AI: Object.freeze({
        THINK_MS: 900,
        ACTION_GAP_MS: 700,
        DEFENSE_CHANCE: 0.5,
        CONSUMABLE_CHANCE: 0.7,
        MAX_REJECTIONS: 3,
        HEAL_MIN_MISSING_HP: 6,
        SHIELD_BELOW_HP: 18,
        SHIELD_RANDOM_CHANCE: 0.25,
        REVIVE_BELOW_HP: 14,
        GUARD_SWAP_CHANCE: 0.45,
        AMBUSH_CHANCE: 0.5,
        CURSE_CHANCE: 0.6,
        // Com 3 Blocks/Reversos idênticos jogáveis, monta o Combo Supremo no Ataque
        ULTIMATE_CHANCE: 0.85,
        // Economia: compra itens especiais/9 se sobrar moeda; vende números fracos com mão cheia
        BUY_CHANCE: 0.65,
        SELL_WHEN_HAND_AT_LEAST: 11,
        SELL_MAX_POWER: 3,
        MAX_SHOP_ACTIONS_PER_ROUND: 2
    }),

    NETWORK: Object.freeze({
        APP_ID: 'yugi-uno-p2p',
        TRYSTERO_URL: 'https://esm.run/@trystero-p2p/mqtt@0.25.4',
        /*
         * Brokers MQTT da sinalização (Trystero relayConfig.urls). A lista padrão da lib começa pelo
         * test.mosquitto.org, broker de TESTE que vive caindo: quando cai, o cliente MQTT tenta reconectar
         * a cada ~1s e o console enche de "WebSocket connection ... failed" no meio da partida. Os dois
         * lados precisam usar a mesma lista (mesma versão do jogo) pra se encontrarem.
         */
        MQTT_RELAYS: Object.freeze([
            'wss://broker.emqx.io:8084/mqtt',
            'wss://broker.hivemq.com:8884/mqtt',
            'wss://public:public@public.cloud.shiftr.io',
            'wss://broker-cn.emqx.io:8084/mqtt'
        ]),
        ACTION_NAME: 'msg',
        ROOM_CODE_LENGTH: 5,
        ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        HEARTBEAT_INTERVAL_MS: 2000,
        HEARTBEAT_TIMEOUT_MS: 4000,
        UNSTABLE_AFTER_MISSES: 2,
        RECONNECT_GRACE_MS: 120000,
        JOIN_SLOW_WARNING_MS: 15000,
        /*
         * Antes de qualquer par de verdade conectar, uma tentativa de handshake WebRTC pode falhar
         * (SDP/ICE) sem que a sala em si esteja quebrada — é só aquela tentativa específica. Em vez
         * de matar a sessão (o host tendo que gerar um link novo), o FallbackAdapter espera esse
         * intervalo e tenta de novo, ciclando pelos transportes disponíveis indefinidamente até um
         * par conectar de verdade ou o jogador sair manualmente da sala.
         */
        CONNECTION_RETRY_DELAY_MS: 3000,
        LOCAL_CPU_LATENCY_MS: 150,
        MAX_CLIENT_BACKLOG: 40,
        PENDING_INPUT_TIMEOUT_MS: 5000,
        /*
         * Camada 1 (sempre ativa, zero configuração): TURN de fallback (formato Trystero turnConfig)
         * para quando os dois pares não conseguem abrir um caminho P2P direto (NAT simétrico, rede
         * corporativa, algumas redes móveis) — sem isso, a sala falha com "could not connect to peer
         * ... after exchanging SDP". Open Relay Project (metered.ca), grátis, sem conta, sem cartão.
         * Credencial pública e COMPARTILHADA com o mundo inteiro (não é segredo) — por isso existe a
         * Camada 2 abaixo, com cota própria em vez de dividida com todo mundo que usa essa lib.
         */
        TURN_SERVERS: Object.freeze([
            Object.freeze({ urls: 'stun:openrelay.metered.ca:80' }),
            Object.freeze({ urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }),
            Object.freeze({ urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }),
            Object.freeze({ urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }),
            // turns: (TURN sobre TLS) é o que de fato atravessa firewall corporativo com inspeção
            // profunda de pacote (DPI): o tráfego fica indistinguível de HTTPS normal na porta 443.
            Object.freeze({ urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' })
        ]),

        /*
         * Camada 2 (opcional, sem cartão): TURN dedicado — mesmo provedor (Metered), mas uma conta
         * SUA e gratuita (dashboard.metered.ca/signup, sem cartão), com cota própria em vez de
         * dividida com o mundo inteiro como a Camada 1. Protege contra o Open Relay público ficar
         * sobrecarregado/instável sob uso pesado global. Gere 1 credencial no dashboard (TURN Server ->
         * Add Credential) e cole as 4 URLs + usuário/senha aqui — são estáticas (o plano free não
         * expira nem exige rotação). Deixe a lista vazia pra desativar: cai só na Camada 1, sem quebrar
         * nada. Como qualquer credencial que precisa estar no bundle do cliente (o jogo não tem
         * backend), ela é visível pra quem inspecionar o código — o risco é alguém consumir sua cota
         * gratuita, nunca cobrança (é plano free, sem cartão cadastrado).
         */
        TURN_SERVERS_OWN: Object.freeze([
            Object.freeze({ urls: 'stun:stun.relay.metered.ca:80' }),
            Object.freeze({ urls: 'turn:global.relay.metered.ca:80', username: 'a2a93d0668e9a1036aab9fe5', credential: 'VStgKko94AHd7QhV' }),
            Object.freeze({ urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'a2a93d0668e9a1036aab9fe5', credential: 'VStgKko94AHd7QhV' }),
            Object.freeze({ urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'a2a93d0668e9a1036aab9fe5', credential: 'VStgKko94AHd7QhV' })
        ]),

        /*
         * Camada 3 (opcional, sem cartão): relay via WebSocket — não é mais WebRTC, é só um túnel de
         * mensagens (ver /relay-server/). Único fallback que atravessa até as redes mais hostis
         * (WebSocket na porta 443 é indistinguível de HTTPS comum). Só é tentado se o WebRTC (Trystero)
         * falhar antes de qualquer par conectar, e mesmo assim o FallbackAdapter continua ciclando
         * indefinidamente (ver fallback-adapter.js) — essa camada nunca é obrigatória pro jogo rodar.
         * Hospede /relay-server/ grátis no Render (sem cartão) e cole a URL wss:// aqui. Vazio desativa.
         */
        RELAY_WS_ENDPOINT: 'wss://yugi-uno.onrender.com/'
    }),

    AUDIO: Object.freeze({
        BUS: Object.freeze({ MASTER: 'master', MUSIC: 'music', SFX: 'sfx', UI: 'ui' }),
        // Volumes iniciais por barramento (0..1). O master passa por um limitador antes da saída.
        VOLUME: Object.freeze({ MASTER: 0.5, MUSIC: 0.55, SFX: 0.5, UI: 0.6 }),
        // Teto de sons sintetizados simultâneos; acima disso o mais antigo é cortado com fade curto
        MAX_VOICES: 24,
        // Escala de tempo por "comprimento" pedido em play(..., { length })
        LENGTH_SCALE: Object.freeze({ SHORT: 0.6, MEDIUM: 1, LONG: 1.8 }),
        START_LOOKAHEAD_S: 0.005,
        STEAL_FADE_S: 0.015,
        DEFAULT_FADE_S: 0.8,
        NOISE_BUFFER_S: 2,
        MAX_ECHO_TAIL_S: 3,
        // Pausa a música e suspende o AudioContext com a aba escondida (economia de bateria no celular)
        SUSPEND_WHEN_HIDDEN: true,
        // 'ambient' respeita a chave de silencioso do iPhone e mistura com outros apps (Audio Session API)
        SESSION_TYPE: 'ambient',
        DEBUG_LOG: false,
        // Faixas de música: `sources` em ordem de preferência (a 1ª que o navegador suportar é usada;
        // adicione .m4a para iOS < 18.4), `volume` própria da faixa (0..1, multiplica com o barramento MUSIC).
        MUSIC: Object.freeze({
            MAIN_THEME: Object.freeze({
                sources: Object.freeze(['assets/audio/music/main_theme.opus']),
                volume: 0.5 // -90% do volume original da faixa
            }),
            SHOP_THEME: Object.freeze({
                sources: Object.freeze(['assets/audio/music/shop_theme.opus']),
                volume: 0.5,
                optional: true
            })
        }),
        // Efeitos gravados (arquivo curto, decodificado inteiro em memória): `sources` + `volume` padrão
        // do sample (0..1, multiplica com o barramento SFX; playSample(..., { volume }) sobrescreve por disparo).
        SAMPLES: Object.freeze({
            CARD_MOVE: Object.freeze({
                sources: Object.freeze(['assets/audio/sfx/card_move.opus']),
                volume: 0.3 // -30% do volume original do arquivo
            })
        })
    }),

    WORKER_MESSAGES: Object.freeze({
        INIT: 'INIT',
        CALCULATE_BATTLE: 'CALCULATE_BATTLE'
    })
});
