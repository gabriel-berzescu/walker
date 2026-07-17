import * as THREE from 'three';
import RAPIER from 'rapier';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { City } from './city.js';
import { Player } from './player.js';
import { Props } from './props.js';
import { AudioEngine } from './audio.js';

const FOG_COLOR = 0x070312;

const overlay = document.getElementById('overlay');
const sysLine = document.getElementById('sys-line');
const statusText = document.getElementById('status-text');
const bootBar = document.getElementById('boot-bar');
const jackIn = document.getElementById('jack-in');
const hud = document.getElementById('hud');
const shardsEl = document.getElementById('shards');
const hintsEl = document.getElementById('hints');
const toastEl = document.getElementById('toast');

function bootProgress(pct, label) {
  bootBar.style.width = `${Math.round(pct * 100)}%`;
  statusText.textContent = label;
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, ms);
}

async function boot() {
  bootProgress(0.15, 'COMPILING NEON');

  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.016);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 1.7, 0);

  // Lighting: the city is mostly emissive, these just keep shadows readable
  scene.add(new THREE.HemisphereLight(0x3a2a6e, 0x0a0a14, 0.55));
  const moonLight = new THREE.DirectionalLight(0x8899ff, 0.35);
  moonLight.position.set(120, 180, -200);
  scene.add(moonLight);
  const ambient = new THREE.AmbientLight(0x221133, 0.5);
  scene.add(ambient);
  const playerGlow = new THREE.PointLight(0x66aaff, 14, 18, 2);
  scene.add(playerGlow);

  // Post-processing: bloom is what makes the neon sing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.6, 0.55
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  buildSky(scene);
  const rain = buildRain(scene);

  bootProgress(0.35, 'CALIBRATING PHYSICS');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // One huge static slab as the ground — the city floats on top of it
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000), groundBody);

  bootProgress(0.55, 'GENERATING SECTOR 7');
  const audio = new AudioEngine();
  const city = new City(scene, world, RAPIER, {
    onShard: (count) => {
      shardsEl.textContent = `SHARDS // ${count}`;
      audio.chime();
      if (count === 1) toast('SHARD ACQUIRED // NO RUSH, THERE ARE MORE');
    },
  });
  const player = new Player(camera, world, RAPIER);
  const props = new Props(scene, world, RAPIER, camera, audio);
  city.groundBody = groundBody;
  // Chunk loading is capped per call, so loop to preload the full radius
  for (let i = 0; i < 8; i++) city.update(player.position);

  bootProgress(0.85, 'ROUTING THROUGH ICE');

  // ── Pointer lock / pause flow ─────────────────────
  let playing = false;

  jackIn.addEventListener('click', () => {
    audio.start();
    canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    playing = document.pointerLockElement === canvas;
    overlay.classList.toggle('hidden', playing);
    hud.classList.toggle('visible', playing);
    if (playing) {
      audio.setMuffled(false);
      setTimeout(() => hintsEl.classList.add('faded'), 9000);
    } else {
      audio.setMuffled(true);
      sysLine.textContent = '[ SYS.PAUSE // NODE: WALKER-01 // STATUS: STANDBY ]';
      jackIn.textContent = '◢ Resume ◣';
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Main loop ─────────────────────────────────────
  // Exactly one physics step per rendered frame, sized to the frame's
  // duration: physics and rendering can never drift out of phase, so
  // the camera is glued to the simulation with zero temporal aliasing.
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (playing) {
      const stepDt = Math.min(dt, 1 / 30);
      world.timestep = stepDt;
      player.fixedUpdate(stepDt);
      world.step();
      player.update(stepDt);
      props.sync();
      city.update(player.position);
      city.tick(dt, player.position);
      rain.update(dt, camera.position);
      playerGlow.position.copy(camera.position);
      playerGlow.position.y += 0.5;
    }

    composer.render();
  }

  bootProgress(1, 'READY');
  sysLine.textContent = '[ SYS.BOOT // NODE: WALKER-01 // STATUS: ONLINE ]';
  overlay.classList.add('ready');
  animate();
}

// ── Sky: stars + a big soft moon ────────────────────
function buildSky(scene) {
  const starCount = 900;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // random point on upper dome
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85); // bias toward zenith
    const r = 420;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) + 10;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xbbccff, size: 1.4, sizeAttenuation: false,
    transparent: true, opacity: 0.7, fog: false,
  }));
  scene.add(stars);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(20, 48),
    new THREE.MeshBasicMaterial({ color: 0xd8e6ff, fog: false })
  );
  moon.position.set(180, 150, -320);
  moon.lookAt(0, 0, 0);
  scene.add(moon);
}

// ── Rain: line segments falling around the camera ───
function buildRain(scene) {
  const COUNT = 700;
  const AREA = 42, HEIGHT = 28;
  const positions = new Float32Array(COUNT * 6);
  const drops = [];
  for (let i = 0; i < COUNT; i++) {
    drops.push({
      x: (Math.random() - 0.5) * AREA,
      y: Math.random() * HEIGHT,
      z: (Math.random() - 0.5) * AREA,
      speed: 14 + Math.random() * 8,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0x5566aa, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  rain.frustumCulled = false;
  scene.add(rain);

  return {
    update(dt, center) {
      const pos = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        const d = drops[i];
        d.y -= d.speed * dt;
        if (d.y < 0) {
          d.y = HEIGHT;
          d.x = (Math.random() - 0.5) * AREA;
          d.z = (Math.random() - 0.5) * AREA;
        }
        const wx = center.x + d.x, wy = d.y, wz = center.z + d.z;
        pos[i * 6] = wx;     pos[i * 6 + 1] = wy;        pos[i * 6 + 2] = wz;
        pos[i * 6 + 3] = wx; pos[i * 6 + 4] = wy + 0.55; pos[i * 6 + 5] = wz;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

boot().catch((err) => {
  console.error(err);
  statusText.textContent = 'BOOT FAILURE // CHECK CONSOLE';
  sysLine.textContent = '[ SYS.BOOT // STATUS: ERROR ]';
});
