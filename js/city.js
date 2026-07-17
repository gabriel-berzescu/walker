import * as THREE from 'three';

const CHUNK = 36;          // one city block, roads on the borders
const LOAD_RADIUS = 3;     // chunks kept alive around the player (Chebyshev)
const UNLOAD_RADIUS = 4;
const MAX_LOADS_PER_FRAME = 8;

const PALETTE = [0x00f0ff, 0xff00a0, 0xf5d300, 0x9d00ff, 0x00ff9f];

// ── Deterministic per-chunk randomness ───────────────
function chunkSeed(cx, cz) {
  let h = Math.imul(cx, 374761393) + Math.imul(cz, 668265263) + 1013904223;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Window texture (drawn once, cloned per repeat) ───
function makeWindowCanvas(rng) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0c16';
  ctx.fillRect(0, 0, c.width, c.height);

  const cols = 6, rows = 24;
  const cw = c.width / cols, ch = c.height / rows;
  const tints = ['#ffd9a0', '#a0e8ff', '#e8b0ff', '#fff4d0'];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rng() > 0.42) continue; // most windows dark: it's late
      const tint = tints[Math.floor(rng() * tints.length)];
      ctx.globalAlpha = 0.35 + rng() * 0.65;
      ctx.fillStyle = tint;
      ctx.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 9);
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

export class City {
  constructor(scene, world, RAPIER, { onShard } = {}) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.onShard = onShard || (() => {});

    this.chunks = new Map();          // "cx,cz" -> chunk record
    this.collectedShards = new Set(); // chunk keys, so shards never respawn
    this.shardCount = 0;
    this.time = 0;

