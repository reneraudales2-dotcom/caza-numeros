/**
 * game.js - Lógica principal del juego viral de tachar números online
 * Sincronización robusta basada en host con cero desfase de roles.
 */

(function() {
  // Estado del Juego
  const state = {
    myNickname: 'Jugador 1',
    rivalNickname: 'Rival',
    role: null, // 'ATTACKER' | 'SEARCHER'
    maxNumbers: 50, // 30, 50 o 100
    myTachados: 0,
    rivalTachados: 0,
    currentTarget: null,
    myBoard: [],
    foundTargets: new Set(),
    isTurnActive: false,
    turnTaps: 0,
    roundNumber: 0,
    historyRounds: [],
    gameOver: false,
    rematchVotes: new Set()
  };

  window.gameState = state;

  // Elementos del DOM
  const views = {
    lobby: document.getElementById('view-lobby'),
    waiting: document.getElementById('view-waiting'),
    game: document.getElementById('view-game'),
    gameover: document.getElementById('view-gameover')
  };

  const ui = {
    // Lobby
    nicknameInput: document.getElementById('input-nickname'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    inputRoomCode: document.getElementById('input-room-code'),
    lobbyStatus: document.getElementById('lobby-status'),

    // Waiting Room
    displayRoomCode: document.getElementById('display-room-code'),
    qrContainer: document.getElementById('qr-container'),
    lanLinkDisplay: document.getElementById('lan-link-display'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    player1Name: document.getElementById('p1-name'),
    player2Name: document.getElementById('p2-name'),
    player2Status: document.getElementById('p2-status'),
    hostControls: document.getElementById('host-controls'),
    guestWaitingMsg: document.getElementById('guest-waiting-msg'),
    selectMaxNumbers: document.getElementById('select-max-numbers'),
    btnStartGame: document.getElementById('btn-start-game'),

    // Game View
    hudMyName: document.getElementById('hud-my-name'),
    hudMyScore: document.getElementById('hud-my-score'),
    hudMyBar: document.getElementById('hud-my-bar'),
    hudRivalName: document.getElementById('hud-rival-name'),
    hudRivalScore: document.getElementById('hud-rival-score'),
    hudRivalBar: document.getElementById('hud-rival-bar'),
    hudGoal: document.getElementById('hud-goal'),

    // Roles Views
    panelAttacker: document.getElementById('panel-attacker'),
    panelSearcher: document.getElementById('panel-searcher'),
    attackerTargetNum: document.getElementById('attacker-target-num'),
    btnTachar: document.getElementById('btn-tachar'),
    nextTacharNum: document.getElementById('next-tachar-num'),
    turnTapsCount: document.getElementById('turn-taps-count'),
    searcherTargetNum: document.getElementById('searcher-target-num'),
    rivalLiveTachados: document.getElementById('rival-live-tachados'),
    boardGrid: document.getElementById('board-grid'),

    // Transition Overlay
    overlayTurn: document.getElementById('overlay-turn'),
    overlayTurnTitle: document.getElementById('overlay-turn-title'),
    overlayTurnSubtitle: document.getElementById('overlay-turn-subtitle'),
    overlayCountdown: document.getElementById('overlay-countdown'),

    // Game Over
    winnerBanner: document.getElementById('winner-banner'),
    finalStats: document.getElementById('final-stats'),
    btnRematch: document.getElementById('btn-rematch'),
    rematchStatus: document.getElementById('rematch-status'),
    btnLeaveGame: document.getElementById('btn-leave-game'),

    // Sound Toggle
    btnSoundToggle: document.getElementById('btn-sound-toggle')
  };

  // Switch de vistas
  function showView(viewName) {
    Object.keys(views).forEach(v => {
      if (views[v]) {
        views[v].classList.toggle('active', v === viewName);
      }
    });
  }

  // Barajar array (Fisher-Yates)
  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Generar tablero desordenado para este jugador
  function generateMyBoard(max) {
    const nums = [];
    for (let i = 1; i <= max; i++) {
      nums.push(i);
    }
    return shuffleArray(nums);
  }

  // Renderizar la cuadrícula de búsqueda
  function renderSearchBoard() {
    ui.boardGrid.innerHTML = '';
    
    // Ajustar columnas de la cuadrícula según cantidad de números
    if (state.maxNumbers <= 30) {
      ui.boardGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(52px, 1fr))';
    } else if (state.maxNumbers <= 50) {
      ui.boardGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(46px, 1fr))';
    } else {
      ui.boardGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(38px, 1fr))';
    }

    state.myBoard.forEach(num => {
      const cell = document.createElement('button');
      cell.className = 'board-cell';
      cell.textContent = num;
      cell.dataset.number = num;

      if (state.foundTargets.has(num)) {
        cell.classList.add('already-found');
      }

      cell.addEventListener('click', (e) => {
        e.preventDefault();
        handleBoardCellClick(num, cell);
      });
      ui.boardGrid.appendChild(cell);
    });
  }

  // Click en celda del tablero de búsqueda
  function handleBoardCellClick(num, cellElement) {
    if (state.role !== 'SEARCHER' || !state.isTurnActive || state.gameOver) return;

    if (num === state.currentTarget) {
      // ¡ACIERTO! Número encontrado
      state.isTurnActive = false;
      cellElement.classList.add('correct-found');
      state.foundTargets.add(num);

      window.soundFX.playSuccess();
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

      // Enviar evento al rival de inmediato para congelar su racha
      window.netManager.send({
        type: 'TARGET_FOUND',
        target: num,
        finder: state.myNickname
      });

      // Procesar fin de turno
      onTargetDiscovered(state.myNickname, num);

    } else {
      // Error: número equivocado
      window.soundFX.playError();
      if (navigator.vibrate) navigator.vibrate(50);
      cellElement.classList.add('wrong-cell');
      setTimeout(() => {
        cellElement.classList.remove('wrong-cell');
      }, 350);
    }
  }

  // Acción de Tachado Rápido del Atacante
  function handleTacharClick() {
    if (state.role !== 'ATTACKER' || !state.isTurnActive || state.gameOver) return;

    state.myTachados++;
    state.turnTaps++;

    window.soundFX.playTap(state.turnTaps);
    if (navigator.vibrate) navigator.vibrate(15);

    // Animación visual de botón
    ui.btnTachar.classList.add('tap-pop');
    setTimeout(() => ui.btnTachar.classList.remove('tap-pop'), 80);

    updateHUD();

    // Notificar al rival del nuevo número tachado
    window.netManager.send({
      type: 'TACHADO_TICK',
      count: state.myTachados
    });

    // ¿Ganó el juego?
    if (state.myTachados >= state.maxNumbers) {
      triggerGameOver(true);
    }
  }

  // Actualizar indicadores visuales de progreso
  function updateHUD() {
    ui.hudMyScore.textContent = state.myTachados;
    ui.hudRivalScore.textContent = state.rivalTachados;
    ui.hudGoal.textContent = state.maxNumbers;

    const myPct = Math.min(100, (state.myTachados / state.maxNumbers) * 100);
    const rivalPct = Math.min(100, (state.rivalTachados / state.maxNumbers) * 100);

    ui.hudMyBar.style.width = myPct + '%';
    ui.hudRivalBar.style.width = rivalPct + '%';

    // Próximo número a tachar por el atacante
    ui.nextTacharNum.textContent = (state.myTachados + 1);
    ui.turnTapsCount.textContent = state.turnTaps;

    // Indicador en vivo para el buscador
    ui.rivalLiveTachados.textContent = state.rivalTachados;
  }

  // Selección del siguiente número objetivo
  function pickNextTarget() {
    const available = [];
    for (let i = 1; i <= state.maxNumbers; i++) {
      if (!state.foundTargets.has(i)) {
        available.push(i);
      }
    }

    if (available.length === 0) {
      state.foundTargets.clear();
      for (let i = 1; i <= state.maxNumbers; i++) available.push(i);
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex];
  }

  // Iniciar un turno activo con un objetivo
  function startTurn(target) {
    state.currentTarget = target;
    state.turnTaps = 0;
    state.roundNumber++;

    ui.overlayTurn.classList.add('hidden');

    if (state.role === 'ATTACKER') {
      ui.panelAttacker.classList.remove('hidden');
      ui.panelSearcher.classList.add('hidden');
      ui.attackerTargetNum.textContent = target;
      state.isTurnActive = true;
    } else {
      ui.panelAttacker.classList.add('hidden');
      ui.panelSearcher.classList.remove('hidden');
      ui.searcherTargetNum.textContent = target;
      window.soundFX.playAlert();
      state.isTurnActive = true;
    }

    updateHUD();
  }

  // Cuando se encuentra el número objetivo (congelar y preparar cambio)
  function onTargetDiscovered(finderName, target) {
    state.isTurnActive = false;
    state.foundTargets.add(target);

    // Actualizar celdas del tablero
    const targetCell = ui.boardGrid.querySelector(`[data-number="${target}"]`);
    if (targetCell) {
      targetCell.classList.add('already-found');
    }

    // Mostrar overlay de cambio
    ui.overlayTurnTitle.textContent = `¡NÚMERO ${target} ENCONTRADO!`;
    ui.overlayTurnSubtitle.textContent = `${finderName} frenó la racha. ¡Cambio de roles!`;
    ui.overlayTurn.classList.remove('hidden');

    let count = 2;
    ui.overlayCountdown.textContent = count;

    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        ui.overlayCountdown.textContent = count;
      } else {
        clearInterval(timer);

        // Si alguien ya ganó, salir
        if (state.myTachados >= state.maxNumbers) {
          triggerGameOver(true);
          return;
        }
        if (state.rivalTachados >= state.maxNumbers) {
          triggerGameOver(false);
          return;
        }

        // El Anfitrión coordina el cambio para garantizar perfecta sincronía
        if (window.netManager.isHost) {
          state.role = (state.role === 'ATTACKER') ? 'SEARCHER' : 'ATTACKER';
          const guestRole = (state.role === 'ATTACKER') ? 'SEARCHER' : 'ATTACKER';
          const nextTarget = pickNextTarget();

          window.netManager.send({
            type: 'NEW_ROUND',
            target: nextTarget,
            guestRole: guestRole
          });

          window.soundFX.playTurnSwitch();
          startTurn(nextTarget);
        }
      }
    }, 1000);
  }

  // Fin de la Partida
  function triggerGameOver(didIWin) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.isTurnActive = false;
    ui.overlayTurn.classList.add('hidden');

    if (didIWin) {
      window.soundFX.playVictory();
      launchConfetti();
      ui.winnerBanner.innerHTML = `🏆 ¡FELICITACIONES, GANASTE! 🏆<br><span style="font-size: 1.05rem; color: #a7f3d0;">Tachaste tus ${state.maxNumbers} números primero</span>`;
      window.netManager.send({
        type: 'GAME_OVER',
        winner: state.myNickname
      });
    } else {
      window.soundFX.playDefeat();
      ui.winnerBanner.innerHTML = `🏁 ¡${state.rivalNickname} GANA LA PARTIDA! 🏁<br><span style="font-size: 1.05rem; color: #cbd5e1;">¡Estuvo reñido!</span>`;
    }

    // Mostrar estadísticas
    ui.finalStats.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Tus números tachados:</span>
        <span class="stat-val" style="color: var(--primary);">${state.myTachados} / ${state.maxNumbers}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Números del rival:</span>
        <span class="stat-val" style="color: var(--secondary);">${state.rivalTachados} / ${state.maxNumbers}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Rondas totales:</span>
        <span class="stat-val">${state.roundNumber}</span>
      </div>
    `;

    ui.rematchStatus.textContent = '';
    ui.btnRematch.disabled = false;
    showView('gameover');
  }

  // Inicializar Partida
  function initGame(firstAttackerIsHost) {
    state.gameOver = false;
    state.myTachados = 0;
    state.rivalTachados = 0;
    state.roundNumber = 0;
    state.turnTaps = 0;
    state.foundTargets.clear();
    state.historyRounds = [];
    state.rematchVotes.clear();

    // Generar tablero de búsqueda propio
    state.myBoard = generateMyBoard(state.maxNumbers);
    renderSearchBoard();

    // Asignar rol inicial
    const amIHost = window.netManager.isHost;
    if (amIHost) {
      state.role = firstAttackerIsHost ? 'ATTACKER' : 'SEARCHER';
    } else {
      state.role = firstAttackerIsHost ? 'SEARCHER' : 'ATTACKER';
    }

    ui.hudMyName.textContent = state.myNickname;
    ui.hudRivalName.textContent = state.rivalNickname;
    updateHUD();

    showView('game');

    // Si soy Anfitrión, generar el primer objetivo y transmitir
    if (amIHost) {
      const firstTarget = pickNextTarget();
      window.netManager.send({
        type: 'NEW_ROUND',
        target: firstTarget,
        guestRole: (state.role === 'ATTACKER') ? 'SEARCHER' : 'ATTACKER'
      });
      startTurn(firstTarget);
    }
  }

  // Efecto visual de Confeti integrado (Canvas nativo)
  function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#8b5cf6', '#ffffff'];

    for (let i = 0; i < 120; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        velY: Math.random() * 4 + 2,
        velX: (Math.random() - 0.5) * 3,
        rot: Math.random() * 360,
        rotVel: (Math.random() - 0.5) * 6
      });
    }

    let frames = 0;
    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.y += p.velY;
        p.x += p.velX;
        p.rot += p.rotVel;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });

      frames++;
      if (frames < 240) {
        requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    render();
  }

  // Event Listeners y Red
  function setupEventListeners() {
    // Tecla Espacio para tachar
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && state.role === 'ATTACKER' && state.isTurnActive) {
        e.preventDefault();
        handleTacharClick();
      }
    });

    // Botón de tachado táctil
    ui.btnTachar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleTacharClick();
    });

    // Crear Sala
    ui.btnCreateRoom.addEventListener('click', () => {
      const nick = ui.nicknameInput.value.trim() || 'Jugador 1';
      state.myNickname = nick;
      ui.player1Name.textContent = nick + ' (Tú - Anfitrión)';
      ui.lobbyStatus.textContent = 'Conectando con la nube...';

      window.soundFX.init();

      window.netManager.createRoom(nick, (roomCode) => {
        ui.displayRoomCode.textContent = roomCode;
        ui.hostControls.classList.remove('hidden');
        ui.guestWaitingMsg.classList.add('hidden');

        // Resolver enlace: si estamos en localhost, usar la IP de la red Wi-Fi para que el celular pueda entrar
        let origin = window.location.origin;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocal && window.SERVER_LAN_IP && window.SERVER_LAN_IP !== 'localhost' && window.SERVER_LAN_IP !== '127.0.0.1') {
          const port = window.location.port ? `:${window.location.port}` : ':8080';
          origin = `${window.location.protocol}//${window.SERVER_LAN_IP}${port}`;
        }
        const shareUrl = origin + window.location.pathname + '?room=' + roomCode;

        if (ui.lanLinkDisplay) {
          ui.lanLinkDisplay.textContent = shareUrl;
          const hint = document.getElementById('lan-link-hint');
          if (hint) {
            hint.textContent = isLocal 
              ? '(Ambos dispositivos deben estar en la misma red Wi-Fi)' 
              : '🌍 ¡Puedes compartir este enlace por WhatsApp para jugar a cualquier distancia!';
          }
        }

        if (window.QRCode) {
          new window.QRCode('qr-container', {
            text: shareUrl,
            width: 160,
            height: 160
          });
        }

        ui.btnCopyLink.onclick = () => {
          navigator.clipboard.writeText(shareUrl).then(() => {
            ui.btnCopyLink.textContent = '¡Enlace copiado! ✅';
            setTimeout(() => ui.btnCopyLink.textContent = '📋 Copiar Enlace Directo', 2000);
          }).catch(() => {
            prompt('Copia este enlace para enviarlo a tu rival:', shareUrl);
          });
        };

        showView('waiting');
      });
    });

    // Unirse a Sala
    ui.btnJoinRoom.addEventListener('click', () => {
      const nick = ui.nicknameInput.value.trim() || 'Jugador 2';
      const code = ui.inputRoomCode.value.trim();

      if (!code) {
        alert('Por favor escribe el código de la sala.');
        return;
      }

      state.myNickname = nick;
      ui.lobbyStatus.textContent = 'Conectando con la sala ' + code.toUpperCase() + '...';
      window.soundFX.init();

      window.netManager.joinRoom(code, nick, () => {
        ui.displayRoomCode.textContent = code.toUpperCase();
        ui.hostControls.classList.add('hidden');
        ui.guestWaitingMsg.classList.remove('hidden');
        ui.player1Name.textContent = 'Anfitrión';
        ui.player2Name.textContent = nick + ' (Tú)';
        ui.player2Status.textContent = 'Conectando...';
        showView('waiting');
      });
    });

    // Configuración de Meta (Host)
    ui.selectMaxNumbers.addEventListener('change', () => {
      state.maxNumbers = parseInt(ui.selectMaxNumbers.value, 10);
      window.netManager.send({
        type: 'CONFIG_UPDATE',
        maxNumbers: state.maxNumbers
      });
    });

    // Iniciar Partida (Host)
    ui.btnStartGame.addEventListener('click', () => {
      state.maxNumbers = parseInt(ui.selectMaxNumbers.value, 10);
      const firstAttackerHost = Math.random() >= 0.5;

      window.netManager.send({
        type: 'GAME_START',
        maxNumbers: state.maxNumbers,
        firstAttackerHost: firstAttackerHost
      });

      initGame(firstAttackerHost);
    });

    // Botón de Revancha
    ui.btnRematch.addEventListener('click', () => {
      ui.btnRematch.disabled = true;
      ui.rematchStatus.textContent = 'Esperando al rival...';
      window.netManager.send({
        type: 'REMATCH_REQ'
      });
      state.rematchVotes.add('me');
      if (state.rematchVotes.has('rival')) {
        const firstAttackerHost = Math.random() >= 0.5;
        if (window.netManager.isHost) {
          window.netManager.send({
            type: 'REMATCH_ACCEPTED',
            firstAttackerHost: firstAttackerHost
          });
          initGame(firstAttackerHost);
        }
      }
    });

    // Salir al Menú
    ui.btnLeaveGame.addEventListener('click', () => {
      window.netManager.disconnect();
      location.reload();
    });

    // Silencio / Sonido
    ui.btnSoundToggle.addEventListener('click', () => {
      const muted = window.soundFX.toggleMute();
      ui.btnSoundToggle.textContent = muted ? '🔇 Silencio' : '🔊 Sonido';
    });

    // Eventos de Red PeerJS
    window.netManager.on('peer_connected', () => {
      ui.player2Status.textContent = '¡Conectado!';
      ui.player2Status.style.color = '#34d399';
      if (window.netManager.isHost) {
        ui.btnStartGame.disabled = false;
        ui.btnStartGame.classList.add('ready-glow');
      }
    });

    window.netManager.on('rival_handshake', (data) => {
      state.rivalNickname = data.nickname || 'Rival';
      if (window.netManager.isHost) {
        ui.player2Name.textContent = state.rivalNickname;
      } else {
        ui.player1Name.textContent = state.rivalNickname + ' (Anfitrión)';
      }
    });

    window.netManager.on('config_updated', (data) => {
      if (data.maxNumbers) {
        state.maxNumbers = data.maxNumbers;
        ui.selectMaxNumbers.value = data.maxNumbers;
      }
    });

    window.netManager.on('game_started', (data) => {
      state.maxNumbers = data.maxNumbers || 50;
      initGame(data.firstAttackerHost);
    });

    window.netManager.on('rival_tachado', (data) => {
      state.rivalTachados = data.count;
      updateHUD();
    });

    window.netManager.on('target_found', (data) => {
      onTargetDiscovered(data.finder, data.target);
    });

    window.netManager.on('new_round', (data) => {
      if (data.guestRole) {
        state.role = data.guestRole;
      }
      window.soundFX.playTurnSwitch();
      startTurn(data.target);
    });

    window.netManager.on('game_over', (data) => {
      triggerGameOver(false);
    });

    window.netManager.on('rematch_requested', () => {
      state.rematchVotes.add('rival');
      ui.rematchStatus.textContent = '¡Tu rival quiere revancha!';
      if (state.rematchVotes.has('me') && window.netManager.isHost) {
        const firstAttackerHost = Math.random() >= 0.5;
        window.netManager.send({
          type: 'REMATCH_ACCEPTED',
          firstAttackerHost: firstAttackerHost
        });
        initGame(firstAttackerHost);
      }
    });

    window.netManager.on('rematch_accepted', (data) => {
      initGame(data.firstAttackerHost);
    });

    window.netManager.on('peer_disconnected', () => {
      alert('Tu rival se ha desconectado de la partida.');
      location.reload();
    });

    window.netManager.on('error', (err) => {
      ui.lobbyStatus.textContent = err;
      ui.lobbyStatus.style.color = '#f87171';
    });

    // Auto-completar código si viene por parámetro en URL (?room=XYZ)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      ui.inputRoomCode.value = roomParam.toUpperCase();
      ui.lobbyStatus.textContent = `Sala "${roomParam.toUpperCase()}" detectada en el enlace. Escribe tu nombre y dale a "Unirse a Sala".`;
      ui.lobbyStatus.style.color = '#38bdf8';
    }
  }

  // Iniciar al cargar el DOM
  window.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
  });

})();
