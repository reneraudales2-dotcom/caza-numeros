/**
 * network.js - Gestión de conexión Online P2P con WebRTC (PeerJS)
 * Permite que 2 jugadores se conecten en tiempo real directamente entre sus navegadores.
 */

class NetworkManager {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = null;
    this.myId = null;
    this.connected = false;
    this.callbacks = {};
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
  }

  // Generar código de sala de 4 caracteres fáciles de leer
  generateCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  getPeerIdFromCode(code) {
    return 'caza-num-' + code.toUpperCase().trim();
  }

  // Inicializar como Anfitrión (Crear Sala)
  createRoom(nickname, onRoomReady) {
    this.isHost = true;
    this.roomCode = this.generateCode();
    const peerId = this.getPeerIdFromCode(this.roomCode);

    this.initPeer(peerId, () => {
      if (onRoomReady) onRoomReady(this.roomCode);
    });
  }

  // Inicializar como Invitado (Unirse a Sala)
  joinRoom(code, nickname, onConnecting) {
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    const hostPeerId = this.getPeerIdFromCode(this.roomCode);

    if (onConnecting) onConnecting();

    this.initPeer(null, () => {
      // Conectar con el anfitrión
      const conn = this.peer.connect(hostPeerId, {
        reliable: true
      });
      this.setupConnection(conn, nickname);
    });
  }

  initPeer(preferredId, onOpen) {
    if (this.peer) {
      this.peer.destroy();
    }

    try {
      const peerConfig = {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      };

      this.peer = preferredId ? new Peer(preferredId, peerConfig) : new Peer(peerConfig);

      this.peer.on('open', (id) => {
        this.myId = id;
        if (onOpen) onOpen(id);
      });

      this.peer.on('connection', (conn) => {
        if (this.isHost) {
          if (this.connected) {
            // Ya hay un jugador en la sala
            conn.on('open', () => {
              conn.send({ type: 'ROOM_FULL' });
              setTimeout(() => conn.close(), 1000);
            });
            return;
          }
          this.setupConnection(conn, window.gameState ? window.gameState.myNickname : 'Anfitrión');
        }
      });

      this.peer.on('error', (err) => {
        console.error('Error de PeerJS:', err);
        let errorMsg = 'Error al conectar con la red.';
        if (err.type === 'unavailable-id') {
          errorMsg = 'El código de sala ya está en uso. Intenta de nuevo.';
        } else if (err.type === 'peer-unavailable') {
          errorMsg = 'No se encontró la sala. Verifica que el código esté correcto.';
        }
        this.emit('error', errorMsg);
      });

      this.peer.on('disconnected', () => {
        console.warn('Desconectado del servidor de señalización, reintentando...');
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });

    } catch (e) {
      console.error('No se pudo inicializar PeerJS:', e);
      this.emit('error', 'No se pudo inicializar el servicio online.');
    }
  }

  setupConnection(conn, myNickname) {
    this.conn = conn;

    this.conn.on('open', () => {
      this.connected = true;

      // Enviar handshake inicial con nickname
      this.send({
        type: 'HANDSHAKE',
        nickname: myNickname,
        isHost: this.isHost
      });

      this.emit('peer_connected');
    });

    this.conn.on('data', (data) => {
      this.handleIncomingData(data);
    });

    this.conn.on('close', () => {
      this.connected = false;
      this.emit('peer_disconnected');
    });

    this.conn.on('error', (err) => {
      console.error('Error en conexión de datos:', err);
      this.emit('error', 'Error en la conexión con el rival.');
    });
  }

  send(msgObj) {
    if (this.conn && this.conn.open) {
      this.conn.send(msgObj);
    }
  }

  handleIncomingData(data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'HANDSHAKE':
        this.emit('rival_handshake', data);
        break;
      case 'ROOM_FULL':
        this.emit('error', 'La sala ya está llena.');
        break;
      case 'CONFIG_UPDATE':
        this.emit('config_updated', data);
        break;
      case 'GAME_START':
        this.emit('game_started', data);
        break;
      case 'TACHADO_TICK':
        this.emit('rival_tachado', data);
        break;
      case 'TARGET_FOUND':
        this.emit('target_found', data);
        break;
      case 'NEW_ROUND':
        this.emit('new_round', data);
        break;
      case 'GAME_OVER':
        this.emit('game_over', data);
        break;
      case 'REMATCH_REQ':
        this.emit('rematch_requested', data);
        break;
      case 'REMATCH_ACCEPTED':
        this.emit('rematch_accepted', data);
        break;
      case 'GAME_TYPE_CHANGE':
        this.emit('game_type_changed', data);
        break;
      case 'START_WORD_GAME':
        this.emit('start_word_game', data);
        break;
      case 'WORD_ROUND_START':
        this.emit('word_round_start', data);
        break;
      case 'WORD_VOTE':
        this.emit('word_vote', data);
        break;
      case 'WORD_GAME_OVER':
        this.emit('word_game_over', data);
        break;
      case 'WORD_REMATCH_REQ':
        this.emit('word_rematch_req', data);
        break;
      case 'WORD_REMATCH_START':
        this.emit('word_rematch_start', data);
        break;
      default:
        this.emit('custom_message', data);
    }
  }

  disconnect() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connected = false;
    this.roomCode = null;
    this.isHost = false;
  }
}

window.netManager = new NetworkManager();
