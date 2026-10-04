import { CONFIG } from '../config/constants.js';

/**
 * Regras puras do jogo (sem DOM, sem rede, sem estado).
 * Usadas pelo servidor autoritativo, pela validação otimista do cliente, pela IA e pelo Worker.
 */

const { COLOR, CARD_TYPES } = CONFIG;

export const CLASH_KIND = Object.freeze({
    NUMBERS: 0,
    MUTUAL_DESTRUCTION: 1,
    A_BLOCKS: 2,
    B_BLOCKS: 3,
    A_REVERSES: 4,
    B_REVERSES: 5,
    A_LIGHTNING: 6,
    B_LIGHTNING: 7,
    A_GHOST: 8,         // o Fantasma de A atravessa a carta de B
    B_GHOST: 9,
    GHOST_BOTH: 10,     // dois Fantasmas: os dois atravessam
    A_MIRROR: 11,       // o Espelho de A copia o valor de B +1 e vence
    B_MIRROR: 12,
    MIRROR_PARADOX: 13  // Espelho x Espelho / Espelho x Block: anulação com estilhaços
});

/** Cartas sem cor vinculada (+4, Trocar Cor) podem ser jogadas em qualquer cor e não contam no sorteio. */
export function isColorless(color) {
    return color === COLOR.BLACK || color === COLOR.NONE;
}

/** O Pintar só recolore cartas que já têm uma cor básica (nunca +4, consumíveis ou outras sem cor). */
export function isPaintable(color) {
    return !isColorless(color) && color !== COLOR.RAINBOW;
}

/** Bit da cor para máscaras de "cores em comum" (0 para cartas sem cor). */
export function colorBit(color) {
    if (isColorless(color) || color === COLOR.RAINBOW) return 0;
    return 1 << color;
}

/**
 * @param {number} cardColor
 * @param {number} activeColor cor sorteada da rodada (ou RAINBOW)
 */
export function canPlayColor(cardColor, activeColor) {
    if (activeColor === COLOR.RAINBOW || activeColor === COLOR.NONE) return true;
    return isColorless(cardColor) || cardColor === activeColor;
}

/**
 * Qualquer estrutura SoA com a face das cartas: ServerState, CardPool ou SnapshotView.
 * @typedef {{ type: ArrayLike<number>, color: ArrayLike<number>, power: ArrayLike<number> }} FaceStore
 */

/**
 * Identidade da carta ignorando a cor: tudo que define a carta exceto a cor.
 * Único ponto a atualizar se uma carta futura ganhar novos atributos.
 * @param {FaceStore} store
 * @param {number} a índice da carta A no store
 * @param {number} b índice da carta B no store
 */
export function isSameCardIgnoringColor(store, a, b) {
    return store.type[a] === store.type[b] && store.power[a] === store.power[b];
}

/**
 * Espelho de Defesa (GAME_RULES §5): com uma carta colorida no Ataque,
 * a Defesa aceita a mesma carta em qualquer cor.
 * @param {FaceStore} store
 * @param {number} attackIdx carta no Slot de Ataque (-1 se vazio)
 * @param {number} cardIdx carta candidata à Defesa
 */
export function isMirrorDefense(store, attackIdx, cardIdx) {
    if (attackIdx < 0 || isColorless(store.color[attackIdx])) return false;
    return isSameCardIgnoringColor(store, attackIdx, cardIdx);
}

/**
 * Validação de cor para um slot de combate (Ataque: attackIdx = -1).
 * @param {FaceStore} store
 * @param {number} cardIdx
 * @param {number} activeColor cor ativa do jogador (sorteada ou RAINBOW)
 * @param {number} attackIdx carta no Ataque quando o alvo é a Defesa, senão -1
 */
export function canPlayOnCombatSlot(store, cardIdx, activeColor, attackIdx) {
    return canPlayColor(store.color[cardIdx], activeColor) || isMirrorDefense(store, attackIdx, cardIdx);
}

