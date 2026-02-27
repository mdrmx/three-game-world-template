// Main entry for 3D scene setup and animation loop
import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js"; // Terrain/environment
import { createScene } from "./components/createScene.js"; // Scene/camera/renderer
import { loadModel } from "./components/modelLoader.js"; // GLTF model loader
import { createRoomWalls } from "./components/createRoomWalls.js"; // room geometry with optional textures
import {
  firstPersonSetup,
  setupMovement,
} from "./components/firstPersonSetup.js"; // First-person controls
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // Three.js GLTF loader
// physics
import {
  AmmoPhysics,
  ExtendedMesh,
  PhysicsLoader,
} from "@enable3d/ammo-physics";
import { plane } from "three/examples/jsm/Addons.js";

// '/ammo' is the folder where all ammo file are
PhysicsLoader("/ammo", async () => {
  // ------ PLAYER MOVEMENT STATE ------
  const movement = setupMovement();

  // All code that uses Ammo/AmmoPhysics must be inside this callback!
  // Declare all variables locally to avoid ReferenceError
  let scene, camera, renderer, player, terrainData, PLAYER_HEIGHT;
  const models = [];
  const clock = new THREE.Clock();

  const DEBUG_LOG_MOVEMENT = true; // Set to true to enable console logging of player movement data for debugging

  // ------ ENVIRONMENT SETUP ------
  // Create scene, camera, renderer
  ({ scene, camera, renderer } = await createScene());

  // Set up physics
  const physics = new AmmoPhysics(scene);
  if (DEBUG_LOG_MOVEMENT) physics.debug?.enable();

  // Set up environment textures and terrain
  // const hdrPath = "textures/hdr/sky2.hdr"; // HDRI for sky background and lighting
  const hdrPath = null; // HDRI for sky background and lighting
  const texName = "planks"; // Base name for floor textures (expects _diff, _ao, etc. suffixes)
  const texturePaths = {
    diffuseMap: `textures/floor/${texName}/${texName}_diff_2k.jpg`,
    aoMap: `textures/floor/${texName}/${texName}_ao_2k.jpg`,
    armMap: `textures/floor/${texName}/${texName}_arm_2k.jpg`,
    normalMap: `textures/floor/${texName}/${texName}_nor_gl_2k.jpg`,
    displacementMap: `textures/floor/${texName}/${texName}_disp_2k.jpg`,
    roughnessMap: `textures/floor/${texName}/${texName}_rough_2k.jpg`,
  };

  // Generate terrain and get height data
  // Exaggerate terrain height for debugging
  const planeSize = 20; // Size of terrain plane (must match createEnvironment config)
  const { heightBounds, terrainData: terrainDataLocal } =
    await createEnvironment(
      scene,
      hdrPath,
      texturePaths,
      {
        textureRepeat: 10, // Tiling of floor textures
        planeSize: planeSize, // Size of terrain
        segments: 100, // Grid resolution
        heightScale: 0, // Exaggerated vertical exaggeration for debug
        heightBias: 0, // Lower terrain for debug
      },
      physics,
    );

  // Player/physics constants
  const FLOOR_LEVEL = 0;
  PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = 20;
  const WALK_ACCELERATION = 5; // Base ground thrust while walking
  const SPRINT_ACCELERATION = 10; // Extra thrust when sprinting
  const MOVEMENT_DAMPING = 20; // Air-resistance style decay

  // Store terrain data for use in animation loop
  terrainData = heightBounds && terrainDataLocal ? terrainDataLocal : null;

  // Add a physics capsule for the player (better for character movement)
  const playerCapsuleRadius = 0.4;
  const playerCapsuleHeight = PLAYER_HEIGHT - 2 * playerCapsuleRadius;
  // Start player well above the highest terrain point for gravity to act
  const playerStart = { x: 0, y: (heightBounds.max ?? 0) + 5, z: 0 };
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

  // build room walls/ceiling; returns data used later for lights
  const { ceilingSize, ceilingY, wallThickness } = await createRoomWalls({
    scene,
    physics,
    planeSize,
    // you can supply texture paths objects here, e.g.:
    // wallTextures: { diffuseMap: "textures/wall/diff.jpg" , ... },
    // ceilingTextures: { diffuseMap: "textures/ceiling/diff.jpg" , ... },
    textureRepeat: 10, // adjust tiling on walls/ceiling
    playerCollider,
  });
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
    // One-time velocity kick for debug
    if (!window._capsuleKickDone) {
      window._capsuleKickDone = true;
      if (typeof playerCollider.body.setVelocity === "function") {
        playerCollider.body.setVelocity(0, 5, 0);
        console.log("[DEBUG] Applied velocity kick to capsule.");
      } else if (playerCollider.body.ammo) {
        // Try to access raw Ammo.js body
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
    // No capsuleOffset
  });

  // Load animated models and add to scene
  const loader = new GLTFLoader();
  const modelNames = ["hut", "house"];
  const ANIMATION_PLAYBACK_RATE = 0.5; // 1 = source speed, <1 = slower

  const pathToModel = `/models/tolerance_statue.glb`;
  // Place model at center of room, slightly above floor
  const centerY = 0.5; // Adjust if model is below floor
  const position = new THREE.Vector3(2, centerY, 0);
  const scale = 3.5; // Adjust based on model size and desired scale in scene
  let mass = 0; // Static by default
  const { model, mixer, activeAction, collider } = await loadModel(
    loader,
    pathToModel,
    scale,
    position,
    scene,
    physics,
    { mass },
  );

  if (model) {
    model.position.set(0, -0.4, 0); // Raise model higher
    model.visible = true;
    model.rotation.x = -Math.PI / 2; // Fix Z-up orientation
    // Ensure all child meshes are visible
    model.traverse((child) => {
      if (child.isMesh) {
        child.visible = true;
        if (child.material) child.material.visible = true;
      }
    });
    console.log("[DEBUG] Model loaded:", model);
  }
  if (mixer && activeAction) {
    activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
  }

  models.push({
    name: "tolerance_statue",
    model,
    mixer,
    activeAction,
    collider,
  });
  // for (const name of modelNames) {
  //   const pathtoModel = `public/models/${name}.glb`;
  //   // Place models at random X/Z positions
  //   const randX = Math.random() * 200 - 50;
  //   const randZ = Math.random() * 100 - 50;
  //   const position = new THREE.Vector3(randX, -1, randZ);
  //   // Set mass: hut static, house dynamic (example)
  //   let mass = 0;
  //   if (name === "hut") mass = 0; // static
  //   if (name === "house") mass = 0; // dynamic (default)
  //   const { model, mixer, activeAction, collider } = await loadModel(
  //     loader,
  //     pathtoModel,
  //     22,
  //     position,
  //     scene,
  //     physics,
  //     { mass },
  //   );
  //   if (mixer && activeAction) {
  //     activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
  //   }
  //   models.push({ name, model, mixer, activeAction, collider });
  // }

  // add point lights across the ceiling as if it were a gallery space
  // Add ambient light for general illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Soft white light
  scene.add(ambientLight);
  const lightColor = 0xffffff;
  const lightIntensity = 0.8;
  const lightDistance = 10;
  const lightDecay = 2;

  const numLightsPerSide = 2;
  // Use ceilingSize[0] for X, ceilingSize[2] for Z
  for (let i = 0; i < numLightsPerSide; i++) {
    for (let j = 0; j < numLightsPerSide; j++) {
      const x =
        -ceilingSize[0] / 2 +
        (ceilingSize[0] / (numLightsPerSide + 1)) * (i + 1);
      const z =
        -ceilingSize[2] / 2 +
        (ceilingSize[2] / (numLightsPerSide + 1)) * (j + 1);
      const yOffset = ceilingY - wallThickness / 2 + 0.1;
      const light = new THREE.SpotLight(
        lightColor,
        10.0, // Higher intensity for visible beams
        30, // Longer distance
        lightDecay,
      );
      light.position.set(x, yOffset, z);
      light.angle = Math.PI / 6.5; // Narrow beam
      light.penumbra = 0.4; // Soft edge
      light.castShadow = true;
      // Set target to floor
      const targetY = 0.1; // Slightly above floor
      light.target.position.set(x, targetY, z);
      scene.add(light.target);
      scene.add(light);
      // Add a visible sphere to show the light position
      const sphereGeometry = new THREE.SphereGeometry(0.15, 12, 12);
      const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffaa });
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphere.position.set(x, yOffset, z);
      scene.add(sphere);

      // model.position.set(x - 3, -0.4, z); // Raise model higher
    }
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
      // Use player config for movement speed
      const walkSpeed = player?.config?.walkAcceleration ?? 8;
      const sprintSpeed = player?.config?.sprintAcceleration ?? 16;
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

      // Camera/player follows the collider exactly (no extra offset)
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
