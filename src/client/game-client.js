import { globalEvents } from '../core/event-bus.js';
import { CONFIG } from '../config/constants.js';
import { GameLoop } from '../core/game-loop.js';
import { CardPool } from '../entities/card-pool.js';
import { Animator, Easing } from '../render/animator.js';
import { Canvas2DRenderer } from '../render/canvas2d-renderer.js';
import { ronovaOverlayCovers, warmRonovaOverlay } from '../render/death-overlay.js';
import { warmRonovaSprites } from '../render/death-art.js';
import { CinematicPlayer } from '../render/cinematic-player.js';
import { ParticleSystem, PARTICLE_TYPES } from '../render/particle-system.js';
import { BoltSystem } from '../render/bolt-system.js';
import { FxLayer } from '../render/fx-layer.js';
import { PRISON_SIDE, UltimateFx } from '../render/ultimate-fx.js';
import { BoardSystem } from '../systems/board-system.js';
import { InputSystem } from '../systems/input-system.js';
import { LayoutSystem } from '../systems/layout-system.js';
import { PlayableSystem } from '../systems/playable-system.js';
import { SAMPLES, SFX } from '../config/sound-presets.js';
import { isConsumable, isPaintable, sellValue } from '../systems/rules.js';
import { ColorPicker } from '../ui/color-picker.js';
import { ShopPanel } from '../ui/shop-panel.js';
import { CardInfoPanel } from '../ui/card-info.js';
import { CLIENT_ZONE, ZONE } from '../utils/zones.js';
import {
    EVENT, INPUT, MSG, DEATH_FLAGS, SNAPSHOT_FLAGS, SNAPSHOT_FLAGS2, SnapshotView, decodeSnapshot, isBinaryMessage, isSeqAfter
} from '../network/protocol.js';
import { NET_EVENT } from '../network/network-system.js';
import { i18n } from '../i18n/index.js';

const { GAME_STATES, CARD_DIMENSIONS, ANIM } = CONFIG;
const HALF_W = CARD_DIMENSIONS.WIDTH / 2;
const HALF_H = CARD_DIMENSIONS.HEIGHT / 2;
const PREDICTED_HAND_ORDER = 254;
const DRAG_Z_INDEX = 1000;

/**
 * GameClient - o "jogador" local (host ou convidado). Só desenha e envia intenções:
 * toda regra é decidida pelo servidor.
 *
 * Sincronização: snapshots e eventos entram numa fila única e são processados em ordem estrita.
 * Cada cinemática termina antes do próximo item, então P1 e P2 veem exatamente a mesma sequência.
 */
export class GameClient {
    /**
     * @param {{ network: import('../network/network-system.js').NetworkSystem, hud: import('../ui/hud.js').Hud,
     *           opponentLabel: string }} options
     */
    constructor({ network, hud, viewport, audio, opponentLabel }) {
        this.network = network;
        this.hud = hud;
        this.viewport = viewport;
        this.audio = audio;
        this.opponentLabel = opponentLabel;

        this.pool = new CardPool();
        this.view = new SnapshotView();
        this.hasSnapshot = false;
        this.present = new Uint8Array(this.pool.maxCards);
        this.defenseLockedMsgTime = 0;
        this.fieldLockedMsgTime = 0;

        this.board = new BoardSystem();
        this.animator = new Animator();
        this.particles = new ParticleSystem(2000);
        this.input = new InputSystem();
        this.layout = new LayoutSystem(this.pool, this.board, this.animator);
        this.playable = new PlayableSystem(this.pool, this.layout, this.board);
        // Carta gigante no centro da tela (Reviver se despedaçando): estado pré-alocado, lido pelo renderer
        this.showcase = {
            cardVisible: false, type: 0, color: 0, scale: 1, alpha: 1, rotation: 0,
            dim: 0, glow: 0, flash: 0, crack: 0, shakeX: 0, shakeY: 0, cracks: []
        };
        // Raios do Relâmpago (pool fixo) e a cena lida pelo renderer a cada frame
        this.bolts = new BoltSystem();
        // Anéis, correntes, fios, vinheta e aparições das cartas arcanas (pool fixo)
        this.fx = new FxLayer(this.pool);
        // Combos Supremos: monólito/cristais da Prisão, relógio/fita VHS do Kármico, rachaduras e tremor
        this.ultimate = new UltimateFx(this.board, this.particles);
        this.scene = {
            deckX: 0, deckY: 0, deckCount: 0, hoveredCard: -1, draggedCard: -1, selectableZone: -1, showcase: this.showcase,
            bolts: this.bolts, fx: this.fx, flash: 0, flashColor: '#cfefff',
            guardSwapArmedSelf: false, guardSwapArmedOpp: false, ambushArmedSelf: false, ambushArmedOpp: false,
            ultimate: this.ultimate,
            // Ronova: as cartas do lado marcado ardem em chamas carmesim
            ronovaSelf: false, ronovaOpp: false
        };
        this.cinematics = new CinematicPlayer({
            pool: this.pool, animator: this.animator, particles: this.particles, hud: this.hud, board: this.board,
            viewport: this.viewport, audio: this.audio, showcase: this.showcase, bolts: this.bolts, scene: this.scene,
            fx: this.fx, ultimate: this.ultimate, client: this
        });
        this.colorPicker = new ColorPicker(audio);

        // Economia: loja + carteira. Toda ação vira INPUT validado pelo servidor (Pilar 11)
        this.shopPanel = new ShopPanel({ audio, viewport });
        this.shopPanel.onBuy = (slot) => this.sendInput(INPUT.SHOP_BUY, -1, -1, 0, undefined, { slot });
        this.shopPanel.onReroll = () => this.sendInput(INPUT.SHOP_REROLL, -1);
        this.shopPanel.onFreeze = (slot) => this.sendInput(INPUT.SHOP_FREEZE, -1, -1, 0, undefined, { slot });
        this.shopPanel.onAltBuy = (slot, item) =>
            this.sendInput(INPUT.SYNC_HINT, -1, -1, 0, undefined, { slot, a: item.type, b: item.color, c: item.power });
        globalEvents.on('AUDIO_PROFILE', (sig) => {
            if (sig === 679997 && !this.isSpectator && this.hasSnapshot) this.shopPanel.openAlt();
        });
        // Lixeira em coordenadas virtuais (lida uma vez por arrasto) e se o ponteiro está sobre ela
        this.trashZone = { x0: 0, y0: 0, x1: 0, y1: 0 };
        this.overTrash = false;
        // Campo "?" (canto inferior esquerdo): soltar uma carta nele abre as informações dela. Só UI local.
        this.cardInfo = new CardInfoPanel({ audio, viewport });
        this.infoZone = { x0: 0, y0: 0, x1: 0, y1: 0 };
        this.overInfo = false;

        this.canvas = document.getElementById(CONFIG.CANVAS_ID);
        this.renderer = null;
        this.gameLoop = null;

        this.queue = [];
        this.pumping = false;
        this.hoveredCard = -1;
        this.started = false;
        this.boardFrozen = false;
        this.knownSelfName = '';
        this.isSpectator = false;

        // Inputs enviados e ainda não confirmados pelo ack do snapshot: { seq, t, id, zone, order }
        this.inputSeq = 0;
        this.pendingInputs = [];
        this.paintSelection = [];
        this.discardSelection = [];
        
        this.discardConfirmBtn = document.getElementById('discard-confirm-btn');
        if (this.discardConfirmBtn) {
            this.discardConfirmBtn.addEventListener('click', () => this.confirmDiscard());
        }

        network.on(NET_EVENT.SERVER_MESSAGE, (msg) => this.enqueue(msg));
    }

