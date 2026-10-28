/**
 * network.js - Conexión online P2P (WebRTC con PeerJS), pensada para que no se caiga.
 *
 * Mejoras clave:
 *  - STUN + TURN (relay): sin TURN muchas conexiones por datos móviles / Wi-Fi distintos fallan.
 *  - Timeouts de conexión: nunca se queda "Conectando..." para siempre.
 *  - Heartbeat (PING/PONG): detecta caídas silenciosas (el evento 'close' no siempre se dispara).
 *  - Varios listeners por evento y un único aviso de desconexión.
 */

// TURN público gratuito de Open Relay (Metered). Es de uso compartido y "mejor esfuerzo".
// Para producción crea una cuenta gratis en https://www.metered.ca/tools/openrelay/ y
// reemplaza estas credenciales por las tuyas (o define window.TURN_SERVERS en config.js).
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
];

const PEER_OPEN_TIMEOUT_MS = 12000;   // esperar al servidor de señalización
const CONNECT_TIMEOUT_MS = 20000;     // esperar a que el rival abra el canal de datos
const HEARTBEAT_EVERY_MS = 2500;
const HEARTBEAT_DEAD_AFTER_MS = 10000;

class NetworkManager {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = null;
    this.myId = null;
    this.connected = false;
    this.listeners = {};
    this._createAttempts = 0;
    this._onRoomReady = null;
    this._lastSeen = 0;
    this._hbSend = null;
    this._hbCheck = null;
    this._disconnectNotified = false;

