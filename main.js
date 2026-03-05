// Main entry for 3D scene setup and animation loop
import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js"; // Terrain/environment
import { createScene } from "./components/createScene.js"; // Scene/camera/renderer
import { loadModel } from "./components/modelLoader.js"; // GLTF model loader
import { createRoomWalls } from "./components/createRoomWalls.js"; // room geometry with optional textures
import { createPlayer } from "./components/playerSetup.js"; // encapsulated player/physics setup
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

  const DEBUG_LOG_MOVEMENT = true; // Set to true to enable console logging of player movement data for debugging

  // ------ ENVIRONMENT SETUP ------
  // Create scene, camera, renderer
  ({ scene, camera, renderer } = await createScene());

  // Set up physics
  const physics = new AmmoPhysics(scene);
  if (DEBUG_LOG_MOVEMENT) physics.debug?.enable();

  // Set up environment textures and terrain
  // const hdrPath = "textures/hdr/sky2.hdr"; // HDRI for sky background and lighting
  const hdrPath = ""; // HDRI for sky background and lighting
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
  // Exaggerate terrain height for debugging
  const planeSize = 25; // Size of terrain plane (must match createEnvironment config)
  const { heightBounds, terrainData: terrainDataLocal } =
    await createEnvironment(
      scene,
      hdrPath,
      texturePaths,
      {
        textureRepeat: 20, // Tiling of floor textures
        planeSize: planeSize, // Size of terrain
        segments: 80, // Grid resolution
        heightScale: 0, // Exaggerated vertical exaggeration for debug
        heightBias: 0, // Lower terrain for debug
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
  const { ceilingSize, ceilingY, wallThickness } = await createRoomWalls({
    scene,
    physics,
    planeSize,
    wallHeight: 5,
    wallThickness: 0.5,
    textureRepeat: 3,
    wallTextures: wallTexturePaths,
    ceilingTextures: {},
  });

  // build player capsule and first-person controller; radius is the only
  // parameter required by main.
  const playerCapsuleRadius = 0.4; // <--- modify this value as needed
  // Set your desired speeds here:
  const walkAcceleration = 4; // Change this value for walk speed
  const sprintAcceleration = 8; // Change this value for sprint speed
  const jumpSpeed = 5; // Change this value for jump speed
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
    },
  });

  // Load animated models and add to scene
  const loader = new GLTFLoader();
  const modelNames = ["hut", "house"];
  const ANIMATION_PLAYBACK_RATE = 0.5; // 1 = source speed, <1 = slower

  const pathToModel = `/models/house.glb`;
  // Place model at center of room, slightly above floor
  const centerY = 0.5; // Adjust if model is below floor
  const position = new THREE.Vector3(2, centerY, 0);
  const scale = 1; // Adjust based on model size and desired scale in scene
  let mass = 0; // Static by default
  const { model, mixer, activeAction, collider } = await loadModel(
    loader,
    pathToModel,
    scale,
    position,
    scene,
    physics,
    {
      mass,
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

  let ceilingLights = [];
  const lightColor = 0xffffff;
  const lightIntensity = 0;

  const lightDistance = 25;
  const lightDecay = 2;

  const numLightsPerSide = 4;
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
        lightIntensity, // Higher intensity for visible beams
        lightDistance, // Longer distance
        lightDecay,
      );
      light.position.set(x, yOffset, z);
      light.angle = Math.PI / 6.5; // Narrow beam
      light.penumbra = 0.4; // Soft edge
      light.castShadow = true;

      ceilingLights.push(light);
      // Set target to floor
      const targetY = 0.1; // Slightly above floor
      light.target.position.set(x, targetY, z);
      scene.add(light.target);
      scene.add(light);
      // // Add a visible sphere to show the light position
      const sphereGeometry = new THREE.SphereGeometry(0.15, 12, 12);
      const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffaa });
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphere.position.set(x, yOffset, z);
      scene.add(sphere);
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

    // update lights based on proximity
    if (playerCollider) {
      const lightActivationDistance = 9; // adjust to taste
      for (const light of ceilingLights) {
        const distanceToPlayer = light.position.distanceTo(
          playerCollider.position,
        );
        light.intensity = distanceToPlayer < lightActivationDistance ? 20.8 : 0;
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