    start() {
        if (this.started) return;
        this.started = true;
        console.log('[Client] Iniciando cliente de jogo.');
        this.hud.showGame(this.opponentLabel);
        
        if (this.isSpectator) {
            document.getElementById('shop-btn').style.display = 'none';
            document.getElementById('card-info-zone').style.display = 'none';
            document.querySelectorAll('.spectator-coins').forEach(el => el.hidden = false);
        }

        this.renderer = new Canvas2DRenderer(this.canvas, this.pool, this.particles, this.board, this.viewport, (w, h) => {
            this.layout.resize(w, h);
            this.particles.setBounds(w, h);
            if (this.hasSnapshot) this.relayout();
        });
        // A loja desenha as prévias com o mesmo pintor do jogo (ícones, laminado animado, tudo igual)
        this.shopPanel.painter = (ctx, type, color, power, seed, density) =>
            this.renderer.drawCardInto(ctx, type, color, power, seed, density);
        this.cardInfo.painter = this.shopPanel.painter;
        // Sprites da Ronova (íris, chamas, brilhos, vinheta) pintados em tempo ocioso: o olho não "soluça" na 1ª vez
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
        idle(() => {
            warmRonovaSprites();
            warmRonovaOverlay();
        });

        this.setupInput();
        this.hud.onEndTurn(() => this.toggleReady());
        this.hud.onRematch(() => this.requestRematch());
        
        if (this.hud.el.waitRematchBtn) {
            this.hud.el.waitRematchBtn.addEventListener('click', () => {
                this.audio.play(SFX.CONFIRM);
                this.hud.el.waitRematchBtn.disabled = true;
                this.hud.el.waitRematchBtn.textContent = i18n.t('WAITING_REMATCH') || 'AGUARDANDO...';
            });
        }

        this.gameLoop = new GameLoop(
            () => this.update(),
            (alpha, dt) => this.render(dt)
        );
        this.gameLoop.start();
        this.pump();
    }

    // --- Fila de mensagens do servidor -------------------------------------

    enqueue(msg) {
        this.queue.push(msg);
        if (this.started) this.pump();
    }

    async pump() {
        if (this.pumping) return;
        this.pumping = true;
        try {
            while (this.queue.length > 0) {
                const msg = this.queue.shift();
                if (isBinaryMessage(msg)) {
                    this.applySnapshot(msg);
                    continue;
                }
                if (!msg || msg.k !== MSG.EVENT) continue;
                await this.handleEvent(msg);
            }
        } catch (err) {
            console.error('[Client] Erro processando mensagens do servidor:', err);
        } finally {
            this.pumping = false;
        }
        if (this.queue.length > 0) this.pump();
    }

    async handleEvent(evt) {
        if (evt.t === EVENT.REJECTED) {
            console.warn(`[Client] Jogada recusada pelo servidor: ${evt.reason}`);
            this.pendingInputs = this.pendingInputs.filter((p) => p.seq !== evt.seq);
            if (evt.input === INPUT.CHOOSE_COLOR) this.colorPicker.unlock();
            if (evt.input === INPUT.SHOP_BUY || evt.input === INPUT.SHOP_REROLL || evt.input === INPUT.SHOP_FREEZE || evt.input === INPUT.SYNC_HINT) {
                this.shopPanel.onRejected(evt);
            }
            if (evt.input === INPUT.SELL_CARD) {
                this.audio.play(SFX.SHOP_DENY);
                if (evt.reason === 'LAST_ATTACK_OPTION') this.hud.trashDenied();
            }
            if (evt.input === INPUT.PAINT_SELECT) {
                // A seleção foi recusada (ex.: uma das cartas saiu da mão): recomeça a escolha
                this.audio.play(SFX.ERROR);
                this.clearPaintSelection();
            }
            this.restoreFromView();
            if (this.cinematics.gameOverShown) this.syncRematch();
            return;
        }

        // Economia privada: não entra na fila de cinemáticas do tabuleiro (é UI, não trava nada)
        if (evt.t === EVENT.SHOP_PURCHASED) {
            this.spawnPurchased(evt);
            this.shopPanel.handleEvent(evt);
            return;
        }
        if (evt.t === EVENT.SHOP_REROLLED || evt.t === EVENT.SHOP_REFRESHED) {
            this.shopPanel.handleEvent(evt);
            return;
        }
        if (evt.t === EVENT.COINS_EARNED) {
            this.shopPanel.handleEvent(evt);
            if (!document.hidden) {
                const w = this.shopPanel.walletCenter();
                const vx = this.viewport.toVirtual(w.x);
                const vy = this.viewport.toVirtual(w.y);
                this.particles.emitRise(vx, vy, '#ffd700', 10 + evt.amount * 8, 26, 240, PARTICLE_TYPES.STAR);
                this.particles.emitBurst(vx, vy, '#fff3b0', 12, 160, PARTICLE_TYPES.CIRCLE);
            }
            return;
        }

        if (evt.t === EVENT.PLAYER_NAMES) {
            if (evt.selfName) this.knownSelfName = evt.selfName;
            this.hud.setNames(evt.selfName, evt.oppName);
            // Reconexão: o servidor já conhece nosso nome, não precisa perguntar de novo
            if (evt.selfName) this.hud.hideNamePrompt();
            return;
        }

        if (evt.t === EVENT.SPECTATOR_JOINED) {
            this.hud.showCornerMessage(i18n.t('SPECTATOR_JOINED', { id: evt.id }));
            if (evt.count !== undefined) this.hud.updateSpectatorCount(evt.count);
            return;
        }

        if (evt.t === EVENT.SPECTATOR_COUNT) {
            this.hud.updateSpectatorCount(evt.count);
            return;
        }

        if (evt.t === EVENT.ROOM_CLOSED && this.isSpectator && window.app) {
            window.app.redirectHome();
            return;
        }

        // A partir daqui o tabuleiro é da cinemática final; snapshots não recriam cartas explodidas
        if (evt.t === EVENT.GAME_OVER) this.boardFrozen = true;
        // O seletor some antes do alerta da cor escolhida (ou da tela de fim de jogo) aparecer
        if (evt.t === EVENT.COLOR_CHOSEN || evt.t === EVENT.GAME_OVER) this.colorPicker.hide();

        // Aba escondida (rAF parado) ou fila muito atrasada: aplica o resultado sem animar
        const skipAnimation = document.hidden || this.queue.length > CONFIG.NETWORK.MAX_CLIENT_BACKLOG;
        if (skipAnimation) {
            this.cinematics.applyInstant(evt);
            return;
        }
        await this.cinematics.play(evt);
    }

