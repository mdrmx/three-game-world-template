// Main entry for 3D scene setup and animation loop
import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js"; // Terrain/environment
import { createScene } from "./components/createScene.js"; // Scene/camera/renderer
import { loadModel } from "./components/modelLoader.js"; // GLTF model loader
import { firstPersonSetup } from "./components/firstPersonSetup.js"; // First-person controls
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // Three.js GLTF loader
// physics
import {
  AmmoPhysics,
  ExtendedMesh,
  PhysicsLoader,
} from "@enable3d/ammo-physics";

// '/ammo' is the folder where all ammo file are
PhysicsLoader("/ammo", async () => {
  // --- PLAYER MOVEMENT STATE ---
  const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    canJump: true,
    sprint: false,
  };

  // Keyboard controls for WASD + jump
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyW") movement.forward = true;
    if (e.code === "KeyS") movement.backward = true;
    if (e.code === "KeyA") movement.left = true;
    if (e.code === "KeyD") movement.right = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      movement.sprint = true;
    if (e.code === "Space" && movement.canJump) movement.jump = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") movement.forward = false;
    if (e.code === "KeyS") movement.backward = false;
    if (e.code === "KeyA") movement.left = false;
    if (e.code === "KeyD") movement.right = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      movement.sprint = false;
    if (e.code === "Space") movement.jump = false;
  });
  // All code that uses Ammo/AmmoPhysics must be inside this callback!
  // Declare all variables locally to avoid ReferenceError
  let scene, camera, renderer, player, terrainData, PLAYER_HEIGHT;
  const models = [];
  const clock = new THREE.Clock();

  const DEBUG_LOG_MOVEMENT = false; // Set to true to enable console logging of player movement data for debugging

  // Create scene, camera, renderer
  ({ scene, camera, renderer } = await createScene());

  // Set up physics
  const physics = new AmmoPhysics(scene);
  if (DEBUG_LOG_MOVEMENT) physics.debug?.enable();

  // Set up environment textures and terrain
  const hdrPath = "textures/hdr/sky2.hdr"; // HDRI for sky background and lighting
  const texName = "rocks"; // Base name for floor textures (expects _diff, _ao, etc. suffixes)
  const texturePaths = {
    diffuseMap: `textures/floor/${texName}/${texName}_diff.jpg`,
    aoMap: `textures/floor/${texName}/${texName}_ao.jpg`,
    armMap: `textures/floor/${texName}/${texName}_arm.jpg`,
    normalMap: `textures/floor/${texName}/${texName}_nor.jpg`,
    displacementMap: `textures/floor/${texName}/${texName}_disp.jpg`,
    roughnessMap: `textures/floor/${texName}/${texName}_rough.jpg`,
  };
  // const texturePaths = "textures/floor/rocks_diff.jpg";

  // Generate terrain and get height data
  const { heightBounds, terrainData: terrainDataLocal } =
    await createEnvironment(
      scene,
      hdrPath,
      texturePaths,
      {
        textureRepeat: 30, // Tiling of floor textures
        planeSize: 500, // Size of terrain
        segments: 24, // Grid resolution
        heightScale: 15, // Vertical exaggeration of terrain
        heightBias: -10, // Vertical offset of terrain from y=0 plane
      },
      physics,
    );

  // Player/physics constants
  const FLOOR_LEVEL = 0;
  PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = 20;
  const WALK_ACCELERATION = 100; // Base ground thrust while walking
  const SPRINT_ACCELERATION = 450; // Extra thrust when sprinting
  const MOVEMENT_DAMPING = 20; // Air-resistance style decay

  // Store terrain data for use in animation loop
  terrainData = heightBounds && terrainDataLocal ? terrainDataLocal : null;

  // Add a physics capsule for the player (better for character movement)
  const playerCapsuleRadius = 0.4;
  const playerCapsuleHeight = PLAYER_HEIGHT - 2 * playerCapsuleRadius;
  const playerStart = { x: 0, y: PLAYER_HEIGHT / 2 + 2, z: 0 };
  const playerCollider = physics.add.capsule(
    {
      radius: playerCapsuleRadius,
      height: playerCapsuleHeight,
      ...playerStart,
      mass: 80,
    },
    { lambert: { color: 0x00ff00, transparent: true, opacity: 0 } },
  );
  // Hide collider visually
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
  scene.add(playerCollider);
  // Prevent capsule from tipping over (lock rotation and add angular damping)
  if (playerCollider.body) {
    // Lock rotation on X and Z axes (allow Y for turning if needed)
    playerCollider.body.setAngularFactor(0, 1, 0);
    // Add angular damping to reduce spinning (setDamping(linear, angular))
    if (typeof playerCollider.body.setDamping === "function") {
      playerCollider.body.setDamping(0.01, 0.99);
    }
  }

  // Set up first-person player controls, pass collider
  player = await firstPersonSetup(camera, renderer, {
    floorLevel: FLOOR_LEVEL,
    playerHeight: PLAYER_HEIGHT,
    gravity: 28,
    walkAcceleration: WALK_ACCELERATION,
    sprintAcceleration: SPRINT_ACCELERATION,
    movementDamping: MOVEMENT_DAMPING,
    jumpSpeed: JUMP_SPEED,
    terrainBounds: heightBounds,
    terrainData,
    dynamicCapsule: playerCollider,
    capsuleOffset: { x: 0, y: 0, z: 0 },
  });

  // Load animated models and add to scene
  const loader = new GLTFLoader();
  const modelNames = ["hut", "house"];
  const ANIMATION_PLAYBACK_RATE = 0.5; // 1 = source speed, <1 = slower

  for (const name of modelNames) {
    const pathtoModel = `public/models/${name}.glb`;
    // Place models at random X/Z positions
    const randX = Math.random() * 200 - 50;
    const randZ = Math.random() * 100 - 50;
    const position = new THREE.Vector3(randX, 5, randZ);
    const { model, mixer, activeAction, collider } = await loadModel(
      loader,
      pathtoModel,
      22,
      position,
      scene,
      physics,
    );
    if (mixer && activeAction) {
      activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
    }
    models.push({ name, model, mixer, activeAction, collider });
  }

  // Start animation loop
  renderer.setAnimationLoop(animate);

  // Main animation loop: updates models, player, and renders scene
  function animate() {
    const delta = clock.getDelta(); // Time since last frame

    // Update all animated models
    for (const model of models) {
      if (model.mixer) model.mixer.update(delta);
    }

    // --- PLAYER PHYSICS MOVEMENT ---
    if (
      playerCollider &&
      player &&
      player.controls &&
      player.controls.isLocked
    ) {
      // Get forward/right vectors from camera
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3();
      right.crossVectors(forward, camera.up).normalize();

      // Calculate desired velocity
      let velocity = new THREE.Vector3();
      const walkSpeed = 8;
      const sprintSpeed = 16;
      const speed = movement.sprint ? sprintSpeed : walkSpeed;
      if (movement.forward) velocity.add(forward);
      if (movement.backward) velocity.sub(forward);
      if (movement.left) velocity.sub(right);
      if (movement.right) velocity.add(right);
      if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(speed);

      // Set collider velocity (keep y velocity for gravity/jump)
      const body = playerCollider.body;
      if (body) {
        const currentVel = body.velocity;
        body.setVelocity(velocity.x, currentVel.y, velocity.z);
        // Jump
        if (
          movement.jump &&
          movement.canJump &&
          Math.abs(currentVel.y) < 0.05
        ) {
          body.setVelocity(currentVel.x, 10, currentVel.z);
          movement.canJump = false;
        }
        // Reset jump when on ground
        if (Math.abs(currentVel.y) < 0.05) {
          movement.canJump = true;
        }
      }

      // Camera/player follows the collider
      camera.position.copy(playerCollider.position);
      if (player.controls.getObject) {
        player.controls.getObject().position.copy(playerCollider.position);
      }
    }

    // Update physics
    physics.update(delta * 1000);
    physics.updateDebugger();

    // Update player controls and keep player on terrain
    // Only update player logic if physics is NOT controlling the player
    const physicsActive =
      playerCollider && player && player.controls && player.controls.isLocked;
    if (player && !physicsActive) {
      player.update(delta);
      if (typeof player.keepOnTerrain === "function") {
        player.keepOnTerrain(terrainData, PLAYER_HEIGHT);
      }
    }

    // Render the scene
    renderer.render(scene, camera);
  }
});
