import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

/**
 * Orchestrates a first-person controller with optional physics support.
 * Handles user input, ground sampling, and synchronisation between camera and physics body.
 */

/**
 * Produces a sample helper that wraps the terrain sampler with fallbacks.
 * Guarantees a finite height value while tracking whether the sample came from real terrain data.
 */
function createGroundResolver(terrainSampler, terrainBounds, floorLevel) {
  const fallbackHeight =
    Number.isFinite(terrainBounds?.max) ? terrainBounds.max : floorLevel;

  if (typeof terrainSampler !== "function") {
    return {
      fallbackHeight,
      sample: () => ({ height: fallbackHeight, isTerrain: false }),
    };
  }

  return {
    fallbackHeight,
    sample: (x, z) => {
      const height = terrainSampler(x, z);
      if (Number.isFinite(height)) {
        return { height, isTerrain: true };
      }
      return { height: fallbackHeight, isTerrain: false };
    },
  };
}

/**
 * Ensures pointer targets receive focus without scrolling the viewport.
 */
function focusPointerTarget(element) {
  if (element instanceof HTMLElement) {
    element.focus({ preventScroll: true });
  }
}

/**
 * Resets jump-related transient state to avoid stale impulses.
 */
function resetJumpState(movement) {
  movement.pendingJump = false;
  movement.jumpBoost = false;
}

/**
 * Generates a bilinear sampler over the supplied height grid so movement can query terrain elevation.
 */
function createTerrainSampler(data) {
  if (!data || !Array.isArray(data.grid)) {
    return null;
  }
  const { grid, rows, cols, cellSizeX, cellSizeZ, halfWidth, halfHeight } =
    data;
  const safeRows = Math.max(rows || 0, 1);
  const safeCols = Math.max(cols || 0, 1);
  const stepX = cellSizeX || 1;
  const stepZ = cellSizeZ || 1;

  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return NaN;
    }
    const fx = (x + halfWidth) / stepX;
    const fz = (z + halfHeight) / stepZ;
    const clampedFx = THREE.MathUtils.clamp(fx, 0, safeCols - 1);
    const clampedFz = THREE.MathUtils.clamp(fz, 0, safeRows - 1);

    const ix0 = Math.floor(clampedFx);
    const iz0 = Math.floor(clampedFz);
    const ix1 = Math.min(ix0 + 1, safeCols - 1);
    const iz1 = Math.min(iz0 + 1, safeRows - 1);

    const sx = clampedFx - ix0;
    const sz = clampedFz - iz0;

    const row0 = grid[iz0] || [];
    const row1 = grid[iz1] || row0;

    const h00 = row0[ix0] ?? 0;
    const h10 = row0[ix1] ?? h00;
    const h01 = row1[ix0] ?? h00;
    const h11 = row1[ix1] ?? h01;

    const h0 = THREE.MathUtils.lerp(h00, h10, sx);
    const h1 = THREE.MathUtils.lerp(h01, h11, sx);
    return THREE.MathUtils.lerp(h0, h1, sz);
  };
}

/**
 * Baseline configuration for player movement and capsule characteristics.
 */
const DEFAULT_CONFIG = {
  floorLevel: 0,
  playerHeight: 1.6,
  gravity: 28,
  walkAcceleration: 5,
  sprintAcceleration: 10,
  movementDamping: 12,
  jumpSpeed: 12,
  capsuleRadius: 0.4,
  capsuleMass: 80,
};

/**
 * Renders a lightweight DOM hint prompting the user to engage pointer lock.
 */
function buildPointerHint() {
  const element = document.createElement("div");
  element.textContent =
    "Click for first-person (WASD + mouse, Space to jump, Esc to release)";
  element.style.position = "absolute";
  element.style.top = "16px";
  element.style.left = "50%";
  element.style.transform = "translateX(-50%)";
  element.style.padding = "8px 12px";
  element.style.fontFamily = "sans-serif";
  element.style.fontSize = "14px";
  element.style.color = "#ffffff";
  element.style.background = "rgba(0, 0, 0, 0.6)";
  element.style.borderRadius = "6px";
  element.style.pointerEvents = "none";
  document.body.appendChild(element);

  return {
    element,
    teardown: () => {
      if (element.parentNode) element.parentNode.removeChild(element);
    },
  };
}

/**
 * Constructs the mutable movement state used by both physics and kinematic updates.
 */
function initializeMovementState() {
  return {
    moveState: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
    },
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    isGrounded: true,
    pendingJump: false,
    jumpBoost: false,
  };
}

/**
 * Maps keyboard events onto the movement state while capturing jump intents.
 */