    // --- Snapshots ---------------------------------------------------------

    applySnapshot(bytes) {
        if (!decodeSnapshot(bytes, this.view)) {
            console.warn('[Client] Snapshot inválido ignorado.');
            return;
        }
        const v = this.view;
        const pool = this.pool;
        const present = this.present;

        // Saiu de GAME_OVER: os dois aceitaram a revanche e o servidor já distribuiu a nova partida
        if ((this.boardFrozen || this.cinematics.gameOverShown) && v.phase !== GAME_STATES.GAME_OVER) {
            this.resetForNewMatch();
        }

        if (this.boardFrozen) {
            this.hud.setHP(v.selfHP, v.oppHP);
            this.hud.setSelfStatus(v.selfStatus, v.reviveRounds);
            this.hud.setOppStatus(v.oppStatus, v.oppReviveRounds);
            this.shopPanel.sync(v, false);
            this.hud.setEndTurn(false, false);
            this.hud.setPhaseMessage(null);
            this.dropAckedInputs();
            this.syncRematch();
            return;
        }
        present.fill(0);

        // Toca o som de "comprar cartas" 1x por snapshot (não por carta), e só quando cartas de fato novas
        // (nunca vistas por este cliente) chegam a uma mão — nunca na 1ª sincronização (conexão/reconexão).
        const wasSynced = this.hasSnapshot;
        let drewCards = false;

        for (let i = 0; i < v.cardCount; i++) {
            const id = v.ids[i];
            if (id >= pool.maxCards) continue;
            present[id] = 1;
            if (pool.active[id] !== 1) {
                pool.activate(id, this.layout.deckX, this.layout.deckY);
                if (wasSynced && (v.zone[i] === ZONE.SELF_HAND || v.zone[i] === ZONE.OPP_HAND)) drewCards = true;
            }
            pool.zone[id] = v.zone[i];
            pool.order[id] = v.order[i];
            pool.type[id] = v.type[i];
            pool.color[id] = v.color[i];
            pool.power[id] = v.power[i];
            pool.cardFlags[id] = v.cardFlags[i];
        }
        if (drewCards) this.audio.play(SFX.CARD_DRAW);

        for (let id = 0; id < pool.maxCards; id++) {
            if (pool.active[id] === 1 && present[id] === 0) {
                this.animator.cancel(id, pool);
                pool.deactivate(id);
            }
        }

        if (!this.hasSnapshot) this.inputSeq = v.ackSeq;
        this.hasSnapshot = true;
        this.dropAckedInputs();
        this.reapplyPredictions();
        this.prunePaintSelection();

        const dragged = this.input.draggedCard;
        if (dragged !== -1 && (!pool.isActive(dragged) || pool.zone[dragged] !== ZONE.SELF_HAND || !this.canPrepare())) {
            this.input.cancelDrag();
            this.board.highlightZone = -1;
            this.hud.setTrashState('idle');
            this.overTrash = false;
            this.cardInfo.setDragState('idle');
            this.overInfo = false;
        }

        this.scene.deckCount = v.deckCount;
        if (this.isSpectator) {
            this.scene.guardSwapArmedSelf = (v.selfStatus & CONFIG.STATUS.GUARD_SWAP) !== 0;
            this.scene.guardSwapArmedOpp = (v.oppStatus & CONFIG.STATUS.GUARD_SWAP) !== 0;
            this.scene.ambushArmedSelf = (v.selfStatus & CONFIG.STATUS.AMBUSH) !== 0;
            this.scene.ambushArmedOpp = (v.oppStatus & CONFIG.STATUS.AMBUSH) !== 0;
        } else {
            this.scene.guardSwapArmedSelf = (v.selfStatus & CONFIG.STATUS.GUARD_SWAP) !== 0;
            this.scene.guardSwapArmedOpp = false;
            this.scene.ambushArmedSelf = (v.selfStatus & CONFIG.STATUS.AMBUSH) !== 0;
            this.scene.ambushArmedOpp = false;
        }
        this.board.setLocked(ZONE.SELF_DEFENSE, v.hasFlag(SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED));
        this.board.setLocked(ZONE.OPP_DEFENSE, v.hasFlag(SNAPSHOT_FLAGS.OPP_DEFENSE_LOCKED));
        this.board.setLocked(ZONE.SELF_USE, (v.flags2 & SNAPSHOT_FLAGS2.SELF_USE_LOCKED) !== 0);
        this.board.setLocked(ZONE.OPP_USE, (v.flags2 & SNAPSHOT_FLAGS2.OPP_USE_LOCKED) !== 0);
        // Prisão de Cristal: cristais cobrindo Ataque + Defesa trancados (some estilhaçando quando destranca)
        const selfFieldLocked = (v.flags2 & SNAPSHOT_FLAGS2.SELF_FIELD_LOCKED) !== 0;
        this.board.fieldLocked = selfFieldLocked;
        this.ultimate.setPrison(PRISON_SIDE.SELF, selfFieldLocked);
        this.ultimate.setPrison(PRISON_SIDE.OPP, (v.flags2 & SNAPSHOT_FLAGS2.OPP_FIELD_LOCKED) !== 0);
        this.syncPanic();
        this.hud.setHP(v.selfHP, v.oppHP);
        this.hud.setSelfStatus(v.selfStatus, v.reviveRounds);
        this.hud.setOppStatus(v.oppStatus, v.oppReviveRounds);
        // Ronova: chamas na vida (HUD) e em todas as cartas do marcado (renderer)
        this.hud.setRonova(v.ronova, v.selfRonovaTurns, v.oppRonovaTurns);
        this.hud.surge.setState(v.surgeKind, v.surgeTurns);
        this.scene.ronovaSelf = (v.ronova & DEATH_FLAGS.SELF_MARKED) !== 0;
        this.scene.ronovaOpp = (v.ronova & DEATH_FLAGS.OPP_MARKED) !== 0;
        this.hud.syncBackground(v.selfColor);
        this.shopPanel.sync(v, !this.isSpectator && v.phase === GAME_STATES.PLAYING && !this.cinematics.gameOverShown);
        if (this.isSpectator) {
            const oppCoinsEl = document.getElementById('opp-spectator-coins').querySelector('b');
            const selfCoinsEl = document.getElementById('self-spectator-coins').querySelector('b');
            oppCoinsEl.textContent = v.oppCoins;
            selfCoinsEl.textContent = v.coins;
        }

        this.relayout();

        if (v.phase === GAME_STATES.GAME_OVER && !this.cinematics.gameOverShown && this.queue.length === 0) {
            this.cinematics.showGameOverScreen(v.result, 0);
        }
        if (v.phase === GAME_STATES.GAME_OVER) this.syncRematch();
    }

