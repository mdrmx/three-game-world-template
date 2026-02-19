import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js";
import { createScene } from "./components/createScene.js";
import { loadModel } from "./components/modelLoader.js";
import { firstPersonSetup } from "./components/firstPersonSetup.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// physics
// Removed Ammo physics imports

let scene;
let camera;
let renderer;
let player;
let terrainData;
let PLAYER_HEIGHT;
const models = [];
const clock = new THREE.Clock();

const DEBUG_LOG_MOVEMENT = false; // Emits delta and velocity diagnostics when physics is off

init();

async function init() {
  ({ scene, camera, renderer } = await createScene());

  const hdrPath = "textures/hdr/sky2.hdr"; //HDRI for sky background and environment lighting
  const texturePaths = {
    diffuseMap: "textures/floor/rocks_diff.jpg",
    aoMap: "textures/floor/rocks_ao.jpg",
    armMap: "textures/floor/rocks_arm.jpg",
    normalMap: "textures/floor/rocks_nor.jpg",
    displacementMap: "textures/floor/rocks_disp.jpg",
    roughnessMap: "textures/floor/rocks_rough.jpg",
  };

  const { heightBounds, terrainData: terrainDataLocal } =
    await createEnvironment(scene, hdrPath, texturePaths, {
      planeSize: 600,
      segments: 32,
      heightScale: 20,
      heightBias: -10,
    });

  //set up first-person controls and constant for player movement and physics
  const FLOOR_LEVEL = 0;
  PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = 20;
  const WALK_ACCELERATION = 100; //base ground thrust while walking
  const SPRINT_ACCELERATION = 450; //extra thrust when sprint modifier is held
  const MOVEMENT_DAMPING = 20; //air-resistance style decay applied every frame

  terrainData = heightBounds && terrainDataLocal ? terrainDataLocal : null;

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

  camera.position.y = FLOOR_LEVEL + PLAYER_HEIGHT; //set camera height to average human eye level for better first-person experience

  //make canvas responsive to window resizing
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  //////////////import object + animation config///////////////
  const loader = new GLTFLoader();
  const modelNames = ["hut", "house"];
  const ANIMATION_PLAYBACK_RATE = 0.5; // 1 preserves source speed; lower slows animation

  for (const name of modelNames) {
    const pathtoModel = `public/models/${name}.glb`;
    const randX = Math.random() * 100 - 50;
    const randZ = Math.random() * 100 - 50;
    const position = new THREE.Vector3(randX, 5, randZ);
    const { model, mixer, activeAction } = await loadModel(
      loader,
      pathtoModel,
      position,
      scene,
      camera,
    );
    if (mixer && activeAction) {
      activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
    }
    models.push({ name, model, mixer, activeAction });
  }
  models[0].model.position.set(0, 0, -10);

  models[1].model.position.set(0, 0, 10);

  renderer.setAnimationLoop(animate);
}

function animate() {
  const delta = clock.getDelta();

  for (const model of models) {
    if (model.mixer) model.mixer.update(delta);
  }

  if (player) {
    player.update(delta);
    if (typeof player.keepOnTerrain === "function") {
      player.keepOnTerrain(terrainData, PLAYER_HEIGHT);
    }
    if (DEBUG_LOG_MOVEMENT && typeof player.logMovement === "function") {
      player.logMovement(delta);
    }
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}