/**
 * Combo de cartas idênticas no mesmo slot.
 * Exige mesma cor, mesmo tipo e mesmo poder. Exceto +4 que não pode combar.
 */
export function isValidCombo(store, topIdx, cardIdx) {
    if (store.type[cardIdx] === CONFIG.CARD_TYPES.PLUS4) return false;
    if (store.type[topIdx] === CONFIG.CARD_TYPES.NUMBER && store.type[cardIdx] === CONFIG.CARD_TYPES.NUMBER && store.color[topIdx] === store.color[cardIdx]) {
        if ((store.power[topIdx] === 1 || store.power[topIdx] === 2) && store.power[cardIdx] === 0) return true;
        if (store.power[topIdx] === 0 && store.power[cardIdx] === 0) return false;
    }
    return isSameCardIgnoringColor(store, topIdx, cardIdx) && store.color[topIdx] === store.color[cardIdx];
}

/**
 * Combo Supremo (GAME_RULES §6.18): as 3 cartas do topo da pilha são Blocks (ou Reversos) idênticos
 * — mesma cor, como todo combo. Vale também quando um +2/+4 puxa essa sequência.
 * @param {FaceStore} store
 * @param {ArrayLike<number>} stack índices da pilha, do fundo (0) pro topo
 * @returns {number} CARD_TYPES.BLOCK / CARD_TYPES.REVERSE, ou -1 se não houver trio
 */
export function tripleKind(store, stack) {
    const n = CONFIG.ULTIMATE.TRIPLE;
    if (stack.length < n) return -1;
    const top = stack[stack.length - 1];
    const type = store.type[top];
    if (type !== CARD_TYPES.BLOCK && type !== CARD_TYPES.REVERSE) return -1;
    for (let i = 2; i <= n; i++) {
        const id = stack[stack.length - i];
        if (store.type[id] !== type || store.color[id] !== store.color[top]) return -1;
    }
    return type;
}

export function isSummon(type) {
    return type === CARD_TYPES.PLUS2 || type === CARD_TYPES.PLUS4;
}

export function summonCount(type) {
    if (type === CARD_TYPES.PLUS4) return 4;
    if (type === CARD_TYPES.PLUS2) return 2;
    return 0;
}

export function isConsumable(type) {
    return type === CARD_TYPES.CHANGE_COLOR || type === CARD_TYPES.HEAL
        || type === CARD_TYPES.SHIELD || type === CARD_TYPES.REVIVE
        || type === CARD_TYPES.PAINT || type === CARD_TYPES.GUARD_SWAP
        || type === CARD_TYPES.AMBUSH || type === CARD_TYPES.CURSE
        || type === CARD_TYPES.DEATH;
}

/** Categoria da carta para o jogador (painel de informações). */
export const CARD_CATEGORY = Object.freeze({ ATTACK: 0, SPECIAL_ATTACK: 1, CONSUMABLE: 2 });

/**
 * Número = carta de ataque; especiais que vão pro Ataque/Defesa (+2, +4, Block, Reverso, Relâmpago,
 * Fantasma, Espelho) = ataque especial; o resto vai pro slot USE = consumível.
 * @returns {number} CARD_CATEGORY.*
 */
export function cardCategory(type) {
    if (isConsumable(type)) return CARD_CATEGORY.CONSUMABLE;
    return type === CARD_TYPES.NUMBER ? CARD_CATEGORY.ATTACK : CARD_CATEGORY.SPECIAL_ATTACK;
}

/**
 * Carta que a Maldição pode atingir e o que ela vira (GAME_RULES §6.15). Consumíveis são imunes; um
 * número já no mínimo não perde nada (a Maldição prefere cartas que de fato sofrem).
 * @param {number} type
 * @param {number} power
 */
export function isCurseTarget(type, power) {
    if (isConsumable(type) || type === CARD_TYPES.HIDDEN) return false;
    if (type === CARD_TYPES.NUMBER) return power > CONFIG.CURSE.MIN_POWER;
    return true;
}