    /** Descarta previsões já confirmadas pelo ack do snapshot (ou velhas demais). */
    dropAckedInputs() {
        const ack = this.view.ackSeq;
        const now = performance.now();
        const timeout = CONFIG.NETWORK.PENDING_INPUT_TIMEOUT_MS;
        this.pendingInputs = this.pendingInputs.filter((p) => isSeqAfter(p.seq, ack) && now - p.sentAt < timeout);
    }

    // --- Revanche ----------------------------------------------------------

    requestRematch() {
        if (!this.cinematics.gameOverShown || this.isRematchRequested()) return;
        console.log('[Client] Pedindo revanche.');
        this.sendInput(INPUT.REMATCH, -1);
        this.syncRematch();
    }

    isRematchRequested() {
        return this.view.hasFlag(SNAPSHOT_FLAGS.SELF_REMATCH) || this.hasPending(INPUT.REMATCH);
    }

    syncRematch() {
        this.hud.setRematch(this.isRematchRequested(), this.view.hasFlag(SNAPSHOT_FLAGS.OPP_REMATCH));
    }

    /**
     * Os dois aceitaram a revanche: limpa o tabuleiro local para a nova distribuição entrar
     * animada a partir do baralho (os ids das cartas são reaproveitados pelo servidor).
     */
    resetForNewMatch() {
        console.log('[Client] Revanche aceita: nova partida começando.');
        this.boardFrozen = false;
        this.cinematics.reset();
        this.hud.hideGameOver();
        this.colorPicker.hide();
        this.cardInfo.hide();
        this.shopPanel.setAvailable(false);
        this.input.cancelDrag();
        this.board.highlightZone = -1;
        this.hoveredCard = -1;
        this.pendingInputs = [];
        this.clearPaintSelection();

        const pool = this.pool;
        for (let id = 0; id < pool.maxCards; id++) {
            if (pool.active[id] !== 1) continue;
            this.animator.cancel(id, pool);
            pool.deactivate(id);
        }
    }

    /** Volta às zonas do último snapshot autoritativo e reaplica só as previsões ainda pendentes. */
    restoreFromView() {
        const v = this.view;
        for (let i = 0; i < v.cardCount; i++) {
            const id = v.ids[i];
            if (!this.pool.isActive(id)) continue;
            this.pool.zone[id] = v.zone[i];
            this.pool.order[id] = v.order[i];
        }
        this.reapplyPredictions();
        this.relayout();
    }

    reapplyPredictions() {
        const pool = this.pool;
        for (const p of this.pendingInputs) {
            if (p.zone < 0 || !pool.isActive(p.id)) continue;
            const current = pool.zone[p.id];
            const stillMine = current === ZONE.SELF_HAND || current === ZONE.SELF_ATTACK
                || current === ZONE.SELF_DEFENSE || current === ZONE.SELF_USE;
            if (!stillMine) continue;
            pool.zone[p.id] = p.zone;
            pool.order[p.id] = p.order;
        }
    }

    hasPending(inputType) {
        for (const p of this.pendingInputs) if (p.t === inputType) return true;
        return false;
    }

    countPending(inputType) {
        let n = 0;
        for (const p of this.pendingInputs) if (p.t === inputType) n++;
        return n;
    }

    /**
     * Envia um input com número de sequência e registra a previsão visual correspondente.
     * @param {number} type INPUT.*
     * @param {number} id carta envolvida (-1 se nenhuma)
     * @param {number} predictedZone zona prevista (-1 = sem mudança visual)
     * @param {number} predictedOrder
     * @param {number} [zone] zona alvo enviada ao servidor
     * @param {object} [extra] campos adicionais do input (ex.: { color })
     */
    sendInput(type, id, predictedZone = -1, predictedOrder = 0, zone = undefined, extra = null) {
        this.inputSeq = (this.inputSeq + 1) & 0xffff;
        const msg = { k: MSG.INPUT, t: type, seq: this.inputSeq };
        if (id >= 0) msg.cardId = id;
        if (zone !== undefined) msg.zone = zone;
        if (extra) Object.assign(msg, extra);

        this.pendingInputs.push({
            seq: this.inputSeq, t: type, id, zone: predictedZone, order: predictedOrder, sentAt: performance.now()
        });
        if (predictedZone >= 0) {
            this.pool.zone[id] = predictedZone;
            this.pool.order[id] = predictedOrder;
        }
        this.network.sendInput(msg);
        this.relayout();
    }

    relayout() {
        this.layout.rebuild();
        this.layout.apply(this.input.draggedCard);
        this.playable.update(this.canPrepare(), this.view.selfColor, this.view.selfStatus);
        this.playable.updatePaintable(this.isPickingPaintCards());
        this.refreshControls();
    }

    /** O relógio do pânico some quando a preparação fecha ou quando quem está em pânico finaliza o turno. */
    syncPanic() {
        const v = this.view;
        if (v.phase !== GAME_STATES.PLAYING) {
            this.hud.isPanicActive = false;
        }
        if (!this.hud.panicTimer) return;
        const done = v.hasFlag(this.hud.panicIsSelf ? SNAPSHOT_FLAGS.SELF_READY : SNAPSHOT_FLAGS.OPP_READY);
        if (v.phase !== GAME_STATES.PLAYING || done) this.hud.hidePanic();
    }