    // Al volver de segundo plano (cambiar de app en el celular) no contar el tiempo oculto como caída
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._lastSeen = Date.now();
    });
  }

  // ---------- Eventos ----------
  on(event, callback) {
    (this.listeners[event] = this.listeners[event] || []).push(callback);
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach((cb) => {
      try { cb(data); } catch (e) { console.error(`Error en listener "${event}":`, e); }
    });
  }

  // ---------- Códigos de sala ----------
  generateCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  }

  getPeerIdFromCode(code) {
    return 'caza-num-' + code.toUpperCase().trim();
  }

  // ---------- Crear / unirse ----------
  createRoom(nickname, onRoomReady) {
    this.isHost = true;
    if (onRoomReady) this._onRoomReady = onRoomReady;
    this.roomCode = this.generateCode();
    this.initPeer(this.getPeerIdFromCode(this.roomCode), () => {
      this._createAttempts = 0;
      if (this._onRoomReady) this._onRoomReady(this.roomCode);
    });
  }

  joinRoom(code, nickname, onConnecting) {
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    const hostPeerId = this.getPeerIdFromCode(this.roomCode);

    if (onConnecting) onConnecting();

    this.initPeer(null, () => {
      const conn = this.peer.connect(hostPeerId, { reliable: true });
      this.setupConnection(conn, nickname);

      // Si el canal de datos no abre a tiempo, avisar en vez de quedarse colgado
      this._connectTimer = setTimeout(() => {
        if (!this.connected) {
          this.emit('error', 'No se pudo conectar con el rival. Revisa el código y que ambos tengan internet.');
          try { conn.close(); } catch (e) {}
        }
      }, CONNECT_TIMEOUT_MS);
    });
  }

  initPeer(preferredId, onOpen) {
    this._cleanupPeer();

    const iceServers = (window.TURN_SERVERS && window.TURN_SERVERS.length)
      ? [{ urls: 'stun:stun.l.google.com:19302' }, ...window.TURN_SERVERS]
      : DEFAULT_ICE_SERVERS;

    if (typeof Peer === 'undefined') {
      this.emit('error', 'No se pudo cargar la librería online. Recarga la página.');
      return;
    }

    try {
      const peerConfig = { debug: 1, config: { iceServers, iceCandidatePoolSize: 4 } };
      const peer = preferredId ? new Peer(preferredId, peerConfig) : new Peer(peerConfig);
      this.peer = peer;

      // Si el servidor de señalización no responde, avisar
      const openTimer = setTimeout(() => {
        if (!this.myId && this.peer === peer) {
          this.emit('error', 'El servidor online no responde. Revisa tu internet e inténtalo de nuevo.');
        }
      }, PEER_OPEN_TIMEOUT_MS);

      peer.on('open', (id) => {
        clearTimeout(openTimer);
        this.myId = id;
        if (onOpen) onOpen(id);
      });

      peer.on('connection', (conn) => {
        if (!this.isHost) return;
        if (this.connected) {
          conn.on('open', () => {
            conn.send({ type: 'ROOM_FULL' });
            setTimeout(() => conn.close(), 1000);
          });
          return;
        }
        this.setupConnection(conn, window.gameState ? window.gameState.myNickname : 'Anfitrión');
      });

      peer.on('error', (err) => {
        clearTimeout(openTimer);
        console.error('Error de PeerJS:', err);

        // Código de sala ocupado: generar otro automáticamente
        if (err.type === 'unavailable-id' && this.isHost && this._createAttempts < 5) {
          this._createAttempts++;
          this.createRoom(null);
          return;
        }

        // Errores durante una partida en curso los gestiona el heartbeat; no pisar la pantalla
        if (this.connected) return;

        const messages = {
          'unavailable-id': 'El código de sala ya está en uso. Intenta de nuevo.',
          'peer-unavailable': 'No se encontró la sala. Verifica que el código esté correcto y que tu amigo siga en la sala.',
          'network': 'Sin conexión con el servidor. Revisa tu internet.',
          'server-error': 'El servidor online tuvo un problema. Inténtalo en unos segundos.',
          'socket-error': 'Se perdió la conexión con el servidor. Inténtalo de nuevo.',
          'socket-closed': 'Se cerró la conexión con el servidor. Inténtalo de nuevo.',
          'webrtc': 'No se pudo establecer la conexión directa. Prueba cambiando de red (Wi-Fi/datos).'
        };
        this.emit('error', messages[err.type] || 'Error al conectar con la red.');
      });

      // Pérdida del servidor de señalización: reintentar (la partida ya iniciada sigue por WebRTC)
      peer.on('disconnected', () => {
        if (peer.destroyed) return;
        let tries = 0;
        const retry = () => {
          if (peer.destroyed || !peer.disconnected || tries >= 5) return;
          tries++;
          try { peer.reconnect(); } catch (e) {}
          setTimeout(retry, 1500 * tries);
        };
        retry();
      });
    } catch (e) {
      console.error('No se pudo inicializar PeerJS:', e);
      this.emit('error', 'No se pudo inicializar el servicio online.');
    }
  }

  setupConnection(conn, myNickname) {
    this.conn = conn;
    this._disconnectNotified = false;

    conn.on('open', () => {
      clearTimeout(this._connectTimer);
      this.connected = true;
      this._lastSeen = Date.now();
      this._startHeartbeat();

      this.send({ type: 'HANDSHAKE', nickname: myNickname, isHost: this.isHost });
      this.emit('peer_connected');
    });

    conn.on('data', (data) => {
      this._lastSeen = Date.now();
      this.handleIncomingData(data);
    });

    conn.on('close', () => this._notifyDisconnect());

    conn.on('error', (err) => {
      console.error('Error en conexión de datos:', err);
      if (!this.connected) this.emit('error', 'Error en la conexión con el rival.');
    });
  }

  // ---------- Heartbeat ----------
  _startHeartbeat() {
    this._stopHeartbeat();
    this._hbSend = setInterval(() => this.send({ type: 'PING' }), HEARTBEAT_EVERY_MS);
    this._hbCheck = setInterval(() => {
      if (document.hidden) return; // en segundo plano el navegador frena los timers
      if (Date.now() - this._lastSeen > HEARTBEAT_DEAD_AFTER_MS) {
        console.warn('Sin señales del rival: conexión considerada caída.');
        try { this.conn && this.conn.close(); } catch (e) {}
        this._notifyDisconnect();
      }
    }, 2000);
  }

  _stopHeartbeat() {
    clearInterval(this._hbSend);
    clearInterval(this._hbCheck);
    this._hbSend = this._hbCheck = null;
  }

  _notifyDisconnect() {
    if (this._disconnectNotified) return;
    this._disconnectNotified = true;
    this.connected = false;
    this._stopHeartbeat();
    this.emit('peer_disconnected');
  }

  // ---------- Envío / recepción ----------
  send(msgObj) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(msgObj);
        return true;
      } catch (e) {
        console.warn('No se pudo enviar el mensaje:', e);
      }
    }
    return false;
  }

  handleIncomingData(data) {
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

    const map = {
      HANDSHAKE: 'rival_handshake',
      ROOM_FULL: null,
      CONFIG_UPDATE: 'config_updated',
      GAME_START: 'game_started',
      TACHADO_TICK: 'rival_tachado',
      TARGET_FOUND: 'target_found',
      NEW_ROUND: 'new_round',
      GAME_OVER: 'game_over',
      REMATCH_REQ: 'rematch_requested',
      REMATCH_ACCEPTED: 'rematch_accepted',
      GAME_TYPE_CHANGE: 'game_type_changed',
      START_WORD_GAME: 'start_word_game',
      WORD_ROUND_START: 'word_round_start',
      WORD_VOTE: 'word_vote',
      WORD_GAME_OVER: 'word_game_over',
      WORD_REMATCH_REQ: 'word_rematch_req',
      WORD_REMATCH_START: 'word_rematch_start',
      BACK_TO_LOBBY: 'back_to_lobby',
      CHANGE_GAME_REQ: 'change_game_req'
    };

    if (data.type === 'PING') return;        // solo sirve para marcar _lastSeen
    if (data.type === 'ROOM_FULL') {
      this.emit('error', 'La sala ya está llena.');
      return;
    }
    this.emit(map[data.type] || 'custom_message', data);
  }

  // ---------- Limpieza ----------
  _cleanupPeer() {
    clearTimeout(this._connectTimer);
    this._stopHeartbeat();
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    this.myId = null;
  }

  disconnect() {
    this._disconnectNotified = true; // salida voluntaria: no avisar
    if (this.conn) {
      try { this.conn.close(); } catch (e) {}
      this.conn = null;
    }
    this._cleanupPeer();
    this.connected = false;
    this.roomCode = null;
    this.isHost = false;
  }
}

window.netManager = new NetworkManager();
