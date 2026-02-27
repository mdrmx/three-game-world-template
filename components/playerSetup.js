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
} = {}) {
  if (!scene || !physics || !heightBounds || !camera || !renderer) {
    throw new Error(
      "createPlayer requires scene, physics, heightBounds, camera and renderer",
    );
  }

  // configuration constants (kept here so main.js only touches radius)
  const PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = 20;
  const WALK_ACCELERATION = 5;
  const SPRINT_ACCELERATION = 10;
  const MOVEMENT_DAMPING = 20;

  // create capsule:
  const playerCapsuleHeight = PLAYER_HEIGHT - 2 * capsuleRadius;
  const playerStart = {
    x: 0,
    y: (heightBounds.max ?? 0) + 5,
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

  return { playerCollider, player, PLAYER_HEIGHT };
}