/**
 * Face amaldiçoada: número perde POWER_LOSS (mínimo MIN_POWER); especial é corrompida em Número 1 na
 * cor da rodada. Escreve em `out` ({ type, color, power }) para não alocar.
 */
export function cursedFace(type, color, power, roundColor, out) {
    const { CURSE } = CONFIG;
    if (type === CARD_TYPES.NUMBER) {
        out.type = type;
        out.color = color;
        out.power = Math.max(CURSE.MIN_POWER, power - CURSE.POWER_LOSS);
    } else {
        out.type = CARD_TYPES.NUMBER;
        out.color = CONFIG.BASIC_COLORS.includes(roundColor) ? roundColor : color;
        out.power = CURSE.CORRUPT_POWER;
    }
    return out;
}

/**
 * A carta pode abrir o Slot de Ataque nesta rodada? (consumível só vai pro USE; o resto obedece à cor)
 * @param {number} type
 * @param {number} color
 * @param {number} activeColor cor ativa do jogador (sorteada ou RAINBOW)
 */
export function isAttackOption(type, color, activeColor) {
    return !isConsumable(type) && canPlayColor(color, activeColor);
}

/**
 * Quantas cartas da lista ainda poderiam ir pro Ataque nesta rodada. Base da proteção "nunca ficar sem
 * jogada" (Finalizar Turno exige um Ataque): vender ou pintar não pode zerar esse número.
 * @param {FaceStore} store
 * @param {ArrayLike<number>} list índices no store (mão, Ataque e Defesa — as do campo voltam pra mão)
 * @param {number} activeColor
 * @param {number} [exceptIdx] carta ignorada (ex.: a que está indo pra lixeira)
 * @param {ArrayLike<number>|null} [paintList] cartas contadas como já pintadas de `paintColor`
 * @param {number} [paintColor]
 * @returns {number}
 */
export function countAttackOptions(store, list, activeColor, exceptIdx = -1, paintList = null, paintColor = COLOR.NONE) {
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (idx === exceptIdx) continue;
        let color = store.color[idx];
        if (paintList !== null) {
            for (let p = 0; p < paintList.length; p++) {
                if (paintList[p] === idx) color = paintColor;
            }
        }
        if (isAttackOption(store.type[idx], color, activeColor)) count++;
    }
    return count;
}

/**
 * Por que este consumível não pode ser usado agora (null = pode). Única fonte da regra: o servidor
 * valida com ela, o cliente usa pra aceitar/recusar o arraste no slot USE e a IA pra decidir.
 * @param {number} type CARD_TYPES.*
 * @param {number} status bitmask CONFIG.STATUS do próprio jogador
 * @returns {string|null}
 */
export function consumableBlockReason(type, status) {
    const { STATUS } = CONFIG;
    if (status & STATUS.USE_LOCKED) return 'USE_SLOT_LOCKED';
    switch (type) {
        case CARD_TYPES.HEAL: return (status & STATUS.HEAL) ? 'HEAL_ALREADY_ACTIVE' : null;
        case CARD_TYPES.SHIELD: return (status & STATUS.SHIELD) ? 'SHIELD_ALREADY_ACTIVE' : null;
        case CARD_TYPES.REVIVE: return (status & STATUS.REVIVE_USED) ? 'REVIVE_ALREADY_USED' : null;
        // Lendária: 1x por jogador por partida
        case CARD_TYPES.DEATH: return (status & STATUS.DEATH_USED) ? 'DEATH_ALREADY_USED' : null;
        // Duas Trocas do mesmo jogador se anulariam: a segunda só desperdiçaria a primeira
        case CARD_TYPES.GUARD_SWAP: return (status & STATUS.GUARD_SWAP) ? 'GUARD_SWAP_ALREADY_ACTIVE' : null;
        case CARD_TYPES.AMBUSH: return (status & STATUS.AMBUSH) ? 'AMBUSH_ALREADY_ACTIVE' : null;
        // Uma Maldição plantada por vez (a segunda só desperdiçaria a primeira) e no máximo 2 por partida
        case CARD_TYPES.CURSE:
            if (status & STATUS.CURSE_SPENT) return 'CURSE_LIMIT_REACHED';
            return (status & STATUS.CURSE_PENDING) ? 'CURSE_ALREADY_PENDING' : null;
        default: return null;
    }
}

