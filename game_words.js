/**
 * game_words.js - Controlador para los 2 juegos de palabras:
 * 1. 'MIND_DIFF': No Elijas lo Mismo (Mentes Opuestas)
 * 2. 'MIND_SAME': Telepatía Total (Piensa lo Mismo)
 */

class WordGamesController {
  constructor() {
    this.mode = 'MIND_DIFF'; // 'MIND_DIFF' | 'MIND_SAME'
    this.currentRound = 0;
    this.totalRounds = 7;
    this.usedCategoryIndices = new Set();
    this.explicitCategoryIdx = -1; // -1 for random
    this.currentCategory = null;
    this.myChoice = null;
    this.rivalChoice = null;
    this.myScore = 0;
    this.rivalScore = 0;
    this.scoreHits = 0;   // Evasiones (en DIFF) o Matches (en SAME)
    this.scoreFails = 0;  // Choques (en DIFF) o Desconexiones (en SAME)
    this.timerLeft = 10;
    this.timerInterval = null;
    this.isRevealing = false;
    this.active = false;

    this.dom = {};
  }

  initDOM() {
    this.dom = {
      view: document.getElementById('view-word-game'),
      badgeMode: document.getElementById('wg-badge-mode'),
      titleGoal: document.getElementById('wg-title-goal'),
      roundIndicator: document.getElementById('wg-round-indicator'),
      hudScoreHits: document.getElementById('wg-score-hits'),
      hudScoreHitsLabel: document.getElementById('wg-score-hits-label'),
      hudScoreFails: document.getElementById('wg-score-fails'),
      hudScoreFailsLabel: document.getElementById('wg-score-fails-label'),
      timerBar: document.getElementById('wg-timer-bar'),
      timerText: document.getElementById('wg-timer-text'),
      categoryIcon: document.getElementById('wg-category-icon'),
      categoryName: document.getElementById('wg-category-name'),
      optionsContainer: document.getElementById('wg-options-container'),
      statusNotice: document.getElementById('wg-status-notice'),

      // Reveal Stage
      revealModal: document.getElementById('wg-reveal-modal'),
      revealResultTitle: document.getElementById('wg-reveal-title'),
      revealResultDesc: document.getElementById('wg-reveal-desc'),
      revealMyCard: document.getElementById('wg-reveal-my-card'),
      revealMyWord: document.getElementById('wg-reveal-my-word'),
      revealRivalCard: document.getElementById('wg-reveal-rival-card'),
      revealRivalWord: document.getElementById('wg-reveal-rival-word'),
      revealNextCountdown: document.getElementById('wg-reveal-countdown'),

      // Game Over Word View
      viewGameOver: document.getElementById('view-word-gameover'),
      goTitle: document.getElementById('wg-go-title'),
      goSubtitle: document.getElementById('wg-go-subtitle'),
      goStat1: document.getElementById('wg-go-stat1'),
      goStat1Val: document.getElementById('wg-go-stat1-val'),
      goStat2: document.getElementById('wg-go-stat2'),
      goStat2Val: document.getElementById('wg-go-stat2-val'),
      goTierMsg: document.getElementById('wg-go-tier'),
      btnRematch: document.getElementById('btn-wg-rematch'),
      rematchStatus: document.getElementById('wg-rematch-status'),
      btnMenu: document.getElementById('btn-wg-menu')
    };

    if (this.dom.btnRematch) {
      this.dom.btnRematch.onclick = () => this.requestRematch();
    }
    if (this.dom.btnMenu) {
      this.dom.btnMenu.onclick = () => location.reload();
    }
  }

