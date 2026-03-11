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
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"; // Editor orbit controls
import { picker } from "./components/picker.js"; // Object selection for editor
// physics
import { AmmoPhysics, PhysicsLoader } from "@enable3d/ammo-physics";

// '/ammo' is the folder where all ammo file are
PhysicsLoader("/ammo", async () => {
  // All code that uses Ammo/AmmoPhysics must be inside this callback!
  // Declare all variables locally to avoid ReferenceError
  let scene, camera, renderer, terrainData;
  const models = [];
  const clock = new THREE.Clock();

  const DEBUG_LOG_MOVEMENT = false; // Set to true to enable console logging of player movement data for debugging

  // ------ ENVIRONMENT SETUP ------ //
  // Create scene, camera, renderer
  ({ scene, camera, renderer } = await createScene());
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // for example
  renderer.toneMappingExposure = 0.5; // <–– 1 is “normal”, <1 makes the HDRI darker

  // Set up physics with more substeps for reliable collision
  const physics = new AmmoPhysics(scene, {
    maxSubSteps: 4,
    fixedTimeStep: 1 / 120,
  });
  if (DEBUG_LOG_MOVEMENT) physics.debug?.enable();

  // Set up environment textures and terrain
  const hdrPath = "textures/hdr/sky_night.hdr"; // HDRI for sky background and lighting
  // const hdrPath = ""; // HDRI for sky background and lighting
  const texName = "rocks"; // Base name for floor textures (expects _diff, _ao, etc. suffixes)
  const texturePaths = {
    diffuseMap: `textures/floor/${texName}/${texName}_diff.jpg`,
    aoMap: `textures/floor/${texName}/${texName}_ao.jpg`,
    armMap: `textures/floor/${texName}/${texName}_arm.jpg`,
    normalMap: `textures/floor/${texName}/${texName}_nor.jpg`,
    displacementMap: `textures/floor/${texName}/${texName}_disp.jpg`,
    roughnessMap: `textures/floor/${texName}/${texName}_rough.jpg`,
  };

  // Generate terrain and get height data
  // Exaggerate terrain height for debugging
  const planeSize = 100; // Size of terrain plane (must match createEnvironment config)
  const { heightBounds, terrainData: terrainDataLocal } =
    await createEnvironment(
      scene,
      hdrPath,
      texturePaths,
      {
        textureRepeat: 2, // Tiling of floor textures
        planeSize: planeSize, // Size of terrain
        segments: 10, // Grid resolution
        heightScale: 3.2, // Exaggerated vertical exaggeration for debug
        heightBias: -3, // Lower terrain for debug
      },
      physics,
    );

  // Store terrain data for use in animation loop
  terrainData = heightBounds && terrainDataLocal ? terrainDataLocal : null;

  const wallTexName = "damaged_plaster"; // Base name for floor textures (expects _diff, _ao, etc. suffixes)
  const wallTexturePaths = {
    diffuseMap: `textures/walls/${wallTexName}/${wallTexName}_diff.jpg`,
    // aoMap: `textures/walls/${wallTexName}/${wallTexName}_ao.jpg`,
    armMap: `textures/walls/${wallTexName}/${wallTexName}_arm.jpg`,
    normalMap: `textures/walls/${wallTexName}/${wallTexName}_nor.jpg`,
    displacementMap: `textures/walls/${wallTexName}/${wallTexName}_disp.jpg`,
    // roughnessMap: `textures/walls/${wallTexName}/${wallTexName}_rough.jpg`,
  };
  // build room walls/ceiling; returns data used later for lights
  // note: playerCollider not yet available, so collision group update will be
  // handled after the collider is created.
  // const { ceilingSize, ceilingY, wallThickness } = await createRoomWalls({
  //   scene,
  //   physics,
  //   planeSize,
  //   wallHeight: 5,
  //   wallThickness: 0.5,
  //   textureRepeat: 3,
  //   wallTextures: wallTexturePaths,
  //   ceilingTextures: {},
  // });

  // // optional helper to create a ceiling grid of spotlights (n×n):
  // let ceilingLights = [];

  // ceilingLights = createCeilingLights(scene, {
  //   ceilingSize,
  //   ceilingY,
  //   wallThickness,
  //   numLightsPerSide: 4,
  //   color: 0xffffff,
  //   intensity: 200,
  //   distance: 25,
  //   decay: 2,
  //   showHelpers: true, // toggle to see helper spheres
  // });

  // ------ Player SETUP ------ //
  // specify a spawn point if you want to start somewhere other than the
  // origin; y is optional and computed from the terrain if omitted.
  const playerSpawn = { x: 10, z: 0, y: 3 };
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

  // Load animated models and add to scene
  const loader = new GLTFLoader();
  const modelNames = [
    "hut.glb",
    "house.glb",
    "cat_statue/concrete_cat_statue_4k.gltf",
  ];
  const ANIMATION_PLAYBACK_RATE = 0.5; // 1 = source speed, <1 = slower

  const pathToModel = `/models/${modelNames[1]}`;
  const modelPosition = new THREE.Vector3(20, -3.9, 0); // Place model
  const scale = 18; // Adjust based on model size and desired scale in scene
  let mass = 0; // Static by default
  const { model, mixer, activeAction, collider } = await loadModel(
    loader,
    pathToModel,
    scale,
    modelPosition,
    scene,
    physics,
    {
      mass,
      shape: "concave", // Use convex hull for better fitting collider; options are "box", "sphere", "cylinder", "hull"
      colliderOffset: new THREE.Vector3(0, 0, 0), // move box independently
    },
  );

  if (model) {
    model.visible = true;
    // Ensure all child meshes are visible
    model.traverse((child) => {
      if (child.isMesh) {
        child.visible = true;
        if (child.material) child.material.visible = true;
      }
    });
    console.log("[DEBUG] Model loaded:", model);
  }

  // Give the collider/model a name for editor selection display
  if (collider) {
    collider.name = modelNames[1].replace(/\.[^.]+$/, ""); // Use filename without extension
  }

  if (mixer && activeAction) {
    activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
  }

  models.push({
    name: `model_${models.length}`,
    model,
    mixer,
    activeAction,
    collider,
  });

  // Add ambient light for general illumination (optional, can be removed if HDRI provides sufficient lighting)
  // const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Soft white light
  // scene.add(ambientLight);

  let lights = [];
  const lightColor = 0xffffff;
  const lightIntensity = 0;
  const lightDistance = 25;
  const lightDecay = 2;

  let pointLight = new THREE.PointLight(
    lightColor,
    lightIntensity,
    lightDistance,
    lightDecay,
  );
  pointLight.position.set(
    modelPosition.x,
    modelPosition.y + 7,
    modelPosition.z,
  );
  pointLight.castShadow = true;
  scene.add(pointLight);

  let pointLight2 = new THREE.PointLight(
    lightColor,
    lightIntensity + 100,
    lightDistance,
    lightDecay,
  );
  pointLight2.position.set(
    modelPosition.x + 1,
    modelPosition.y + 11,
    modelPosition.z + 2,
  );
  pointLight2.castShadow = true;
  scene.add(pointLight2);
  lights.push(pointLight);
  lights.push(pointLight2);

  // ------ MODE SYSTEM (Editor / Play) ------ //
  // Editor mode: OrbitControls for free camera movement
  // Play mode: First-person pointer lock controls
  let currentMode = "editor"; // "editor" or "play"

  // Set up OrbitControls for editor mode
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 1;
  orbitControls.maxDistance = 500;
  orbitControls.maxPolarAngle = Math.PI / 2 + 0.1; // Slightly below horizon
  // Position camera for editor view
  camera.position.set(playerSpawn.x, playerSpawn.y + 20, playerSpawn.z + 30);
  orbitControls.target.set(playerSpawn.x, playerSpawn.y, playerSpawn.z);
  orbitControls.update();

  // ------ OBJECT SELECTION (Editor Mode) ------ //
  const objectPicker = picker(renderer, scene, camera);
  let selectedObject = null;

  // Selection info UI
  const selectionInfo = document.createElement("div");
  selectionInfo.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-family: sans-serif;
    font-size: 12px;
    border-radius: 4px;
    z-index: 1000;
    display: none;
  `;
  document.body.appendChild(selectionInfo);

  function updateSelectionInfo() {
    if (selectedObject && currentMode === "editor") {
      const name = selectedObject.name || selectedObject.type || "Object";
      const pos = selectedObject.position;
      selectionInfo.innerHTML = `
        <strong>Selected:</strong> ${name}<br>
        <strong>Position:</strong> x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}
      `;
      selectionInfo.style.display = "block";
    } else {
      selectionInfo.style.display = "none";
    }
  }

  objectPicker.onSelect((obj) => {
    selectedObject = obj;
    updateSelectionInfo();
    if (obj) {
      console.log("[Editor] Selected:", obj.name || obj.type, obj);
    } else {
      console.log("[Editor] Selection cleared");
    }
  });

  // Enable picker by default for editor mode
  objectPicker.setEnabled(true);

  // Mode indicator UI
  const modeIndicator = document.createElement("div");
  modeIndicator.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-family: sans-serif;
    font-size: 14px;
    border-radius: 4px;
    z-index: 1000;
  `;
  document.body.appendChild(modeIndicator);

  function updateModeIndicator() {
    modeIndicator.textContent =
      currentMode === "editor" ?
        "EDITOR MODE (Press L for Play)"
      : "PLAY MODE (Press L for Editor)";
  }
  updateModeIndicator();

  // Toggle between modes with L key
  function switchToEditorMode() {
    currentMode = "editor";
    window.__disablePointerLock = true; // Prevent click-to-lock in editor
    orbitControls.enabled = true;
    objectPicker.setEnabled(true); // Enable object selection
    // Hide pointer lock hint
    const hint = document.getElementById("pointer-lock-hint");
    if (hint) hint.style.display = "none";
    // Unlock pointer if locked
    if (player?.controls?.isLocked) {
      player.controls.unlock();
    }
    // Position orbit camera at current player position, looking at player
    if (playerCollider) {
      const pos = playerCollider.position;
      camera.position.set(pos.x, pos.y + 15, pos.z + 20);
      orbitControls.target.set(pos.x, pos.y, pos.z);
      orbitControls.update();
    }
    updateModeIndicator();
    updateSelectionInfo();
  }

  function switchToPlayMode() {
    currentMode = "play";
    window.__disablePointerLock = false; // Allow pointer lock in play mode
    orbitControls.enabled = false;
    objectPicker.setEnabled(false); // Disable object selection
    selectionInfo.style.display = "none"; // Hide selection info
    // Show pointer lock hint
    const hint = document.getElementById("pointer-lock-hint");
    if (hint) hint.style.display = "";
    // Position camera at player capsule
    if (playerCollider) {
      camera.position.copy(playerCollider.position);
      camera.position.y += playerHeight + 0.03;
    }
    // Lock pointer for first-person controls
    if (player?.controls && !player.controls.isLocked) {
      player.controls.lock();
    }
    updateModeIndicator();
  }

  // Initialize in editor mode
  window.__disablePointerLock = true;

  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyL") {
      if (currentMode === "editor") {
        switchToPlayMode();
      } else {
        switchToEditorMode();
      }
    }
  });

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
    if (currentMode === "editor") {
      // Editor mode: update orbit controls and picker
      orbitControls.update();
      objectPicker.update();
    } else {
      // Play mode: update player movement and physics
      if (typeof updatePlayer === "function") {
        updatePlayer(delta);
      }

      // Custom code: Example of dynamic light intensity based on player proximity to the model
      // update lights based on proximity
      if (playerCollider) {
        const lightActivationDistance = 4; // adjust to taste
        for (const light of lights) {
          const distanceToPlayer = light.position.distanceTo(
            playerCollider.position,
          );
          light.intensity =
            distanceToPlayer < lightActivationDistance ? 100 : 0;
        }
      }

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
