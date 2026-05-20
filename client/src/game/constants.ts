// Physics — Cannon-es, Y-up
export const PHYSICS_GRAVITY  = -30;
export const PLAYER_SPEED     = 13;   // horizontal units/s
export const JUMP_VELOCITY    = 17;
// Ground damping is set dynamically per-frame (high on ground, low in air)
export const DAMPING_GROUND   = 0.80;  // quick stop when standing
export const DAMPING_AIR      = 0.05;  // barely any drag while airborne
export const ANGULAR_DAMPING  = 1.0;

// Sphere radius used for player collision body
export const PLAYER_RADIUS    = 0.45;
export const LINEAR_DAMPING   = 0.05; // kept for backwards compat — use DAMPING_* above

// Chain (two-pass PBD)
export const MAX_ROPE_LENGTH  = 9;    // world units
export const ROPE_PRE_CORR    = 18;   // impulse/s applied before physics step
export const ROPE_POST_CORR   = 0.78; // position correction alpha after step

// Network
export const SEND_RATE_MS     = 33;   // ~30 Hz

// Death / respawn
export const RESPAWN_DELAY    = 3000;
export const FALL_DEATH_Y     = -6;

// Camera
export const CAM_AZIMUTH_DEF  = 0;    // degrees
export const CAM_ELEV_DEF     = 26;   // degrees above horizon
export const CAM_DIST_DEF     = 14;   // units from player centre
export const CAM_LERP         = 0.07;

// Chain visual
export const CHAIN_LINKS      = 10;   // links per rope segment
export const MAX_ROPES        = 3;    // 4 players → 3 ropes