/**
 * Dano que um golpe direto realmente tira, com o Escudo (metade, arredondada pra baixo) aplicado.
 * @param {number} rawDamage
 * @param {boolean} shielded
 */
export function shieldedDamage(rawDamage, shielded) {
    return shielded ? Math.floor(rawDamage * CONFIG.CONSUMABLES.SHIELD_DAMAGE_RATIO) : rawDamage;
}

// --- Economia (lixeira, moedas e loja) ---------------------------------------

const TYPE_NAMES = Object.freeze(Object.fromEntries(Object.entries(CARD_TYPES).map(([k, v]) => [v, k])));

/** Nome do tipo em CARD_TYPES (chave do catálogo e das traduções DESC_*), ou '' se desconhecido. */
export function cardTypeName(type) {
    return TYPE_NAMES[type] || '';
}

/** Chave i18n do nome da carta (`CARD_<TIPO>`), ou '' se o tipo for desconhecido. */
export function cardNameKey(type) {
    const name = TYPE_NAMES[type];
    return name ? `CARD_${name}` : '';
}

/** @returns {object|null} entrada de CONFIG.CARD_CATALOG */
export function catalogEntry(type) {
    return CONFIG.CARD_CATALOG[TYPE_NAMES[type]] || null;
}

export function hasCardTag(type, tag) {
    const entry = catalogEntry(type);
    return !!entry && (entry.tags & tag) !== 0;
}

/**
 * Moedas que a carta rende na lixeira. Números valem o valor atual; especiais, o do catálogo.
 * Carta comprada na loja (CARD_FLAGS.RESALE) revende por uma fração — sem isso, comprar um 9 por 8
 * e revendê-lo por 9 viraria dinheiro infinito.
 * @returns {number} 0 se não puder ser vendida
 */
export function sellValue(type, power, cardFlags = 0) {
    const entry = catalogEntry(type);
    if (!entry || (entry.tags & CONFIG.CARD_TAGS.SELLABLE) === 0) return -1;
    const base = entry.sell === 'POWER' ? Math.max(0, power) : entry.sell;
    if (cardFlags & CONFIG.CARD_FLAGS.RESALE) return Math.floor(base * CONFIG.SHOP.RESALE_RATIO);
    return base;
}

/**
 * Por que a compra do item não pode acontecer (null = pode). Mesma regra no servidor e no cliente.
 * @param {{ price: number, flags: number, type: number }} item
 */
export function purchaseBlockReason(item, coins, handSize) {
    if (item.type === CARD_TYPES.HIDDEN || (item.flags & CONFIG.SHOP_ITEM_FLAGS.SOLD)) return 'ITEM_UNAVAILABLE';
    if (coins < item.price) return 'NOT_ENOUGH_COINS';
    if (handSize >= CONFIG.MAX_HAND_SIZE) return 'HAND_FULL';
    return null;
}

// --- Evento da Arena (GAME_RULES §9): regras puras usadas igual por servidor, snapshot e CPU ---------

/** Efeitos ligados (bitmask CONFIG.SURGE_EFFECT) pelo evento `kind` (CONFIG.SURGE_KIND). */
export function surgeEffects(kind) {
    return CONFIG.SURGE.EFFECTS[kind] || 0;
}

/** Preço na loja (item ou renovação) com o Super Desconto aplicado, se ativo. */
export function surgePrice(price, kind) {
    return (surgeEffects(kind) & CONFIG.SURGE_EFFECT.DISCOUNT) ? Math.ceil(price * CONFIG.SURGE.DISCOUNT_RATIO) : price;
}

/** Cartas compradas no início do turno com o Dobro de Cartas aplicado, se ativo. */
export function surgeDraws(draws, kind) {
    return (surgeEffects(kind) & CONFIG.SURGE_EFFECT.DRAW) ? draws * CONFIG.SURGE.DRAW_MULT : draws;
}

