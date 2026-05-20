# ⛓ Ascent Together

A browser-based 3D multiplayer co-op climbing platformer for 2–4 players. Each player is physically chained to their teammates — work together (or drag each other down) to reach the golden platform at the top.

Built with **Three.js + Cannon-es** for 3D physics rendering, **Socket.io** for real-time multiplayer, and **React + Vite** for the UI.

---

## Quick Start (local dev)

### Prerequisites
- Node.js 18+  
- npm 9+

### 1. Install dependencies

```bash
# Server
cd server && npm install

# Client (open a second terminal)
cd client && npm install
```

### 2. Run both servers

**Terminal 1 – backend:**
```bash
cd server
npm run dev
```

**Terminal 2 – frontend:**
```bash
cd client
npm run dev
```

Open **http://localhost:5173** in multiple browser tabs or windows.

---

## Controls

| Key | Action |
|-----|--------|
| `A` / `←` | Move left |
| `D` / `→` | Move right |
| `W` / `↑` / `Space` | Jump |

---

## Deploying

### Frontend → Vercel (free)

1. Push the repo to GitHub.
2. Import in [vercel.com](https://vercel.com) → **New Project**.
3. Set **Root Directory** to `client`.
4. Vercel auto-detects Vite — build command is `vite build`, output `dist`.
5. Add **Environment Variable**: `VITE_SERVER_URL=https://your-backend.up.railway.app`

### Backend → Railway ⭐ (best free option for WebSockets)

Railway gives $5/month free credit — more than enough for this server.

1. Create account at [railway.app](https://railway.app).
2. **New Project → Deploy from GitHub repo**.
3. Set **Root Directory**: `server`.
4. Railway auto-detects Node.js.
5. Add env vars in the Railway dashboard:
   - `PORT=3001`
   - `CLIENT_ORIGIN=https://your-app.vercel.app`
6. Railway natively supports WebSockets — no extra config needed.

### Backend → Render (alternative, free tier)

1. [render.com](https://render.com) → **New Web Service**.
2. Root directory: `server`
3. Build: `npm install && npm run build`
4. Start: `npm start`
5. Add env var: `CLIENT_ORIGIN=https://your-app.vercel.app`

> ⚠️ Render's free tier **spins down** after 15 min of inactivity (cold start ~30 s).  
> Railway is recommended for a better multiplayer experience.

---

## Character Model

The player characters are **procedurally built from BoxGeometry** — no external asset files needed. Each character has a head, body, arms, legs, and eyes in the player's team color.

### Upgrading to a real character model

To replace the blocky placeholder with a proper animated character:

1. Download a free GLTF character from:
   - **Kenney.nl** → [kenney.nl/assets/animated-characters](https://kenney.nl/assets/animated-characters)
   - **Mixamo** → [mixamo.com](https://mixamo.com) (free rigged + animated)
   - **Sketchfab** → filter by "free" + "GLTF"

2. In `client/src/game/GameCanvas.tsx`, replace `createCharacterMesh()` with a `GLTFLoader` call:
   ```ts
   import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
   const loader = new GLTFLoader();
   loader.load('/character.glb', (gltf) => {
     const model = gltf.scene;
     // ... setup AnimationMixer for walk/jump clips
   });
   ```

### Texture improvements (TODO)

| File | Purpose |
|------|---------|
| `playerSkin.png` (64×64) | UV-mapped face & body texture |
| `platform.png` (256×256) | Tileable stone/grass for platforms |
| `sky.hdr` | Equirectangular HDR sky |

---

## Game Systems

### Rope Physics
Players are linked by a soft distance constraint. When the distance between players exceeds `MAX_ROPE_LENGTH` (9 units), a velocity correction force pulls them together. The rope turns red when taut. A falling player can drag teammates — coordinate jumps!

### Camera
Follows the **average Y position** of all alive players, lerped smoothly. The camera pulls back when players spread out horizontally.

### Respawning
On death (hazard touch or falling below Y=-4), a 3-second timer plays, then the player respawns at the best checkpoint any teammate has reached.

### Moving Platforms
Sinusoidal X or Y oscillation. The physics body is kinematic — players slide realistically on the surface.

---

## Level Format (JSON)

Levels live in `client/src/game/levels/`. Add a new JSON file following this schema:

```jsonc
{
  "id": "level2",
  "name": "...",
  "spawnX": 0, "spawnY": 3, "spawnZ": 0,
  "finishY": 80,          // Y coordinate of the finish trigger
  "platforms": [
    { "id": "p1", "x": 0, "y": 0, "z": 0,
      "w": 12, "h": 1, "d": 4,
      "type": "static",   // or "moving"
      "color": "#7A5C3A",
      // moving only:
      "moveX": 5,         // amplitude in X
      "moveY": 0,         // amplitude in Y
      "speed": 1.2        // oscillation speed
    }
  ],
  "hazards": [
    { "x": 0, "y": -1, "z": 0, "w": 40, "h": 0.5, "d": 20, "type": "lava" },
    { "x": 2, "y": 5,  "z": 0, "w": 1,  "h": 0.5, "d": 2,  "type": "spike" }
  ],
  "checkpoints": [
    { "x": 0, "y": 20, "z": 0, "index": 0 }
  ]
}
```

---

## TODO

- [ ] GLTF character model with walk/jump animations
- [ ] Sound effects (jump, checkpoint, death, finish)
- [ ] Particle effects for checkpoints and deaths
- [ ] More levels
- [ ] Level select screen
- [ ] Player count limit enforcement in UI
- [ ] Spectator mode after finishing
- [ ] Leaderboard / fastest time tracking
- [ ] Mobile touch controls
- [ ] In-game chat
