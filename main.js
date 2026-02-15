import * as THREE from "three";
import { createEnvironment } from "./components/createEnvironment.js";
import { createScene } from "./components/createScene.js";
import { loadModel } from "./components/modelLoader.js";
import { firstPersonSetup } from "./components/firstPersonSetup.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// physics
import { AmmoPhysics, PhysicsLoader } from "@enable3d/ammo-physics";

let scene;
let camera;
let renderer;
let physics;
let player;
const models = [];
const clock = new THREE.Clock();

const USE_PLAYER_PHYSICS = false; // Toggle to compare physics-driven vs kinematic control
const DEBUG_LOG_MOVEMENT = false; // Emits delta and velocity diagnostics when physics is off

PhysicsLoader("/ammo", () => init());

async function init() {
  ({ scene, camera, renderer } = await createScene());

  if (USE_PLAYER_PHYSICS) {
    physics = new AmmoPhysics(scene, { gravity: { y: -9.8 } });
  }

  const hdrPath = "textures/hdr/sky2.hdr"; //HDRI for sky background and environment lighting
  const texturePaths = {
    diffuseMap: "textures/floor/rocks_diff.jpg",
    aoMap: "textures/floor/rocks_ao.jpg",
    armMap: "textures/floor/rocks_arm.jpg",
    normalMap: "textures/floor/rocks_nor.jpg",
    displacementMap: "textures/floor/rocks_disp.jpg",
    roughnessMap: "textures/floor/rocks_rough.jpg",
  };

  const { heightBounds, terrainData } = await createEnvironment(
    scene,
    hdrPath,
    texturePaths,
    physics,
    {
      planeSize: 600,
      segments: 32,
      heightScale: 20,
      heightBias: -10,
      physicsFriction: 1.1,
      physicsRestitution: 0.05,
    },
  );

  //set up first-person controls and constant for player movement and physics
  const FLOOR_LEVEL = 0;
  const PLAYER_HEIGHT = 1.6;
  const JUMP_SPEED = 20;
  const WALK_ACCELERATION = 100; //base ground thrust while walking
  const SPRINT_ACCELERATION = 450; //extra thrust when sprint modifier is held
  const MOVEMENT_DAMPING = 20; //air-resistance style decay applied every frame

  player = await firstPersonSetup(camera, renderer, {
    floorLevel: FLOOR_LEVEL,
    playerHeight: PLAYER_HEIGHT,
    gravity: 28,
    walkAcceleration: WALK_ACCELERATION,
    sprintAcceleration: SPRINT_ACCELERATION,
    movementDamping: MOVEMENT_DAMPING,
    jumpSpeed: JUMP_SPEED,
    physics,
    walkSpeed: WALK_ACCELERATION * 0.05,
    sprintSpeed: SPRINT_ACCELERATION * 0.05,
    capsuleRadius: 0.45,
    capsuleMass: 90,
    airControl: 0.25,
    terrainBounds: heightBounds,
    terrainData,
    usePhysics: USE_PLAYER_PHYSICS,
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

  renderer.setAnimationLoop(animate);
}

function animate() {
  const delta = clock.getDelta();
  if (physics && USE_PLAYER_PHYSICS) {
    physics.update(delta * 1000); //keep physics world in sync with render loop
  }

  for (const model of models) {
    if (model.mixer) model.mixer.update(delta);
  }

  if (player) {
    player.update(delta);
    if (DEBUG_LOG_MOVEMENT && !USE_PLAYER_PHYSICS) {
      const velocity = player.velocity;
      const speed = velocity.length();
      console.log("[movement-debug]", {
        delta: Number(delta.toFixed(4)),
        speed: Number(speed.toFixed(4)),
        velocity: {
          x: Number(velocity.x.toFixed(4)),
          y: Number(velocity.y.toFixed(4)),
          z: Number(velocity.z.toFixed(4)),
        },
      });
    }
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}
