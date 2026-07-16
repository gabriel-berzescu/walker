import * as THREE from 'three';

const CUBE_HALF = 0.28;
const MAX_CUBES = 48;
const PALETTE = [0x00f0ff, 0xff00a0, 0xf5d300, 0x9d00ff, 0x00ff9f];

export class Props {
  constructor(scene, world, RAPIER, camera, audio) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.camera = camera;
    this.audio = audio;

    this.cubes = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 22;

    this.geo = new THREE.BoxGeometry(CUBE_HALF * 2, CUBE_HALF * 2, CUBE_HALF * 2);
    this.materials = PALETTE.map((c) => new THREE.MeshStandardMaterial({
      color: 0x0a0a12,
      emissive: c, emissiveIntensity: 1.4,
      roughness: 0.4, metalness: 0.3,
    }));

    // A loose scatter of cubes around spawn to greet the player
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 3.5 + Math.random() * 8;
      this.spawnCube(
        new THREE.Vector3(Math.cos(angle) * dist, 0.6 + Math.random() * 2, Math.sin(angle) * dist),
        new THREE.Vector3(0, 0, 0)
      );
    }

    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement === null || e.button !== 0) return;
      this.pulse();
    });

    document.addEventListener('keydown', (e) => {
      if (document.pointerLockElement === null || e.code !== 'KeyQ') return;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const pos = this.camera.position.clone().addScaledVector(dir, 2.2);
      this.spawnCube(pos, dir.multiplyScalar(4).add(new THREE.Vector3(0, 2.5, 0)));
      this.audio.whoosh();
    });
  }

  spawnCube(position, velocity) {
    if (this.cubes.length >= MAX_CUBES) {
      const oldest = this.cubes.shift();
      this.scene.remove(oldest.mesh);
      this.world.removeRigidBody(oldest.body);
    }

    const mesh = new THREE.Mesh(
      this.geo, this.materials[Math.floor(Math.random() * this.materials.length)]
    );
    mesh.position.copy(position);
    this.scene.add(mesh);

    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setLinearDamping(0.25)
        .setAngularDamping(0.4)
    );
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cuboid(CUBE_HALF, CUBE_HALF, CUBE_HALF)
        .setRestitution(0.45)
        .setFriction(0.7),
      body
    );

    mesh.userData.body = body;
    this.cubes.push({ mesh, body });
  }

  // Left click: nudge whatever cube you're looking at
  pulse() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(this.cubes.map((c) => c.mesh), false);
    if (hits.length === 0) return;

    const body = hits[0].object.userData.body;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const m = body.mass();
    body.applyImpulse(
      { x: dir.x * 3.2 * m, y: (dir.y + 0.9) * 2.6 * m, z: dir.z * 3.2 * m },
      true
    );
    this.audio.thump();
  }

  sync() {
    for (const { mesh, body } of this.cubes) {
      const t = body.translation();
      mesh.position.set(t.x, t.y, t.z);
      const r = body.rotation();
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
