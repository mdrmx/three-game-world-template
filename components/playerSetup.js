import * as THREE from "three";
import { firstPersonSetup } from "./firstPersonSetup.js";

// encapsulates all of the player/physics initialization that used to live in
// main.js.  The only argument the caller normally needs to supply is the
// capsule radius; everything else is internal (gravity, jump speed, movement
// configuration, collision masks, etc).  Returns the created collider and the
// object returned by firstPersonSetup so the caller can keep the reference.
//
// options:
//   physics       - AmmoPhysics instance (required)
//   heightBounds  - terrain height bounds object ({min,max}) used to choose
//                   a sensible spawn height (required)
//   terrainData   - optional terrain data grid passed through to firstPerson
//                   controls for keeping the player on the ground
//   camera        - THREE.Camera instance (required)
//   renderer      - THREE.Renderer used by firstPersonSetup (required)
//   capsuleRadius - number, default 0.4
//   floorLevel    - number, default 0 (used by firstPersonSetup)
//
export async function createPlayer({
  scene,
  physics,
  heightBounds,
  terrainData = null,
  camera,
  renderer,
  capsuleRadius = 0.4,
  floorLevel = 0,
  playerOptions = {},
} = {}) {
  if (!scene || !physics || !heightBounds || !camera || !renderer) {
    throw new Error(
      "createPlayer requires scene, physics, heightBounds, camera and renderer",
    );
  }

  // configuration constants (kept here so main.js only touches radius)
  const PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = playerOptions.jumpSpeed ?? 2;
  const WALK_ACCELERATION = playerOptions.walkAcceleration ?? 5;
  const SPRINT_ACCELERATION = playerOptions.sprintAcceleration ?? 10;
  const MOVEMENT_DAMPING = 20;

  // state used by movement code and returned for debugging if caller wants it
  const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    canJump: true,
    sprint: false,
  };

  // keep track of when the capsule last touched ground for jump logic
  let lastGroundedAt = 0;

  // keyboard input helpers (WASD + jump/sprint)
  const onKeyDown = (e) => {
    if (e.code === "KeyW") movement.forward = true;
    if (e.code === "KeyS") movement.backward = true;
    if (e.code === "KeyA") movement.left = true;
    if (e.code === "KeyD") movement.right = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      movement.sprint = true;
    if (e.code === "Space") movement.jump = true;
  };
  const onKeyUp = (e) => {
    if (e.code === "KeyW") movement.forward = false;
    if (e.code === "KeyS") movement.backward = false;
    if (e.code === "KeyA") movement.left = false;
    if (e.code === "KeyD") movement.right = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      movement.sprint = false;
    if (e.code === "Space") movement.jump = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // create capsule:
  const playerCapsuleHeight = PLAYER_HEIGHT - 2 * capsuleRadius;
  const playerStart = {
    x: 0,
    // ensure heightBounds.max is used then add player height & a margin
    y: (heightBounds.max ?? 0) + PLAYER_HEIGHT + 1,
    z: 0,
  };

  const playerCollider = physics.add.capsule(
    {
      radius: capsuleRadius,
      height: playerCapsuleHeight,
      ...playerStart,
      mass: 80,
    },
    { lambert: { color: 0x00ff00, transparent: true, opacity: 0 } },
  );

  // hide the visible geometry
  const playerMaterials =
    Array.isArray(playerCollider.material) ?
      playerCollider.material
    : [playerCollider.material];
  playerMaterials.forEach((mat) => {
    if (!mat) return;
    mat.transparent = true;
    mat.opacity = 0;
    mat.depthWrite = false;
  });

  // collision group/mask to interact with walls (group 1 = player, 2 = walls)
  if (
    playerCollider.body &&
    playerCollider.body.setCollisionGroup &&
    playerCollider.body.setCollisionMask
  ) {
    const COLLISION_GROUP_PLAYER = 1 << 0;
    const COLLISION_GROUP_WALL = 1 << 1;
    playerCollider.body.setCollisionGroup(COLLISION_GROUP_PLAYER);
    playerCollider.body.setCollisionMask(
      COLLISION_GROUP_PLAYER | COLLISION_GROUP_WALL,
    );
  }

  // keep capsule upright and add damping / debug kick
  if (playerCollider.body) {
    playerCollider.body.setAngularFactor(0, 1, 0);
    if (typeof playerCollider.body.setDamping === "function") {
      playerCollider.body.setDamping(0.01, 0.99);
    }
    if (!window._capsuleKickDone) {
      window._capsuleKickDone = true;
      if (typeof playerCollider.body.setVelocity === "function") {
        playerCollider.body.setVelocity(0, 5, 0);
        console.log("[DEBUG] Applied velocity kick to capsule.");
      } else if (playerCollider.body.ammo) {
        try {
          const ammoBody = playerCollider.body.ammo;
          if (ammoBody && ammoBody.setLinearVelocity) {
            const v = new Ammo.btVector3(0, 5, 0);
            ammoBody.setLinearVelocity(v);
          }
        } catch (e) {
          console.warn("[DEBUG] Could not access raw Ammo.js body:", e);
        }
      }
    }
  }
  if (
    playerCollider.body &&
    typeof playerCollider.body.setRestitution === "function"
  ) {
    playerCollider.body.setRestitution(20); // Set to your desired value
  }
  // add capsule to scene
  scene.add(playerCollider);

  // set up first-person controls; mostly defaults are fine
  const player = await firstPersonSetup(camera, renderer, {
    floorLevel,
    playerHeight: PLAYER_HEIGHT,
    gravity: 28,
    walkAcceleration: WALK_ACCELERATION,
    sprintAcceleration: SPRINT_ACCELERATION,
    movementDamping: MOVEMENT_DAMPING,
    jumpSpeed: JUMP_SPEED,
    terrainBounds: heightBounds,
    terrainData,
    dynamicCapsule: playerCollider,
  });

  // update() will be called every frame by the caller; it drives physics based
  // movement, jumping, and keeps the camera/controller synced with the capsule.
  function update(delta) {
    if (
      !playerCollider ||
      !player ||
      !player.controls ||
      !player.controls.isLocked
    ) {
      return;
    }

    // movement vectors relative to camera orientation
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();

    // desired horizontal velocity
    let velocity = new THREE.Vector3();
    const walkSpeed = player?.config?.walkAcceleration;
    const sprintSpeed = player?.config?.sprintAcceleration;
    const speed = movement.sprint ? sprintSpeed : walkSpeed;
    if (movement.forward) velocity.add(forward);
    if (movement.backward) velocity.sub(forward);
    if (movement.left) velocity.sub(right);
    if (movement.right) velocity.add(right);
    if (velocity.lengthSq() > 0 && typeof speed === "number")
      velocity.normalize().multiplyScalar(speed);

    const body = playerCollider.body;
    if (body) {
      const currentVel = body.velocity;
      body.setVelocity(velocity.x, currentVel.y, velocity.z);
      const now = performance.now();
      const isGroundedNow = Math.abs(currentVel.y) < 1.0;
      if (isGroundedNow) lastGroundedAt = now;
      const canJumpNow = now - lastGroundedAt < 120;
      if (movement.jump && canJumpNow) {
        // use the configured jump speed so caller can adjust gravity
        body.setVelocity(velocity.x, JUMP_SPEED, velocity.z);
        movement.jump = false;
        lastGroundedAt = 0;
      }
    }

    // make camera / controls follow the capsule
    camera.position.copy(playerCollider.position);
    if (player.controls.getObject) {
      player.controls.getObject().position.copy(playerCollider.position);
    }
  }

  // caller may want the movement object or update routine too
  return { playerCollider, player, PLAYER_HEIGHT, movement, update };
}