/** Golpe na vida (antes do Escudo) com o Frenesi aplicado, se ativo. */
export function surgeDamage(raw, kind) {
    return raw > 0 && (surgeEffects(kind) & CONFIG.SURGE_EFFECT.FRENZY) ? Math.ceil(raw * CONFIG.SURGE.FRENZY_DAMAGE_MULT) : raw;
}

/** Moedas do fim da rodada: quem perdeu ganha mais (o oposto das compras de carta). */
export function roundCoinsFor(seat, roundWinner) {
    const { ROUND_COINS } = CONFIG.SHOP;
    if (roundWinner < 0) return ROUND_COINS.TIE;
    return seat === roundWinner ? ROUND_COINS.WINNER : ROUND_COINS.LOSER;
}

/** Sorteio ponderado de uma lista [valor, peso]. */
export function weightedPick(pairs, random = Math.random) {
    let total = 0;
    for (let i = 0; i < pairs.length; i++) total += pairs[i][1];
    let roll = random() * total;
    for (let i = 0; i < pairs.length; i++) {
        roll -= pairs[i][1];
        if (roll < 0) return pairs[i][0];
    }
    return pairs[pairs.length - 1][0];
}

/** Cura do fim do combate: metade do dano causado na rodada (pra baixo), limitada à vida máxima. */
export function healAmount(damageDealt, currentHp) {
    const heal = Math.floor(damageDealt * CONFIG.CONSUMABLES.HEAL_RATIO);
    return Math.max(0, Math.min(heal, CONFIG.MAX_HP - currentHp));
}

/**
 * Choque numérico. Positivo: A vence e fica com esse valor. Negativo: B vence com o módulo. Zero: empate.
 * @returns {number}
 */
export function resolveNumberClash(powerA, powerB) {
    return powerA - powerB;
}

/** Especiais que agem no choque de mesa (em vez de lutar com número). */
export function isFieldSpecial(type) {
    return type === CARD_TYPES.BLOCK || type === CARD_TYPES.REVERSE || type === CARD_TYPES.LIGHTNING
        || type === CARD_TYPES.GHOST || type === CARD_TYPES.MIRROR;
}

/** Choque em que um dos lados age (A_* quando `aActs`, senão B_*). */
function actor(aActs, kindA, kindB) {
    return aActs ? kindA : kindB;
}

/**
 * Classifica o choque entre duas cartas de topo (nunca +2/+4, que explodem antes).
 * Consumíveis que cheguem ao combate via invocação se comportam como número de valor 0 — o efeito
 * deles só existe quando usados no slot USE.
 *
 * Prioridade entre especiais (GAME_RULES §6), avaliada nesta ordem:
 *   1. Relâmpago: fulmina tudo (Block, Fantasma, Espelho, números) — só o Reverso o puxa antes.
 *   2. Fantasma: intangível, atravessa tudo o que sobrou (Block, Reverso, Espelho, números).
 *   3. Reverso: rouba/inverte (inclusive o Espelho, que não tem tempo de copiar). Reverso x Block anula.
 *   4. Block: anula a pilha; Block x Espelho é paradoxo (os dois se anulam).
 *   5. Espelho: copia o número +1 e vence; Espelho x Espelho é paradoxo.
 *   Especiais iguais se anulam.
 */
