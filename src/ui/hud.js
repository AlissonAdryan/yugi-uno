import { SurgeHud } from './surge-hud.js';
import { CONFIG } from '../config/constants.js';
import { END_REASON, GAME_RESULT, DEATH_FLAGS } from '../network/protocol.js';
import { RonovaHpFx } from './death-hp-fx.js';
import { NET_STATUS } from '../network/network-system.js';
import { SFX } from '../config/sound-presets.js';
import { i18n } from '../i18n/index.js';

const COLOR_ALERT_MS = 1500;
// Estilos do alerta central por carta especial (ver showSpecialAlert e style.css)
const SPECIAL_ALERT_CLASSES = Object.freeze([
    'alert-paint', 'alert-swap', 'alert-storm', 'alert-ambush', 'alert-curse', 'alert-fusion', 'alert-prison', 'alert-karma', 'alert-collapse',
    'alert-death', 'alert-surge'
]);
// Vida "bugada" do Reverso Kármico: troca de número a cada HP_GLITCH_STEP_MS
const HP_GLITCH_STEP_MS = 45;
const FLOATING_TEXT_MS = 1500;
// Deve bater com a duração de `transition: opacity` de .plasma-layer--incoming em style.css
const BG_FADE_MS = 1500;

function getConnectionText(status) {
    switch(status) {
        case NET_STATUS.CONNECTING: return i18n.t('NET_CONNECTING');
        case NET_STATUS.UNSTABLE: return i18n.t('NET_UNSTABLE');
        case NET_STATUS.OPPONENT_DISCONNECTED: return i18n.t('NET_OPP_DISCONNECTED');
        case NET_STATUS.RECONNECTING: return i18n.t('NET_RECONNECTING');
        case NET_STATUS.LOST: return i18n.t('NET_LOST');
        case NET_STATUS.ERROR: return i18n.t('NET_ERROR');
        default: return '';
    }
}

/**
 * Hud - única camada que toca no DOM da interface (menu, sala, HP, mensagens, fim de jogo, conexão).
 * Escritas só acontecem quando o valor muda, para não gerar recálculo de estilo à toa.
 */