  // Iniciar partida
  startGame(mode, totalRounds = 7) {
    this.initDOM();
    this.mode = mode;
    this.totalRounds = totalRounds;
    this.currentRound = 0;
    this.usedCategoryIndices.clear();
    this.scoreHits = 0;
    this.scoreFails = 0;
    this.active = true;

    // Configurar encabezados visuales según el modo
    if (this.mode === 'MIND_DIFF') {
      this.dom.badgeMode.textContent = '🧠 MENTES OPUESTAS';
      this.dom.badgeMode.style.background = 'rgba(236, 72, 153, 0.2)';
      this.dom.badgeMode.style.borderColor = '#ec4899';
      this.dom.titleGoal.textContent = '¡ELIGE UNA OPCIÓN DIFERENTE AL RIVAL!';
      this.dom.hudScoreHitsLabel.textContent = 'Evasiones exitosas';
      this.dom.hudScoreFailsLabel.textContent = 'Choques / Coincidencias';
    } else {
      this.dom.badgeMode.textContent = '🔮 TELEPATÍA TOTAL';
      this.dom.badgeMode.style.background = 'rgba(139, 92, 246, 0.2)';
      this.dom.badgeMode.style.borderColor = '#8b5cf6';
      this.dom.titleGoal.textContent = '¡SINCRONÍCENSE! ELIJAN LA MISMA OPCIÓN';
      this.dom.hudScoreHitsLabel.textContent = 'Matches Telepáticos';
      this.dom.hudScoreFailsLabel.textContent = 'Desconexiones';
    }

    this.updateHUD();

    // Mostrar vista del juego
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    this.dom.view.classList.add('active');

    // Si soy Anfitrión, inicio la ronda 1
    if (window.netManager.isHost) {
      this.hostStartNextRound();
    }
  }

  hostStartNextRound() {
    this.currentRound++;
    if (this.currentRound > this.totalRounds) {
      this.triggerGameOver();
      return;
    }

    // Elegir categoría (respeta selección explícita)
    let catIdx;
    if (this.explicitCategoryIdx >= 0) {
      catIdx = this.explicitCategoryIdx;
      // Restablecer para rondas posteriores
      this.explicitCategoryIdx = -1;
    } else {
      const totalCat = window.GAME_CATEGORIES.length;
      catIdx = Math.floor(Math.random() * totalCat);
      while (this.usedCategoryIndices.has(catIdx) && this.usedCategoryIndices.size < totalCat) {
        catIdx = Math.floor(Math.random() * totalCat);
      }
    }
    this.usedCategoryIndices.add(catIdx);

    window.netManager.send({
      type: 'WORD_ROUND_START',
      mode: this.mode,
      categoryIndex: catIdx,
      round: this.currentRound,
      totalRounds: this.totalRounds
    });

    this.setupRound(catIdx, this.currentRound);
  }

