import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameRoom } from './GameRoom';
import { PlayerState } from './types';

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

// In-memory room map
const rooms = new Map<string, GameRoom>();

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function makeCode(): string {
  let code: string;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);
  let currentRoom: GameRoom | null = null;

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('create_room', ({ playerName, levelId }: { playerName: string; levelId?: string }) => {
    const code = makeCode();
    const room = new GameRoom(io, socket.id, code);
    if (levelId) room.levelId = levelId;
    rooms.set(code, room);

    const player = room.addPlayer(socket.id, playerName);
    socket.join(code);
    currentRoom = room;

    socket.emit('room_created', { roomCode: code, player, players: room.getPlayerList(), hostId: socket.id, levelId: room.levelId });
    console.log(`[room] ${socket.id} created ${code} (level: ${room.levelId})`);
  });

  // ── Join room ───────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) return socket.emit('join_error', { message: 'Room not found.' });
    if (room.isFull()) return socket.emit('join_error', { message: 'Room is full (max 4 players).' });
    if (room.gameStarted) return socket.emit('join_error', { message: 'Game already in progress.' });

    const player = room.addPlayer(socket.id, playerName);
    socket.join(code);
    currentRoom = room;

    socket.emit('room_joined', { roomCode: code, player, players: room.getPlayerList(), hostId: room.hostId, levelId: room.levelId });
    socket.to(code).emit('player_joined', { player });
    console.log(`[room] ${socket.id} joined ${code}`);
  });

  // ── Ready ───────────────────────────────────────────────────────────────────
  socket.on('set_ready', () => {
    if (!currentRoom) return;
    const p = currentRoom.players.get(socket.id);
    if (p) {
      p.isReady = true;
      io.to(currentRoom.code).emit('player_ready', { playerId: socket.id });
    }
  });

  // ── Change level (host only, lobby only) ──────────────────────────────────
  socket.on('change_level', ({ levelId }: { levelId: string }) => {
    if (!currentRoom || currentRoom.hostId !== socket.id || currentRoom.gameStarted) return;
    currentRoom.levelId = levelId;
    io.to(currentRoom.code).emit('level_changed', { levelId });
    console.log(`[room] ${currentRoom.code} level → ${levelId}`);
  });

  // ── Start game (host only) ──────────────────────────────────────────────────
  socket.on('start_game', () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    currentRoom.startGame();
    io.to(currentRoom.code).emit('game_start', { levelId: currentRoom.levelId });
    console.log(`[room] Game started in ${currentRoom.code}`);
  });

  // ── Player position update → relay immediately + accumulate for 20Hz tick ──
  socket.on('player_update', (state: Partial<PlayerState>) => {
    if (!currentRoom || !currentRoom.gameStarted) return;
    currentRoom.receiveUpdate(socket.id, state);
    socket.to(currentRoom.code).emit('player_update', { ...state, id: socket.id });
  });

  // ── Checkpoint ─────────────────────────────────────────────────────────────
  socket.on('checkpoint_reached', ({ checkpointIndex }: { checkpointIndex: number }) => {
    if (!currentRoom) return;
    const p = currentRoom.players.get(socket.id);
    if (p && checkpointIndex > p.checkpointIndex) {
      p.checkpointIndex = checkpointIndex;
      io.to(currentRoom.code).emit('checkpoint_reached', { playerId: socket.id, checkpointIndex });
    }
  });

  // ── Level complete ──────────────────────────────────────────────────────────
  socket.on('level_complete', () => {
    if (!currentRoom) return;
    io.to(currentRoom.code).emit('level_complete', { playerId: socket.id });
    currentRoom.stopGame();
    console.log(`[room] Level complete in ${currentRoom.code}`);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    if (!currentRoom) return;

    currentRoom.removePlayer(socket.id);
    socket.to(currentRoom.code).emit('player_left', { playerId: socket.id });

    if (currentRoom.players.size === 0) {
      currentRoom.stopGame();
      rooms.delete(currentRoom.code);
      console.log(`[room] ${currentRoom.code} deleted (empty)`);
    }
    currentRoom = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}  (CORS → ${CLIENT_ORIGIN})`);
});