export class Hud {
    /** @param {import('../audio/audio-engine.js').AudioEngine} audio */
    constructor(audio) {
        this.audio = audio;
        const $ = (id) => document.getElementById(id);
        this.el = {
            mainMenu: $('main-menu'),
            btnPlayCpu: $('btn-play-cpu'),
            btnCreateRoom: $('btn-create-room'),
            roomModal: $('room-modal'),
            roomTitle: $('room-title'),
            roomInfo: $('room-info'),
            roomCode: $('room-code-display'),
            roomWarning: $('room-warning'),
            btnCopyLink: $('btn-copy-link'),
            roomStatus: $('room-status'),
            btnCancelRoom: $('btn-cancel-room'),
            gameContainer: $('game-container'),
            selfName: $('self-name'),
            selfHP: $('self-hp'),
            oppName: $('opponent-name'),
            oppHP: $('opponent-hp'),
            selfHpBox: $('self-hp-container'),
            oppHpBox: $('opponent-hp-container'),
            endTurn: $('end-turn-btn'),
            vignette: $('damage-vignette'),
            spectatorCounter: $('spectator-counter'),
            spectatorCountText: $('spectator-count-text'),
            damageText: $('damage-text-container'),
            colorAlert: $('color-alert'),
            phaseMessage: $('phase-message'),
            victory: $('victory-screen'),
            defeat: $('defeat-screen'),
            spectatorScreen: $('spectator-screen'),
            spectatorWinnerTitle: $('spectator-winner-title'),
            spectatorReason: $('spectator-reason'),
            waitRematchBtn: $('wait-rematch-btn'),
            victoryReason: $('victory-reason'),
            defeatReason: $('defeat-reason'),
            nameModal: $('name-modal'),
            nameForm: $('name-form'),
            nameInput: $('name-input'),
            banner: $('connection-banner'),
            bannerText: $('connection-text'),
            bannerMenuBtn: $('connection-menu-btn'),
            plasmaIncoming: $('plasma-bg-incoming'),
            rematchNotice: $('rematch-notice'),
            panicBadge: $('panic-badge'),
            rematchButtons: document.querySelectorAll('.rematch-btn')
        };

        // Vida "bugada" em andamento por lado (função que congela no valor final) e o relógio do pânico
        this.hpGlitch = { self: null, opp: null };
        this.panicTimer = null;
        this.panicIsSelf = false;
        this.cache = {
            selfHP: -1, oppHP: -1, phase: null, phaseVariant: '', endVisible: null, endEnabled: null, bgColor: -1, banner: null, rematch: '',
            status: -1, reviveRounds: -1, oppStatus: -1, oppReviveRounds: -1,
            ronova: -1, ronovaSelf: -1, ronovaOpp: -1
        };
        // Chamas da Morte em volta das caixas de vida (canvas próprio; o loop só roda enquanto alguma arde)
        this.ronovaFx = new RonovaHpFx([this.el.selfHpBox, this.el.oppHpBox]);
        this.surge = new SurgeHud(audio);
        this.el.selfShield = this.el.selfHpBox.querySelector('.hp-shield');
        this.el.selfShieldRipple = this.el.selfHpBox.querySelector('.hp-shield-ripple');
        this.el.oppShield = this.el.oppHpBox.querySelector('.hp-shield');
        this.el.oppShieldRipple = this.el.oppHpBox.querySelector('.hp-shield-ripple');
        this.el.reviveBadge = this.el.selfHpBox.querySelector('.hp-revive-badge');
        this.el.selfTrash = document.getElementById('self-trash');
        this.el.oppTrash = document.getElementById('opp-trash');
        this.el.trashValue = this.el.selfTrash.querySelector('.trash-value b');
        this.trashState = 'idle';
        // Timers das classes de disparo curto (pulseClass): elemento -> { classe: timer }
        this.pulseTimers = new WeakMap();
        this.lastRoundColor = CONFIG.COLOR.NONE; // cor da rodada imediatamente antes do Rainbow
        this.colorAlertTimer = null;
        this.bgFadeTimer = null;
        this.bgFading = false;
        this.pendingBg = CONFIG.DEFAULT_BACKGROUND;
        this.roomLink = '';

        this.el.btnCopyLink.addEventListener('click', () => {
            this.audio.play(SFX.CLICK);
            this.copyRoomLink();
        });

        this.onNameSubmit = null;
        this.el.nameInput.maxLength = CONFIG.NAME_MAX_LENGTH;
        this.el.nameForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = this.el.nameInput.value.trim();
            if (!name || !this.onNameSubmit) return;
            this.audio.play(SFX.CONFIRM);
            const callback = this.onNameSubmit;
            this.hideNamePrompt();
            callback(name);
        });
    }

    // --- Nome do jogador ---------------------------------------------------

    /**
     * @param {string} defaultName valor inicial do campo
     * @param {(name: string) => void} onSubmit
     */
    askName(defaultName, onSubmit) {
        this.onNameSubmit = onSubmit;
        this.el.nameInput.value = defaultName || '';
        this.el.nameModal.hidden = false;
        this.el.nameInput.focus();
        this.el.nameInput.select();
    }

    hideNamePrompt() {
        this.onNameSubmit = null;
        this.el.nameModal.hidden = true;
    }

    /** Nomes nos cantos de vida (oppName vazio mantém o rótulo atual). */
    setNames(selfName, oppName) {
        if (selfName) this.el.selfName.textContent = selfName;
        if (oppName) this.el.oppName.textContent = oppName;
    }

    bindMenu({ onPlayCpu, onCreateRoom, onCancelRoom, onBackToMenu }) {
        const withClick = (fn) => () => {
            this.audio.play(SFX.CLICK);
            fn();
        };
        this.el.btnPlayCpu.addEventListener('click', withClick(onPlayCpu));
        this.el.btnCreateRoom.addEventListener('click', withClick(onCreateRoom));
        this.el.btnCancelRoom.addEventListener('click', withClick(onCancelRoom));
        this.el.bannerMenuBtn.addEventListener('click', withClick(onBackToMenu));
        for (const btn of document.querySelectorAll('.back-to-menu')) btn.addEventListener('click', withClick(onBackToMenu));
    }

    onRematch(callback) {
        for (const btn of this.el.rematchButtons) {
            btn.addEventListener('click', () => {
                this.audio.play(SFX.CONFIRM);
                callback();
            });
        }
    }

    onEndTurn(callback) {
        this.el.endTurn.addEventListener('click', () => {
            this.audio.play(SFX.CONFIRM);
            callback();
        });
    }

    // --- Sala --------------------------------------------------------------

    showRoomHosting(code, link, isLocalOrigin) {
        this.roomLink = link;
        // O menu principal segue "por baixo" (é pra onde volta se a sala for cancelada), mas
        // esconder evita ele vazar através do backdrop semi-transparente do modal quando o cartão
        // não cobre a tela inteira. Sempre volta via reload completo da página (backToMenu), então
        // não precisa de um "unhide" correspondente aqui.
        this.el.mainMenu.hidden = true;
        this.el.roomModal.hidden = false;
        this.el.roomTitle.textContent = i18n.t('ROOM_CREATED');
        this.el.roomInfo.hidden = false;
        this.el.roomCode.textContent = code;
        this.el.roomWarning.hidden = !isLocalOrigin;
        this.setRoomStatus('');
    }

    showRoomJoining(code) {
        this.el.mainMenu.hidden = true;
        this.el.roomModal.hidden = false;
        this.el.roomTitle.textContent = i18n.t('ROOM_JOINING', { code });
        this.el.roomInfo.hidden = true;
        this.setRoomStatus(i18n.t('SEARCHING_HOST'));
    }

    setRoomStatus(text, isError = false) {
        this.el.roomStatus.textContent = text;
        this.el.roomStatus.classList.toggle('error', isError);
    }

    hideRoomModal() {
        this.el.roomModal.hidden = true;
    }

    copyRoomLink() {
        const btn = this.el.btnCopyLink;
        const done = (label) => {
            btn.textContent = label;
            setTimeout(() => { btn.textContent = i18n.t('COPY_LINK'); }, 2000);
        };
        if (!navigator.clipboard) {
            window.prompt(i18n.t('PROMPT_COPY'), this.roomLink);
            return;
        }
        navigator.clipboard.writeText(this.roomLink)
            .then(() => done(i18n.t('COPIED')))
            .catch(() => window.prompt(i18n.t('PROMPT_COPY'), this.roomLink));
    }

    // --- Partida -----------------------------------------------------------

    showGame(opponentLabel) {
        this.el.mainMenu.hidden = true;
        this.el.gameContainer.hidden = false;
        this.el.selfName.textContent = i18n.t('YOU');
        this.el.oppName.textContent = opponentLabel || i18n.t('OPPONENT');
    }

    setHP(selfHP, oppHP) {
        // Durante a vida "bugada" do Kármico o número é da animação; o valor final entra quando ela congela
        if (this.hpGlitch.self) selfHP = this.cache.selfHP;
        if (this.hpGlitch.opp) oppHP = this.cache.oppHP;
        if (selfHP !== this.cache.selfHP) {
            this.cache.selfHP = selfHP;
            this.el.selfHP.textContent = selfHP;
        }
        if (oppHP !== this.cache.oppHP) {
            this.cache.oppHP = oppHP;
            this.el.oppHP.textContent = oppHP;
        }
    }

    updateSpectatorCount(count) {
        if (count > 0) {
            this.el.spectatorCounter.hidden = false;
            this.el.spectatorCountText.textContent = count;
        } else {
            this.el.spectatorCounter.hidden = true;
        }
    }

    setEndTurn(visible, enabled, isReady = false) {
        if (visible !== this.cache.endVisible) {
            this.cache.endVisible = visible;
            this.el.endTurn.hidden = !visible;
        }
        if (enabled !== this.cache.endEnabled) {
            this.cache.endEnabled = enabled;
            this.el.endTurn.disabled = !enabled;
        }
        const text = isReady ? i18n.t('CANCEL_TURN') : i18n.t('END_TURN');
        if (this.el.endTurn.textContent !== text) {
            this.el.endTurn.textContent = text;
        }
        this.el.endTurn.classList.toggle('cancel-mode', isReady);
    }

    /**
     * @param {string|null} text
     * @param {string} [variant] '' (padrão, vermelho) | 'paint' (arco-íris, instruções do Pintar)
     */
    setPhaseMessage(text, variant = '') {
        if (text === this.cache.phase && variant === this.cache.phaseVariant) return;
        this.cache.phase = text;
        this.cache.phaseVariant = variant;
        this.el.phaseMessage.textContent = text || '';
        this.el.phaseMessage.classList.toggle('phase-paint', variant === 'paint');
        this.el.phaseMessage.hidden = !text;
    }

    /** Troca o fundo sem alerta (usado na sincronização por snapshot). */
    syncBackground(color) {
        if (color === this.cache.bgColor) return;
        this.cache.bgColor = color;
        // Guarda a última cor de rodada real para montar o Rainbow dinâmico
        if (color !== CONFIG.COLOR.RAINBOW && color !== CONFIG.COLOR.NONE) {
            this.lastRoundColor = color;
        }
        const palette = CONFIG.COLOR_PALETTES[color];
        const bg = (color === CONFIG.COLOR.RAINBOW)
            ? Hud._rainbowBg(this.lastRoundColor)
            : (palette ? palette.bg : CONFIG.DEFAULT_BACKGROUND);
        this.crossfadeBackground(bg);
    }

    /**
     * Monta o bg do Rainbow de forma dinâmica:
     * - bg-1 (sólido) = cor da rodada atual
     * - bg-2/3/4 (blobs) = as outras 3 cores
     * @param {number} roundColor COLOR.* da rodada vigente
     */
    static _rainbowBg(roundColor) {
        // bg[0] de cada paleta (base sólida) e bg[1] (cor do blob claro) por cor básica
        const BASE = { 1: '#4a0f0f', 2: '#0f204a', 3: '#0f4a15', 4: '#4a4a0f' };
        const BLOB = { 1: '#721616', 2: '#153366', 3: '#156620', 4: '#666615' };
        const ALL  = [1, 2, 3, 4]; // RED, BLUE, GREEN, YELLOW
        const solidBase = BASE[roundColor] ?? CONFIG.DEFAULT_BACKGROUND[0];
        const others = ALL.filter(c => c !== roundColor); // sempre 3 ou 4 elementos
        return [solidBase, BLOB[others[0]], BLOB[others[1]], BLOB[others[2]]];
    }

    /** Camada de cima volta a ficar invisível e sem transição, pronta para o próximo fade. */
    snapIncomingHidden() {
        const top = this.el.plasmaIncoming;
        top.style.transition = 'none';
        top.style.opacity = '0';
        void top.offsetWidth; // reflow: trava o "sem transição" antes de reativá-la
        top.style.transition = '';
    }

    /**
     * Cross-fade de cor via opacity entre duas camadas de gradiente (Pilar 2): a cor do
     * gradiente em si nunca é animada pelo CSS, só a opacidade da camada de cima (compositor puro).
     */
    crossfadeBackground(bg) {
        clearTimeout(this.bgFadeTimer);
        const root = document.documentElement.style;

        if (this.bgFading) {
            // Troca muito rápida, fade anterior ainda rodando: assenta a cor pendente e recomeça do zero
            root.setProperty('--bg-1', this.pendingBg[0]);
            root.setProperty('--bg-2', this.pendingBg[1]);
            root.setProperty('--bg-3', this.pendingBg[2]);
            if (this.pendingBg[3]) root.setProperty('--bg-4', this.pendingBg[3]);
            this.snapIncomingHidden();
        }

        root.setProperty('--bg-1-next', bg[0]);
        root.setProperty('--bg-2-next', bg[1]);
        root.setProperty('--bg-3-next', bg[2]);
        if (bg[3]) root.setProperty('--bg-4-next', bg[3]);
        this.pendingBg = bg;
        this.bgFading = true;
        this.el.plasmaIncoming.style.opacity = '1';

        this.bgFadeTimer = setTimeout(() => {
            this.bgFading = false;
            root.setProperty('--bg-1', bg[0]);
            root.setProperty('--bg-2', bg[1]);
            root.setProperty('--bg-3', bg[2]);
            if (bg[3]) root.setProperty('--bg-4', bg[3]);
            this.snapIncomingHidden();
        }, BG_FADE_MS);
    }

    /** Muda o fundo e pisca o nome da cor no centro da tela. */
    showColorAlert(color) {
        const palette = CONFIG.COLOR_PALETTES[color];
        if (!palette) return;
        this.syncBackground(color);

        const alert = this.el.colorAlert;
        alert.textContent = i18n.t(CONFIG.COLOR_NAME_KEYS[color]);
        alert.style.color = color === CONFIG.COLOR.RAINBOW ? '#ffffff' : CONFIG.COLOR_HEX[color];
        for (let i = 0; i < SPECIAL_ALERT_CLASSES.length; i++) alert.classList.remove(SPECIAL_ALERT_CLASSES[i]);
        alert.classList.add('show');
        clearTimeout(this.colorAlertTimer);
        this.colorAlertTimer = setTimeout(() => alert.classList.remove('show'), COLOR_ALERT_MS);
    }

    /** "PINTAR!" em tinta arco-íris no centro da tela (só quem usou a carta vê). */
    showPaintAlert() {
        this.showSpecialAlert(i18n.t('PAINT_ALERT'), 'alert-paint');
    }

    /**
     * Texto grande no centro da tela com o estilo de uma carta especial (reinicia a animação).
     * @param {string} text já traduzido
     * @param {'alert-paint'|'alert-swap'|'alert-storm'|'alert-ambush'|'alert-curse'|'alert-fusion'} variant classe de estilo (style.css)
     */
    showSpecialAlert(text, variant) {
        const alert = this.el.colorAlert;
        alert.textContent = text;
        alert.style.color = '';
        for (let i = 0; i < SPECIAL_ALERT_CLASSES.length; i++) alert.classList.remove(SPECIAL_ALERT_CLASSES[i]);
        alert.classList.add(variant);
        alert.classList.remove('show');
        void alert.offsetWidth;
        alert.classList.add('show');
        clearTimeout(this.colorAlertTimer);
        this.colorAlertTimer = setTimeout(() => alert.classList.remove('show'), COLOR_ALERT_MS);
    }

    flashDamage() {
        const v = this.el.vignette;
        v.classList.add('active');
        setTimeout(() => v.classList.remove('active'), FLOATING_TEXT_MS);
    }

    showCornerMessage(text, ms = 4000) {
        if (!this.el.cornerContainer) this.el.cornerContainer = document.getElementById('corner-notification-container');
        if (!this.el.cornerContainer) return;

        const node = document.createElement('div');
        node.className = 'corner-notification';
        node.textContent = text;
        this.el.cornerContainer.appendChild(node);
        
        // Trigger CSS transition
        requestAnimationFrame(() => {
            node.classList.add('show');
        });

        setTimeout(() => {
            node.classList.remove('show');
            setTimeout(() => node.remove(), 300); // Wait for fade out
        }, ms);
    }

    /**
     * @param {string} text
     * @param {boolean} isSelfTarget
     * @param {string} [variant] '' | 'heal' | 'shielded' | 'guarded' | 'overload' | 'ghost' | 'mirror' (cor do texto)
     */
    showFloatingText(text, isSelfTarget, variant = '') {
        const node = document.createElement('div');
        node.className = variant ? `damage-text ${variant}` : 'damage-text';
        node.textContent = text;
        node.style.top = isSelfTarget ? '70%' : '20%';
        this.el.damageText.appendChild(node);
        setTimeout(() => node.remove(), FLOATING_TEXT_MS);
    }

    // --- Efeitos de vida (Cura, Escudo, Reviver) ----------------------------

    hpBox(isSelf) {
        return isSelf ? this.el.selfHpBox : this.el.oppHpBox;
    }

    /**
     * Estados persistentes do próprio jogador (o do oponente nunca chega: é secreto).
     * @param {number} status bitmask CONFIG.STATUS
     * @param {number} reviveRounds rodadas de guarda restantes do Reviver
     */
    setSelfStatus(status, reviveRounds) {
        if (status === this.cache.status && reviveRounds === this.cache.reviveRounds) return;
        const { STATUS } = CONFIG;
        const box = this.el.selfHpBox;
        box.classList.toggle('status-heal', (status & STATUS.HEAL) !== 0);
        box.classList.toggle('status-shield', (status & STATUS.SHIELD) !== 0);
        box.classList.toggle('status-revive', (status & STATUS.REVIVE_ACTIVE) !== 0);
        // Maldição plantada: a caveira pulsa sobre a vida do oponente (só quem amaldiçoou recebe o status)
        this.el.oppHpBox.classList.toggle('curse-marked', (status & STATUS.CURSE_PENDING) !== 0);
        if (reviveRounds !== this.cache.reviveRounds) this.el.reviveBadge.textContent = reviveRounds > 0 ? String(reviveRounds) : '';
        this.cache.status = status;
        this.cache.reviveRounds = reviveRounds;
    }

    /**
     * Estados persistentes do oponente (apenas espectadores recebem; jogadores recebem 0 sempre).
     */
    setOppStatus(status, reviveRounds) {
        if (status === this.cache.oppStatus && reviveRounds === this.cache.oppReviveRounds) return;
        const { STATUS } = CONFIG;
        const box = this.el.oppHpBox;
        box.classList.toggle('status-heal', (status & STATUS.HEAL) !== 0);
        box.classList.toggle('status-shield', (status & STATUS.SHIELD) !== 0);
        box.classList.toggle('status-revive', (status & STATUS.REVIVE_ACTIVE) !== 0);
        
        // Espectador precisa ver a maldição plantada pelo oponente na vida do jogador principal (Host)
        this.el.selfHpBox.classList.toggle('curse-marked', (status & STATUS.CURSE_PENDING) !== 0);
        
        let oppReviveBadge = box.querySelector('.hp-revive-badge');
        if (!oppReviveBadge) {
            oppReviveBadge = document.createElement('span');
            oppReviveBadge.className = 'hp-revive-badge';
            box.appendChild(oppReviveBadge);
        }
        
        if (reviveRounds !== this.cache.oppReviveRounds) oppReviveBadge.textContent = reviveRounds > 0 ? String(reviveRounds) : '';
        this.cache.oppStatus = status;
        this.cache.oppReviveRounds = reviveRounds;
    }

    /**
     * Chamas da Morte nas caixas de vida (byte DEATH_FLAGS do snapshot, já na perspectiva de quem vê).
     * Plantada: só quem usou (e espectadores) recebem o flag de pendente. Ativa: todos veem, com os turnos.
     */
    setRonova(flags, selfTurns, oppTurns) {
        if (flags === this.cache.ronova && selfTurns === this.cache.ronovaSelf && oppTurns === this.cache.ronovaOpp) return;
        this.applyRonovaBox(0, this.el.selfHpBox, (flags & DEATH_FLAGS.SELF_PENDING) !== 0, (flags & DEATH_FLAGS.SELF_MARKED) !== 0, selfTurns);
        this.applyRonovaBox(1, this.el.oppHpBox, (flags & DEATH_FLAGS.OPP_PENDING) !== 0, (flags & DEATH_FLAGS.OPP_MARKED) !== 0, oppTurns);
        this.cache.ronova = flags;
        this.cache.ronovaSelf = selfTurns;
        this.cache.ronovaOpp = oppTurns;
    }

    applyRonovaBox(index, box, pending, active, turns) {
        box.classList.toggle('death-pending', pending && !active);
        box.classList.toggle('death-active', active);
        const badge = box.querySelector('.hp-death-turns');
        if (badge) badge.textContent = active && turns > 0 ? String(turns) : '';
        // Plantada arde um pouco mais contida; a marca ativa queima com tudo
        this.ronovaFx.set(index, pending || active, active ? 1 : 0.72);
    }

    /** O fogo acende na vida (cinemática de uso/olho): um estouro curto por cima do estado persistente. */
    flashRonova(isSelf) {
        this.pulseClass(this.hpBox(isSelf), 'death-flare', 900);
        this.ronovaFx.flare(isSelf ? 0 : 1);
    }

    /**
     * Reinicia uma animação CSS de disparo curto: remove a classe, força o recálculo e a recoloca;
     * some sozinha depois de `ms` pra não prender outras animações da mesma camada.
     */
    pulseClass(el, cls, ms) {
        if (!el) return;
        let timers = this.pulseTimers.get(el);
        if (!timers) {
            timers = {};
            this.pulseTimers.set(el, timers);
        }
        clearTimeout(timers[cls]);
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        timers[cls] = setTimeout(() => el.classList.remove(cls), ms);
    }

    flashShield(isSelf) {
        const shield = isSelf ? this.el.selfShield : this.el.oppShield;
        const ripple = isSelf ? this.el.selfShieldRipple : this.el.oppShieldRipple;
        this.pulseClass(shield, 'hit', 500);
        this.pulseClass(ripple, 'hit', 650);
    }

    playHealBurst(isSelf) {
        this.pulseClass(this.hpBox(isSelf), 'heal-burst', 1150);
    }

    playHealFizzle() {
        this.pulseClass(this.el.selfHpBox, 'heal-fizzle', 750);
    }

    playDivine(isSelf) {
        this.pulseClass(this.hpBox(isSelf), 'divine-play', 2100);
    }

    flashGuard(isSelf) {
        this.pulseClass(this.hpBox(isSelf), 'guard-flash', 850);
    }

    /**
     * Reverso Kármico na vida: em vez de descer suave, o número "buga" (valores aleatórios em altíssima
     * velocidade, com a caixa em aberração cromática) e congela piscando no valor novo.
     * @returns {Promise<void>} resolve quando o número congela
     */
    glitchHP(isSelf, finalHP, ms) {
        const key = isSelf ? 'self' : 'opp';
        const el = isSelf ? this.el.selfHP : this.el.oppHP;
        const box = this.hpBox(isSelf);
        this.stopHpGlitch(key);
        box.classList.add('hp-glitching');
        let last = -1;
        const timer = setInterval(() => {
            let n = Math.floor(Math.random() * 100);
            if (n === last) n = (n + 37) % 100;
            last = n;
            el.textContent = n < 10 ? `0${n}` : String(n);
        }, HP_GLITCH_STEP_MS);
        return new Promise((resolve) => {
            const finish = () => {
                clearInterval(timer);
                clearTimeout(end);
                this.hpGlitch[key] = null;
                box.classList.remove('hp-glitching');
                this.cache[isSelf ? 'selfHP' : 'oppHP'] = finalHP;
                el.textContent = finalHP;
                this.pulseClass(box, 'hp-glitch-freeze', 900);
                resolve();
            };
            const end = setTimeout(finish, ms);
            this.hpGlitch[key] = finish;
        });
    }

    stopHpGlitch(key) {
        const finish = this.hpGlitch[key];
        if (finish) finish();
    }

    /**
     * Pânico (Reverso Kármico na vida): contagem regressiva grande na tela. Quem está em pânico vê o próprio
     * relógio (com tique a cada segundo e as bordas da tela pulsando); o oponente vê o do rival.
     * @param {boolean} isSelf
     * @param {number} ms tempo total
     */
    showPanic(isSelf, ms) {
        const badge = this.el.panicBadge;
        if (!badge) return;
        this.panicIsSelf = isSelf;
        this.isPanicActive = true;
        this.hidePanic();
        const label = badge.querySelector('.panic-label');
        const time = badge.querySelector('.panic-time');
        label.textContent = i18n.t(isSelf ? 'PANIC_SELF' : 'PANIC_OPP');
        badge.classList.toggle('panic-self', isSelf);
        this.panicIsSelf = isSelf;
        badge.hidden = false;
        if (isSelf) this.el.vignette.classList.add('panic');
        const end = performance.now() + ms;
        let shown = -1;
        const tick = () => {
            const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
            if (left !== shown) {
                shown = left;
                time.textContent = String(left);
                this.pulseClass(badge, 'tick', 400);
                if (isSelf && left > 0) this.audio.play(SFX.PANIC_TICK);
            }
            if (left <= 0) this.hidePanic();
        };
        tick();
        this.panicTimer = setInterval(tick, 100);
        console.log(`[Hud] Pânico ${isSelf ? 'próprio' : 'do oponente'}: ${Math.round(ms / 1000)}s.`);
    }

    hidePanic() {
        clearInterval(this.panicTimer);
        this.panicTimer = null;
        if (this.el.panicBadge) this.el.panicBadge.hidden = true;
        this.el.vignette.classList.remove('panic');
    }

    /** Centro da caixa de vida em px de tela (CSS). Só é lido em eventos, nunca por frame. */
    hpCenter(isSelf) {
        const rect = this.hpBox(isSelf).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    // --- Lixeira ---------------------------------------------------------------

    /**
     * @param {'idle'|'armed'|'hover'|'blocked'} state armed = arrastando uma carta; hover = carta em cima
     *        da lixeira; blocked = em cima, mas é a última carta que pode atacar (venda proibida)
     * @param {number} [value] moedas que a carta renderia (mostrado em cima da lixeira no hover)
     */
    setTrashState(state, value = 0) {
        const el = this.el.selfTrash;
        if (state === 'hover') this.el.trashValue.textContent = `+${value}`;
        if (state === this.trashState) return;
        this.trashState = state;
        // Um novo arrasto encerra o aviso de venda recusada na hora
        if (state !== 'idle') el.classList.remove('denied');
        el.classList.toggle('armed', state === 'armed');
        el.classList.toggle('hover', state === 'hover');
        el.classList.toggle('blocked', state === 'blocked');
    }

    /** Venda recusada (última opção de Ataque): a lixeira treme em vermelho e o aviso fica mais um pouco. */
    trashDenied() {
        this.pulseClass(this.el.selfTrash, 'denied', 1400);
    }

    /** Retângulo da própria lixeira em px de tela (lido 1x por arrasto, nunca por frame). */
    trashRect() {
        return this.el.selfTrash.getBoundingClientRect();
    }

    trashCenter(isSelf) {
        const r = (isSelf ? this.el.selfTrash : this.el.oppTrash).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    /** A tampa bate, a lixeira pula e (só pra quem vendeu) sobe o "+N" de moedas. */
    trashSold(isSelf, coins) {
        const el = isSelf ? this.el.selfTrash : this.el.oppTrash;
        this.pulseClass(el, 'sold', 500);
        if (!isSelf || !(coins > 0)) return;
        const gain = document.createElement('span');
        gain.className = 'trash-gain';
        gain.innerHTML = '<svg class="ico-coin"><use href="#ico-coin"/></svg><b></b>';
        gain.querySelector('b').textContent = `+${coins}`;
        el.appendChild(gain);
        setTimeout(() => gain.remove(), 1350);
    }

    showGameOver(result, reason, winnerName, isSpectatorParam = null) {
        this.setEndTurn(false, false);
        this.setPhaseMessage(null);

        const isSpectator = isSpectatorParam !== null ? isSpectatorParam : (window.app && window.app.client && window.app.client.isSpectator);
        let screen, reasonEl;

        if (isSpectator) {
            screen = this.el.spectatorScreen;
            reasonEl = this.el.spectatorReason;
            this.el.spectatorWinnerTitle.textContent = i18n.t('SPECTATOR_WINNER', { name: winnerName || 'Player' });
        } else {
            const isVictory = result === GAME_RESULT.VICTORY;
            screen = isVictory ? this.el.victory : this.el.defeat;
            reasonEl = isVictory ? this.el.victoryReason : this.el.defeatReason;
        }

        if (reason === END_REASON.ABANDON) {
            if (isSpectator) reasonEl.textContent = i18n.t('REASON_ABANDON_SPECTATOR');
            else reasonEl.textContent = result === GAME_RESULT.VICTORY ? i18n.t('REASON_ABANDON_WIN') : i18n.t('REASON_ABANDON_LOSS');
        } else {
            if (isSpectator) reasonEl.textContent = i18n.t('REASON_WIN_SPECTATOR');
            else reasonEl.textContent = result === GAME_RESULT.VICTORY ? i18n.t('REASON_WIN') : i18n.t('REASON_LOSS');
        }

        // Oponente abandonou (ou você caiu): não há com quem jogar a revanche
        for (const btn of this.el.rematchButtons) btn.hidden = reason === END_REASON.ABANDON;
        if (this.el.waitRematchBtn) this.el.waitRematchBtn.hidden = reason === END_REASON.ABANDON;

        screen.hidden = false;
        requestAnimationFrame(() => screen.classList.add('active'));
    }

    /** Fecha as telas de fim de jogo e o aviso de revanche (nova partida começando). */
    hideGameOver() {
        for (const screen of [this.el.victory, this.el.defeat, this.el.spectatorScreen]) {
            if (screen) {
                screen.classList.remove('active');
                screen.hidden = true;
            }
        }
        this.setRematch(false, false);
    }

    /**
     * Estado da revanche vindo do snapshot (+ previsão local do próprio pedido).
     * @param {boolean} selfRequested
     * @param {boolean} oppRequested
     */
    setRematch(selfRequested, oppRequested) {
        const key = `${selfRequested ? 1 : 0}${oppRequested ? 1 : 0}`;
        if (key === this.cache.rematch) return;
        this.cache.rematch = key;

        const opponent = this.el.oppName.textContent || i18n.t('OPPONENT');
        let label = i18n.t('REMATCH');
        if (selfRequested) label = i18n.t('WAITING_REMATCH_BTN');
        else if (oppRequested) label = i18n.t('ACCEPT_REMATCH');
        for (const btn of this.el.rematchButtons) {
            btn.textContent = label;
            btn.disabled = selfRequested;
        }

        const notice = this.el.rematchNotice;
        let text = null;
        if (selfRequested && oppRequested) text = i18n.t('REMATCH_ACCEPTED');
        else if (oppRequested) text = i18n.t('OPP_WANTS_REMATCH', { opponent });
        else if (selfRequested) text = i18n.t('WAITING_REMATCH_OPPONENT', { opponent });

        notice.textContent = text || '';
        notice.classList.toggle('incoming', oppRequested && !selfRequested);
        notice.hidden = !text;
    }

    isGameOverVisible() {
        return !this.el.victory.hidden || !this.el.defeat.hidden || (this.el.spectatorScreen && !this.el.spectatorScreen.hidden);
    }

    // --- Conexão -----------------------------------------------------------

    /**
     * @param {string} status NET_STATUS.*
     */
    setConnectionStatus(status) {
        const text = getConnectionText(status) || null;
        if (text === this.cache.banner) return;
        this.cache.banner = text;
        this.el.banner.hidden = !text;
        this.el.bannerText.textContent = text || '';
        const terminal = status === NET_STATUS.LOST || status === NET_STATUS.ERROR;
        this.el.bannerMenuBtn.hidden = !terminal;
        this.el.banner.classList.toggle('error', terminal);
    }
}
