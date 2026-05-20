export const PLAYER_COLORS = ['#FF4444', '#4488FF', '#44FF66', '#FFDD44'];

export interface PlayerState {
  id: string; name: string; color: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onGround: boolean; isDead: boolean; isReady: boolean;
  checkpointIndex: number; slotIndex: number;
}

// ── Level data ─────────────────────────────────────────────────────────────────
export interface PlatformData {
  id: string;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  type: 'static' | 'moving';
  color: string;
  moveX?: number; moveY?: number; moveZ?: number;
  speed?: number;
}
export interface HazardData   { x: number; y: number; z: number; w: number; h: number; d: number; type: 'spike' | 'lava'; }
export interface CheckpointData { x: number; y: number; z: number; index: number; }
export interface WindBoostData  { x: number; y: number; z: number; radius: number; height: number; strength: number; }
export interface PendulumData   { x: number; pivotY: number; z: number; length: number; swingAngle: number; speed: number; radius: number; }
export interface RotatingBarData { x: number; y: number; z: number; radius: number; barWidth: number; barHeight: number; speed: number; }
export interface CoopDoorData   { id: string; x: number; y: number; z: number; width: number; height: number; depth: number; activateRadius: number; }
export interface RisingLavaData { startY: number; speed: number; }

export interface LevelData {
  id: string; name: string;
  spawnX: number; spawnY: number; spawnZ: number;
  finishY: number;
  platforms:    PlatformData[];
  hazards:      HazardData[];
  checkpoints:  CheckpointData[];
  windBoosts:   WindBoostData[];
  pendulums:    PendulumData[];
  rotatingBars: RotatingBarData[];
  coopDoors:    CoopDoorData[];
  risingLava?:  RisingLavaData;
}

// ── Leaderboard ────────────────────────────────────────────────────────────────
export interface LeaderboardEntry { playerName: string; time: number; date: string; }

export function getLeaderboard(levelId: string): LeaderboardEntry[] {
  try { const r = localStorage.getItem(`lb_${levelId}`); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
export function saveLeaderboardEntry(levelId: string, entry: LeaderboardEntry) {
  const lb = getLeaderboard(levelId);
  lb.push(entry); lb.sort((a, b) => a.time - b.time);
  try { localStorage.setItem(`lb_${levelId}`, JSON.stringify(lb.slice(0, 20))); } catch {}
}
export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

// ── Level catalogue ────────────────────────────────────────────────────────────
export interface LevelInfo {
  id: string; name: string; description: string;
  difficulty: 1 | 2 | 3; accentColor: string; emoji: string;
}
export const LEVEL_CATALOGUE: LevelInfo[] = [
  { id: 'level1', name: 'The Ascent',         description: 'Ancient ruins above the clouds. Moving platforms, pendulums, wind boosts.',          difficulty: 1, accentColor: '#7A7570', emoji: '🏔️' },
  { id: 'level2', name: 'Freefall Funhouse',  description: 'Fall Guys–style chaos. Spinning bars, cooperative doors, colourful mayhem.',         difficulty: 2, accentColor: '#FF69B4', emoji: '🎪' },
  { id: 'level3', name: 'Sky Bridge',         description: 'Narrow cloud bridges high above the void. Wind channels and moving platforms.',       difficulty: 1, accentColor: '#55AAFF', emoji: '☁️' },
  { id: 'level4', name: 'Lava Run',           description: 'RISING LAVA! Never stop moving. Volcanic platforms over an inferno.',                  difficulty: 2, accentColor: '#FF5500', emoji: '🌋' },
  { id: 'level5', name: 'The Pinnacle',       description: 'Hardest level. Cosmic void, razor platforms, dual coop doors, and dual spinning bars.', difficulty: 3, accentColor: '#8833FF', emoji: '🌌' },
];
