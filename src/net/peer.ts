import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { peerIdForRoom, randomRoomCode } from './protocol';
import type { Transport } from './transport';

const CONNECT_TIMEOUT = 12000;

/**
 * Servidor de señalización. Por defecto el público y gratuito de PeerJS (0.peerjs.com).
 * Se puede cambiar en build (VITE_PEER_HOST=...) o en caliente con ?peer=host:puerto (útil para pruebas locales).
 */
function peerOptions(): PeerOptions {
  const opts: PeerOptions = { debug: 1 };
  const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('peer') : null;
  const env = import.meta.env;
  const spec = fromUrl ?? (env.VITE_PEER_HOST ? `${env.VITE_PEER_HOST}:${env.VITE_PEER_PORT ?? 443}` : null);
  if (spec) {
    const [host, port] = spec.split(':');
    opts.host = host;
    opts.port = Number(port) || 443;
    opts.path = env.VITE_PEER_PATH ?? '/';
    opts.secure = opts.port === 443;
  }
  return opts;
}

function wrap(conn: DataConnection): Transport {
  const closeCbs: (() => void)[] = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeCbs.forEach((cb) => cb());
  };
  conn.on('close', fireClose);
  conn.on('error', fireClose);
  // Si el ICE muere sin cerrar el canal (wifi que se cae), también lo damos por cerrado.
  conn.on('iceStateChanged', (state) => {
    if (state === 'failed' || state === 'closed') fireClose();
  });
  return {
    send(msg) {
      if (!closed && conn.open) {
        try {
          conn.send(msg);
        } catch {
          /* canal cerrándose */
        }
      }
    },
    onMessage(cb) {
      conn.on('data', cb);
    },
    onClose(cb) {
      closeCbs.push(cb);
    },
    close() {
      conn.close();
      fireClose();
    },
  };
}

export interface HostedRoom {
  code: string;
  peer: Peer;
  destroy(): void;
}

/** Crea la sala: registra un peer con id derivado del código. Reintenta si el código está cogido. */
export function hostRoom(onConnection: (t: Transport) => void, attempts = 4): Promise<HostedRoom> {
  return new Promise((resolve, reject) => {
    const tryOnce = (left: number) => {
      const code = randomRoomCode();
      const peer = new Peer(peerIdForRoom(code), peerOptions());
      let opened = false;
      peer.on('open', () => {
        opened = true;
        resolve({ code, peer, destroy: () => peer.destroy() });
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => onConnection(wrap(conn)));
      });
      peer.on('disconnected', () => {
        // perdimos el servidor de señalización: las conexiones existentes siguen, pero reintentamos
        if (opened && !peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err: Error & { type?: string }) => {
        if (opened) return;
        peer.destroy();
        if (err.type === 'unavailable-id' && left > 0) tryOnce(left - 1);
        else reject(new Error(describeError(err.type)));
      });
    };
    tryOnce(attempts);
  });
}

export function joinRoom(code: string): Promise<{ transport: Transport; peer: Peer }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let done = false;
    const fail = (msg: string) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('No responde nadie en esa sala. ¿Código bien escrito?'), CONNECT_TIMEOUT);
    peer.on('error', (err: Error & { type?: string }) => {
      clearTimeout(timer);
      fail(describeError(err.type));
    });
    peer.on('open', () => {
      const conn = peer.connect(peerIdForRoom(code), { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ transport: wrap(conn), peer });
      });
    });
  });
}

function describeError(type?: string): string {
  switch (type) {
    case 'peer-unavailable':
      return 'Esa sala no existe (o el anfitrión se ha ido).';
    case 'unavailable-id':
      return 'No se pudo reservar un código de sala. Prueba otra vez.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'No se puede contactar con el servidor de emparejamiento. ¿Hay internet?';
    case 'browser-incompatible':
      return 'Tu navegador no soporta WebRTC. Prueba con Chrome o Firefox.';
    default:
      return `Error de conexión (${type ?? 'desconocido'})`;
  }
}
