import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AmmoPhysics } from "@enable3d/ammo-physics";

import { createEnvironment } from "./createEnvironment.js";
import { createPlayer } from "./playerSetup.js";
import { createScene } from "./createScene.js";
import { loadModel } from "./modelLoader.js";
import { GAME_CONFIG, createPbrTexturePaths } from "./gameConfig.js";

function createMovementState() {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
  };
}

export class GameWorld {
  constructor(config = GAME_CONFIG) {
    this.config = config;
    this.clock = new THREE.Clock();
    this.models = [];
    this.ceilingLights = [];
    this.movement = createMovementState();
    this.lastGroundedAt = 0;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.physics = null;
    this.player = null;
    this.playerCollider = null;
    this.terrainData = null;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.animate = this.animate.bind(this);
  }

  async init() {
    this.bindInput();
    await this.setupScene();
    await this.setupEnvironment();
    await this.setupPlayer();
    await this.setupModels();
    this.setupLighting();
  }

  start() {
    if (!this.renderer) return;
    this.renderer.setAnimationLoop(this.animate);
  }

  handleKeyDown(event) {
    if (event.code === "KeyW") this.movement.forward = true;
    if (event.code === "KeyS") this.movement.backward = true;
    if (event.code === "KeyA") this.movement.left = true;
    if (event.code === "KeyD") this.movement.right = true;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.movement.sprint = true;
    }
    if (event.code === "Space") this.movement.jump = true;
  }

  handleKeyUp(event) {
    if (event.code === "KeyW") this.movement.forward = false;
    if (event.code === "KeyS") this.movement.backward = false;
    if (event.code === "KeyA") this.movement.left = false;
    if (event.code === "KeyD") this.movement.right = false;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.movement.sprint = false;
    }
    if (event.code === "Space") this.movement.jump = false;
  }

  bindInput() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  async setupScene() {
    const { scene, camera, renderer } = await createScene();
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.physics = new AmmoPhysics(scene);
  }

  async setupEnvironment() {
    const environment = this.config.environment;
    const floorTexturePaths = createPbrTexturePaths(
      "floor",
      environment.floorTextureSet,
    );

    const { heightBounds, terrainData } = await createEnvironment(
      this.scene,
      environment.hdrPath,
      floorTexturePaths,
      {
        textureRepeat: environment.textureRepeat,
        planeSize: environment.planeSize,
        segments: environment.segments,
        heightScale: environment.heightScale,
        heightBias: environment.heightBias,
      },
      this.physics,
    );

    this.heightBounds = heightBounds;
    this.terrainData = heightBounds && terrainData ? terrainData : null;
  }

  async setupPlayer() {
    const playerConfig = this.config.player;
    const { playerCollider, player } = await createPlayer({
      scene: this.scene,
      physics: this.physics,
      heightBounds: this.heightBounds,
      terrainData: this.terrainData,
      camera: this.camera,
      renderer: this.renderer,
      capsuleRadius: playerConfig.capsuleRadius,
      playerOptions: {
        walkAcceleration: playerConfig.walkAcceleration,
        sprintAcceleration: playerConfig.sprintAcceleration,
        jumpSpeed: playerConfig.jumpSpeed,
      },
    });

    this.playerCollider = playerCollider;
    this.player = player;
  }

  async setupModels() {
    const loader = new GLTFLoader();
    const modelConfig = this.config.model;

    const { model, mixer, activeAction, collider } = await loadModel(
      loader,
      modelConfig.path,
      modelConfig.scale,
      modelConfig.position,
      this.scene,
      this.physics,
      {
        mass: modelConfig.mass,
        colliderOffset: modelConfig.colliderOffset,
      },
    );

    if (model) {
      model.visible = true;
      model.traverse((child) => {
        if (child.isMesh) {
          child.visible = true;
          if (child.material) child.material.visible = true;
        }
      });
    }

    if (mixer && activeAction) {
      activeAction.setEffectiveTimeScale(modelConfig.animationPlaybackRate);
    }

    this.models.push({
      name: "house",
      model,
      mixer,
      activeAction,
      collider,
    });
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(
      0xffffff,
      this.config.lighting.ambientIntensity,
    );
    this.scene.add(ambientLight);
  }

  updateModelAnimations(delta) {
    for (const model of this.models) {
      if (model.mixer) model.mixer.update(delta);
    }
  }

  updateProximityLights() {
    const lightingConfig = this.config.lighting;
    for (const light of this.ceilingLights) {
      const distanceToPlayer = light.position.distanceTo(
        this.playerCollider.position,
      );
      light.intensity =
        distanceToPlayer < lightingConfig.activationDistance ?
          lightingConfig.activeLightIntensity
        : 0;
    }
  }

  updatePlayerPhysicsMovement() {
    if (
      !this.playerCollider ||
      !this.player ||
      !this.player.controls ||
      !this.player.controls.isLocked
    ) {
      return;
    }

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, this.camera.up).normalize();

    this.updateProximityLights();

    const velocity = new THREE.Vector3();
    const walkSpeed = this.player?.config?.walkAcceleration;
    const sprintSpeed = this.player?.config?.sprintAcceleration;
    const speed = this.movement.sprint ? sprintSpeed : walkSpeed;

    if (this.movement.forward) velocity.add(forward);
    if (this.movement.backward) velocity.sub(forward);
    if (this.movement.left) velocity.sub(right);
    if (this.movement.right) velocity.add(right);
    if (velocity.lengthSq() > 0 && typeof speed === "number") {
      velocity.normalize().multiplyScalar(speed);
    }

    const body = this.playerCollider.body;
    if (body) {
      const currentVel = body.velocity;
      body.setVelocity(velocity.x, currentVel.y, velocity.z);

      const now = performance.now();
      const isGroundedNow = Math.abs(currentVel.y) < 1.0;
      if (isGroundedNow) this.lastGroundedAt = now;
      const canJumpNow = now - this.lastGroundedAt < 120;

      if (this.movement.jump && canJumpNow) {
        const jumpImpulse = this.player?.config?.jumpSpeed ?? 12;
        body.setVelocity(velocity.x, jumpImpulse, velocity.z);
        this.movement.jump = false;
        this.lastGroundedAt = 0;
      }
    }

    this.camera.position.copy(this.playerCollider.position);
    if (this.player.controls.getObject) {
      this.player.controls
        .getObject()
        .position.copy(this.playerCollider.position);
    }
  }

  animate() {
    const delta = this.clock.getDelta();

    this.updateModelAnimations(delta);
    this.updatePlayerPhysicsMovement();

    this.physics.update(delta * 1000);
    this.physics.updateDebugger();
    this.renderer.render(this.scene, this.camera);
  }
}
