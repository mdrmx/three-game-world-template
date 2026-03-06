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

  // Set up physics
  const physics = new AmmoPhysics(scene);
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
  const planeSize = 150; // Size of terrain plane (must match createEnvironment config)
  const { heightBounds, terrainData: terrainDataLocal } =
    await createEnvironment(
      scene,
      hdrPath,
      texturePaths,
      {
        textureRepeat: 20, // Tiling of floor textures
        planeSize: planeSize, // Size of terrain
        segments: 8, // Grid resolution
        heightScale: 9.2, // Exaggerated vertical exaggeration for debug
        heightBias: -7, // Lower terrain for debug
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
  // build player capsule and first-person controller; radius is the only
  // parameter required by` main.
  const playerCapsuleRadius = 0.2; // <--- modify this value as needed
  // Set your desired speeds here:
  const walkAcceleration = 4; // Change this value for walk speed
  const sprintAcceleration = 8; // Change this value for sprint speed
  const jumpSpeed = 5; // Change this value for jump speed
  const playerHeight = 0.8;

  const {
    playerCollider,
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
  // Place model at center of room, slightly above floor
  const centerY = -3.9; // Adjust if model is below floor
  const modelPosition = new THREE.Vector3(20, centerY, 0);
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
      // rotation will rotate both mesh and collider together
    },
  );

  if (model) {
    // model.position.set(0, 0, 0); // Raise model higher
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

  // add point lights across the ceiling as if it were a gallery space
  // Add ambient light for general illumination
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
    modelPosition.y + 10,
    modelPosition.z + 4,
  );
  pointLight2.castShadow = true;
  scene.add(pointLight2);
  lights.push(pointLight);
  lights.push(pointLight2);

  // Start animation loop
  renderer.setAnimationLoop(animate);

  // Main animation loop: updates models, player, and renders scene
  function animate() {
    const delta = clock.getDelta(); // Time since last frame

    // Update all animated models
    for (const model of models) {
      if (model.mixer) model.mixer.update(delta);
    }

    // update lights based on proximity
    if (playerCollider) {
      const lightActivationDistance = 4; // adjust to taste
      for (const light of lights) {
        const distanceToPlayer = light.position.distanceTo(
          playerCollider.position,
        );
        light.intensity = distanceToPlayer < lightActivationDistance ? 100 : 0;
      }
    }

    // delegate movement & camera syncing to player module
    if (typeof updatePlayer === "function") {
      updatePlayer(delta);
    }

    // Update physics
    physics.update(delta * 1000);
    physics.updateDebugger();

    // Render the scene
    renderer.render(scene, camera);
  }
});
