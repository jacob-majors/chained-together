/**
 * SplitScreenCanvas — local 2-player split-screen game.
 *
 * One cannon-es world, one Three.js scene, two cameras rendered
 * into left and right halves via scissor/viewport.
 *
 * Controls:
 *   P1 — WASD + Space
 *   P2 — Arrow keys + Enter
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LevelData, PLAYER_COLORS } from '../types';
import level1 from './levels/level1.json';
import level2 from './levels/level2.json';
import level3 from './levels/level3.json';
import level4 from './levels/level4.json';
import level5 from './levels/level5.json';
import {
  PHYSICS_GRAVITY, PLAYER_SPEED, JUMP_VELOCITY,
  GROUND_ACCEL, AIR_ACCEL, FALL_GRAV_MULT, LOW_JUMP_MULT,
  DAMPING_GROUND, DAMPING_AIR, ANGULAR_DAMPING,
  PLAYER_RADIUS,
  MAX_ROPE_LENGTH, ROPE_PRE_CORR, ROPE_POST_CORR,
  FALL_DEATH_Y,
  CAM_AZIMUTH_DEF, CAM_ELEV_DEF, CAM_DIST_DEF, CAM_LERP,
  CHAIN_LINKS,
} from './constants';
import { LEVEL_CATALOGUE } from '../types';

interface ExtLevel extends LevelData { risingLava?: { startY: number; speed: number } }
const LEVELS: Record<string, ExtLevel> = {
  level1: level1 as unknown as ExtLevel,
  level2: level2 as unknown as ExtLevel,
  level3: level3 as unknown as ExtLevel,
  level4: level4 as unknown as ExtLevel,
  level5: level5 as unknown as ExtLevel,
};

function hexC(h: string): number { return parseInt(h.replace('#',''), 16); }
function darken(c: number, amt = 0x282828): number { return Math.max(0, c - amt); }

function makeBlobChar(colorHex: string): THREE.Group {
  const g = new THREE.Group();
  const c = hexC(colorHex), d = darken(c);
  const toon = (col: number) => new THREE.MeshToonMaterial({ color: col });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.38, 4, 10), toon(c));
  body.position.y = 0.72; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 12, 9), toon(c));
  head.position.y = 1.40; head.castShadow = true; g.add(head);
  for (const sx of [-1,1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 3, 8), toon(d));
    arm.position.set(sx*0.50, 0.84, 0); arm.rotation.z = sx*0.5; arm.castShadow = true; g.add(arm);
  }
  for (const sx of [-1,1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 3, 8), toon(d));
    leg.position.set(sx*0.19, 0.22, 0); leg.castShadow = true; g.add(leg);
  }
  const ew = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ep = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const sx of [-1,1]) {
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.072,6,6), ew);
    e1.position.set(sx*0.115, 1.47, 0.25); g.add(e1);
    const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.042,4,4), ep);
    e2.position.set(sx*0.115, 1.46, 0.29); g.add(e2);
  }
  return g;
}

function makeLabel(name: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d')!;
  cx.fillStyle = 'rgba(0,0,0,0.62)'; cx.roundRect(4,4,248,56,12); cx.fill();
  cx.font = 'bold 26px sans-serif'; cx.fillStyle = color;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(name.slice(0,14), 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(2.8, 0.7, 1);
  return sp;
}

interface Props {
  levelId: string;
  p1Name:  string;
  p2Name:  string;
  onGameEnd: (msg: string, time: number) => void;
  onBack: () => void;
}

const SplitScreenCanvas: React.FC<Props> = ({ levelId, p1Name, p2Name, onGameEnd, onBack }) => {
  const mountRef  = useRef<HTMLDivElement>(null);
  const [dead1, setDead1] = useState(false);
  const [dead2, setDead2] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(levelId);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const cleanup = runSplitGame(container, currentLevel, p1Name, p2Name, onGameEnd,
      (v) => setDead1(v), (v) => setDead2(v));
    (container as any)._cleanup = cleanup;
    return () => { cleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLevel]);

  const levelInfo = LEVEL_CATALOGUE.find(l => l.id === currentLevel);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Divider line */}
      <div style={{
        position: 'absolute', left: '50%', top: 0, bottom: 0,
        width: 3, background: 'rgba(255,255,255,0.25)',
        transform: 'translateX(-50%)', pointerEvents: 'none',
      }} />

      {/* P1 label */}
      <div style={{
        position: 'absolute', top: 10, left: 10,
        background: 'rgba(0,0,0,0.6)', borderRadius: 8,
        padding: '5px 12px', fontFamily: 'monospace', fontSize: 13,
        color: PLAYER_COLORS[0], fontWeight: 700, pointerEvents: 'none',
      }}>
        {p1Name} · WASD+Space
      </div>

      {/* P2 label */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        background: 'rgba(0,0,0,0.6)', borderRadius: 8,
        padding: '5px 12px', fontFamily: 'monospace', fontSize: 13,
        color: PLAYER_COLORS[1], fontWeight: 700, pointerEvents: 'none',
      }}>
        Arrows+Enter · {p2Name}
      </div>

      {/* Level selector */}
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.65)', borderRadius: 8,
        padding: '5px 14px', fontFamily: 'monospace', fontSize: 12, color: '#ccc',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {LEVEL_CATALOGUE.map(l => (
          <button
            key={l.id}
            onClick={() => setCurrentLevel(l.id)}
            style={{
              background: l.id === currentLevel ? 'rgba(255,255,255,0.2)' : 'none',
              border: 'none', color: l.id === currentLevel ? '#fff' : '#666',
              cursor: 'pointer', fontSize: 18, padding: '2px 4px', borderRadius: 6,
            }}
            title={l.name}
          >
            {l.emoji}
          </button>
        ))}
        <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}>{levelInfo?.name}</span>
      </div>

      {/* P1 death overlay (left half) */}
      {dead1 && (
        <div style={{
          position: 'absolute', left: 0, top: 0, width: '50%', height: '100%',
          background: 'rgba(0,0,0,0.7)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 52 }}>💀</div>
          <div style={{ color: '#FF5555', fontFamily: 'monospace', fontSize: 22, fontWeight: 700 }}>
            {p1Name} died!
          </div>
          <button
            onClick={() => (mountRef.current as any)?._retry1?.()}
            style={{
              padding: '12px 32px', borderRadius: 10, border: 'none',
              background: '#FF6644', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer',
            }}
          >
            Retry from Checkpoint
          </button>
        </div>
      )}

      {/* P2 death overlay (right half) */}
      {dead2 && (
        <div style={{
          position: 'absolute', right: 0, top: 0, width: '50%', height: '100%',
          background: 'rgba(0,0,0,0.7)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 52 }}>💀</div>
          <div style={{ color: '#FF5555', fontFamily: 'monospace', fontSize: 22, fontWeight: 700 }}>
            {p2Name} died!
          </div>
          <button
            onClick={() => (mountRef.current as any)?._retry2?.()}
            style={{
              padding: '12px 32px', borderRadius: 10, border: 'none',
              background: '#FF6644', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer',
            }}
          >
            Retry from Checkpoint
          </button>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8, color: '#aaa', padding: '7px 20px',
          cursor: 'pointer', fontSize: 13, fontFamily: 'monospace',
        }}
      >
        ← Menu
      </button>
    </div>
  );
};

// ── Core game function ─────────────────────────────────────────────────────────
function runSplitGame(
  container: HTMLDivElement,
  levelId:   string,
  p1Name:    string,
  p2Name:    string,
  onGameEnd: Props['onGameEnd'],
  setDead1:  (v: boolean) => void,
  setDead2:  (v: boolean) => void,
): () => void {
  const levelData = LEVELS[levelId] ?? LEVELS['level1'];

  // ── Renderer ────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // ── Scene ────────────────────────────────────────────────────────────────────
  const SKY: Record<string, { zenith: number; horizon: number; fog: number; sun: number; amb: number; hem: number }> = {
    level1: { zenith: 0x0d1a50, horizon: 0xD4874A, fog: 0xB87040, sun: 0xFFCCA0, amb: 0xFFCCA0, hem: 0x558800 },
    level2: { zenith: 0x1155CC, horizon: 0x88DDFF, fog: 0x99DDFF, sun: 0xFFFFFF, amb: 0xFFFFFF, hem: 0x558844 },
    level3: { zenith: 0x1A5599, horizon: 0xBBEEFF, fog: 0xCCEEFF, sun: 0xFFFFFF, amb: 0xEEF8FF, hem: 0x6688AA },
    level4: { zenith: 0x1a0500, horizon: 0xCC2200, fog: 0x881100, sun: 0xFF6600, amb: 0xFF5500, hem: 0x330800 },
    level5: { zenith: 0x020010, horizon: 0x220055, fog: 0x110033, sun: 0x8855FF, amb: 0x551188, hem: 0x220044 },
  };
  const atm = SKY[levelId] ?? SKY['level2'];

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(atm.fog, 0.009);

  // Sky sphere
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { zenith: { value: new THREE.Color(atm.zenith) }, horizon: { value: new THREE.Color(atm.horizon) } },
    vertexShader: `varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 zenith,horizon; varying vec3 vW; void main(){ float h=clamp(normalize(vW).y,0.,1.); gl_FragColor=vec4(mix(horizon,zenith,pow(h,0.45)),1.); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(280,32,16), skyMat));

  scene.add(new THREE.AmbientLight(atm.amb, 0.8));
  const sun = new THREE.DirectionalLight(atm.sun, 1.15);
  sun.position.set(14,40,16); sun.castShadow = true;
  sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -50;
  sun.shadow.camera.right = sun.shadow.camera.top   =  50;
  sun.shadow.camera.far = 280;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(atm.horizon, atm.hem, 0.55));

  // Water
  const waterUniforms = {
    time: { value: 0 },
    deepColor:    { value: new THREE.Color(levelId === 'level4' ? 0x440000 : 0x0044AA) },
    shallowColor: { value: new THREE.Color(levelId === 'level4' ? 0xFF3300 : 0x00AADD) },
    sunDir:       { value: new THREE.Vector3(0.45,0.6,0.65).normalize() },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms, transparent: true, depthWrite: false,
    vertexShader: `uniform float time; varying vec2 vUv; varying float vH;
      void main(){ vUv=uv; vec3 p=position;
        float h=sin(p.x*.12+time*1.1)*.9+sin(p.z*.18+time*.8)*.7+sin(p.x*.3+p.z*.24+time*1.4)*.4;
        p.y+=h; vH=h; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
    fragmentShader: `uniform vec3 deepColor,shallowColor,sunDir; uniform float time;
      varying vec2 vUv; varying float vH;
      void main(){ float t=clamp((vH+2.5)*.24,0.,1.); vec3 col=mix(deepColor,shallowColor,t);
        col*=0.55+max(0.,dot(normalize(vec3(0.,1.,0.)),sunDir))*.6;
        float edge=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y))*5.;
        gl_FragColor=vec4(col,clamp(edge,0.,1.)*.88); }`,
  });
  const waterGeo = new THREE.PlaneGeometry(500,500,60,60);
  waterGeo.rotateX(-Math.PI/2);
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.y = -9;
  scene.add(waterMesh);

  // ── Physics ─────────────────────────────────────────────────────────────────
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYSICS_GRAVITY, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  const defMat = new CANNON.Material('def');
  world.addContactMaterial(new CANNON.ContactMaterial(defMat, defMat, { friction: 0.4, restitution: 0 }));

  // ── Level geometry ──────────────────────────────────────────────────────────
  const movPlats: Array<{ body: CANNON.Body; mesh: THREE.Mesh; p: LevelData['platforms'][number]; sx: number; sy: number; sz: number }> = [];
  const grassMat = new THREE.MeshStandardMaterial({ color: levelId === 'level5' ? 0x3333AA : levelId === 'level4' ? 0x441100 : 0x44AA28, roughness: 0.9 });

  for (const p of levelData.platforms) {
    const isFinish = p.color === '#FFD700' || p.color === '#B08000';
    const mat = new THREE.MeshStandardMaterial({
      color: hexC(p.color),
      roughness: isFinish ? 0.25 : p.type === 'moving' ? 0.55 : 0.78,
      metalness: isFinish ? 0.45 : 0.0,
    });
    if (isFinish) { mat.emissive.set(0x554400); mat.emissiveIntensity = 0.4; }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat);
    mesh.position.set(p.x, p.y, p.z); mesh.receiveShadow = true;
    if (p.type === 'static' && !isFinish) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.13, p.d), grassMat);
      cap.position.set(p.x, p.y+p.h/2+0.065, p.z); cap.matrixAutoUpdate = false; cap.updateMatrix(); scene.add(cap);
    }
    const body = new CANNON.Body({ mass: 0, material: defMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(p.w/2, p.h/2, p.d/2)));
    body.position.set(p.x, p.y, p.z);
    if (p.type === 'moving') {
      body.type = CANNON.Body.KINEMATIC;
      mesh.matrixAutoUpdate = true;
      movPlats.push({ body, mesh, p, sx: p.x, sy: p.y, sz: p.z });
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
      const m = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d),
        new THREE.MeshStandardMaterial({ color: 0xFF4400, emissive: 0xFF2200, emissiveIntensity: 0.9, roughness: 0.6 }));
      m.position.set(h.x, h.y, h.z); scene.add(m);
      if (levelData.risingLava && !lavaMesh) { lavaY = levelData.risingLava.startY; m.position.y = lavaY; lavaMesh = m; }
      else { m.matrixAutoUpdate = false; m.updateMatrix(); }
    } else {
      const sm = new THREE.MeshStandardMaterial({ color: 0xBB1111, emissive: 0x440000, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.6 });
      const cnt = Math.max(1, Math.floor(h.w/0.7));
      for (let i = 0; i < cnt; i++) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.22,0.65,4), sm);
        s.position.set(h.x-h.w/2+0.35+i*(h.w/cnt), h.y+0.33, h.z);
        s.matrixAutoUpdate = false; s.updateMatrix(); scene.add(s);
      }
    }
  }

  // Pendulums
  const pendMeshes: THREE.Mesh[] = [];
  for (const pd of levelData.pendulums) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(pd.radius,10,8), new THREE.MeshToonMaterial({ color: 0x333333 }));
    scene.add(m); pendMeshes.push(m);
  }
  const barMeshes: THREE.Mesh[] = [];
  for (const rb of levelData.rotatingBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(rb.radius*2, rb.barHeight, rb.barWidth), new THREE.MeshToonMaterial({ color: 0x222233 }));
    bar.position.set(rb.x, rb.y, rb.z); scene.add(bar); barMeshes.push(bar);
  }

  // Finish ring
  const finRing = new THREE.Mesh(new THREE.TorusGeometry(2.4,0.18,6,24), new THREE.MeshBasicMaterial({ color: 0xFFD700 }));
  finRing.position.set(0, levelData.finishY+2, 0); finRing.rotation.x = Math.PI/2; scene.add(finRing);

  // ── Two players ─────────────────────────────────────────────────────────────
  const COLORS = [PLAYER_COLORS[0], PLAYER_COLORS[1]];
  const names  = [p1Name, p2Name];

  const meshes:   THREE.Group[]    = [];
  const bodies:   CANNON.Body[]    = [];
  const gTimers:  number[]         = [0, 0];
  const jumpBufs: number[]         = [0, 0];
  const wasOnGnd: boolean[]        = [false, false];
  const isDead_:  boolean[]        = [false, false];
  const lastCP_:  number[]         = [-1, -1];
  let   levelDone = false;
  const platSnap:  {x:number;y:number;z:number}[] = [];

  for (let i = 0; i < 2; i++) {
    const sx = levelData.spawnX + i * 1.8;
    const sy = levelData.spawnY;
    const sz = levelData.spawnZ ?? 0;

    const mesh = makeBlobChar(COLORS[i]);
    mesh.position.set(sx, sy, sz);
    scene.add(mesh);
    const lbl = makeLabel(names[i], COLORS[i]); lbl.position.y = 2.6; mesh.add(lbl);
    meshes.push(mesh);

    const body = new CANNON.Body({ mass: 1, material: defMat, linearDamping: DAMPING_AIR, angularDamping: ANGULAR_DAMPING, fixedRotation: true });
    body.addShape(new CANNON.Sphere(PLAYER_RADIUS));
    body.position.set(sx, sy + PLAYER_RADIUS, sz);
    world.addBody(body);
    bodies.push(body);

    const idx = i;
    body.addEventListener('collide', (ev: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      const c = ev.contact;
      const yDir = c.bi === body ? -1 : 1;
      if (c.ni.y * yDir > 0.4) gTimers[idx] = 0.22;
    });
  }

  // ── Chain (between the two local players) ──────────────────────────────────
  const linkGeo  = new THREE.CylinderGeometry(0.055, 0.055, 0.36, 6, 1);
  const linkMat  = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const chainLinks: THREE.Mesh[] = [];
  for (let i = 0; i < CHAIN_LINKS; i++) {
    const m = new THREE.Mesh(linkGeo, linkMat);
    m.visible = false; m.castShadow = false; scene.add(m); chainLinks.push(m);
  }
  const _lk = new THREE.Vector3();
  function drawChain() {
    if (isDead_[0] || isDead_[1]) { chainLinks.forEach(l => l.visible = false); return; }
    const p1 = meshes[0].position, p2 = meshes[1].position;
    const dist = p1.distanceTo(p2);
    const tension = Math.min(1, Math.max(0, (dist - MAX_ROPE_LENGTH*0.65)/(MAX_ROPE_LENGTH*0.4)));
    if (tension > 0.75) linkMat.color.setHex(0xDD2200);
    else if (tension > 0.35) linkMat.color.setHex(0xFF9900);
    else linkMat.color.setHex(0x999999);
    const sag = Math.max(0, (MAX_ROPE_LENGTH - dist) * 0.26);
    for (let i = 0; i < CHAIN_LINKS; i++) {
      const t = (i+0.5)/CHAIN_LINKS;
      chainLinks[i].position.set(
        p1.x+(p2.x-p1.x)*t, p1.y+(p2.y-p1.y)*t - Math.sin(t*Math.PI)*sag + 0.9, p1.z+(p2.z-p1.z)*t
      );
      const nt = Math.min(1, (i+1.5)/CHAIN_LINKS);
      _lk.set(p1.x+(p2.x-p1.x)*nt, p1.y+(p2.y-p1.y)*nt - Math.sin(nt*Math.PI)*sag + 0.9, p1.z+(p2.z-p1.z)*nt);
      chainLinks[i].lookAt(_lk); chainLinks[i].rotateX(Math.PI/2);
      if (i%2===0) chainLinks[i].rotateY(Math.PI/2);
      chainLinks[i].visible = true;
    }
  }

  // ── Cameras (two cameras, one per player) ──────────────────────────────────
  const camAz   = [CAM_AZIMUTH_DEF, CAM_AZIMUTH_DEF];
  const camEl   = [CAM_ELEV_DEF,    CAM_ELEV_DEF];
  const camDist = [CAM_DIST_DEF,    CAM_DIST_DEF];
  const camPos  = [new THREE.Vector3(), new THREE.Vector3()];
  const camLook = [new THREE.Vector3(), new THREE.Vector3()];
  const cameras = [
    new THREE.PerspectiveCamera(62, 0.5 * container.clientWidth / container.clientHeight, 0.1, 350),
    new THREE.PerspectiveCamera(62, 0.5 * container.clientWidth / container.clientHeight, 0.1, 350),
  ];
  let firstFrame = true;

  // Mouse/touch drag per half
  const drag = [false, false];
  const prevM = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

  const onMD = (e: MouseEvent) => {
    const half = e.clientX < container.clientWidth / 2 ? 0 : 1;
    drag[half] = true; prevM[half].x = e.clientX; prevM[half].y = e.clientY;
  };
  const onMU = () => { drag[0] = false; drag[1] = false; };
  const onMM = (e: MouseEvent) => {
    for (const half of [0,1]) {
      if (!drag[half]) continue;
      camAz[half]  += (e.clientX - prevM[half].x) * 0.45;
      camEl[half]   = Math.max(8, Math.min(58, camEl[half] - (e.clientY - prevM[half].y) * 0.3));
      prevM[half].x = e.clientX; prevM[half].y = e.clientY;
    }
  };
  const onWh = (e: WheelEvent) => {
    const half = e.clientX < container.clientWidth / 2 ? 0 : 1;
    camDist[half] = Math.max(6, Math.min(28, camDist[half] + e.deltaY * 0.015));
  };
  renderer.domElement.addEventListener('mousedown', onMD);
  window.addEventListener('mouseup', onMU); window.addEventListener('mousemove', onMM);
  renderer.domElement.addEventListener('wheel', onWh, { passive: true });

  // ── Input ────────────────────────────────────────────────────────────────────
  const keys = new Set<string>();
  const onKD = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space') jumpBufs[0] = 0.14;
    if (e.code === 'ArrowUp' || e.code === 'Enter') jumpBufs[1] = 0.14;
  };
  const onKU = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', onKD); window.addEventListener('keyup', onKU);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function inHazard(pos: THREE.Vector3): boolean {
    if (levelData.risingLava && pos.y < lavaY + PLAYER_RADIUS + 0.2) return true;
    for (const h of levelData.hazards) {
      if (h.type === 'lava' && levelData.risingLava) continue;
      if (Math.abs(pos.x-h.x) < h.w/2+PLAYER_RADIUS && Math.abs(pos.y-h.y) < h.h/2+PLAYER_RADIUS && Math.abs(pos.z-h.z) < h.d/2+PLAYER_RADIUS) return true;
    }
    return false;
  }

  function killPlayer_(pi: number) {
    if (isDead_[pi] || levelDone) return;
    isDead_[pi] = true;
    meshes[pi].visible = false;
    if (pi===0) setDead1(true); else setDead2(true);
  }

  function respawnPlayer_(pi: number) {
    let best = lastCP_[pi];
    const otherCP = lastCP_[pi===0?1:0];
    if (otherCP > best) best = otherCP;
    let rx = levelData.spawnX + pi*1.8;
    let ry = levelData.spawnY + 2;
    let rz = levelData.spawnZ ?? 0;
    if (best >= 0 && best < levelData.checkpoints.length) {
      const cp = levelData.checkpoints[best]; rx = cp.x; ry = cp.y + 3.5; rz = cp.z ?? 0;
    }
    bodies[pi].position.set(rx, ry+PLAYER_RADIUS, rz);
    bodies[pi].velocity.set(0,0,0);
    meshes[pi].position.set(rx, ry, rz);
    meshes[pi].visible = true;
    isDead_[pi] = false; gTimers[pi] = 0;
    if (pi===0) setDead1(false); else setDead2(false);
  }

  (container as any)._retry1 = () => respawnPlayer_(0);
  (container as any)._retry2 = () => respawnPlayer_(1);

  // ── Move one player ──────────────────────────────────────────────────────────
  const _va = new THREE.Vector3(), _vb = new THREE.Vector3();

  function movePlayer(pi: number, realDt: number, now: number) {
    if (isDead_[pi] || levelDone) return;
    const body = bodies[pi];
    const mesh = meshes[pi];

    gTimers[pi]  = Math.max(0, gTimers[pi]  - realDt);
    jumpBufs[pi] = Math.max(0, jumpBufs[pi] - realDt);
    const onGround = gTimers[pi] > 0;

    const justLanded = onGround && !wasOnGnd[pi];
    wasOnGnd[pi] = onGround;
    if (justLanded) { /* squash optional */ }

    const azRad = camAz[pi] * (Math.PI/180);
    const fwdX = Math.sin(azRad), fwdZ = Math.cos(azRad);
    const rgtX = fwdZ,            rgtZ = -fwdX;

    let mvX = 0, mvZ = 0;
    if (pi === 0) {
      if (keys.has('KeyW'))    { mvX += fwdX; mvZ += fwdZ; }
      if (keys.has('KeyS'))    { mvX -= fwdX; mvZ -= fwdZ; }
      if (keys.has('KeyA'))    { mvX -= rgtX; mvZ -= rgtZ; }
      if (keys.has('KeyD'))    { mvX += rgtX; mvZ += rgtZ; }
    } else {
      if (keys.has('ArrowUp'))    { mvX += fwdX; mvZ += fwdZ; }
      if (keys.has('ArrowDown'))  { mvX -= fwdX; mvZ -= fwdZ; }
      if (keys.has('ArrowLeft'))  { mvX -= rgtX; mvZ -= rgtZ; }
      if (keys.has('ArrowRight')) { mvX += rgtX; mvZ += rgtZ; }
    }
    const isMoving = mvX !== 0 || mvZ !== 0;

    if (isMoving) {
      const len = Math.sqrt(mvX*mvX+mvZ*mvZ);
      const ux = mvX/len, uz = mvZ/len;
      const accel = onGround ? GROUND_ACCEL : AIR_ACCEL;
      const lerpF = 1 - Math.pow(1-accel, realDt*60);
      body.velocity.x += (ux*PLAYER_SPEED - body.velocity.x)*lerpF;
      body.velocity.z += (uz*PLAYER_SPEED - body.velocity.z)*lerpF;
      // Yaw
      const ty = Math.atan2(-uz, ux) + Math.PI/2;
      let diff = ty - mesh.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI*2;
      while (diff < -Math.PI) diff += Math.PI*2;
      mesh.rotation.y += diff * 0.22;
      // Walk bob
      const bob = Math.sin(now*0.014)*0.2;
      const ch = mesh.children;
      if (ch[4]) ch[4].position.y = 0.22+bob*0.5;
      if (ch[5]) ch[5].position.y = 0.22-bob*0.5;
    } else if (onGround) {
      body.velocity.x *= 0.72; body.velocity.z *= 0.72;
    }

    const jumpKey = pi === 0 ? 'Space' : 'Enter';
    if (jumpBufs[pi] > 0 && onGround) {
      body.velocity.y = JUMP_VELOCITY;
      jumpBufs[pi] = 0; gTimers[pi] = 0;
    }
    if (!keys.has(jumpKey) && body.velocity.y > 10) body.velocity.y *= 0.92;

    body.linearDamping = onGround ? DAMPING_GROUND : DAMPING_AIR;

    if (body.velocity.y < 0) body.velocity.y += PHYSICS_GRAVITY*(FALL_GRAV_MULT-1)*realDt;
    else if (body.velocity.y > 0 && !keys.has(jumpKey)) body.velocity.y += PHYSICS_GRAVITY*(LOW_JUMP_MULT-1)*realDt;

    // Chain constraint (pre-step)
    const other = bodies[pi===0?1:0];
    const dx = other.position.x-body.position.x;
    const dy = other.position.y-body.position.y;
    const dz = other.position.z-body.position.z;
    const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if (dist > MAX_ROPE_LENGTH) {
      const inv = 1/dist;
      const nx = dx*inv, ny = dy*inv, nz = dz*inv;
      const vAway = -(body.velocity.x*nx+body.velocity.y*ny+body.velocity.z*nz);
      if (vAway > 0) { body.velocity.x += nx*vAway; body.velocity.y += ny*vAway; body.velocity.z += nz*vAway; }
      const overshoot = dist-MAX_ROPE_LENGTH;
      const pull = overshoot*ROPE_PRE_CORR*(1/60);
      body.velocity.x += nx*pull; body.velocity.y += ny*pull; body.velocity.z += nz*pull;
    }

    // Wind
    for (const wb of levelData.windBoosts) {
      const wx = mesh.position.x-wb.x, wz = mesh.position.z-wb.z;
      if (wx*wx+wz*wz < wb.radius*wb.radius && Math.abs(mesh.position.y-wb.y) < wb.height/2)
        body.velocity.y = Math.min(wb.strength, body.velocity.y + wb.strength*realDt*10);
    }
  }

  function postStepPlayer(pi: number, realDt: number) {
    if (isDead_[pi] || levelDone) return;
    const body = bodies[pi];
    const mesh = meshes[pi];

    // Platform carry
    if (gTimers[pi] > 0) {
      for (let i = 0; i < movPlats.length; i++) {
        const mp = movPlats[i];
        const hW = mp.p.w/2+0.12, hD = mp.p.d/2+0.12;
        const top = mp.body.position.y+mp.p.h/2;
        const bot = body.position.y-PLAYER_RADIUS;
        if (Math.abs(body.position.x-mp.body.position.x)<hW && Math.abs(body.position.z-mp.body.position.z)<hD && Math.abs(bot-top)<0.3) {
          body.position.x += mp.body.position.x-platSnap[i].x;
          body.position.y += mp.body.position.y-platSnap[i].y;
          body.position.z += mp.body.position.z-platSnap[i].z;
          break;
        }
      }
    }

    // Chain post-step
    const other = bodies[pi===0?1:0];
    const dx = other.position.x-body.position.x;
    const dy = other.position.y-body.position.y;
    const dz = other.position.z-body.position.z;
    const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if (dist > MAX_ROPE_LENGTH+0.05) {
      const excess = dist-MAX_ROPE_LENGTH;
      const inv = 1/dist;
      body.position.x += dx*inv*excess*ROPE_POST_CORR;
      body.position.y += dy*inv*excess*ROPE_POST_CORR;
      body.position.z += dz*inv*excess*ROPE_POST_CORR;
      const nx = dx*inv, ny = dy*inv, nz = dz*inv;
      const vDot = body.velocity.x*nx+body.velocity.y*ny+body.velocity.z*nz;
      if (vDot<0){ body.velocity.x -= nx*vDot; body.velocity.y -= ny*vDot; body.velocity.z -= nz*vDot; }
    }

    mesh.position.set(body.position.x, body.position.y-PLAYER_RADIUS, body.position.z);
  }

  // ── Camera update ────────────────────────────────────────────────────────────
  function updateCamera(pi: number, dt: number) {
    const azRad = camAz[pi]*(Math.PI/180), elRad = camEl[pi]*(Math.PI/180);
    const cx = meshes[pi].position.x, cy = meshes[pi].position.y, cz_ = meshes[pi].position.z;
    const tx = cx + Math.sin(azRad)*Math.cos(elRad)*camDist[pi];
    const ty = cy + Math.sin(elRad)*camDist[pi];
    const tz = cz_ + Math.cos(azRad)*Math.cos(elRad)*camDist[pi];
    if (firstFrame) {
      camPos[pi].set(tx, ty, tz); camLook[pi].set(cx, cy+1, cz_);
    } else {
      camPos[pi].lerp(new THREE.Vector3(tx,ty,tz), CAM_LERP);
      camLook[pi].lerp(new THREE.Vector3(cx,cy+1,cz_), CAM_LERP);
    }
    cameras[pi].position.copy(camPos[pi]);
    cameras[pi].lookAt(camLook[pi]);
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  const FIXED_DT = 1/60;
  let accumulator = 0, platTime = 0;
  let animId = 0, prevTime = performance.now();
  const gameStartMs = performance.now();

  function loop(now: number) {
    animId = requestAnimationFrame(loop);
    const frameMs = Math.min(now-prevTime, 50);
    prevTime = now;
    const realDt = frameMs/1000;

    finRing.rotation.z += realDt*1.1;
    waterUniforms.time.value += realDt;

    // Move both players (pre-physics)
    for (let pi = 0; pi < 2; pi++) movePlayer(pi, realDt, now);

    // Physics substeps
    const snap0 = movPlats.map(mp => ({ x: mp.body.position.x, y: mp.body.position.y, z: mp.body.position.z }));
    for (let i = 0; i < movPlats.length; i++) platSnap[i] = snap0[i];

    accumulator += realDt;
    while (accumulator >= FIXED_DT) {
      platTime += FIXED_DT;
      for (const mp of movPlats) {
        const nx = mp.sx+Math.sin(platTime*mp.p.speed!)*(mp.p.moveX??0);
        const ny = mp.sy+Math.sin(platTime*mp.p.speed!)*(mp.p.moveY??0);
        const nz_ = mp.sz+Math.sin(platTime*mp.p.speed!)*(mp.p.moveZ??0);
        mp.body.position.set(nx,ny,nz_); mp.body.velocity.set(0,0,0);
        mp.mesh.position.set(nx,ny,nz_);
      }
      world.step(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    // Post-step (position correction, carry)
    for (let pi = 0; pi < 2; pi++) postStepPlayer(pi, realDt);

    // Rising lava
    if (levelData.risingLava) {
      lavaY += levelData.risingLava.speed*realDt;
      if (lavaMesh) lavaMesh.position.y = lavaY;
    }

    // Pendulums
    for (let i = 0; i < levelData.pendulums.length; i++) {
      const pd = levelData.pendulums[i];
      const ang = Math.sin(now*0.001*pd.speed)*pd.swingAngle;
      pendMeshes[i].position.set(pd.x+Math.sin(ang)*pd.length, pd.pivotY-Math.cos(ang)*pd.length, pd.z);
    }
    for (let i = 0; i < levelData.rotatingBars.length; i++) {
      const rb = levelData.rotatingBars[i];
      barMeshes[i].rotation.y = now*0.001*rb.speed*Math.PI*2;
    }

    // Hazard + death checks
    for (let pi = 0; pi < 2; pi++) {
      if (isDead_[pi] || levelDone) continue;
      const mesh = meshes[pi];
      if (bodies[pi].position.y < FALL_DEATH_Y || inHazard(mesh.position)) {
        killPlayer_(pi);
      }
    }

    // Win check
    if (!levelDone) {
      for (let pi = 0; pi < 2; pi++) {
        if (!isDead_[pi] && meshes[pi].position.y >= levelData.finishY-1 && Math.abs(meshes[pi].position.x) < 5) {
          levelDone = true;
          const elapsed = (performance.now()-gameStartMs)/1000;
          onGameEnd(`${names[pi]} reached the top! 🏆`, elapsed);
          break;
        }
      }
    }

    // Draw chain
    drawChain();

    // Cameras
    for (let pi = 0; pi < 2; pi++) updateCamera(pi, realDt);
    if (firstFrame) firstFrame = false;

    // Render split screen
    const W = container.clientWidth, H = container.clientHeight;
    const HW = Math.floor(W/2);

    // Left half — P1
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, HW, H);
    renderer.setViewport(0, 0, HW, H);
    cameras[0].aspect = HW/H;
    cameras[0].updateProjectionMatrix();
    renderer.render(scene, cameras[0]);

    // Right half — P2
    renderer.setScissor(HW, 0, W-HW, H);
    renderer.setViewport(HW, 0, W-HW, H);
    cameras[1].aspect = (W-HW)/H;
    cameras[1].updateProjectionMatrix();
    renderer.render(scene, cameras[1]);

    renderer.setScissorTest(false);
  }

  animId = requestAnimationFrame(loop);

  const onResize = () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  return () => {
    cancelAnimationFrame(animId);
    window.removeEventListener('keydown', onKD); window.removeEventListener('keyup', onKU);
    window.removeEventListener('mouseup', onMU); window.removeEventListener('mousemove', onMM);
    window.removeEventListener('resize', onResize);
    scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose();
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };
}

export default SplitScreenCanvas;
