import { io, Socket } from 'socket.io-client';

// Vite exposes env vars via import.meta.env. Fall back to localhost for dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? 'http://localhost:3001';

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    _socket.on('connect_error', (err) => {
      console.warn('[socket] connect error:', err.message);
    });
  }
  return _socket;
}
