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
  // optional spawn position to place the player at a specific location
  spawnPosition = null, // {x,y,z} or null to compute from terrain
} = {}) {
  if (!scene || !physics || !heightBounds || !camera || !renderer) {
    throw new Error(
      "createPlayer requires scene, physics, heightBounds, camera and renderer",
    );
  }

  // configuration constants (kept here so main.js only touches radius)
  // expose player height for camera/controls.  you can also specify a
  // ``capsuleHeight`` option which is interpreted as the **total** height of
  // the physics capsule (cylinder + 2 hemisphere radii).  That makes the
  // behaviour intuitive: increasing the radius will *not* change the overall
  // height, the cylinder length is adjusted automatically.  If you instead
  // want to control the radius, provide ``capsuleRadius`` as well.
  const PLAYER_HEIGHT = playerOptions.playerHeight ?? 1.6;
  const OVERRIDE_TOTAL_HEIGHT =
    typeof playerOptions.capsuleHeight === "number" ?
      playerOptions.capsuleHeight
    : null;
  const OVERRIDE_RADIUS =
    typeof playerOptions.capsuleRadius === "number" ?
      playerOptions.capsuleRadius
    : null;
  const JUMP_SPEED = playerOptions.jumpSpeed ?? 2;
  const WALK_ACCELERATION = playerOptions.walkAcceleration ?? 5;
  const SPRINT_ACCELERATION = playerOptions.sprintAcceleration ?? 10;
  const MOVEMENT_DAMPING = 20;
  // allow shifting the camera vertically relative to collider
  const CAMERA_Y_OFFSET = playerOptions.cameraYOffset ?? 0;

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

  // compute final radius and cylinder height. if the caller specified a
  // total capsule height we honour it exactly; the cylinder is adjusted
  // to keep the total constant whenever the radius changes. radius may also
  // be overridden independently.
  if (OVERRIDE_RADIUS !== null) {
    capsuleRadius = OVERRIDE_RADIUS;
  }

  // ensure radius fits within the visual player height
  if (PLAYER_HEIGHT < 2 * capsuleRadius) {
    console.warn(
      `[createPlayer] requested HEIGHT ${PLAYER_HEIGHT} < 2*radius (${capsuleRadius}), ` +
        `reducing radius to ${PLAYER_HEIGHT / 2}`,
    );
    capsuleRadius = PLAYER_HEIGHT / 2;
  }

  let playerCapsuleHeight;
  if (OVERRIDE_TOTAL_HEIGHT !== null) {
    const total = OVERRIDE_TOTAL_HEIGHT;
    if (total < 2 * capsuleRadius) {
      console.warn(
        `[createPlayer] requested capsuleHeight ${total} < 2*radius (${capsuleRadius}), ` +
          `reducing radius to ${total / 2}`,
      );
      capsuleRadius = total / 2;
    }
    playerCapsuleHeight = Math.max(0, total - 2 * capsuleRadius);
  } else {
    playerCapsuleHeight = Math.max(0, PLAYER_HEIGHT - 2 * capsuleRadius);
  }
  // decide where the player should start. the caller can specify a
  // custom `spawnPosition` object with x/z (and optionally y) to override
  // the default behaviour. if y is omitted we still compute a sensible height
  // above the terrain so the capsule doesn't start buried.
  const defaultY =
    (heightBounds.max ?? 0) +
    Math.max(playerCapsuleHeight, PLAYER_HEIGHT) / 2 +
    1; // one unit of clearance above ground

  const playerStart = {
    x: spawnPosition?.x ?? 0,
    z: spawnPosition?.z ?? 0,
    y: typeof spawnPosition?.y === "number" ? spawnPosition.y : defaultY,
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

  // Mark player as not selectable in editor
  playerCollider.userData.selectable = false;

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

  // collision group/mask to interact with walls, ground, and objects
  // group 1 = player, 2 = walls, 4 = ground, 8 = objects
  if (
    playerCollider.body &&
    playerCollider.body.setCollisionGroup &&
    playerCollider.body.setCollisionMask
  ) {
    const COLLISION_GROUP_PLAYER = 1 << 0;
    const COLLISION_GROUP_WALL = 1 << 1;
    const COLLISION_GROUP_GROUND = 1 << 2;
    const COLLISION_GROUP_OBJECT = 1 << 3;
    playerCollider.body.setCollisionGroup(COLLISION_GROUP_PLAYER);
    playerCollider.body.setCollisionMask(
      COLLISION_GROUP_PLAYER |
        COLLISION_GROUP_WALL |
        COLLISION_GROUP_GROUND |
        COLLISION_GROUP_OBJECT,
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
    playerCollider.body.setRestitution(2); // Low restitution to prevent bouncing
  }

  // Enable CCD (Continuous Collision Detection) to prevent tunneling through ground
  if (playerCollider.body && playerCollider.body.ammo) {
    const ammoBody = playerCollider.body.ammo;
    // setCcdMotionThreshold: if the body moves more than this in one step, CCD kicks in
    ammoBody.setCcdMotionThreshold(capsuleRadius * 0.5);
    // setCcdSweptSphereRadius: the swept sphere used for CCD
    ammoBody.setCcdSweptSphereRadius(capsuleRadius * 0.8);

    // Set collision margin on capsule shape
    const shape = ammoBody.getCollisionShape();
    if (shape && shape.setMargin) {
      shape.setMargin(0.04);
    }
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

  // Reusable vectors to avoid allocations in update loop (GC optimization)
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _velocity = new THREE.Vector3();

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

    // movement vectors relative to camera orientation (reusing pre-allocated vectors)
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    _right.crossVectors(_forward, camera.up).normalize();

    // desired horizontal velocity (reusing pre-allocated vector)
    _velocity.set(0, 0, 0);
    const walkSpeed = player?.config?.walkAcceleration;
    const sprintSpeed = player?.config?.sprintAcceleration;
    const speed = movement.sprint ? sprintSpeed : walkSpeed;
    if (movement.forward) _velocity.add(_forward);
    if (movement.backward) _velocity.sub(_forward);
    if (movement.left) _velocity.sub(_right);
    if (movement.right) _velocity.add(_right);
    if (_velocity.lengthSq() > 0 && typeof speed === "number")
      _velocity.normalize().multiplyScalar(speed);

    const body = playerCollider.body;
    if (body) {
      // Safety check: teleport player back up if they fell through the ground
      const minY = (heightBounds?.min ?? -10) - 30;
      if (playerCollider.position.y < minY) {
        console.warn("[Player] Fell through ground, resetting position");
        body.setVelocity(0, 0, 0);
        // Properly reset physics body position using Ammo.js transform
        if (body.ammo) {
          const transform = new Ammo.btTransform();
          transform.setIdentity();
          transform.setOrigin(
            new Ammo.btVector3(playerStart.x, playerStart.y + 2, playerStart.z),
          );
          body.ammo.setWorldTransform(transform);
          body.ammo.getMotionState().setWorldTransform(transform);
          body.ammo.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
          body.ammo.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
          body.ammo.activate();
        }
        playerCollider.position.set(
          playerStart.x,
          playerStart.y + 2,
          playerStart.z,
        );
        body.needUpdate = true;
      }

      const currentVel = body.velocity;
      body.setVelocity(_velocity.x, currentVel.y, _velocity.z);
      const now = performance.now();
      const isGroundedNow = Math.abs(currentVel.y) < 1.0;
      if (isGroundedNow) lastGroundedAt = now;
      const canJumpNow = now - lastGroundedAt < 120;
      if (movement.jump && canJumpNow) {
        // use the configured jump speed so caller can adjust gravity
        body.setVelocity(_velocity.x, JUMP_SPEED, _velocity.z);
        movement.jump = false;
        lastGroundedAt = 0;
      }
    }

    // make camera / controls follow the capsule, with optional vertical offset
    camera.position.copy(playerCollider.position);
    if (CAMERA_Y_OFFSET) {
      camera.position.y += CAMERA_Y_OFFSET;
    }
    if (player.controls.getObject) {
      player.controls.getObject().position.copy(playerCollider.position);
      if (CAMERA_Y_OFFSET) {
        player.controls.getObject().position.y += CAMERA_Y_OFFSET;
      }
    }
  }

  // caller may want the movement object or update routine too
  return { playerCollider, player, PLAYER_HEIGHT, movement, update };
}