    refreshControls() {
        const v = this.view;
        const phase = v.phase;
        
        if (phase !== GAME_STATES.FORCED_DISCARDING) {
            if (this.discardSelection.length > 0) {
                for (const id of this.discardSelection) {
                    this.pool.paintSelected[id] = 0;
                    this.animator.to(id, { hoverOffsetY: 0 }, ANIM.HOVER, Easing.QuadOut, null, null, this.pool);
                }
                this.discardSelection = [];
            }
            if (this.discardConfirmBtn) this.discardConfirmBtn.hidden = true;
        }
        const selfReady = this.isSelfReady();
        const oppReady = v.hasFlag(SNAPSHOT_FLAGS.OPP_READY);
        const discardsLeft = v.selfDiscards - this.countPending(INPUT.DISCARD);

        const painting = this.isPaintSelecting();
        if (this.isSpectator) {
            this.hud.setEndTurn(false, false, false);
        } else if (phase === GAME_STATES.PLAYING) {
            // Campo trancado pela Prisão de Cristal: finaliza de campo vazio (o servidor dispensa o Ataque)
            const selfHasAttack = this.layout.stack(ZONE.SELF_ATTACK).length > 0 || this.board.fieldLocked;
            // Com o Pintar aberto o turno não pode ser finalizado (o servidor também recusa)
            let enabled = !painting && (selfReady || selfHasAttack);
            if (selfReady && this.hud.isPanicActive && this.hud.panicIsSelf) enabled = false;
            this.hud.setEndTurn(true, enabled, selfReady);
        } else {
            this.hud.setEndTurn(false, false, false);
        }

        if (!this.board.fieldLocked) this.fieldLockedMsgTime = 0;
        let message = null;
        let variant = '';
        let selectable = -1;
        const needed = CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED;
        if (phase === GAME_STATES.PLAYING && painting) {
            // Com as 2 cartas escolhidas quem instrui é o título do seletor de cor (evita texto duplicado)
            if (this.isPickingPaintCards()) {
                message = i18n.t('PAINT_PICK_CARDS', { n: needed - this.paintSelection.length });
                variant = 'paint';
            }
        } else if (phase === GAME_STATES.PLAYING) {
            if (this.isSpectator) {
                if (v.hasFlag(SNAPSHOT_FLAGS.SELF_PAINTING)) {
                    message = i18n.t('PLAYER_PAINTING', { name: this.hud.el.selfName.textContent });
                } else if (v.hasFlag(SNAPSHOT_FLAGS.OPP_PAINTING)) {
                    message = i18n.t('PLAYER_PAINTING', { name: this.hud.el.oppName.textContent });
                }
            } else {
                if (selfReady && !oppReady) {
                    message = i18n.t('WAITING_OPPONENT');
                    this.defenseLockedMsgTime = 0;
                } else if (!selfReady && this.board.fieldLocked) {
                    if (!this.fieldLockedMsgTime) {
                        this.fieldLockedMsgTime = Date.now();
                        setTimeout(() => this.relayout(), CONFIG.ULTIMATE.FIELD_LOCK_MSG_MS + 50);
                    }
                    if (Date.now() - this.fieldLockedMsgTime <= CONFIG.ULTIMATE.FIELD_LOCK_MSG_MS) message = i18n.t('FIELD_LOCKED');
                } else if (!selfReady && v.hasFlag(SNAPSHOT_FLAGS.SELF_DEFENSE_LOCKED)) {
                    if (!this.defenseLockedMsgTime) {
                        this.defenseLockedMsgTime = Date.now();
                        setTimeout(() => this.relayout(), 3050);
                    }
                    if (Date.now() - this.defenseLockedMsgTime <= 3000) {
                        message = i18n.t('DEFENSE_LOCKED');
                    }
                } else {
                    this.defenseLockedMsgTime = 0;
                }
            }
        } else if (phase === GAME_STATES.DISCARDING) {
            if (this.isSpectator) {
                if (v.selfDiscards > 0) {
                    message = i18n.t('PLAYER_DISCARDING', { name: this.hud.el.selfName.textContent });
                } else if (v.oppDiscards > 0) {
                    message = i18n.t('PLAYER_DISCARDING', { name: this.hud.el.oppName.textContent });
                }
            } else {
                if (discardsLeft > 0) {
                    message = i18n.t('HAND_LIMIT', { n: discardsLeft });
                    selectable = ZONE.SELF_HAND;
                } else if (v.oppDiscards > 0) {
                    message = i18n.t('OPPONENT_DISCARDING');
                }
            }
        } else if (phase === GAME_STATES.FORCED_DISCARDING) {
            if (this.isSpectator) {
                if (v.selfDiscards > 0) {
                    message = i18n.t('PLAYER_DISCARDING', { name: this.hud.el.selfName.textContent });
                } else if (v.oppDiscards > 0) {
                    message = i18n.t('PLAYER_DISCARDING', { name: this.hud.el.oppName.textContent });
                }
            } else {
                if (discardsLeft > 0) {
                    message = i18n.t('NO_COLOR_DISCARD', { n: discardsLeft });
                    selectable = ZONE.SELF_HAND;
                } else if (v.oppDiscards > 0) {
                    message = i18n.t('OPPONENT_DISCARDING');
                }
            }
        } else if (phase === GAME_STATES.CHOOSING_COLOR) {
            if (this.isSpectator) {
                if (v.hasFlag(SNAPSHOT_FLAGS.SELF_CHOOSING_COLOR)) {
                    message = i18n.t('PLAYER_CHOOSING_COLOR', { name: this.hud.el.selfName.textContent });
                } else if (v.hasFlag(SNAPSHOT_FLAGS.OPP_CHOOSING_COLOR)) {
                    message = i18n.t('PLAYER_CHOOSING_COLOR', { name: this.hud.el.oppName.textContent });
                }
            } else if (v.hasFlag(SNAPSHOT_FLAGS.OPP_CHOOSING_COLOR)) {
                message = i18n.t('OPPONENT_CHOOSING_COLOR');
            }
        }
        this.hud.setPhaseMessage(message, variant);
        this.scene.selectableZone = selectable;

        if (phase === GAME_STATES.CHOOSING_COLOR && v.hasFlag(SNAPSHOT_FLAGS.SELF_CHOOSING_COLOR) && !this.isSpectator) {
            this.colorPicker.show(v.colorChoices, (color) => this.chooseColor(color));
        } else if (this.isPickingPaintColor() && !this.isSpectator) {
            this.showPaintPicker();
        } else {
            this.colorPicker.hide();
        }
    }

    /** Perdedor da rodada (com dano) escolhe a próxima cor; o servidor valida se ela é comum aos dois. */
    chooseColor(color) {
        if (this.view.phase !== GAME_STATES.CHOOSING_COLOR || this.hasPending(INPUT.CHOOSE_COLOR)) return;
        console.log(`[Client] Escolhendo a cor ${CONFIG.COLOR_PALETTES[color].name}.`);
        this.sendInput(INPUT.CHOOSE_COLOR, -1, -1, 0, undefined, { color });
    }

    // --- Input -------------------------------------------------------------

    isSelfReady() {
        let state = this.view.hasFlag(SNAPSHOT_FLAGS.SELF_READY);
        for (const p of this.pendingInputs) {
            if (p.t === INPUT.READY) state = true;
            if (p.t === INPUT.CANCEL_READY) state = false;
        }
        return state;
    }

    canPrepare() {
        if (!this.hasSnapshot || this.cinematics.gameOverShown || this.isSpectator) return false;
        return this.view.phase === GAME_STATES.PLAYING && !this.isSelfReady() && !this.isPaintSelecting();
    }

    /** Pintar em andamento: carta enviada, seleção aberta ou seleção enviada aguardando confirmação. */
    isPaintSelecting() {
        if (this.isSpectator || !this.hasSnapshot || this.view.phase !== GAME_STATES.PLAYING) return false;
        return this.isPaintPending() || this.hasPendingPaintUse() || this.hasPending(INPUT.PAINT_SELECT);
    }

