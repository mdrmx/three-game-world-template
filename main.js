import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js";
import { createScene } from "./components/createScene.js";
import { loadModel } from "./components/modelLoader.js";
import { firstPersonSetup } from "./components/firstPersonSetup.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// physics
import {
  AmmoPhysics,
  ExtendedMesh,
  PhysicsLoader,
} from "@enable3d/ammo-physics";

const { scene, camera, renderer } = await createScene();

const hdrPath = "textures/hdr/sky2.hdr"; //HDRI for sky background and environment lighting
const texturePaths = {
  diffuseMap: "textures/floor/rocks_diff.jpg",
  aoMap: "textures/floor/rocks_ao.jpg",
  armMap: "textures/floor/rocks_arm.jpg",
  normalMap: "textures/floor/rocks_nor.jpg",
  displacementMap: "textures/floor/rocks_disp.jpg",
  roughnessMap: "textures/floor/rocks_rough.jpg",
};

const { floor } = await createEnvironment(scene, hdrPath, texturePaths);

//set up first-person controls and constant for player movement and physics
const FLOOR_LEVEL = 0;
const PLAYER_HEIGHT = 1.6;
const GRAVITY = 28;
const JUMP_SPEED = 20;
const WALK_ACCELERATION = 100; //base ground thrust while walking
const SPRINT_ACCELERATION = 150; //extra thrust when sprint modifier is held
const MOVEMENT_DAMPING = 12; //air-resistance style decay applied every frame

const player = await firstPersonSetup(camera, renderer, {
  floorLevel: FLOOR_LEVEL,
  playerHeight: PLAYER_HEIGHT,
  gravity: GRAVITY,
  walkAcceleration: WALK_ACCELERATION,
  sprintAcceleration: SPRINT_ACCELERATION,
  movementDamping: MOVEMENT_DAMPING,
  jumpSpeed: JUMP_SPEED,
});

camera.position.y = FLOOR_LEVEL + PLAYER_HEIGHT; //set camera height to average human eye level for better first-person experience

const clock = new THREE.Clock();

//make canvas responsive to window resizing
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

//////////////import object + animation config///////////////
const loader = new GLTFLoader();
const modelNames = ["hut", "house"];
const models = [];
const ANIMATION_PLAYBACK_RATE = 0.5; // 1 preserves source speed; lower slows animation

for (const name of modelNames) {
  let pathtoModel = `public/models/${name}.glb`;
  let position = new THREE.Vector3(12, -0.1, 0);
  const { model, mixer, activeAction } = await loadModel(
    loader,
    pathtoModel,
    position,
    scene,
    camera,
  );
  models.push({ name, model, mixer, activeAction });
}
//assign animation loop to renderer
renderer.setAnimationLoop(animate);

//animation loop for rendering scene
function animate() {
  const delta = clock.getDelta(); // Get time elapsed since last frame for time-based animation
  for (const model of models) {
    if (model.mixer) model.mixer.update(delta);
  }

  player.update(delta);

  renderer.render(scene, camera);
}
