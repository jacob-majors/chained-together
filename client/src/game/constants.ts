// Physics — Cannon-es, Y-up
export const PHYSICS_GRAVITY  = -30;
export const PLAYER_SPEED     = 13;      // top horizontal speed (units/s)
export const JUMP_VELOCITY    = 17;

// Acceleration: lerp factor toward target speed (normalised to 60 fps).
// Ground: snappy. Air: limited control but still responsive.
export const GROUND_ACCEL     = 0.30;
export const AIR_ACCEL        = 0.07;

// Fall-gravity multipliers applied on top of PHYSICS_GRAVITY each substep.
// Makes jumps feel punchy: fast up, faster down.
export const FALL_GRAV_MULT   = 2.0;    // extra gravity when vy < 0 (falling)
export const LOW_JUMP_MULT    = 1.2;    // extra when rising without holding Space

// Damping: switched per-frame so ground = crisp stop, air = free momentum
export const DAMPING_GROUND   = 0.82;
export const DAMPING_AIR      = 0.02;
export const ANGULAR_DAMPING  = 1.0;

// Sphere collision radius
export const PLAYER_RADIUS    = 0.45;

// Chain — two-pass PBD
export const MAX_ROPE_LENGTH  = 9;
export const ROPE_PRE_CORR    = 18;
export const ROPE_POST_CORR   = 0.78;

// Network
export const SEND_RATE_MS     = 33;

// Death / respawn
export const RESPAWN_DELAY    = 3000;
export const FALL_DEATH_Y     = -6;

// Camera
export const CAM_AZIMUTH_DEF  = 0;
export const CAM_ELEV_DEF     = 26;
export const CAM_DIST_DEF     = 14;
export const CAM_LERP         = 0.07;

// Chain visual
export const CHAIN_LINKS      = 10;
export const MAX_ROPES        = 3;

// Keep for any stale imports
export const LINEAR_DAMPING   = 0.02;