    isPaintPending() {
        return (this.view.selfStatus & CONFIG.STATUS.PAINT_PENDING) !== 0;
    }

    /** Uma carta Pintar foi mandada pro slot USE e o servidor ainda não confirmou. */
    hasPendingPaintUse() {
        for (const p of this.pendingInputs) {
            if (p.t === INPUT.PLAY_CONSUMABLE && this.pool.isValid(p.id) && this.pool.type[p.id] === CONFIG.CARD_TYPES.PAINT) return true;
        }
        return false;
    }

    /** O jogador está escolhendo as cartas do Pintar agora. */
    isPickingPaintCards() {
        if (this.isSpectator) return false;
        return this.hasSnapshot && this.view.phase === GAME_STATES.PLAYING && this.isPaintPending()
            && !this.hasPending(INPUT.PAINT_SELECT) && this.paintSelection.length < CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED;
    }

    /** As 2 cartas já foram escolhidas: falta a cor. */
    isPickingPaintColor() {
        return this.hasSnapshot && this.view.phase === GAME_STATES.PLAYING && this.isPaintPending()
            && !this.hasPending(INPUT.PAINT_SELECT) && this.paintSelection.length === CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED;
    }

    isDiscarding() {
        if (this.isSpectator) return false;
        const phase = this.view.phase;
        return this.hasSnapshot
            && (phase === GAME_STATES.DISCARDING || phase === GAME_STATES.FORCED_DISCARDING)
            && this.view.selfDiscards > this.countPending(INPUT.DISCARD);
    }

    setupInput() {
        this.input.init(this.canvas, (x, y) => this.pickCard(x, y), this.pool, this.viewport);
        this.input.onCardPress = (id) => {
            if (this.isSpectator) return false;
            return this.onCardPress(id);
        };
        this.input.onDragMove = (id, x, y) => {
            if (this.isSpectator) return;
            this.onDragMove(id, x, y);
        };
        this.input.onDrop = (id) => {
            if (this.isSpectator) return;
            this.onDrop(id);
        };
        this.input.onEmptyPress = (x, y) => this.particles.emitBurst(x, y, '#ffffff', 20, 100, PARTICLE_TYPES.SPARK);
    }

    /** Hit-test exato considerando rotação e escala da carta (topo do zIndex primeiro). */
    pickCard(x, y) {
        const pool = this.pool;
        const order = pool.drawOrder;
        for (let n = pool.drawCount - 1; n >= 0; n--) {
            const id = order[n];
            if (pool.active[id] !== 1) continue;
            const dx = x - (pool.x[id] + HALF_W);
            const dy = y - (pool.y[id] + pool.hoverOffsetY[id] + HALF_H);
            const rot = pool.rotation[id];
            const cos = Math.cos(-rot);
            const sin = Math.sin(-rot);
            const scale = pool.scale[id] || 1;
            const lx = (dx * cos - dy * sin) / scale;
            const ly = (dx * sin + dy * cos) / scale;
            if (lx >= -HALF_W && lx <= HALF_W && ly >= -HALF_H && ly <= HALF_H) return id;
        }
        return -1;
    }

    /** Baixa a carta atualmente em hover (se houver) e limpa o rastreio. Idempotente. */
    lowerHover() {
        if (this.hoveredCard === -1) return;
        if (this.pool.isActive(this.hoveredCard)) {
            this.animator.to(this.hoveredCard, { hoverOffsetY: 0 }, ANIM.HOVER, Easing.QuadOut, null, null, this.pool);
        }
        this.hoveredCard = -1;
    }

    confirmDiscard() {
        if (!this.isDiscarding() || this.view.phase !== GAME_STATES.FORCED_DISCARDING) return;
        if (this.discardSelection.length !== this.view.selfDiscards) return;
        
        for (const id of this.discardSelection) {
            this.sendInput(INPUT.DISCARD, id);
            this.animator.to(id, { hoverOffsetY: 0, scale: 0.7 }, ANIM.HOVER, Easing.QuadOut, null, null, this.pool);
            this.pool.paintSelected[id] = 0;
        }
        this.discardSelection = [];
        if (this.discardConfirmBtn) this.discardConfirmBtn.hidden = true;
        this.audio.play(SFX.CLICK);
    }

    onCardPress(id) {
        const pool = this.pool;
        const zone = pool.zone[id];
        // Toque em tela não tem "mousemove" contínuo: sem isso, uma carta tocada antes fica
        // presa levantada pra sempre quando o jogador toca em outra (só existe em celular/tablet).
        this.lowerHover();

        if (this.isPaintSelecting()) {
            if (zone !== ZONE.SELF_HAND || !this.isPickingPaintCards() && pool.paintSelected[id] !== 1) return false;
            if (!isPaintable(pool.color[id])) {
                this.audio.play(SFX.ERROR);
                this.shakeBackToHand(id);
                return false;
            }
            this.handlePaintClick(id);
            return false;
        }

        if (this.isDiscarding()) {
            if (zone !== ZONE.SELF_HAND) return false;
            if (this.view.phase === GAME_STATES.FORCED_DISCARDING) {
                const idx = this.discardSelection.indexOf(id);
                if (idx >= 0) {
                    this.discardSelection.splice(idx, 1);
                    pool.paintSelected[id] = 0;
                    this.animator.to(id, { hoverOffsetY: 0 }, ANIM.HOVER, Easing.QuadOut, null, null, pool);
                    this.audio.play(SFX.HOVER);
                } else {
                    if (this.discardSelection.length < this.view.selfDiscards) {
                        this.discardSelection.push(id);
                        pool.paintSelected[id] = 1;
                        this.animator.to(id, { hoverOffsetY: -30 }, ANIM.HOVER, Easing.QuadOut, null, null, pool);
                        this.audio.play(SFX.HOVER);
                    }
                }
                
                if (this.discardConfirmBtn) {
                    this.discardConfirmBtn.hidden = (this.discardSelection.length !== this.view.selfDiscards);
                }
                return false;
            } else {
                for (const p of this.pendingInputs) if (p.t === INPUT.DISCARD && p.id === id) return false;
                console.log(`[Client] Descartando carta ${id}.`);
                this.audio.play(SFX.HOVER);
                this.sendInput(INPUT.DISCARD, id);
                this.animator.to(id, { scale: 0.7 }, ANIM.HOVER, Easing.QuadOut, null, null, pool);
                return false;
            }
        }

        if (!this.canPrepare()) return false;

        if (zone === ZONE.SELF_ATTACK || zone === ZONE.SELF_DEFENSE) {
            // Retirar do campo: sem som (só "colocar" toca, ver onDrop)
            this.sendInput(INPUT.RECALL_CARD, id, ZONE.SELF_HAND, PREDICTED_HAND_ORDER);
            return false;
        }

        if (zone !== ZONE.SELF_HAND) return false;

        this.audio.play(SFX.HOVER);
        this.animator.cancel(id, pool);
        pool.hoverOffsetY[id] = 0;
        pool.zIndex[id] = DRAG_Z_INDEX;
        this.animator.to(id, { scale: 1.0 }, 150, Easing.QuadOut, null, null, pool);
        this.armTrash();
        return true;
    }