    // Shared resources — never disposed
    const texRng = mulberry32(1337);
    this.windowCanvases = [makeWindowCanvas(texRng), makeWindowCanvas(texRng)];
    this.textureCache = new Map();
    this.materialCache = new Map();

    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6);
    this.bulbGeo = new THREE.SphereGeometry(0.16, 10, 8);
    this.shardGeo = new THREE.IcosahedronGeometry(0.22, 0);
    this.ringGeo = new THREE.TorusGeometry(0.45, 0.02, 8, 32);
    this.gemGeo = new THREE.IcosahedronGeometry(1.2, 0);
    this.plazaRingGeo = new THREE.TorusGeometry(6, 0.06, 8, 64);

    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0x07070f, roughness: 0.85, metalness: 0.35,
    });
    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a24, roughness: 0.6, metalness: 0.8,
    });
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff });
  }

  buildingMaterial(w, h, variant) {
    const rx = Math.max(0.4, Math.round((w / 10) * 10) / 10);
    const ry = Math.max(0.25, Math.round((h / 48) * 20) / 20);
    const key = `${variant}_${rx}_${ry}`;
    if (this.materialCache.has(key)) return this.materialCache.get(key);

    let tex = this.textureCache.get(key);
    if (!tex) {
      tex = new THREE.CanvasTexture(this.windowCanvases[variant]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textureCache.set(key, tex);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: tex,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85,
      roughness: 0.75, metalness: 0.25,
    });
    this.materialCache.set(key, mat);
    return mat;
  }

  // ── Chunk lifecycle ────────────────────────────────
  update(playerPos) {
    const pcx = Math.round(playerPos.x / CHUNK);
    const pcz = Math.round(playerPos.z / CHUNK);

    // Keep the (finite) physics ground slab centered under the player.
    // Only reposition on an actual chunk change — teleporting a fixed
    // body every frame disturbs the character's ground contact.
    if (this.groundBody && (pcx !== this.lastPcx || pcz !== this.lastPcz)) {
      this.groundBody.setTranslation({ x: pcx * CHUNK, y: -0.5, z: pcz * CHUNK }, false);
      this.lastPcx = pcx;
      this.lastPcz = pcz;
    }

    // Unload far chunks
    for (const [key, chunk] of this.chunks) {
      if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) > UNLOAD_RADIUS) {
        this.unloadChunk(key, chunk);
      }
    }

    // Load missing chunks, nearest first, capped per frame
    const missing = [];
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (!this.chunks.has(`${cx},${cz}`)) {
          missing.push({ cx, cz, d: dx * dx + dz * dz });
        }
      }
    }
    missing.sort((a, b) => a.d - b.d);
    for (const m of missing.slice(0, MAX_LOADS_PER_FRAME)) {
      this.loadChunk(m.cx, m.cz);
    }
  }

  unloadChunk(key, chunk) {
    this.scene.remove(chunk.group);
    for (const body of chunk.bodies) this.world.removeRigidBody(body);
    for (const mat of chunk.ownedMaterials) mat.dispose();
    this.chunks.delete(key);
  }

  loadChunk(cx, cz) {
    const rng = mulberry32(chunkSeed(cx, cz));
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const group = new THREE.Group();
    group.position.set(ox, 0, oz);

    const chunk = {
      cx, cz, group,
      bodies: [],
      ownedMaterials: [],
      updatables: [],
      shard: null,
    };

    // Ground slab + neon road lines along two borders
    const ground = new THREE.Mesh(this.planeGeo, this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.scale.set(CHUNK, CHUNK, 1);
    ground.position.y = 0.001;
    group.add(ground);

    const lineColor = (cx + cz) % 2 === 0 ? 0x00f0ff : 0xff00a0;
    const lineMat = new THREE.MeshBasicMaterial({ color: lineColor });
    lineMat.color.multiplyScalar(0.55);
    chunk.ownedMaterials.push(lineMat);
    for (const horizontal of [true, false]) {
      const line = new THREE.Mesh(this.boxGeo, lineMat);
      line.scale.set(horizontal ? CHUNK : 0.14, 0.04, horizontal ? 0.14 : CHUNK);
      line.position.set(
        horizontal ? 0 : -CHUNK / 2,
        0.02,
        horizontal ? -CHUNK / 2 : 0
      );
      group.add(line);
    }

    // Streetlamp at the block corner
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.set(-CHUNK / 2 + 1.4, 2.1, -CHUNK / 2 + 1.4);
    group.add(pole);
    const bulb = new THREE.Mesh(this.bulbGeo, this.bulbMat);
    bulb.position.set(-CHUNK / 2 + 1.4, 4.3, -CHUNK / 2 + 1.4);
    group.add(bulb);

    const isPlaza = (cx === 0 && cz === 0) || rng() < 0.07;
    if (isPlaza) {
      this.buildPlaza(chunk, rng);
    } else {
      this.buildBuildings(chunk, rng, ox, oz);
    }

    // Maybe a collectible shard, floating over the road
    const key = `${cx},${cz}`;
    if (!this.collectedShards.has(key) && rng() < 0.4) {
      const shardMat = new THREE.MeshBasicMaterial({ color: 0x00ff9f });
      chunk.ownedMaterials.push(shardMat);
      const shard = new THREE.Mesh(this.shardGeo, shardMat);
      const along = (rng() - 0.5) * (CHUNK - 8);
      const sx = rng() < 0.5 ? -CHUNK / 2 : along;
      const sz = sx === -CHUNK / 2 ? along : -CHUNK / 2;
      shard.position.set(sx, 1.2, sz);
      group.add(shard);
      const ring = new THREE.Mesh(this.ringGeo, shardMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx, 0.25, sz);
      group.add(ring);
      chunk.shard = { mesh: shard, ring, baseY: 1.2, phase: rng() * 6.28, key };
    }

    this.scene.add(group);
    this.chunks.set(key, chunk);
  }

  buildBuildings(chunk, rng, ox, oz) {
    const count = 1 + Math.floor(rng() * 3);
    const placed = [];

    for (let i = 0; i < count; i++) {
      let rect = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const w = 8 + rng() * 6;
        const d = 8 + rng() * 6;
        const x = (rng() - 0.5) * (26 - w);
        const z = (rng() - 0.5) * (26 - d);
        const candidate = { x, z, w, d };
        const overlaps = placed.some((p) =>
          Math.abs(p.x - x) < (p.w + w) / 2 + 1.5 &&
          Math.abs(p.z - z) < (p.d + d) / 2 + 1.5
        );
        if (!overlaps) { rect = candidate; break; }
      }
      if (!rect) continue;
      placed.push(rect);

      const tall = rng() < 0.18;
      const h = tall ? 40 + rng() * 30 : 12 + rng() * 26;
      const { x, z, w, d } = rect;

      const mesh = new THREE.Mesh(this.boxGeo, this.buildingMaterial(w, h, rng() < 0.5 ? 0 : 1));
      mesh.scale.set(w, h, d);
      mesh.position.set(x, h / 2, z);
      chunk.group.add(mesh);

      // Neon roofline trim
      const trimColor = PALETTE[Math.floor(rng() * PALETTE.length)];
      const trimMat = new THREE.MeshBasicMaterial({ color: trimColor });
      chunk.ownedMaterials.push(trimMat);
      const trim = new THREE.Mesh(this.boxGeo, trimMat);
      trim.scale.set(w + 0.3, 0.22, d + 0.3);
      trim.position.set(x, h + 0.11, z);
      chunk.group.add(trim);

      // Occasional glowing corner strip
      if (rng() < 0.45) {
        const strip = new THREE.Mesh(this.boxGeo, trimMat);
        strip.scale.set(0.14, h * 0.8, 0.14);
        strip.position.set(x + w / 2, h * 0.4, z + d / 2);
        chunk.group.add(strip);
      }

      // Wall signs with lazy flicker
      const signCount = Math.floor(rng() * 3);
      for (let s = 0; s < signCount; s++) {
        const signMat = new THREE.MeshBasicMaterial({
          color: PALETTE[Math.floor(rng() * PALETTE.length)],
          side: THREE.DoubleSide,
        });
        chunk.ownedMaterials.push(signMat);
        const sign = new THREE.Mesh(this.planeGeo, signMat);
        const sw = 1.2 + rng() * 2.6, sh = 0.6 + rng() * 1.2;
        sign.scale.set(sw, sh, 1);
        const sy = h * (0.3 + rng() * 0.5);
        const side = Math.floor(rng() * 4);
        if (side === 0) { sign.position.set(x + w / 2 + 0.06, sy, z + (rng() - 0.5) * d * 0.6); sign.rotation.y = Math.PI / 2; }
        if (side === 1) { sign.position.set(x - w / 2 - 0.06, sy, z + (rng() - 0.5) * d * 0.6); sign.rotation.y = -Math.PI / 2; }
        if (side === 2) { sign.position.set(x + (rng() - 0.5) * w * 0.6, sy, z + d / 2 + 0.06); }
        if (side === 3) { sign.position.set(x + (rng() - 0.5) * w * 0.6, sy, z - d / 2 - 0.06); sign.rotation.y = Math.PI; }
        chunk.group.add(sign);

        const base = signMat.color.clone();
        const freq = 0.6 + rng() * 1.6, phase = rng() * 10;
        chunk.updatables.push((t) => {
          const flicker = Math.sin(t * freq + phase) > 0.96 || Math.sin(t * 7.3 + phase * 2) > 0.985;
          signMat.color.copy(base).multiplyScalar(flicker ? 0.12 : 1);
        });
      }

      // Blinking red beacon on tall towers
      if (h > 38) {
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
        chunk.ownedMaterials.push(beaconMat);
        const beacon = new THREE.Mesh(this.bulbGeo, beaconMat);
        beacon.position.set(x, h + 0.9, z);
        beacon.scale.setScalar(0.8);
        chunk.group.add(beacon);
        const phase = rng() * 10;
        chunk.updatables.push((t) => {
          beacon.visible = Math.sin(t * 2.2 + phase) > 0;
        });
      }

      // Physics: one static box per building
      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.fixed().setTranslation(ox + x, h / 2, oz + z)
      );
      this.world.createCollider(
        this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body
      );
      chunk.bodies.push(body);
    }
  }

  buildPlaza(chunk, rng) {
    // An open block: glowing ring on the ground, slow floating gem above
    const color = PALETTE[Math.floor(rng() * PALETTE.length)];
    const mat = new THREE.MeshBasicMaterial({ color });
    chunk.ownedMaterials.push(mat);

    const ring = new THREE.Mesh(this.plazaRingGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    chunk.group.add(ring);

    const gemMat = new THREE.MeshBasicMaterial({ color, wireframe: true });
    chunk.ownedMaterials.push(gemMat);
    const gem = new THREE.Mesh(this.gemGeo, gemMat);
    gem.position.y = 4.2;
    chunk.group.add(gem);

    const phase = rng() * 6.28;
    chunk.updatables.push((t) => {
      gem.rotation.y = t * 0.3 + phase;
      gem.rotation.x = t * 0.11;
      gem.position.y = 4.2 + Math.sin(t * 0.6 + phase) * 0.5;
    });
  }

  // ── Per-frame animation + shard pickup ─────────────
  tick(dt, playerPos) {
    this.time += dt;
    const t = this.time;

    for (const chunk of this.chunks.values()) {
      for (const fn of chunk.updatables) fn(t);

      const shard = chunk.shard;
      if (!shard) continue;
      shard.mesh.rotation.y = t * 1.4 + shard.phase;
      shard.mesh.position.y = shard.baseY + Math.sin(t * 1.6 + shard.phase) * 0.22;

      const wx = chunk.group.position.x + shard.mesh.position.x;
      const wz = chunk.group.position.z + shard.mesh.position.z;
      const dx = playerPos.x - wx, dz = playerPos.z - wz;
      if (dx * dx + dz * dz < 1.9) {
        chunk.group.remove(shard.mesh, shard.ring);
        chunk.shard = null;
        this.collectedShards.add(shard.key);
        this.shardCount += 1;
        this.onShard(this.shardCount);
      }
    }
  }
}
