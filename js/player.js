import * as THREE from 'three';

const WALK_SPEED = 4.2;
const RUN_SPEED = 7.5;
const JUMP_SPEED = 6.8;
const GRAVITY = 19;
const EYE_OFFSET = 0.65;      // camera height above capsule center
const MOUSE_SENS = 0.0022;

export class Player {
  constructor(camera, world, RAPIER) {
    this.camera = camera;
    this.world = world;

    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.grounded = false;
    this.keys = new Set();
    this.position = new THREE.Vector3(0, 1.05, 0);
    this.prevPosition = this.position.clone();
    this.renderPos = this.position.clone();
    this.smoothY = this.position.y;

    // Kinematic capsule driven by Rapier's character controller
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.05, 0)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.35), this.body
    );

    this.controller = world.createCharacterController(0.08);
    this.controller.enableAutostep(0.5, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === null) return;
      this.yaw -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  fixedUpdate(dt) {
    this.prevPosition.copy(this.position);

    // Movement direction in the horizontal plane, relative to yaw
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW')) iz -= 1;
    if (this.keys.has('KeyS')) iz += 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;

    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      ? RUN_SPEED : WALK_SPEED;

    let dx = 0, dz = 0;
    if (ix !== 0 || iz !== 0) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      dx = (ix * cos + iz * sin) * speed * dt;
      dz = (-ix * sin + iz * cos) * speed * dt;
    }

    this.vy -= GRAVITY * dt;
    if (this.grounded && this.vy < 0) this.vy = -0.8;
    if (this.grounded && this.keys.has('Space')) this.vy = JUMP_SPEED;

    this.controller.computeColliderMovement(
      this.collider, { x: dx, y: this.vy * dt, z: dz }
    );
    this.grounded = this.controller.computedGrounded();

    const move = this.controller.computedMovement();
    const cur = this.body.translation();
    const next = { x: cur.x + move.x, y: cur.y + move.y, z: cur.z + move.z };
    this.body.setNextKinematicTranslation(next);
    this.position.set(next.x, next.y, next.z);

  }

  // alpha in [0,1]: how far we are between two physics steps —
  // the camera follows an interpolated position so it never stutters
  // when the display refresh rate isn't a multiple of the physics rate.
  update(dt, alpha) {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    this.renderPos.copy(this.prevPosition).lerp(this.position, alpha);

    // Damp millimetre-scale vertical noise from ground snapping, but
    // follow instantly on real height changes (jumps, steps, falls).
    if (Math.abs(this.renderPos.y - this.smoothY) > 0.3) {
      this.smoothY = this.renderPos.y;
    } else {
      this.smoothY += (this.renderPos.y - this.smoothY) * Math.min(1, dt * 12);
    }

    this.camera.position.set(
      this.renderPos.x,
      this.smoothY + EYE_OFFSET,
      this.renderPos.z
    );
  }
}
