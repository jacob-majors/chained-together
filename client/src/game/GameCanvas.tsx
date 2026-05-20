/**
 * GameCanvas — authoritative client-side physics + Three.js rendering.
 *
 * Key fixes vs previous versions:
 *  • Camera is explicitly placed on frame 0 (no lerp on first frame).
 *  • Sphere collision body (radius 0.45) instead of Box — smooth, no edge-catching.
 *  • Character mesh offset corrected: feet sit at sphere bottom.
 *  • Chain uses two-pass PBD: velocity correction before step + position clamp after step.
 *    Both clients run the same code → bidirectional pull without extra socket events.
 *  • Rising lava for level 4: lava hazard animates upward; player dies if caught.
 *  • Particle burst pool (40 spheres, zero allocation per frame).
 *  • Screen shake on death.
 *  • All 5 levels supported via dynamic import map.
 *  • Errors in the useEffect are caught and shown on-screen instead of blue void.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LevelData, formatTime } from '../types';
import { getSocket } from '../socket';
import level1 from './levels/level1.json';
import level2 from './levels/level2.json';
import level3 from './levels/level3.json';
import level4 from './levels/level4.json';
import level5 from './levels/level5.json';
import {
  PHYSICS_GRAVITY, PLAYER_SPEED, JUMP_VELOCITY, DAMPING_GROUND, DAMPING_AIR, ANGULAR_DAMPING,
  PLAYER_RADIUS,
  MAX_ROPE_LENGTH, ROPE_PRE_CORR, ROPE_POST_CORR,
  SEND_RATE_MS, RESPAWN_DELAY, FALL_DEATH_Y,
  CAM_AZIMUTH_DEF, CAM_ELEV_DEF, CAM_DIST_DEF, CAM_LERP,
  CHAIN_LINKS, MAX_ROPES,
} from './constants';
import { PlayerState } from '../types';

// Extend with optional mechanics
interface ExtLevel extends LevelData {
  risingLava?: { startY: number; speed: number };
}

const LEVELS: Record<string, ExtLevel> = {
  level1: level1 as unknown as ExtLevel,
  level2: level2 as unknown as ExtLevel,
  level3: level3 as unknown as ExtLevel,
  level4: level4 as unknown as ExtLevel,
  level5: level5 as unknown as ExtLevel,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();

function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  _va.subVectors(b, a); _vb.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _vb.dot(_va) / _va.dot(_va)));
  _vc.copy(a).addScaledVector(_va, t);
  return p.distanceTo(_vc);
}

function hexC(h: string): number { return parseInt(h.replace('#', ''), 16); }
function darken(c: number, amt = 0x282828): number { return Math.max(0, c - amt); }

/** Fall-Guys–style rounded blob. Swap with GLTFLoader for a real character. */
function makeBlobChar(colorHex: string): THREE.Group {
  const g = new THREE.Group();
  const c = hexC(colorHex), d = darken(c);
  const toon = (col: number) => new THREE.MeshToonMaterial({ color: col });

  // Body capsule
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.38, 4, 10), toon(c));
  body.position.y = 0.72; body.castShadow = true;
  g.add(body);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 12, 9), toon(c));
  head.position.y = 1.40; head.castShadow = true;
  g.add(head);
  // Arms
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 3, 8), toon(d));
    arm.position.set(sx * 0.50, 0.84, 0);
    arm.rotation.z = sx * 0.5;
    arm.castShadow = true; g.add(arm);
  }
  // Legs
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 3, 8), toon(d));
    leg.position.set(sx * 0.19, 0.22, 0);
    leg.castShadow = true; g.add(leg);
  }
  // Eyes
  const ew = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ep = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const sx of [-1, 1]) {
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.072, 6, 6), ew);
    e1.position.set(sx * 0.115, 1.47, 0.25); g.add(e1);
    const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.042, 4, 4), ep);
    e2.position.set(sx * 0.115, 1.46, 0.29); g.add(e2);
  }
  return g;
}

function makeLabel(name: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d')!;
  cx.fillStyle = 'rgba(0,0,0,0.62)'; cx.roundRect(4, 4, 248, 56, 12); cx.fill();
  cx.font = 'bold 26px sans-serif'; cx.fillStyle = color;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(name.slice(0, 14), 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(2.8, 0.7, 1);
  return sp;
}

interface RemoteEntry {
  mesh: THREE.Group; label: THREE.Sprite;
  targetPos: THREE.Vector3; velocity: THREE.Vector3;
  state: PlayerState; lastSeq: number;
}

// ── Particle pool entry ───────────────────────────────────────────────────────
interface Particle { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; maxLife: number; }

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  levelId: string;
  localPlayer: PlayerState;
  initialPlayers: PlayerState[];
  roomCode: string;
  onGameEnd: (msg: string, time: number) => void;
}