export function classifyClash(typeA, typeB) {
    const T = CARD_TYPES;
    if (!isFieldSpecial(typeA) && !isFieldSpecial(typeB)) return CLASH_KIND.NUMBERS;

    // 1. Relâmpago
    const aL = typeA === T.LIGHTNING;
    const bL = typeB === T.LIGHTNING;
    if (aL || bL) {
        if (aL && bL) return CLASH_KIND.MUTUAL_DESTRUCTION;
        const other = aL ? typeB : typeA;
        if (other === T.REVERSE) return actor(!aL, CLASH_KIND.A_REVERSES, CLASH_KIND.B_REVERSES);
        return actor(aL, CLASH_KIND.A_LIGHTNING, CLASH_KIND.B_LIGHTNING);
    }
    // 2. Fantasma
    const aG = typeA === T.GHOST;
    const bG = typeB === T.GHOST;
    if (aG && bG) return CLASH_KIND.GHOST_BOTH;
    if (aG || bG) return actor(aG, CLASH_KIND.A_GHOST, CLASH_KIND.B_GHOST);
    // 3. Reverso
    const aR = typeA === T.REVERSE;
    const bR = typeB === T.REVERSE;
    if (aR || bR) {
        if (aR && bR) return CLASH_KIND.MUTUAL_DESTRUCTION;
        if ((aR ? typeB : typeA) === T.BLOCK) return CLASH_KIND.MUTUAL_DESTRUCTION;
        return actor(aR, CLASH_KIND.A_REVERSES, CLASH_KIND.B_REVERSES);
    }
    // 4. Block
    const aB = typeA === T.BLOCK;
    const bB = typeB === T.BLOCK;
    if (aB || bB) {
        if (aB && bB) return CLASH_KIND.MUTUAL_DESTRUCTION;
        if ((aB ? typeB : typeA) === T.MIRROR) return CLASH_KIND.MIRROR_PARADOX;
        return actor(aB, CLASH_KIND.A_BLOCKS, CLASH_KIND.B_BLOCKS);
    }
    // 5. Espelho
    if (typeA === T.MIRROR && typeB === T.MIRROR) return CLASH_KIND.MIRROR_PARADOX;
    return actor(typeA === T.MIRROR, CLASH_KIND.A_MIRROR, CLASH_KIND.B_MIRROR);
}

/** Máscara com as 4 cores básicas (ex.: seletor de cor do Pintar, que aceita qualquer uma). */
export const ALL_BASIC_COLORS_MASK = CONFIG.BASIC_COLORS.reduce((mask, color) => mask | colorBit(color), 0);

/**
 * Proteção contra ficar sem jogada: a mudança só é recusada se o jogador TINHA opção de Ataque e ficaria
 * com zero (sem opção nenhuma antes, vender/pintar não piora nada).
 * @param {number} before countAttackOptions antes da mudança
 * @param {number} after countAttackOptions depois da mudança
 */
export function leavesNoAttack(before, after) {
    return before > 0 && after === 0;
}

/** Quantas cores básicas estão presentes na máscara (ver colorBit). */
export function colorCount(mask) {
    const colors = CONFIG.BASIC_COLORS;
    let count = 0;
    for (let i = 0; i < colors.length; i++) {
        if (mask & (1 << colors[i])) count++;
    }
    return count;
}

/**
 * Sorteia uma cor entre as presentes na máscara.
 * @param {number} mask
 * @param {() => number} [random]
 * @returns {number} COLOR.* ou COLOR.NONE se a máscara estiver vazia
 */
export function pickColorFromMask(mask, random = Math.random) {
    const colors = CONFIG.BASIC_COLORS;
    let count = 0;
    for (let i = 0; i < colors.length; i++) {
        if (mask & (1 << colors[i])) count++;
    }
    if (count === 0) return COLOR.NONE;

    let pick = Math.floor(random() * count);
    for (let i = 0; i < colors.length; i++) {
        if (mask & (1 << colors[i])) {
            if (pick === 0) return colors[i];
            pick--;
        }
    }
    return COLOR.NONE;
}

/** Quantas cartas precisam ser doadas antes da compra para não estourar o limite da mão. */
export function handLimitExcess(handCount, incoming) {
    return Math.max(0, handCount + incoming - CONFIG.MAX_HAND_SIZE);
}

/**
 * @param {number} seat
 * @param {number} roundWinner assento vencedor da rodada, ou -1 em empate
 */
export function roundDrawsFor(seat, roundWinner) {
    if (roundWinner < 0) return CONFIG.ROUND_DRAWS.TIE;
    return seat === roundWinner ? CONFIG.ROUND_DRAWS.WINNER : CONFIG.ROUND_DRAWS.LOSER;
}