function createInputHandler(movement) {
  return (event, isPressed) => {
    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        movement.moveState.forward = isPressed;
        break;
      case "KeyS":
      case "ArrowDown":
        movement.moveState.backward = isPressed;
        break;
      case "KeyA":
      case "ArrowLeft":
        movement.moveState.left = isPressed;
        break;
      case "KeyD":
      case "ArrowRight":
        movement.moveState.right = isPressed;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        movement.moveState.sprint = isPressed;
        break;
      case "Space":
        movement.moveState.jump = isPressed;
        if (isPressed) {
          if (movement.isGrounded) {
            movement.pendingJump = true;
            movement.jumpBoost = movement.moveState.forward;
          }
        } else {
          movement.pendingJump = false;
          movement.jumpBoost = false;
        }
        break;
      default:
        break;
    }
  };
}

/**
 * Configures pointer-lock controls and returns an update loop to drive movement each frame.
 */
export async function firstPersonSetup(camera, renderer, options = {}) {
  const {
    terrainBounds: terrainBoundsOverride = null,
    terrainData = null,
    dynamicCapsule = null,
    capsuleOffset = { x: 0, y: 0, z: 0 },
    ...configOverrides
  } = options;

  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const derivedBounds =
    terrainData ?
      {
        min: terrainData.min ?? config.floorLevel,
        max: terrainData.max ?? config.floorLevel,
      }
    : {
        min: config.floorLevel,
        max: config.floorLevel,
      };
  const terrainBounds =
    terrainBoundsOverride ?
      { ...derivedBounds, ...terrainBoundsOverride }
    : derivedBounds;
  const terrainSampler = terrainData ? createTerrainSampler(terrainData) : null;
  const groundResolver = createGroundResolver(
    terrainSampler,
    terrainBounds,
    config.floorLevel,
  );

  const pointerElement = renderer?.domElement || document.body;
  if (pointerElement instanceof HTMLElement) {
    if (!pointerElement.hasAttribute("tabindex")) {
      pointerElement.setAttribute("tabindex", "-1");
    }
    pointerElement.style.outline = "none";
  }

  const controls = new PointerLockControls(camera, pointerElement);
  const controlsObject =
    (typeof controls.getObject === "function" && controls.getObject()) ||
    controls.object ||
    controls.camera ||
    camera;

  const setCameraPosition = (x, y, z) => {
    controlsObject.position.set(x, y, z);
    camera.position.set(x, y, z);
    if (dynamicCapsule && dynamicCapsule.position) {
      dynamicCapsule.position.set(
        x + capsuleOffset.x,
        y + capsuleOffset.y,
        z + capsuleOffset.z,
      );
    }
  };

  const { element: pointerHint } = buildPointerHint();

  const movement = initializeMovementState();
  const handleKey = createInputHandler(movement);

  const spawnGround = groundResolver.sample(
    camera.position.x,
    camera.position.z,
  ).height;

  controls.addEventListener("lock", () => {
    pointerHint.style.display = "none";
    focusPointerTarget(pointerElement);
  });

  controls.addEventListener("unlock", () => {
    pointerHint.style.display = "";
    Object.keys(movement.moveState).forEach((key) => {
      movement.moveState[key] = false;
    });
    movement.velocity.set(0, 0, 0);
    resetJumpState(movement);
    const unlockedGround = groundResolver.sample(
      camera.position.x,
      camera.position.z,
    ).height;
    setCameraPosition(
      camera.position.x,
      unlockedGround + config.playerHeight,
      camera.position.z,
    );
    movement.isGrounded = true;
  });

  pointerElement.addEventListener("click", () => {
    focusPointerTarget(pointerElement);
    if (!controls.isLocked) controls.lock();
  });

  const keydownListener = (event) => handleKey(event, true);
  const keyupListener = (event) => handleKey(event, false);
  const keyTargets = new Set([
    window,
    pointerElement?.ownerDocument || document,
  ]);
  if (pointerElement && typeof pointerElement.addEventListener === "function") {
    keyTargets.add(pointerElement);
  }
  keyTargets.forEach((target) => {
    target.addEventListener("keydown", keydownListener);
    target.addEventListener("keyup", keyupListener);
  });

  setCameraPosition(
    camera.position.x,
    spawnGround + config.playerHeight,
    camera.position.z,
  );

  /**
   * Kinematic fallback when physics is disabled, integrating velocity manually.
   */
  function updateKinematicMovement(delta) {
    movement.velocity.x -= movement.velocity.x * config.movementDamping * delta;
    movement.velocity.z -= movement.velocity.z * config.movementDamping * delta;

    // Derive desired input direction from key states and normalise for consistent speed.
    movement.direction.z =
      Number(movement.moveState.forward) - Number(movement.moveState.backward);
    movement.direction.x =
      Number(movement.moveState.right) - Number(movement.moveState.left);
    if (movement.direction.lengthSq() > 0) movement.direction.normalize();

    const acceleration =
      movement.moveState.sprint ?
        config.sprintAcceleration
      : config.walkAcceleration;

    if (movement.moveState.forward || movement.moveState.backward) {
      movement.velocity.z -= movement.direction.z * acceleration * delta;
    }
    if (movement.moveState.left || movement.moveState.right) {
      movement.velocity.x -= movement.direction.x * acceleration * delta;
    }

    if (movement.pendingJump && movement.isGrounded) {
      movement.velocity.y = config.jumpSpeed;
      movement.isGrounded = false;
      if (movement.jumpBoost) {
        movement.velocity.z -= config.walkAcceleration * 0.1;
      }
    }
    resetJumpState(movement);

    // Apply gravity after handling jump impulses.
    movement.velocity.y -= config.gravity * delta;

    controls.moveRight(-movement.velocity.x * delta);
    controls.moveForward(-movement.velocity.z * delta);

    const controlsPosition = controlsObject.position;
    const nextY = controlsPosition.y + movement.velocity.y * delta;
    setCameraPosition(controlsPosition.x, nextY, controlsPosition.z);

    let groundedFromTerrain = false;
    if (terrainSampler) {
      const surfaceHeight = terrainSampler(
        camera.position.x,
        camera.position.z,
      );
      if (Number.isFinite(surfaceHeight)) {
        const targetY = surfaceHeight + config.playerHeight;
        if (camera.position.y <= targetY) {
          setCameraPosition(
            controlsObject.position.x,
            targetY,
            controlsObject.position.z,
          );
          if (movement.velocity.y < 0) movement.velocity.y = 0;
          groundedFromTerrain = true;
        }
      }
    }

    if (!terrainSampler) {
      const minY =
        (terrainBounds.min ?? config.floorLevel) + config.playerHeight;
      if (camera.position.y <= minY) {
        setCameraPosition(
          controlsObject.position.x,
          minY,
          controlsObject.position.z,
        );
        movement.velocity.y = 0;
        movement.isGrounded = true;
      } else {
        movement.isGrounded = false;
      }
    } else {
      movement.isGrounded = groundedFromTerrain;
    }
  }

  const player = {
    controls,
    moveState: movement.moveState,
    velocity: movement.velocity,
    direction: movement.direction,
    update(delta) {
      const isActive = controls.isLocked;
      if (isActive) {
        updateKinematicMovement(delta);
      } else {
        movement.velocity.set(0, 0, 0);
        movement.direction.set(0, 0, 0);
        resetJumpState(movement);
      }
    },
    get isGrounded() {
      return movement.isGrounded;
    },
    set isGrounded(value) {
      movement.isGrounded = value;
    },
    config,
    collider: null,
    get usingPhysics() {
      return false;
    },
  };

  // Attach keepOnTerrain method
  player.keepOnTerrain = function (terrainData, playerHeight) {
    if (this.position && terrainData) {
      const x = this.position.x;
      const z = this.position.z;
      let terrainY = 0;
      if (typeof terrainData === "function") {
        terrainY = terrainData(x, z);
      } else if (Array.isArray(terrainData)) {
        // Fallback: no grid info, assume square
        const size = Math.sqrt(terrainData.length);
        const idx = Math.floor(z) * size + Math.floor(x);
        terrainY = terrainData[idx] || 0;
      } else if (terrainData && terrainData.grid && terrainData.cols) {
        // Proper grid object from createEnvironment
        const col = Math.floor(x);
        const row = Math.floor(z);
        const idx = row * terrainData.cols + col;
        terrainY = terrainData.grid[idx] || 0;
      }
      this.position.y = Math.max(this.position.y, terrainY + playerHeight);
    }
  };

  // Attach logMovement method
  player.logMovement = function (delta) {
    const velocity = this.velocity;
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
  };

  return player;
}

export function setupMovement() {
  // --- PLAYER MOVEMENT STATE ---
  const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    canJump: true,
    sprint: false,
  };

  // Keyboard controls for WASD + jump
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyW") movement.forward = true;
    if (e.code === "KeyS") movement.backward = true;
    if (e.code === "KeyA") movement.left = true;
    if (e.code === "KeyD") movement.right = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      movement.sprint = true;
    if (e.code === "Space" && movement.canJump) movement.jump = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") movement.forward = false;
    if (e.code === "KeyS") movement.backward = false;
    if (e.code === "KeyA") movement.left = false;
    if (e.code === "KeyD") movement.right = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      movement.sprint = false;
    if (e.code === "Space") movement.jump = false;
  });

  return movement;
}
