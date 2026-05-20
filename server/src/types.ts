export const PLAYER_COLORS = ['#FF4444', '#4488FF', '#44FF66', '#FFDD44'];

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  isDead: boolean;
  isReady: boolean;
  checkpointIndex: number;
  slotIndex: number;
}
