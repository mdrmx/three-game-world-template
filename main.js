// Main entry for 3D scene setup and animation loop
import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js"; // Terrain/environment
import { createScene } from "./components/createScene.js"; // Scene/camera/renderer
import { loadModel } from "./components/modelLoader.js"; // GLTF model loader
import { firstPersonSetup } from "./components/firstPersonSetup.js"; // First-person controls
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // Three.js GLTF loader

// Scene globals
let scene;
let camera;
let renderer;
let player;
let terrainData;
let PLAYER_HEIGHT;
const models = []; // Array of loaded models

const clock = new THREE.Clock(); // Animation clock

// Toggle for movement debug logging
const DEBUG_LOG_MOVEMENT = false; // Emits delta and velocity diagnostics when physics is off

// Start the app
init();

async function init() {
  // Create scene, camera, renderer
  ({ scene, camera, renderer } = await createScene());

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
    await createEnvironment(scene, hdrPath, texturePaths, {
      textureRepeat: 30, // Tiling of floor textures
      planeSize: 500, // Size of terrain
      segments: 24, // Grid resolution
      heightScale: 15, // Vertical exaggeration of terrain
      heightBias: -10, // Vertical offset of terrain from y=0 plane
    });

  // Player/physics constants
  const FLOOR_LEVEL = 0;
  PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = 20;
  const WALK_ACCELERATION = 100; // Base ground thrust while walking
  const SPRINT_ACCELERATION = 450; // Extra thrust when sprinting
  const MOVEMENT_DAMPING = 20; // Air-resistance style decay

  // Store terrain data for use in animation loop
  terrainData = heightBounds && terrainDataLocal ? terrainDataLocal : null;

  // Set up first-person player controls
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
  });

  // Responsive canvas: update on window resize
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
    const { model, mixer, activeAction } = await loadModel(
      loader,
      pathtoModel,
      22,
      position,
      scene,
    );
    if (mixer && activeAction) {
      activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
    }
    models.push({ name, model, mixer, activeAction });
  }
  // Place huts/houses at fixed Z for demo
  models[0].model.position.set(0, 0.3, -10);
  models[1].model.position.set(10, -2, 10);

  // Start animation loop
  renderer.setAnimationLoop(animate);
}

// Main animation loop: updates models, player, and renders scene
function animate() {
  const delta = clock.getDelta(); // Time since last frame

  // Update all animated models
  for (const model of models) {
    if (model.mixer) model.mixer.update(delta);
  }

  // Update player controls and keep player on terrain
  if (player) {
    player.update(delta);
    if (typeof player.keepOnTerrain === "function") {
      player.keepOnTerrain(terrainData, PLAYER_HEIGHT);
    }
    // Optionally log movement debug info
    if (DEBUG_LOG_MOVEMENT && typeof player.logMovement === "function") {
      player.logMovement(delta);
    }
  }

  // Render the scene

  renderer.render(scene, camera);
}