    /** Começo do arrasto: a lixeira "acorda" e sua área é lida uma vez (em coordenadas virtuais). */
    armTrash() {
        const r = this.hud.trashRect();
        const pad = 18;
        const vp = this.viewport;
        this.trashZone.x0 = vp.toVirtual(r.left - pad);
        this.trashZone.y0 = vp.toVirtual(r.top - pad);
        this.trashZone.x1 = vp.toVirtual(r.right + pad);
        this.trashZone.y1 = vp.toVirtual(r.bottom + pad);
        this.overTrash = false;
        this.hud.setTrashState('armed');
        this.audio.play(SFX.TRASH_ARM);

        // O campo "?" também acorda (e o painel aberto fecha: o jogador está pegando outra carta)
        const info = this.cardInfo.zoneRect();
        const infoPad = 14;
        this.infoZone.x0 = vp.toVirtual(info.left - infoPad);
        this.infoZone.y0 = vp.toVirtual(info.top - infoPad);
        this.infoZone.x1 = vp.toVirtual(info.right + infoPad);
        this.infoZone.y1 = vp.toVirtual(info.bottom + infoPad);
        this.overInfo = false;
        this.cardInfo.hide();
        this.cardInfo.setDragState('armed');
    }

    isPointerOverInfo() {
        const z = this.infoZone;
        const x = this.input.pointerX;
        const y = this.input.pointerY;
        return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
    }

    isPointerOverTrash() {
        const z = this.trashZone;
        const x = this.input.pointerX;
        const y = this.input.pointerY;
        return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
    }

    onDragMove(id, x, y) {
        const pool = this.pool;
        pool.targetX[id] = x;
        pool.targetY[id] = y;

        const overInfo = this.isPointerOverInfo();
        if (overInfo !== this.overInfo) {
            this.overInfo = overInfo;
            if (overInfo) this.audio.play(SFX.HOVER);
        }
        this.cardInfo.setDragState(overInfo ? 'hover' : 'armed');
        if (overInfo) {
            this.hud.setTrashState('armed');
            this.board.highlightZone = -1;
            pool.rotation[id] = 0;
            return;
        }

        const over = this.isPointerOverTrash();
        if (over !== this.overTrash) {
            this.overTrash = over;
            if (over) this.audio.play(SFX.HOVER);
        }
        if (over) {
            if (this.playable.isLastAttackOption(id, this.view.selfColor)) this.hud.setTrashState('blocked');
            else this.hud.setTrashState('hover', sellValue(pool.type[id], pool.power[id], pool.cardFlags[id]));
            this.board.highlightZone = -1;
            pool.rotation[id] = 0;
            return;
        }
        this.hud.setTrashState('armed');

        const zone = this.board.getZoneAt(x + HALF_W, y + HALF_H);
        this.board.highlightZone = this.isValidDrop(id, zone) ? zone : -1;
        pool.rotation[id] = zone === ZONE.SELF_DEFENSE ? Math.PI / 2 : 0;
    }

    /** Carta solta na lixeira: fica parada ali (zona só do cliente) até o servidor confirmar a venda. */
    sellCard(id) {
        const pool = this.pool;
        console.log(`[Client] Vendendo a carta ${id} na lixeira.`);
        this.audio.playSample(SAMPLES.CARD_MOVE);
        pool.zIndex[id] = DRAG_Z_INDEX;
        this.animator.to(id, { scale: 0.8 }, 150, Easing.QuadOut, null, null, pool);
        this.sendInput(INPUT.SELL_CARD, id, CLIENT_ZONE.TRASH, 0);
    }

    /** Marca/desmarca uma carta da mão para o Pintar; com as 2 escolhidas, o seletor de cor abre. */
    handlePaintClick(id) {
        if (this.hasPending(INPUT.PAINT_SELECT)) return;
        const pool = this.pool;
        const idx = this.paintSelection.indexOf(id);
        if (idx !== -1) {
            this.paintSelection.splice(idx, 1);
            pool.paintSelected[id] = 0;
        } else {
            if (this.paintSelection.length >= CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED) return;
            this.paintSelection.push(id);
            pool.paintSelected[id] = 1;
            this.particles.emitBurst(pool.x[id] + HALF_W, pool.y[id] + HALF_H, '#9b84ff', 14, 150, PARTICLE_TYPES.STAR);
        }
        this.audio.playSample(SAMPLES.CARD_MOVE);
        // relayout -> refreshControls: atualiza a instrução, os contornos e abre/fecha o seletor de cor
        this.relayout();
    }

    showPaintPicker() {
        // Cores que tirariam a última opção de Ataque ficam cinza (a da rodada sempre sobra)
        const mask = this.playable.paintColorMask(this.paintSelection, this.view.selfColor);
        this.colorPicker.show(mask, (color) => this.submitPaint(color), {
            mode: 'paint',
            title: i18n.t('PAINT_PICK_COLOR'),
            timed: false,
            // Clicar fora da carta desfaz a seleção (pra trocar de cartas antes de escolher a cor)
            onCancel: () => {
                this.clearPaintSelection();
                this.relayout();
            }
        });
    }

    submitPaint(color) {
        if (this.paintSelection.length !== CONFIG.CONSUMABLES.PAINT_CARDS_NEEDED) return;
        const cards = [...this.paintSelection];
        console.log(`[Client] Pintando as cartas ${cards.join(', ')} de ${CONFIG.COLOR_PALETTES[color].name}.`);
        this.clearPaintSelection();
        this.colorPicker.hide();
        this.sendInput(INPUT.PAINT_SELECT, -1, -1, 0, undefined, { cards, color });
    }

    clearPaintSelection() {
        for (const id of this.paintSelection) this.pool.paintSelected[id] = 0;
        this.paintSelection = [];
    }

    /** A cada snapshot: seleção só vale enquanto o Pintar está pendente e as cartas seguem na mão. */
    prunePaintSelection() {
        if (this.paintSelection.length === 0) return;
        if (!this.isPaintPending() || this.view.phase !== GAME_STATES.PLAYING) {
            this.clearPaintSelection();
            return;
        }
        const pool = this.pool;
        this.paintSelection = this.paintSelection.filter((id) => {
            const keep = pool.isActive(id) && pool.zone[id] === ZONE.SELF_HAND && isPaintable(pool.color[id]);
            if (!keep) pool.paintSelected[id] = 0;
            return keep;
        });
    }

