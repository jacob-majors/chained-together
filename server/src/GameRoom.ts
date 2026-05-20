import { Server } from 'socket.io';
import { PlayerState, PLAYER_COLORS } from './types';

export class GameRoom {
  public code: string;
  public hostId: string;
  public gameStarted = false;
  public levelId = 'level1';
  public players = new Map<string, PlayerState>();

  private io: Server;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

  constructor(io: Server, hostId: string, code: string) {
    this.io = io;
    this.hostId = hostId;
    this.code = code;
  }

  addPlayer(socketId: string, name: string): PlayerState {
    const slotIndex = this.players.size;
    const player: PlayerState = {
      id: socketId,
      name: (name || `Player ${slotIndex + 1}`).slice(0, 16),
      color: PLAYER_COLORS[slotIndex % PLAYER_COLORS.length],
      x: slotIndex * 1.5, y: 3, z: 0,
      vx: 0, vy: 0, vz: 0,
      onGround: false,
      isDead: false,
      isReady: false,
      checkpointIndex: -1,
      slotIndex,
    };
    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId: string) {
    this.players.delete(socketId);

    if (this.hostId === socketId && this.players.size > 0) {
      this.hostId = [...this.players.keys()][0];
      this.io.to(this.code).emit('host_changed', { newHostId: this.hostId });
    }
  }

  receiveUpdate(socketId: string, partial: Partial<PlayerState>) {
    const player = this.players.get(socketId);
    if (!player) return;
    Object.assign(player, partial, { id: socketId, color: player.color, name: player.name });
  }

  startGame() {
    this.gameStarted = true;
    // Broadcast full state at 20 Hz so late-joined clients stay synced
    this.broadcastInterval = setInterval(() => {
      const stateObj: Record<string, PlayerState> = {};
      this.players.forEach((p, id) => { stateObj[id] = p; });
      this.io.to(this.code).emit('state_update', { players: stateObj });
    }, 50);
  }

  stopGame() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    this.gameStarted = false;
  }

  getPlayerList(): PlayerState[] {
    return [...this.players.values()];
  }

  isFull(): boolean {
    return this.players.size >= 4;
  }
}
