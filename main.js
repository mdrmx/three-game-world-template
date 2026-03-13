// Main entry for 3D scene setup and animation loop
import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js"; // Terrain/environment
import { createScene } from "./components/createScene.js"; // Scene/camera/renderer
import { loadModel } from "./components/modelLoader.js"; // GLTF model loader
import { createRoomWalls } from "./components/createRoomWalls.js"; // room geometry with optional textures
import { createPlayer } from "./components/playerSetup.js"; // encapsulated player/physics setup
import {
  createPointLights,
  createCeilingLights,
} from "./components/createLights.js"; // helpers for adding lights
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // Three.js GLTF loader
import { createModeSystem } from "./components/modeSystem.js"; // Editor/Play mode system
// physics
import { AmmoPhysics, PhysicsLoader } from "@enable3d/ammo-physics";

// '/ammo' is the folder where all ammo file are
PhysicsLoader("/ammo", async () => {
  // All code that uses Ammo/AmmoPhysics must be inside this callback!

  // ------------------------------- //
  // --------- SCENE SETUP --------- //
  // ------------------------------- //
  let scene, camera, renderer, terrainData;
  const clock = new THREE.Clock();
  ({ scene, camera, renderer } = await createScene());
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // for example
  renderer.toneMappingExposure = 0.5; // <–– 1 is “normal”, <1 makes the HDRI darker

  // Set up physics with more substeps for reliable collision
  const DEBUG_LOG_MOVEMENT = false; // Set to true to enable console logging of player movement data for debugging

  const physics = new AmmoPhysics(scene, {
    maxSubSteps: 8,
    fixedTimeStep: 1 / 120,
  });

  if (DEBUG_LOG_MOVEMENT) physics.debug?.enable();

  // ------------------------------- //
  // ------ ENVIRONMENT SETUP ------ //
  // ------------------------------- //
  // Set up environment textures and terrain
  const hdrPath = "textures/hdr/sky_night.hdr"; // HDRI for sky background and lighting
  // const hdrPath = ""; // HDRI for sky background and lighting
  const texName = "planks"; // Base name for floor textures (expects _diff, _ao, etc. suffixes)
  const texturePaths = {
    diffuseMap: `textures/floor/${texName}/${texName}_diff.jpg`,
    aoMap: `textures/floor/${texName}/${texName}_ao.jpg`,
    armMap: `textures/floor/${texName}/${texName}_arm.jpg`,
    normalMap: `textures/floor/${texName}/${texName}_nor.jpg`,
    displacementMap: `textures/floor/${texName}/${texName}_disp.jpg`,
    roughnessMap: `textures/floor/${texName}/${texName}_rough.jpg`,
  };

  // Generate terrain and get height data
  // Supports rectangular floors with width/depth
  const floorWidth = 20; // X axis
  const floorDepth = 10; // Z axis
  const {
    heightBounds,
    terrainData: terrainDataLocal,
    floorSize,
  } = await createEnvironment(
    scene,
    hdrPath,
    texturePaths,
    {
      textureRepeat: 1, // Tiling of floor textures
      width: floorWidth, // Rectangular floor width
      depth: floorDepth, // Rectangular floor depth
      segments: 16, // Grid resolution
      heightScale: 0.02, // Vertical exaggeration
      heightBias: 0, // Lower terrain
      // Texture rotation options:
      // - "natural": many angles for organic textures (rocks, grass, dirt)
      // - "aligned": 0° and 180° only for structured textures (planks, tiles)
      // - "none": no rotation
      // - Custom array: [0, Math.PI] or any angles in radians
      textureRotations: "aligned",
    },
    physics,
  );

  // Store terrain data for use in animation loop
  terrainData = heightBounds && terrainDataLocal ? terrainDataLocal : null;

  const wallTexName = "corrugated_iron"; // Base name for floor textures (expects _diff, _ao, etc. suffixes)
  const wallTexturePaths = {
    diffuseMap: `textures/walls/${wallTexName}/${wallTexName}_diff.jpg`,
    // aoMap: `textures/walls/${wallTexName}/${wallTexName}_ao.jpg`,
    armMap: `textures/walls/${wallTexName}/${wallTexName}_arm.jpg`,
    normalMap: `textures/walls/${wallTexName}/${wallTexName}_nor.jpg`,
    displacementMap: `textures/walls/${wallTexName}/${wallTexName}_disp.jpg`,
    // roughnessMap: `textures/walls/${wallTexName}/${wallTexName}_rough.jpg`,
  };
  // build room walls/ceiling; supports rectangular rooms and selective wall creation
  // note: playerCollider not yet available, so collision group update will be
  // handled after the collider is created.
  const { roomSize, ceilingY, wallThickness } = await createRoomWalls({
    scene,
    physics,
    width: floorSize.width, // Use actual floor dimensions
    depth: floorSize.depth,
    wallHeight: 5,
    wallThickness: 0.5,
    segments: 10, // Number of segments for wall geometry
    textureRepeat: 10,
    wallTextures: wallTexturePaths,
    ceilingTextures: {},
    // Select which walls to create (all enabled by default)
    walls: {
      north: false, // Back wall (-Z)
      south: true, // Front wall (+Z)
      east: true, // Right wall (+X)
      west: false, // Left wall (-X)
    },
    ceiling: false, // Toggle roof on/off
  });

  // // optional helper to create a ceiling grid of spotlights (n×n):
  // // Note: ceilingSize format changed - now use roomSize.width/depth
  // let ceilingLights = [];
  // ceilingLights = createCeilingLights(scene, {
  //   ceilingSize: [roomSize.width, wallThickness, roomSize.depth],
  //   ceilingY,
  //   wallThickness,
  //   numLightsPerSide: 4,
  //   color: 0xffffff,
  //   intensity: 200,
  //   distance: 25,
  //   decay: 2,
  //   showHelpers: true, // toggle to see helper spheres
  // });

  // ------------------------------- //
  // --------- PLAYER SETUP -------- //
  // ------------------------------- //
  // specify a spawn point if you want to start somewhere other than the
  // origin; y is optional and computed from the terrain if omitted.
  const playerSpawn = { x: 0, z: 0, y: 3 };
  const playerCapsuleRadius = 0.2; // <--- modify this value as needed
  // Set your desired speeds here:
  const walkAcceleration = 4; // Change this value for walk speed
  const sprintAcceleration = 8; // Change this value for sprint speed
  const jumpSpeed = 5; // Change this value for jump speed
  const playerHeight = 0.6;

  const {
    playerCollider,
    player, // first-person controls wrapper
    PLAYER_HEIGHT: _PLAYER_HEIGHT,
    movement: _playerMovement, // unused helper state
    update: updatePlayer,
  } = await createPlayer({
    scene,
    physics,
    heightBounds,
    terrainData,
    camera,
    renderer,
    capsuleRadius: playerCapsuleRadius,
    playerOptions: {
      walkAcceleration,
      sprintAcceleration,
      jumpSpeed,
      playerHeight,
      cameraYOffset: playerHeight + 0.03, // Camera height is at top of capsule
    },
    spawnPosition: playerSpawn,
  });
  // ------------------------------- //
  // - MODE SYSTEM (Editor / Play) - //
  // ------------------------------- //
  const modeSystem = createModeSystem({
    camera,
    renderer,
    scene,
    player,
    playerCollider,
    playerHeight,
    playerSpawn,
    physics, // Pass physics for transform sync
  });
  // ------------------------------- //
  // -------- MODEL SETUP ---------- //
  // ------------------------------- //
  // Consolidated model configuration - easier to maintain
  const ANIMATION_PLAYBACK_RATE = 1.0; // 1 = source speed, <1 = slower
  const modelConfigs = [
    {
      path: "rhino/source/rhinoThird_twoSevenNine_test.glb",
      scale: 4,
      mass: 1,
      shape: "hull",
      position: [7, 0, 0],
    },
    {
      path: "cat_statue/concrete_cat_statue_4k.gltf",
      scale: 2,
      mass: 1000,
      shape: "box",
      position: [0, 0, 0],
    },
    {
      path: "chair/mid_century_lounge_chair_1k.gltf",
      scale: 1,
      mass: 10,
      shape: "hull",
      position: [-7, 0, 0],
    },
    // {
    //   path: "animated_triceratops_skeleton.glb",
    //   scale: 10,
    //   mass: 0,
    //   shape: "box",
    //   position: [-15, 0, -1],
    // },
    // {
    //   path: "fountain.glb",
    //   scale: 8,
    //   mass: 0,
    //   shape: "concave",
    //   position: [20, -4.5, 0],
    // },
  ];

  // Load all models in parallel for faster startup
  const loader = new GLTFLoader();
  const modelPromises = modelConfigs.map((config) =>
    loadModel(
      loader,
      `/models/${config.path}`,
      config.scale,
      new THREE.Vector3(...config.position),
      scene,
      physics,
      {
        mass: config.mass,
        shape: config.shape,
        colliderOffset: new THREE.Vector3(0, 0, 0),
      },
    ).then((result) => ({ ...result, config })),
  );

  const loadedModels = await Promise.all(modelPromises);

  // Process loaded models
  const models = loadedModels.map((result, index) => {
    const { model, mixer, activeAction, collider, config, clips } = result;

    if (model) {
      model.visible = true;
      model.traverse((child) => {
        if (child.isMesh) {
          child.visible = true;
          if (child.material) child.material.visible = true;
        }
      });
    }

    // Give the collider/model a name for editor selection display
    if (collider) {
      collider.name = config.path.replace(/\.[^.]+$/, "").replace(/\/.*$/, "");
    }

    if (mixer && activeAction) {
      activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
    }

    return {
      name: `model_${index}`,
      model,
      mixer,
      activeAction,
      collider,
      clips,
      config,
      currentClipIndex: 0, // Track which animation is playing
    };
  });

  console.log(`[Engine] Loaded ${models.length} models in parallel`, models);

  // ------------------------------- //
  // ------ LIGHT SETUP ------ //
  // ------------------------------- //

  // Add ambient light for general illumination (optional, can be removed if HDRI provides sufficient lighting)
  // const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Soft white light
  // scene.add(ambientLight);

  let lights = [];
  const lightColor = 0xffffff;
  const lightIntensity = 0;
  const lightDistance = 25;
  const lightDecay = 2;

  // let pointLight = new THREE.PointLight(
  //   lightColor,
  //   lightIntensity,
  //   lightDistance,
  //   lightDecay,
  // );
  // pointLight.position.set(
  //   modelPosition.x,
  //   modelPosition.y + 7,
  //   modelPosition.z,
  // );
  // pointLight.castShadow = true;
  // scene.add(pointLight);

  // let pointLight2 = new THREE.PointLight(
  //   lightColor,
  //   lightIntensity + 100,
  //   lightDistance,
  //   lightDecay,
  // );
  // pointLight2.position.set(
  //   modelPosition.x + 1,
  //   modelPosition.y + 11,
  //   modelPosition.z + 2,
  // );
  // pointLight2.castShadow = true;
  // scene.add(pointLight2);
  // lights.push(pointLight);
  // lights.push(pointLight2);

  // Start animation loop
  renderer.setAnimationLoop(animate);

  // Main animation loop: updates models, player, and renders scene
  function animate() {
    // Essential component: get time delta for smooth animation and physics updates
    const delta = clock.getDelta(); // Time since last frame

    // Essential component: Update all animated models
    for (const model of models) {
      if (model.mixer) model.mixer.update(delta);
    }

    // Mode-specific updates
    if (modeSystem.isEditorMode()) {
      // Editor mode: update orbit controls and picker
      modeSystem.update();
    } else {
      // Play mode: update player movement and physics
      if (typeof updatePlayer === "function") {
        updatePlayer(delta);
      }

      // Optimized light proximity check using squared distance (avoids sqrt)
      // if (playerCollider && lights.length > 0) {
      //   const lightActivationDistanceSq = 16; // 4^2 - compare squared to avoid sqrt
      //   const px = playerCollider.position.x;
      //   const pz = playerCollider.position.z;
      //   for (let i = 0; i < lights.length; i++) {
      //     const light = lights[i];
      //     const dx = light.position.x - px;
      //     const dz = light.position.z - pz;
      //     const distSq = dx * dx + dz * dz;
      //     light.intensity = distSq < lightActivationDistanceSq ? 100 : 0;
      //   }
      // }

      // Essential component:Update physics
      // Clamp delta to prevent physics instability on frame drops
      const clampedDelta = Math.min(delta, 1 / 30); // Cap at ~30fps equivalent
      physics.update(clampedDelta * 1000);
      physics.updateDebugger();
    }

    // Essential component: Render the scene
    renderer.render(scene, camera);
  }
});