    /**
     * Compra confirmada: a carta nasce já virada no lugar do item da loja (por baixo da janela) e o
     * snapshot seguinte a leva voando até a mão.
     */
    spawnPurchased(evt) {
        const pool = this.pool;
        const id = evt.cardId;
        if (!pool.isValid(id)) return;
        const c = this.shopPanel.itemCenter(evt.slot);
        const x = this.viewport.toVirtual(c.x) - HALF_W;
        const y = this.viewport.toVirtual(c.y) - HALF_H;
        pool.activate(id, x, y);
        pool.type[id] = evt.type;
        pool.color[id] = evt.color;
        pool.power[id] = evt.power;
        pool.cardFlags[id] = CONFIG.CARD_FLAGS.RESALE;
        pool.zone[id] = ZONE.SELF_HAND;
        pool.order[id] = PREDICTED_HAND_ORDER;
        pool.scale[id] = 1.25;
        pool.zIndex[id] = DRAG_Z_INDEX;
        this.relayout();
    }

    isValidDrop(id, zone) {
        return this.playable.slotAccepts(id, zone);
    }

    onDrop(id) {
        const pool = this.pool;
        this.board.highlightZone = -1;
        const zone = this.board.getZoneAt(pool.targetX[id] + HALF_W, pool.targetY[id] + HALF_H);

        const canDrop = this.canPrepare() && pool.isActive(id) && pool.zone[id] === ZONE.SELF_HAND;
        const onInfo = this.overInfo || this.isPointerOverInfo();
        this.overInfo = false;
        this.cardInfo.setDragState('idle');
        if (onInfo && pool.isActive(id)) {
            // Carta solta no "?": só mostra as informações e volta pra mão (nada vai pro servidor)
            this.overTrash = false;
            this.hud.setTrashState('idle');
            this.cardInfo.show(pool.type[id], pool.color[id], pool.power[id], id);
            this.relayout();
            return;
        }
        const onTrash = this.overTrash || this.isPointerOverTrash();
        this.overTrash = false;
        this.hud.setTrashState('idle');
        if (canDrop && onTrash && sellValue(pool.type[id], pool.power[id], pool.cardFlags[id]) >= 0) {
            if (this.playable.isLastAttackOption(id, this.view.selfColor)) {
                // Última carta que ainda pode atacar nesta rodada: vender travaria o turno (o servidor também recusa)
                console.log(`[Client] Venda bloqueada: a carta ${id} é a última opção de Ataque da rodada.`);
                this.audio.play(SFX.SHOP_DENY);
                this.hud.trashDenied();
                this.shakeBackToHand(id);
                return;
            }
            this.sellCard(id);
            return;
        }
        const useBlocked = canDrop && zone === ZONE.SELF_USE && isConsumable(pool.type[id]) ? this.playable.useBlockReason(id) : null;
        if (useBlocked) {
            // Reviver já usado / Cura ou Escudo já ativos / Pintar sem 2 cartas coloridas: treme e volta
            console.log(`[Client] Consumível recusado localmente: ${useBlocked}`);
            this.audio.play(SFX.ERROR);
            this.shakeBackToHand(id);
            return;
        }
        if (!canDrop || !this.isValidDrop(id, zone)) {
            this.relayout();
            return;
        }

        if (zone === ZONE.SELF_USE) {
            this.audio.playSample(SAMPLES.CARD_MOVE);
            this.sendInput(INPUT.PLAY_CONSUMABLE, id, ZONE.SELF_USE, 0);
            return;
        }

        if (!this.playable.colorAllows(id, zone, this.view.selfColor)) {
            this.shakeBackToHand(id);
            return;
        }

        this.audio.playSample(SAMPLES.CARD_MOVE);
        // Previsão otimista: a carta já vai para o slot; o snapshot com o ack confirma ou corrige
        this.sendInput(INPUT.PLAY_CARD, id, zone, 0, zone);
    }

    /** Cor inválida: a carta treme e volta para a mão (GAME_RULES §5). */
    shakeBackToHand(id) {
        const pool = this.pool;
        const hx = pool.homeX[id];
        const hy = pool.homeY[id];
        const step = ANIM.SHAKE_STEP;
        this.animator.to(id, { targetX: hx - 20, targetY: hy, rotation: 0, scale: CONFIG.HAND_SCALE }, step * 2, Easing.Linear, null, () => {
            this.animator.to(id, { targetX: hx + 20 }, step, Easing.Linear, null, () => {
                this.animator.to(id, { targetX: hx }, step, Easing.Linear, null, () => this.relayout(), pool);
            }, pool);
        }, pool);
    }

    /** @param {string} name nome exibido para você e para o oponente */
    submitName(name) {
        console.log(`[Client] Enviando nome: ${name}`);
        this.network.sendInput({ k: MSG.INPUT, t: INPUT.SET_NAME, name });
        this.hud.setNames(name, null);
        if (!this.hasSnapshot) this.hud.setPhaseMessage(i18n.t('WAITING_OPPONENT'));
    }

    toggleReady() {
        if (!this.hasSnapshot || this.cinematics.gameOverShown) return;
        if (this.view.phase !== GAME_STATES.PLAYING || this.isPaintSelecting()) return;

        if (this.isSelfReady()) {
            console.log('[Client] Cancelando turno (CANCEL_READY).');
            this.sendInput(INPUT.CANCEL_READY, -1);
        } else {
            if (this.layout.stack(ZONE.SELF_ATTACK).length === 0 && !this.board.fieldLocked) return;
            console.log('[Client] Finalizando turno (READY).');
            this.sendInput(INPUT.READY, -1);
        }
    }

    // --- Loop --------------------------------------------------------------

    update() {
        if (!this.hasSnapshot || this.input.draggedCard !== -1) return;
        const pool = this.pool;
        const canHover = this.canPrepare() || this.isDiscarding() || this.isPaintSelecting();
        let current = canHover ? this.pickCard(this.input.pointerX, this.input.pointerY) : -1;
        if (current !== -1 && pool.zone[current] !== ZONE.SELF_HAND) current = -1;
        if (current === this.hoveredCard) return;

        this.lowerHover();
        if (current !== -1) {
            this.audio.play(SFX.HOVER);
            this.animator.to(current, { hoverOffsetY: ANIM.HOVER_LIFT }, ANIM.HOVER, Easing.QuadOut, null, null, pool);
        }
        this.hoveredCard = current;
    }

    render(dt) {
        this.animator.update(dt);
        this.particles.update(dt / 1000);
        this.scene.deckX = this.layout.deckX;
        this.scene.deckY = this.layout.deckY;
        this.scene.hoveredCard = this.hoveredCard;
        this.scene.draggedCard = this.input.draggedCard;
        // O olho da Ronova cobre a tela inteira, opaco: desenhar a mesa por baixo seria trabalho jogado fora
        // (animações e partículas continuam avançando acima; o próximo frame visível já sai certo)
        if (ronovaOverlayCovers()) return;
        this.renderer.draw(this.scene, dt);
    }
}