const GameCanvas: React.FC<Props> = ({ levelId, localPlayer, initialPlayers, roomCode, onGameEnd }) => {
  const mountRef   = useRef<HTMLDivElement>(null);
  const miniRef    = useRef<HTMLCanvasElement>(null);
  const hudRef     = useRef<HTMLDivElement>(null);
  const alertRef   = useRef<HTMLDivElement>(null);
  const errRef     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const socket    = getSocket();

    try {
      runGame(container, socket, levelId, localPlayer, initialPlayers, roomCode, onGameEnd,
              miniRef, hudRef, alertRef);
    } catch (err) {
      console.error('[GameCanvas] fatal:', err);
      if (errRef.current) {
        errRef.current.style.display = 'flex';
        errRef.current.textContent   = `Game error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Cleanup stored by runGame on the container element
    return () => {
      const c = container as HTMLDivElement & { _cleanup?: () => void };
      c._cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Mini-map */}
      <canvas ref={miniRef} width={130} height={200} style={{
        position: 'absolute', top: 12, left: 12, borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.18)', pointerEvents: 'none',
      }} />
      <div style={{ position: 'absolute', top: 218, left: 12, fontFamily: 'monospace', fontSize: 10, color: '#555', width: 130, textAlign: 'center', pointerEvents: 'none' }}>
        MAP · ▲ UP
      </div>

      {/* HUD */}
      <div ref={hudRef} style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        fontFamily: 'monospace', fontSize: 13, color: '#fff',
        background: 'rgba(0,0,0,0.65)', borderRadius: 8, padding: '6px 18px',
        pointerEvents: 'none', whiteSpace: 'nowrap',
      }} />

      {/* Controls */}
      <div style={{
        position: 'absolute', top: 12, right: 12, fontFamily: 'monospace', fontSize: 11, color: '#ccc',
        background: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: '6px 12px',
        lineHeight: 1.9, pointerEvents: 'none',
      }}>
        WASD — move · Space/W — jump<br />
        Mouse drag — rotate cam · Scroll — zoom<br />
        🔗 Chain pulls both players!
      </div>

      {/* Respawn / coop alert */}
      <div ref={alertRef} style={{
        display: 'none', position: 'absolute', top: '48%', left: '50%',
        transform: 'translate(-50%,-50%)',
        fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: '#FF6666',
        background: 'rgba(0,0,0,0.82)', borderRadius: 12, padding: '14px 36px', pointerEvents: 'none',
      }} />

      {/* Error display */}
      <div ref={errRef} style={{
        display: 'none', position: 'absolute', top: '40%', left: '50%',
        transform: 'translate(-50%,-50%)',
        fontFamily: 'monospace', fontSize: 15, color: '#FF8888',
        background: 'rgba(0,0,0,0.9)', borderRadius: 10, padding: '20px 30px',
        maxWidth: 480, textAlign: 'center',
      }} />

      {/* Player badge */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        fontFamily: 'monospace', fontSize: 13,
        background: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: '8px 16px', pointerEvents: 'none',
      }}>
        <span style={{ color: localPlayer.color, fontWeight: 700 }}>⬤ {localPlayer.name} (you)</span>
      </div>
    </div>
  );
};

// ── Main game function (isolated so errors can be caught) ──────────────────────
function runGame(
  container:     HTMLDivElement,
  socket:        ReturnType<typeof getSocket>,
  levelId:       string,
  localPlayer:   PlayerState,
  initialPlayers: PlayerState[],
  roomCode:      string,
  onGameEnd:     Props['onGameEnd'],
  miniRef:       React.RefObject<HTMLCanvasElement>,
  hudRef:        React.RefObject<HTMLDivElement>,
  alertRef:      React.RefObject<HTMLDivElement>,
) {
  const levelData = LEVELS[levelId] ?? LEVELS['level1'];

  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // ── Scene & camera ────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87DAFF);
  scene.fog = new THREE.Fog(0x87DAFF, 70, 220);

  const camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 300);
  // Explicit initial position so frame-0 renders correctly
  camera.position.set(
    levelData.spawnX,
    levelData.spawnY + 9,
    levelData.spawnZ + CAM_DIST_DEF
  );
  camera.lookAt(levelData.spawnX, levelData.spawnY + 1, levelData.spawnZ);

  // ── Lights ────────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xfff8e0, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(12, 30, 14); sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -45;
  sun.shadow.camera.right = sun.shadow.camera.top   =  45;
  sun.shadow.camera.far = 250;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87DAFF, 0x558844, 0.5));

  // Clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.86 });
  for (let i = 0; i < 30; i++) {
    const cl = new THREE.Mesh(new THREE.BoxGeometry(4 + Math.random() * 10, 1.5 + Math.random() * 2, 4), cloudMat);
    cl.position.set((Math.random() - 0.5) * 90, 5 + Math.random() * 90, -16 - Math.random() * 30);
    cl.matrixAutoUpdate = false; cl.updateMatrix();
    scene.add(cl);
  }

  // ── Cannon-es world ───────────────────────────────────────────────────────
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYSICS_GRAVITY, 0) });
  world.broadphase  = new CANNON.SAPBroadphase(world);
  world.allowSleep  = false;
  const defMat = new CANNON.Material('def');
  world.addContactMaterial(new CANNON.ContactMaterial(defMat, defMat, { friction: 0.4, restitution: 0 }));
  world.defaultContactMaterial.friction = 0.4;

  // ── Level geometry ────────────────────────────────────────────────────────
  const grassMat = new THREE.MeshToonMaterial({ color: 0x55bb30 });
  const movPlats: Array<{ body: CANNON.Body; mesh: THREE.Mesh; p: LevelData['platforms'][number]; sx: number; sy: number; sz: number }> = [];

  for (const p of levelData.platforms) {
    const geo  = new THREE.BoxGeometry(p.w, p.h, p.d);
    const mat  = new THREE.MeshToonMaterial({ color: hexC(p.color) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, p.y, p.z);
    mesh.receiveShadow = true;

    if (p.type === 'static' && !['#FFD700','#B08000'].includes(p.color)) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.13, p.d), grassMat);
      cap.position.set(p.x, p.y + p.h / 2 + 0.065, p.z);
      cap.matrixAutoUpdate = false; cap.updateMatrix();
      scene.add(cap);
    }
    if (p.type === 'moving') {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(p.w, 0.12, p.d),
        new THREE.MeshBasicMaterial({ color: 0xFFCC00 })
      );
      stripe.position.y = p.h / 2 + 0.06;
      mesh.add(stripe);
    }

    const body = new CANNON.Body({ mass: 0, material: defMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(p.w / 2, p.h / 2, p.d / 2)));
    body.position.set(p.x, p.y, p.z);
    if (p.type === 'moving') {
      body.type = CANNON.Body.KINEMATIC;
      movPlats.push({ body, mesh, p, sx: p.x, sy: p.y, sz: p.z });
      mesh.matrixAutoUpdate = true;
    } else {
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    }
    world.addBody(body); scene.add(mesh);
  }

  // Hazards
  let lavaMesh: THREE.Mesh | null = null;
  let lavaY = levelData.risingLava?.startY ?? -999;

  for (const h of levelData.hazards) {
    if (h.type === 'lava') {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(h.w, h.h, h.d),
        new THREE.MeshBasicMaterial({ color: 0xFF5500 })
      );
      m.position.set(h.x, h.y, h.z);
      scene.add(m);
      if (levelData.risingLava && !lavaMesh) {
        lavaY = levelData.risingLava.startY;
        m.position.y = lavaY;
        lavaMesh = m;
      } else {
        m.matrixAutoUpdate = false; m.updateMatrix();
      }
      // Glow ring above lava
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(h.w + 2, 0.15, h.d + 2),
        new THREE.MeshBasicMaterial({ color: 0xFF8800, transparent: true, opacity: 0.35 })
      );
      glow.position.set(h.x, h.y + 0.3, h.z);
      glow.matrixAutoUpdate = false; glow.updateMatrix();
      scene.add(glow);
    } else {
      // Spikes
      const cnt = Math.max(1, Math.floor(h.w / 0.7));
      const sm  = new THREE.MeshToonMaterial({ color: 0xCC2222 });
      const sg  = new THREE.ConeGeometry(0.22, 0.65, 4);
      for (let i = 0; i < cnt; i++) {
        const s = new THREE.Mesh(sg, sm);
        s.position.set(h.x - h.w / 2 + 0.35 + i * (h.w / cnt), h.y + 0.33, h.z);
        s.matrixAutoUpdate = false; s.updateMatrix();
        scene.add(s);
      }
    }
  }

  // Wind boosts
  const windMat = new THREE.MeshBasicMaterial({ color: 0x00EEFF, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
  for (const wb of levelData.windBoosts) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(wb.radius, wb.radius, wb.height, 12, 1, true), windMat);
    c.position.set(wb.x, wb.y, wb.z); c.matrixAutoUpdate = false; c.updateMatrix(); scene.add(c);
    const ar = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0x00FFFF }));
    ar.position.set(wb.x, wb.y - wb.height / 2 + 0.4, wb.z); ar.matrixAutoUpdate = false; ar.updateMatrix(); scene.add(ar);
  }

  // Pendulums
  const pendMeshes: THREE.Mesh[] = [];
  for (const pd of levelData.pendulums) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(pd.radius, 10, 8), new THREE.MeshToonMaterial({ color: 0x333333 }));
    scene.add(m); pendMeshes.push(m);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, pd.length * 1.2, 6), new THREE.MeshLambertMaterial({ color: 0x666666 }));
    pole.position.set(pd.x, pd.pivotY - pd.length * 0.6, pd.z);
    pole.matrixAutoUpdate = false; pole.updateMatrix(); scene.add(pole);
  }

  // Rotating bars
  const barMeshes: THREE.Mesh[] = [];
  const barMat   = new THREE.MeshToonMaterial({ color: 0x222233 });
  for (const rb of levelData.rotatingBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(rb.radius * 2, rb.barHeight, rb.barWidth), barMat);
    bar.position.set(rb.x, rb.y, rb.z); scene.add(bar); barMeshes.push(bar);
    const piv = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshToonMaterial({ color: 0xFF4400 }));
    piv.position.set(rb.x, rb.y, rb.z); piv.matrixAutoUpdate = false; piv.updateMatrix(); scene.add(piv);
  }

  // Coop doors
  interface DoorState { open: boolean; prog: number }
  const doorStates: DoorState[]  = levelData.coopDoors.map(() => ({ open: false, prog: 0 }));
  const doorMeshes: THREE.Mesh[] = [];
  for (const d of levelData.coopDoors) {
    const dm = new THREE.Mesh(
      new THREE.BoxGeometry(d.width, d.height, d.depth),
      new THREE.MeshToonMaterial({ color: 0xEE2200, transparent: true, opacity: 0.88 })
    );
    dm.position.set(d.x, d.y + d.height / 2, d.z);
    scene.add(dm); doorMeshes.push(dm);
    const lbl = makeLabel('Both players needed!', '#FF9988');
    lbl.position.set(d.x, d.y + d.height + 1.5, d.z);
    lbl.matrixAutoUpdate = false; lbl.updateMatrix(); scene.add(lbl);
  }

  // Checkpoints
  for (const cp of levelData.checkpoints) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), new THREE.MeshLambertMaterial({ color: 0xCCCCCC }));
    pole.position.set(cp.x - 0.3, cp.y + 0.8, cp.z); pole.matrixAutoUpdate = false; pole.updateMatrix(); scene.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), new THREE.MeshToonMaterial({ color: 0xFFD700 }));
    flag.position.set(cp.x + 0.2, cp.y + 1.9, cp.z); flag.matrixAutoUpdate = false; flag.updateMatrix(); scene.add(flag);
  }

  // Finish ring
  const finRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 6, 24), new THREE.MeshBasicMaterial({ color: 0xFFD700 }));
  finRing.position.set(0, levelData.finishY + 2, 0); finRing.rotation.x = Math.PI / 2; scene.add(finRing);
  for (let i = 0; i < 5; i++) {
    const st = new THREE.Mesh(new THREE.SphereGeometry(0.16, 5, 5), new THREE.MeshBasicMaterial({ color: 0xFFEE00 }));
    const a  = (i / 5) * Math.PI * 2;
    st.position.set(Math.cos(a) * 2.4, levelData.finishY + 2, Math.sin(a) * 2.4);
    scene.add(st);
  }

  // ── Local player ───────────────────────────────────────────────────────────
  const spawnX = levelData.spawnX + localPlayer.slotIndex * 1.5;
  const spawnY = levelData.spawnY;
  const spawnZ = levelData.spawnZ ?? 0;

  const localMesh = makeBlobChar(localPlayer.color);
  localMesh.position.set(spawnX, spawnY, spawnZ);
  scene.add(localMesh);
  const ll = makeLabel(localPlayer.name + ' (you)', localPlayer.color);
  ll.position.y = 2.6; localMesh.add(ll);

  // Sphere body — smoother than box, no edge-catching
  const playerBody = new CANNON.Body({
    mass: 1, material: defMat,
    linearDamping: DAMPING_AIR, angularDamping: ANGULAR_DAMPING, fixedRotation: true,
  });
  playerBody.addShape(new CANNON.Sphere(PLAYER_RADIUS));
  playerBody.position.set(spawnX, spawnY + PLAYER_RADIUS, spawnZ);
  world.addBody(playerBody);

  // Ground detection via collision events + coyote time
  let groundTimer = 0;
  playerBody.addEventListener('collide', (ev: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
    const c = ev.contact;
    const yDir = c.bi === playerBody ? -1 : 1;
    if (c.ni.y * yDir > 0.4) groundTimer = 0.22;
  });
  let jumpBuf       = 0;    // jump buffer window
  let wasOnGround   = false; // for landing-particle detection

  // ── Remote players ─────────────────────────────────────────────────────────
  const remoteMap = new Map<string, RemoteEntry>();
  function addRemote(p: PlayerState) {
    if (p.id === localPlayer.id || remoteMap.has(p.id)) return;
    const mesh = makeBlobChar(p.color);
    mesh.position.set(p.x, p.y, p.z ?? 0);
    const lbl = makeLabel(p.name, p.color); lbl.position.y = 2.6; mesh.add(lbl);
    scene.add(mesh);
    remoteMap.set(p.id, {
      mesh, label: lbl,
      targetPos: new THREE.Vector3(p.x, p.y, p.z ?? 0),
      velocity:  new THREE.Vector3(p.vx ?? 0, p.vy ?? 0, p.vz ?? 0),
      state: { ...p }, lastSeq: -1,
    });
  }
  function removeRemote(id: string) {
    const e = remoteMap.get(id);
    if (!e) return;
    e.mesh.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    scene.remove(e.mesh); remoteMap.delete(id);
  }
  for (const p of initialPlayers) addRemote(p);

  // ── Chain links (pre-allocated) ───────────────────────────────────────────
  const linkGeo  = new THREE.CylinderGeometry(0.055, 0.055, 0.36, 6, 1);
  const ropeMats = Array.from({ length: MAX_ROPES }, () => new THREE.MeshLambertMaterial({ color: 0x999999 }));
  const chainLinks: THREE.Mesh[] = [];
  for (let i = 0; i < CHAIN_LINKS * MAX_ROPES; i++) {
    const m = new THREE.Mesh(linkGeo, ropeMats[Math.floor(i / CHAIN_LINKS)]);
    m.visible = false; m.castShadow = false; scene.add(m); chainLinks.push(m);
  }
  const _lk = new THREE.Vector3();
  function drawChain(p1: THREE.Vector3, p2: THREE.Vector3, dist: number, ri: number) {
    const tension = Math.min(1, Math.max(0, (dist - MAX_ROPE_LENGTH * 0.65) / (MAX_ROPE_LENGTH * 0.4)));
    const mat = ropeMats[ri];
    if      (tension > 0.75) mat.color.setHex(0xDD2200);
    else if (tension > 0.35) mat.color.setHex(0xFF9900);
    else                     mat.color.setHex(0x999999);
    const sag = Math.max(0, (MAX_ROPE_LENGTH - dist) * 0.26);
    const off = ri * CHAIN_LINKS;
    for (let i = 0; i < CHAIN_LINKS; i++) {
      const t  = (i + 0.5) / CHAIN_LINKS;
      const lk = chainLinks[off + i];
      lk.position.set(
        p1.x + (p2.x - p1.x) * t,
        p1.y + (p2.y - p1.y) * t - Math.sin(t * Math.PI) * sag + 0.9,
        p1.z + (p2.z - p1.z) * t
      );
      const nt = Math.min(1, (i + 1.5) / CHAIN_LINKS);
      _lk.set(
        p1.x + (p2.x - p1.x) * nt,
        p1.y + (p2.y - p1.y) * nt - Math.sin(nt * Math.PI) * sag + 0.9,
        p1.z + (p2.z - p1.z) * nt
      );
      lk.lookAt(_lk); lk.rotateX(Math.PI / 2);
      if (i % 2 === 0) lk.rotateY(Math.PI / 2);
      lk.visible = true;
    }
  }
  function hideChain(ri: number) {
    const off = ri * CHAIN_LINKS;
    for (let i = 0; i < CHAIN_LINKS; i++) chainLinks[off + i].visible = false;
  }

  // ── Particle pool ─────────────────────────────────────────────────────────
  const pGeo  = new THREE.SphereGeometry(0.09, 4, 4);
  const pPool: Particle[] = [];
  for (let i = 0; i < 50; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ transparent: true }));
    m.visible = false; scene.add(m);
    pPool.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
  }
  function burst(x: number, y: number, z: number, color: number, n: number) {
    let used = 0;
    for (const p of pPool) {
      if (p.life > 0 || used >= n) continue;
      p.mesh.position.set(x, y, z);
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      p.vx = (Math.random() - 0.5) * 6; p.vy = Math.random() * 5 + 1; p.vz = (Math.random() - 0.5) * 6;
      p.maxLife = 0.35 + Math.random() * 0.3; p.life = 0.001;
      p.mesh.visible = true; used++;
    }
  }
  function tickParticles(dt: number) {
    for (const p of pPool) {
      if (p.life <= 0) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.life = 0; p.mesh.visible = false; continue; }
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.vy -= 14 * dt;
      const t = p.life / p.maxLife;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      p.mesh.scale.setScalar(1 - t * 0.7);
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  const keys = new Set<string>();
  const onKD = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    // Space is the dedicated jump key — W/ArrowUp are movement only
    if (e.code === 'Space') jumpBuf = 0.14;
  };
  const onKU = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', onKD); window.addEventListener('keyup', onKU);

  // ── Orbit camera ──────────────────────────────────────────────────────────
  let camAz   = CAM_AZIMUTH_DEF;
  let camEl   = CAM_ELEV_DEF;
  let camDist = CAM_DIST_DEF;
  let drag = false, prevMX = 0, prevMY = 0;

  const onMD  = (e: MouseEvent) => { drag = true; prevMX = e.clientX; prevMY = e.clientY; };
  const onMU  = () => { drag = false; };
  const onMM  = (e: MouseEvent) => {
    if (!drag) return;
    camAz += (e.clientX - prevMX) * 0.45;
    camEl = Math.max(8, Math.min(58, camEl - (e.clientY - prevMY) * 0.3));
    prevMX = e.clientX; prevMY = e.clientY;
  };
  const onWh  = (e: WheelEvent) => { camDist = Math.max(6, Math.min(28, camDist + e.deltaY * 0.015)); };
  let prevTX = 0, prevTY = 0;
  const onTS = (e: TouchEvent) => { prevTX = e.touches[0].clientX; prevTY = e.touches[0].clientY; };
  const onTM = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    camAz += (e.touches[0].clientX - prevTX) * 0.45;
    camEl = Math.max(8, Math.min(58, camEl - (e.touches[0].clientY - prevTY) * 0.3));
    prevTX = e.touches[0].clientX; prevTY = e.touches[0].clientY;
  };
  renderer.domElement.addEventListener('mousedown', onMD);
  window.addEventListener('mouseup', onMU); window.addEventListener('mousemove', onMM);
  renderer.domElement.addEventListener('wheel', onWh, { passive: true });
  renderer.domElement.addEventListener('touchstart', onTS, { passive: true });
  renderer.domElement.addEventListener('touchmove',  onTM, { passive: true });

  // Camera lerp targets
  const camPos  = new THREE.Vector3(spawnX, spawnY + 9, spawnZ + CAM_DIST_DEF);
  const camLook = new THREE.Vector3(spawnX, spawnY + 1, spawnZ);
  let   firstFrame = true;

  // Screen shake
  let shakeAmt = 0, shakeTmr = 0;
  function triggerShake(a: number, d: number) { shakeAmt = a; shakeTmr = d; }

  // ── Game state ────────────────────────────────────────────────────────────
  let isDead = false, respawnCD = 0, lastCP = -1, levelComplete = false;
  let lastSent = 0, sendSeq = 0, platTime = 0, accumulator = 0;
  const FIXED_DT = 1 / 60;
  const gameStartMs = performance.now();

  // ── Socket listeners ──────────────────────────────────────────────────────
  socket.on('player_joined', ({ player }: { player: PlayerState }) => addRemote(player));
  socket.on('player_left',   ({ playerId }: { playerId: string }) => removeRemote(playerId));
  socket.on('player_update', (s: PlayerState & { seq?: number }) => {
    const e = remoteMap.get(s.id);
    if (!e) return;
    if (s.seq !== undefined && s.seq <= e.lastSeq) return;
    if (s.seq !== undefined) e.lastSeq = s.seq;
    e.velocity.set(s.vx ?? 0, s.vy ?? 0, s.vz ?? 0);
    e.targetPos.set(s.x, s.y, s.z ?? 0);
    e.state = { ...s }; e.mesh.visible = !s.isDead;
  });
  socket.on('state_update', ({ players }: { players: Record<string, PlayerState> }) => {
    for (const [id, ps] of Object.entries(players)) {
      if (id === localPlayer.id) continue;
      const e = remoteMap.get(id); if (!e) continue;
      e.velocity.set(ps.vx ?? 0, ps.vy ?? 0, ps.vz ?? 0);
      e.targetPos.set(ps.x, ps.y, ps.z ?? 0);
      e.state = { ...ps }; e.mesh.visible = !ps.isDead;
    }
  });
  socket.on('level_complete', ({ playerId }: { playerId: string }) => {
    if (levelComplete) return;
    levelComplete = true;
    const t   = (performance.now() - gameStartMs) / 1000;
    const who = playerId === localPlayer.id ? 'You' : (remoteMap.get(playerId)?.state.name ?? 'A teammate');
    onGameEnd(`${who} reached the top! 🏆`, t);
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function inHazard(pos: THREE.Vector3): boolean {
    const ry = levelData.risingLava ? lavaY : -999;
    if (pos.y < ry + PLAYER_RADIUS + 0.2) return true;
    for (const h of levelData.hazards) {
      if (h.type === 'lava' && levelData.risingLava) continue; // handled via rising lava
      if (Math.abs(pos.x - h.x) < h.w / 2 + PLAYER_RADIUS &&
          Math.abs(pos.y - h.y) < h.h / 2 + PLAYER_RADIUS &&
          Math.abs(pos.z - h.z) < h.d / 2 + PLAYER_RADIUS) return true;
    }
    return false;
  }

  function killPlayer() {
    if (isDead || levelComplete) return;
    isDead = true; respawnCD = RESPAWN_DELAY;
    localMesh.visible = false;
    burst(localMesh.position.x, localMesh.position.y, localMesh.position.z, 0xFF3300, 16);
    triggerShake(0.35, 0.5);
    socket.emit('player_update', { isDead: true, seq: sendSeq++ });
  }

  function respawnPlayer() {
    let best = lastCP;
    remoteMap.forEach(e => { if (e.state.checkpointIndex > best) best = e.state.checkpointIndex; });
    let rx = spawnX, ry = spawnY, rz = spawnZ;
    if (best >= 0 && best < levelData.checkpoints.length) {
      const cp = levelData.checkpoints[best]; rx = cp.x; ry = cp.y + 2.5; rz = cp.z ?? 0;
    }
    playerBody.position.set(rx, ry + PLAYER_RADIUS, rz);
    playerBody.velocity.set(0, 0, 0);
    localMesh.position.set(rx, ry, rz);
    localMesh.visible = true;
    isDead = false; groundTimer = 0;
    burst(rx, ry + 1, rz, 0x44FF88, 12);
    socket.emit('player_update', { isDead: false, x: rx, y: ry, z: rz, vx: 0, vy: 0, vz: 0, seq: sendSeq++ });
  }

  // ── Mini-map ──────────────────────────────────────────────────────────────
  const MWORLD_W = 32, MWORLD_H = levelData.finishY + 8;
  function drawMiniMap() {
    const mc = miniRef.current; if (!mc) return;
    const ctx = mc.getContext('2d'); if (!ctx) return;
    const W = mc.width, H = mc.height;
    const mx = (wx: number) => (wx + MWORLD_W / 2) / MWORLD_W * W;
    const my = (wy: number) => H - wy / MWORLD_H * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W-1, H-1);
    // Finish
    ctx.fillStyle = '#FFD700'; ctx.fillRect(0, my(levelData.finishY) - 1, W, 2);
    // Platforms
    for (const p of levelData.platforms) {
      ctx.fillStyle = p.color;
      ctx.fillRect(mx(p.x - p.w/2), my(p.y + p.h/2), (p.w/MWORLD_W)*W, Math.max(2, (p.h/MWORLD_H)*H));
    }
    // Rising lava
    if (levelData.risingLava && lavaY > -100) {
      ctx.fillStyle = 'rgba(255,100,0,0.7)';
      ctx.fillRect(0, my(lavaY + 1), W, H - my(lavaY + 1));
    }
    // Checkpoints
    ctx.fillStyle = '#FFD700';
    for (const cp of levelData.checkpoints) ctx.fillRect(mx(cp.x) - 3, my(cp.y) - 2, 6, 3);
    // Camera viewport hint
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    ctx.strokeRect(0, my(localMesh.position.y + 14), W, my(localMesh.position.y - 4) - my(localMesh.position.y + 14));
    // Remote players
    remoteMap.forEach(e => {
      if (e.state.isDead) return;
      ctx.fillStyle = e.state.color;
      ctx.beginPath(); ctx.arc(mx(e.mesh.position.x), my(e.mesh.position.y), 3.5, 0, Math.PI*2); ctx.fill();
    });
    // Local player
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(mx(localMesh.position.x), my(localMesh.position.y), 6, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = localPlayer.color;
    ctx.beginPath(); ctx.arc(mx(localMesh.position.x), my(localMesh.position.y), 4, 0, Math.PI*2); ctx.fill();
  }

  // ── Game loop ─────────────────────────────────────────────────────────────
  let animId = 0, prevTime = performance.now();

  function loop(now: number) {
    animId = requestAnimationFrame(loop);
    const frameMs = Math.min(now - prevTime, 50);
    prevTime = now;
    const realDt = frameMs / 1000;

    finRing.rotation.z += realDt * 1.1;

    // Respawn countdown
    if (isDead) {
      respawnCD -= frameMs;
      if (alertRef.current) {
        alertRef.current.style.display = 'flex';
        alertRef.current.textContent   = `💀 Respawning in ${Math.ceil(respawnCD / 1000)}…`;
      }
      if (respawnCD <= 0) { if (alertRef.current) alertRef.current.style.display = 'none'; respawnPlayer(); }
      updateCamera(realDt); tickParticles(realDt);
      renderer.render(scene, camera); drawMiniMap();
      return;
    }
    if (alertRef.current) alertRef.current.style.display = 'none';
    if (levelComplete) { renderer.render(scene, camera); return; }

    // Ground + jump buffer timers
    groundTimer = Math.max(0, groundTimer - realDt);
    jumpBuf     = Math.max(0, jumpBuf     - realDt);
    const onGround = groundTimer > 0;

    // Landing particle
    if (onGround && !wasOnGround) {
      burst(localMesh.position.x, localMesh.position.y, localMesh.position.z, 0xCCBB88, 6);
    }
    wasOnGround = onGround;

    // ── Camera-relative 3-D movement ──────────────────────────────────────────
    const azRad = camAz * (Math.PI / 180);
    const fwdX = Math.sin(azRad), fwdZ = Math.cos(azRad);
    const rgtX = -fwdZ, rgtZ = fwdX;

    let mvX = 0, mvZ = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp'))    { mvX += fwdX; mvZ += fwdZ; }
    if (keys.has('KeyS') || keys.has('ArrowDown'))  { mvX -= fwdX; mvZ -= fwdZ; }
    if (keys.has('KeyA') || keys.has('ArrowLeft'))  { mvX -= rgtX; mvZ -= rgtZ; }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { mvX += rgtX; mvZ += rgtZ; }

    if (mvX !== 0 || mvZ !== 0) {
      const len = Math.sqrt(mvX * mvX + mvZ * mvZ);
      playerBody.velocity.x = (mvX / len) * PLAYER_SPEED;
      playerBody.velocity.z = (mvZ / len) * PLAYER_SPEED;
      localMesh.rotation.y  = Math.atan2(-mvZ, mvX) + Math.PI / 2;
      // Leg/arm walk animation
      const bob = Math.sin(now * 0.014) * 0.2;
      const ch = localMesh.children;
      if (ch[3]) ch[3].position.y = 0.22 + bob * 0.5;
      if (ch[4]) ch[4].position.y = 0.22 - bob * 0.5;
    }

    // Jump
    if (jumpBuf > 0 && onGround) {
      playerBody.velocity.y = JUMP_VELOCITY;
      jumpBuf = 0; groundTimer = 0;
    }
    // Variable height: cut on release
    // Variable jump height: only gentle cut, only if Space released while still rising fast
    if (!keys.has('Space') && playerBody.velocity.y > 10) playerBody.velocity.y *= 0.92;

    // Switch damping based on ground contact (crisp stop on ground, free flight in air)
    playerBody.linearDamping = onGround ? DAMPING_GROUND : DAMPING_AIR;

    // ── Chain constraint — PRE-STEP (velocity) ─────────────────────────────
    let ri = 0;
    remoteMap.forEach(entry => {
      if (entry.state.isDead || isDead) { hideChain(ri++); return; }

      const dx = entry.targetPos.x - playerBody.position.x;
      const dy = entry.targetPos.y - playerBody.position.y;
      const dz = entry.targetPos.z - playerBody.position.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

      drawChain(localMesh.position, entry.targetPos, dist, ri++);

      if (dist > MAX_ROPE_LENGTH) {
        const inv = 1 / dist;
        const nx = dx * inv, ny = dy * inv, nz = dz * inv;
        const overshoot = dist - MAX_ROPE_LENGTH;

        // 1. Zero velocity component moving AWAY from partner (hard clamp)
        const vAway = -(playerBody.velocity.x * nx + playerBody.velocity.y * ny + playerBody.velocity.z * nz);
        if (vAway > 0) {
          playerBody.velocity.x += nx * vAway;
          playerBody.velocity.y += ny * vAway;
          playerBody.velocity.z += nz * vAway;
        }
        // 2. Apply pull toward partner
        const pull = overshoot * ROPE_PRE_CORR * FIXED_DT;
        playerBody.velocity.x += nx * pull;
        playerBody.velocity.y += ny * pull;
        playerBody.velocity.z += nz * pull;
      }
    });
    for (; ri < MAX_ROPES; ri++) hideChain(ri);

    // Wind
    for (const wb of levelData.windBoosts) {
      const dx = localMesh.position.x - wb.x, dz = localMesh.position.z - wb.z;
      if (dx*dx + dz*dz < wb.radius*wb.radius && Math.abs(localMesh.position.y - wb.y) < wb.height / 2)
        playerBody.velocity.y = Math.min(wb.strength, playerBody.velocity.y + wb.strength * realDt * 10);
    }

    // ── Physics substeps ───────────────────────────────────────────────────
    accumulator += realDt;
    while (accumulator >= FIXED_DT) {
      platTime += FIXED_DT;
      for (const mp of movPlats) {
        const nx = mp.sx + Math.sin(platTime * mp.p.speed!) * (mp.p.moveX ?? 0);
        const ny = mp.sy + Math.sin(platTime * mp.p.speed!) * (mp.p.moveY ?? 0);
        const nz = mp.sz + Math.sin(platTime * mp.p.speed!) * (mp.p.moveZ ?? 0);
        mp.body.position.set(nx, ny, nz); mp.body.velocity.set(0, 0, 0);
        mp.mesh.position.set(nx, ny, nz);
      }
      world.step(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    // ── Chain — POST-STEP position correction (PBD) ────────────────────────
    // This is the key fix: after physics, clamp position so rope can NEVER
    // exceed MAX_ROPE_LENGTH. Both clients run this → mutual bidirectional pull.
    remoteMap.forEach(entry => {
      if (entry.state.isDead || isDead) return;
      const dx = entry.targetPos.x - playerBody.position.x;
      const dy = entry.targetPos.y - playerBody.position.y;
      const dz = entry.targetPos.z - playerBody.position.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist > MAX_ROPE_LENGTH + 0.05) {
        const excess = dist - MAX_ROPE_LENGTH;
        const inv = 1 / dist;
        playerBody.position.x += dx * inv * excess * ROPE_POST_CORR;
        playerBody.position.y += dy * inv * excess * ROPE_POST_CORR;
        playerBody.position.z += dz * inv * excess * ROPE_POST_CORR;
        // Clamp outward velocity
        const nx = dx * inv, ny = dy * inv, nz = dz * inv;
        const vDot = playerBody.velocity.x * nx + playerBody.velocity.y * ny + playerBody.velocity.z * nz;
        if (vDot < 0) {
          playerBody.velocity.x -= nx * vDot;
          playerBody.velocity.y -= ny * vDot;
          playerBody.velocity.z -= nz * vDot;
        }
      }
    });

    // Sync mesh: sphere bottom = PLAYER_RADIUS below body centre = character feet
    localMesh.position.set(
      playerBody.position.x,
      playerBody.position.y - PLAYER_RADIUS,  // feet at sphere bottom
      playerBody.position.z
    );

    // ── Hazards ───────────────────────────────────────────────────────────────
    // Rising lava
    if (levelData.risingLava) {
      lavaY += levelData.risingLava.speed * realDt;
      if (lavaMesh) lavaMesh.position.y = lavaY;
      if (!isDead && localMesh.position.y < lavaY + 0.6) killPlayer();
    }

    // Pendulums
    for (let i = 0; i < levelData.pendulums.length; i++) {
      const pd = levelData.pendulums[i];
      const ang = Math.sin(now * 0.001 * pd.speed) * pd.swingAngle;
      pendMeshes[i].position.set(pd.x + Math.sin(ang) * pd.length, pd.pivotY - Math.cos(ang) * pd.length, pd.z);
      if (!isDead && localMesh.position.distanceTo(pendMeshes[i].position) < pd.radius + PLAYER_RADIUS + 0.1) killPlayer();
    }

    // Rotating bars
    for (let i = 0; i < levelData.rotatingBars.length; i++) {
      const rb  = levelData.rotatingBars[i];
      const ang = now * 0.001 * rb.speed * Math.PI * 2;
      barMeshes[i].rotation.y = ang;
      if (!isDead) {
        _va.set(rb.x + Math.cos(ang) * rb.radius, rb.y, rb.z + Math.sin(ang) * rb.radius);
        _vb.set(rb.x - Math.cos(ang) * rb.radius, rb.y, rb.z - Math.sin(ang) * rb.radius);
        if (segDist(localMesh.position, _va, _vb) < rb.barWidth / 2 + PLAYER_RADIUS + 0.1
            && Math.abs(localMesh.position.y - rb.y) < rb.barHeight / 2 + PLAYER_RADIUS) killPlayer();
      }
    }

    // Static hazard overlap (spikes/lava)
    if (!isDead && (playerBody.position.y < FALL_DEATH_Y || inHazard(localMesh.position))) killPlayer();

    // ── Coop doors ────────────────────────────────────────────────────────────
    for (let i = 0; i < levelData.coopDoors.length; i++) {
      const d = levelData.coopDoors[i]; const ds = doorStates[i];
      if (ds.open) continue;
      _vc.set(d.x, d.y, d.z);
      let near = localMesh.position.distanceTo(_vc) < d.activateRadius ? 1 : 0;
      remoteMap.forEach(e => { if (!e.state.isDead && e.mesh.position.distanceTo(_vc) < d.activateRadius) near++; });
      if (near >= 2) {
        ds.prog = Math.min(1, ds.prog + realDt / 1.5);
        if (ds.prog >= 1) { ds.open = true; doorMeshes[i].visible = false; burst(d.x, d.y + 2, d.z, 0x44FF88, 15); }
      } else {
        ds.prog = Math.max(0, ds.prog - realDt * 2.5);
      }
      doorMeshes[i].scale.y = Math.max(0.01, 1 - ds.prog);
    }

    // ── Checkpoints ───────────────────────────────────────────────────────────
    for (let i = levelData.checkpoints.length - 1; i >= 0; i--) {
      if (i <= lastCP) continue;
      const cp = levelData.checkpoints[i];
      _vc.set(cp.x, cp.y, cp.z ?? 0);
      if (localMesh.position.distanceTo(_vc) < 4) {
        lastCP = i;
        socket.emit('checkpoint_reached', { checkpointIndex: i });
        burst(localMesh.position.x, localMesh.position.y + 1, localMesh.position.z, 0xFFDD44, 14);
        if (alertRef.current) {
          alertRef.current.style.display = 'flex';
          alertRef.current.style.color   = '#FFD700';
          alertRef.current.textContent   = `✓ Checkpoint ${i + 1}!`;
          setTimeout(() => { if (alertRef.current && !isDead) alertRef.current.style.display = 'none'; }, 2200);
        }
        break;
      }
    }

    // Finish
    if (!levelComplete && localMesh.position.y >= levelData.finishY - 1 && Math.abs(localMesh.position.x) < 5) {
      const elapsed = (performance.now() - gameStartMs) / 1000;
      socket.emit('level_complete');
      levelComplete = true;
      onGameEnd('You reached the top! 🏆', elapsed);
    }

    // ── Remote player interpolation (dead-reckoning + distance-scaled lerp) ──
    remoteMap.forEach(e => {
      if (e.state.isDead) return;
      e.targetPos.x += e.velocity.x * realDt * 0.35;
      e.targetPos.y += e.velocity.y * realDt * 0.35;
      e.targetPos.z += e.velocity.z * realDt * 0.35;
      const gap  = e.mesh.position.distanceTo(e.targetPos);
      e.mesh.position.lerp(e.targetPos, Math.min(0.32, 0.1 + gap * 0.055));
    });

    // ── Particles ────────────────────────────────────────────────────────────
    tickParticles(realDt);

    // ── Camera ────────────────────────────────────────────────────────────────
    updateCamera(realDt);

    // ── HUD ───────────────────────────────────────────────────────────────────
    if (hudRef.current) {
      const pct = Math.max(0, Math.min(100, Math.round((localMesh.position.y / levelData.finishY) * 100)));
      const elapsed = (now - gameStartMs) / 1000;
      let txt = `⏱ ${formatTime(elapsed)}  ·  Height ${pct}%  ·  Room: ${roomCode}`;
      if (levelData.risingLava) txt += `  🌋 LAVA RISING`;
      hudRef.current.textContent = txt;
    }

    // ── Send 30 Hz ────────────────────────────────────────────────────────────
    if (now - lastSent >= SEND_RATE_MS) {
      lastSent = now;
      socket.emit('player_update', {
        x: localMesh.position.x, y: localMesh.position.y, z: localMesh.position.z,
        vx: playerBody.velocity.x, vy: playerBody.velocity.y, vz: playerBody.velocity.z,
        onGround, isDead, checkpointIndex: lastCP, seq: sendSeq++,
      });
    }

    drawMiniMap();
    renderer.render(scene, camera);
  }

  function updateCamera(dt: number) {
    let sy = localMesh.position.y, sx = localMesh.position.x, sz = localMesh.position.z, n = 1;
    remoteMap.forEach(e => { if (!e.state.isDead) { sy += e.mesh.position.y; sx += e.mesh.position.x; sz += e.mesh.position.z; n++; } });
    const avgX = sx / n, avgY = sy / n, avgZ = sz / n;

    const azRad = camAz * (Math.PI / 180), elRad = camEl * (Math.PI / 180);
    const tx = avgX + Math.sin(azRad) * Math.cos(elRad) * camDist;
    const ty = avgY + Math.sin(elRad) * camDist;
    const tz = avgZ + Math.cos(azRad) * Math.cos(elRad) * camDist;

    if (firstFrame) {
      // Snap camera on first frame (no lerp) so scene is immediately visible
      camPos.set(tx, ty, tz);
      camLook.set(avgX, avgY + 1, avgZ);
      firstFrame = false;
    } else {
      camPos.lerp(new THREE.Vector3(tx, ty, tz), CAM_LERP);
      camLook.lerp(new THREE.Vector3(avgX, avgY + 1, avgZ), CAM_LERP);
    }

    // Screen shake
    if (shakeTmr > 0) {
      shakeTmr = Math.max(0, shakeTmr - dt);
      const s = shakeAmt * (shakeTmr / 0.5);
      camera.position.set(camPos.x + (Math.random()-0.5)*s, camPos.y + (Math.random()-0.5)*s, camPos.z + (Math.random()-0.5)*s);
    } else {
      camera.position.copy(camPos);
    }
    camera.lookAt(camLook);
  }

  animId = requestAnimationFrame(loop);

  // ── Resize ────────────────────────────────────────────────────────────────
  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  // ── Cleanup (called by React when component unmounts) ─────────────────────
  // We store the cleanup in a ref-like pattern via a module-level WeakMap so
  // the outer useEffect can call it.  Since runGame is called directly from
  // useEffect and the cleanup return must happen there, we do it via a
  // registered global (simpler than passing refs back):
  (container as HTMLDivElement & { _cleanup?: () => void })._cleanup = () => {
    cancelAnimationFrame(animId);
    window.removeEventListener('keydown', onKD); window.removeEventListener('keyup', onKU);
    window.removeEventListener('mouseup', onMU); window.removeEventListener('mousemove', onMM);
    window.removeEventListener('resize', onResize);
    socket.off('player_joined'); socket.off('player_left');
    socket.off('player_update'); socket.off('state_update'); socket.off('level_complete');
    scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };
}

export default GameCanvas;