  setupRound(categoryIndex, roundNum) {
    this.currentRound = roundNum;
    this.currentCategory = window.GAME_CATEGORIES[categoryIndex];
    this.myChoice = null;
    this.rivalChoice = null;
    this.isRevealing = false;

    // Ocultar modal de revelación
    this.dom.revealModal.classList.add('hidden');

    this.dom.roundIndicator.textContent = `Ronda ${this.currentRound} de ${this.totalRounds}`;
    this.dom.categoryIcon.textContent = this.currentCategory.icon;
    this.dom.categoryName.textContent = this.currentCategory.name;
    this.dom.statusNotice.textContent = 'Selecciona tu palabra en secreto...';
    this.dom.statusNotice.style.color = '#cbd5e1';

    // Renderizar opciones
    this.dom.optionsContainer.innerHTML = '';
    this.currentCategory.options.forEach((optText, index) => {
      const btn = document.createElement('button');
      btn.className = 'word-option-card';
      btn.innerHTML = `
        <span class="word-card-num">${index + 1}</span>
        <span class="word-card-text">${optText}</span>
        <span class="word-card-lock hidden">🔒</span>
      `;
      btn.onclick = () => this.handleOptionSelect(index, btn);
      this.dom.optionsContainer.appendChild(btn);
    });

    this.startTimer();
    window.soundFX.playTurnSwitch();
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerLeft = 10;
    this.updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      this.timerLeft--;
      this.updateTimerDisplay();
      if (this.timerLeft <= 3 && this.timerLeft > 0) {
        window.soundFX.playTick();
      }
      if (this.timerLeft <= 0) {
        clearInterval(this.timerInterval);
        // Si no votó a tiempo, asignar una opción al azar
        if (this.myChoice === null) {
          const randomChoice = Math.floor(Math.random() * this.currentCategory.options.length);
          const buttons = this.dom.optionsContainer.querySelectorAll('.word-option-card');
          if (buttons[randomChoice]) {
            this.handleOptionSelect(randomChoice, buttons[randomChoice]);
          }
        }
      }
    }, 1000);
  }

  updateTimerDisplay() {
    const pct = (this.timerLeft / 10) * 100;
    this.dom.timerBar.style.width = pct + '%';
    this.dom.timerText.textContent = `${this.timerLeft}s`;
    if (this.timerLeft <= 3) {
      this.dom.timerBar.style.background = '#ef4444';
    } else {
      this.dom.timerBar.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';
    }
  }

  handleOptionSelect(index, btnElement) {
    if (this.myChoice !== null || this.isRevealing) return;

    this.myChoice = index;
    window.soundFX.playTap(3);
    if (navigator.vibrate) navigator.vibrate(20);

    // Marcar visualmente la tarjeta seleccionada
    const allBtns = this.dom.optionsContainer.querySelectorAll('.word-option-card');
    allBtns.forEach((b, i) => {
      if (i === index) {
        b.classList.add('selected');
        const lock = b.querySelector('.word-card-lock');
        if (lock) lock.classList.remove('hidden');
      } else {
        b.classList.add('disabled');
      }
    });

    this.dom.statusNotice.textContent = '¡Voto registrado! 🔒 Esperando al rival...';
    this.dom.statusNotice.style.color = '#38bdf8';

    // Enviar mi elección al rival
    window.netManager.send({
      type: 'WORD_VOTE',
      choice: index
    });

    // Si el rival ya había votado, ejecutar la revelación
    if (this.rivalChoice !== null) {
      this.executeReveal();
    }
  }

  handleRivalVoted(choice) {
    this.rivalChoice = choice;
    this.dom.statusNotice.textContent = '¡Tu rival ya eligió su palabra! 🔒';

    // Si yo también ya voté, ejecutar la revelación
    if (this.myChoice !== null) {
      this.executeReveal();
    }
  }

  executeReveal() {
    if (this.isRevealing) return;
    this.isRevealing = true;
    if (this.timerInterval) clearInterval(this.timerInterval);

    const myWord = this.currentCategory.options[this.myChoice];
    const rivalWord = this.currentCategory.options[this.rivalChoice];
    const isMatch = (this.myChoice === this.rivalChoice);

    // Configurar cartas de revelación
    this.dom.revealMyWord.textContent = myWord;
    this.dom.revealRivalWord.textContent = rivalWord;

    let isSuccess = false;
    if (this.mode === 'MIND_DIFF') {
      // Objetivo: NO coincidir
      isSuccess = !isMatch;
      if (isSuccess) {
        this.scoreHits++;
        this.dom.revealResultTitle.innerHTML = '🎉 ¡A SALVO! PENSARON DIFERENTE';
        this.dom.revealResultTitle.style.color = '#34d399';
        this.dom.revealResultDesc.textContent = `Tú elegiste "${myWord}" y tu rival "${rivalWord}". ¡Punto de evasión!`;
        window.soundFX.playSuccess();
      } else {
        this.scoreFails++;
        this.dom.revealResultTitle.innerHTML = '💥 ¡COINCIDENCIA FATAL! 😱';
        this.dom.revealResultTitle.style.color = '#f43f5e';
        this.dom.revealResultDesc.textContent = `¡Ambos pensaron en "${myWord}"! Coincidencia no deseada.`;
        window.soundFX.playClash();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      }
    } else {
      // Objetivo: TELEPATÍA (Coincidir)
      isSuccess = isMatch;
      if (isSuccess) {
        this.scoreHits++;
        this.dom.revealResultTitle.innerHTML = '🔮 ¡MATCH TELEPÁTICO TOTAL! ✨';
        this.dom.revealResultTitle.style.color = '#a78bfa';
        this.dom.revealResultDesc.textContent = `¡Conexión mental! Ambos eligieron "${myWord}".`;
        window.soundFX.playMatch();
        if (navigator.vibrate) navigator.vibrate([50, 80, 150]);
      } else {
        this.scoreFails++;
        this.dom.revealResultTitle.innerHTML = '❌ ¡DESCONEXIÓN MENTAL!';
        this.dom.revealResultTitle.style.color = '#fbbf24';
        this.dom.revealResultDesc.textContent = `Tú elegiste "${myWord}" y tu rival "${rivalWord}".`;
        window.soundFX.playError();
      }
    }

    this.updateHUD();
    this.dom.revealModal.classList.remove('hidden');

    // Cuenta atrás de 3 segundos para siguiente ronda
    let countdown = 3;
    this.dom.revealNextCountdown.textContent = countdown;
    const countInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        this.dom.revealNextCountdown.textContent = countdown;
      } else {
        clearInterval(countInterval);
        if (window.netManager.isHost) {
          this.hostStartNextRound();
        }
      }
    }, 1000);
  }

  updateHUD() {
    this.dom.hudScoreHits.textContent = this.scoreHits;
    this.dom.hudScoreFails.textContent = this.scoreFails;
  }

  triggerGameOver() {
    this.active = false;
    this.dom.revealModal.classList.add('hidden');

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    this.dom.viewGameOver.classList.add('active');

    window.netManager.send({
      type: 'WORD_GAME_OVER',
      scoreHits: this.scoreHits,
      scoreFails: this.scoreFails
    });

    this.renderGameOverStats();
  }

  renderGameOverStats() {
    if (this.mode === 'MIND_DIFF') {
      this.dom.goTitle.textContent = '🧠 ¡Fin del Reto de Mentes Opuestas!';
      this.dom.goStat1.textContent = 'Evasiones exitosas:';
      this.dom.goStat1Val.textContent = `${this.scoreHits} / ${this.totalRounds}`;
      this.dom.goStat2.textContent = 'Coincidencias no deseadas:';
      this.dom.goStat2Val.textContent = `${this.scoreFails}`;

      if (this.scoreHits >= 6) {
        this.dom.goTierMsg.textContent = '🏆 ¡Mentes 100% Desconectadas! Son estrategas opuestos.';
        window.soundFX.playVictory();
      } else if (this.scoreHits >= 4) {
        this.dom.goTierMsg.textContent = '🥈 ¡Buen intento! Lograron esquivar la mayoría.';
      } else {
        this.dom.goTierMsg.textContent = '😱 ¡Tienen demasiada telepatía! Piensan igual sin querer.';
      }
    } else {
      const pct = Math.round((this.scoreHits / this.totalRounds) * 100);
      this.dom.goTitle.textContent = '🔮 ¡Fin de la Prueba de Telepatía!';
      this.dom.goStat1.textContent = 'Matches telepáticos:';
      this.dom.goStat1Val.textContent = `${this.scoreHits} / ${this.totalRounds}`;
      this.dom.goStat2.textContent = 'Compatibilidad Mental:';
      this.dom.goStat2Val.textContent = `${pct}%`;

      if (pct >= 70) {
        this.dom.goTierMsg.textContent = `💖 ¡${pct}% ALMAS GEMELAS! Conexión telepática pura.`;
        window.soundFX.playVictory();
      } else if (pct >= 40) {
        this.dom.goTierMsg.textContent = `✨ ${pct}% Conexión moderada. ¡Van por buen camino!`;
      } else {
        this.dom.goTierMsg.textContent = `⚡ ${pct}% Mentes en frecuencias completamente distintas.`;
      }
    }
  }

  requestRematch() {
    this.dom.btnRematch.disabled = true;
    this.dom.rematchStatus.textContent = 'Esperando al rival para revancha...';
    window.netManager.send({
      type: 'WORD_REMATCH_REQ'
    });

    if (window.wordRematchVotes) {
      window.wordRematchVotes.add('me');
      if (window.wordRematchVotes.has('rival') && window.netManager.isHost) {
        this.startGame(this.mode, this.totalRounds);
      }
    }
  }
}

window.wordGames = new WordGamesController();
window.wordRematchVotes = new Set();

// Escuchadores de red para juegos de palabras
window.addEventListener('DOMContentLoaded', () => {
  if (window.netManager) {
    window.netManager.on('word_round_start', (data) => {
      if (!window.wordGames.active) {
        window.wordGames.startGame(data.mode, data.totalRounds);
      }
      window.wordGames.setupRound(data.categoryIndex, data.round);
    });

    window.netManager.on('word_vote', (data) => {
      window.wordGames.handleRivalVoted(data.choice);
    });

    window.netManager.on('word_game_over', (data) => {
      window.wordGames.renderGameOverStats();
    });

    window.netManager.on('word_rematch_req', () => {
      window.wordRematchVotes.add('rival');
      if (window.wordGames.dom.rematchStatus) {
        window.wordGames.dom.rematchStatus.textContent = '¡Tu rival quiere revancha!';
      }
      if (window.wordRematchVotes.has('me') && window.netManager.isHost) {
        window.wordGames.startGame(window.wordGames.mode, window.wordGames.totalRounds);
      }
    });
  }
});
