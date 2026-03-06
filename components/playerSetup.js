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
