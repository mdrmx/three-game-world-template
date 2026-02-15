import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TEMP_FORWARD = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const DESIRED_DIRECTION = new THREE.Vector3();
const HORIZONTAL_VELOCITY = new THREE.Vector3();

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

const DEFAULT_CONFIG = {
  floorLevel: 0,
  playerHeight: 1.6,
  gravity: 28,
  walkAcceleration: 50,
  sprintAcceleration: 450,
  movementDamping: 12,
  jumpSpeed: 12,
  capsuleRadius: 0.4,
  capsuleMass: 80,
};

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

export async function firstPersonSetup(camera, renderer, options = {}) {
  const {
    physics: physicsWorld = null,
    usePhysics = true,
    walkSpeed: overrideWalkSpeed,
    sprintSpeed: overrideSprintSpeed,
    capsuleRadius: overrideCapsuleRadius,
    capsuleMass: overrideCapsuleMass,
    airControl = 0.3,
    horizontalDamping,
    terrainBounds: terrainBoundsOverride = null,
    terrainData = null,
    ...restOptions
  } = options;

  const config = { ...DEFAULT_CONFIG, ...restOptions };
  const walkSpeed = overrideWalkSpeed ?? config.walkAcceleration * 0.05;
  const sprintSpeed = overrideSprintSpeed ?? config.sprintAcceleration * 0.05;
  const capsuleRadius = overrideCapsuleRadius ?? config.capsuleRadius;
  const capsuleMass = overrideCapsuleMass ?? config.capsuleMass;
  const dampingStrength = horizontalDamping ?? config.movementDamping;
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
  const physicsEnabled = Boolean(usePhysics && physicsWorld?.add?.capsule);

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
  };

  const { element: pointerHint } = buildPointerHint();

  const movement = initializeMovementState();
  const handleKey = createInputHandler(movement);

  const initialGroundHeight =
    terrainSampler ?
      terrainSampler(camera.position.x, camera.position.z)
    : terrainBounds.max;
  const spawnGround =
    Number.isFinite(initialGroundHeight) ? initialGroundHeight : (
      (terrainBounds.max ?? config.floorLevel)
    );

  const playerState = {
    capsule: null,
    cameraOffset: config.playerHeight,
    walkSpeed,
    sprintSpeed,
    airControl,
    dampingStrength,
    terrainSampler,
    capsuleHalfHeight: null,
    usingPhysics: false,
  };

  if (physicsEnabled) {
    const capsuleHeight = Math.max(
      config.playerHeight - capsuleRadius * 2,
      0.2,
    );
    const totalHeight = capsuleHeight + capsuleRadius * 2;
    const safeSpawnOffset = Math.max(capsuleRadius, 0.3);
    const startY = spawnGround + totalHeight / 2 + safeSpawnOffset;
    const capsule = physicsWorld.add.capsule(
      {
        name: "playerCollider",
        radius: capsuleRadius,
        height: capsuleHeight,
        mass: capsuleMass,
        x: camera.position.x,
        y: startY,
        z: camera.position.z,
      },
      { basic: { transparent: true, opacity: 0 } },
    );
    if (capsule) {
      capsule.visible = false;
      if (capsule.body) {
        capsule.body.setAngularFactor(0, 0, 0);
        capsule.body.setFriction(0.8);
        capsule.body.setDamping(dampingStrength * 0.05, dampingStrength * 0.05);
        capsule.body.setCcdMotionThreshold(0.01);
        capsule.body.setCcdSweptSphereRadius(capsuleRadius * 0.5);
      }
      playerState.capsule = capsule;
      playerState.cameraOffset = Math.max(
        config.playerHeight - totalHeight / 2,
        0,
      );
      playerState.capsuleHalfHeight = totalHeight / 2;
      playerState.usingPhysics = true;
    }
  }

  controls.addEventListener("lock", () => {
    pointerHint.style.display = "none";
    if (pointerElement instanceof HTMLElement) {
      pointerElement.focus({ preventScroll: true });
    }
  });

  controls.addEventListener("unlock", () => {
    pointerHint.style.display = "";
    Object.keys(movement.moveState).forEach((key) => {
      movement.moveState[key] = false;
    });
    movement.velocity.set(0, 0, 0);
    movement.pendingJump = false;
    movement.jumpBoost = false;
    const unlockedGround =
      terrainSampler ?
        terrainSampler(camera.position.x, camera.position.z)
      : terrainBounds.max;
    const groundedY =
      Number.isFinite(unlockedGround) ? unlockedGround : (
        (terrainBounds.max ?? config.floorLevel)
      );
    setCameraPosition(
      camera.position.x,
      groundedY + config.playerHeight,
      camera.position.z,
    );
    movement.isGrounded = true;
  });

  pointerElement.addEventListener("click", () => {
    if (pointerElement instanceof HTMLElement) {
      pointerElement.focus({ preventScroll: true });
    }
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

  function updatePhysicsMovement(delta, isActive) {
    if (!playerState.capsule?.body) {
      if (terrainSampler) {
        const fallbackGround = terrainSampler(
          camera.position.x,
          camera.position.z,
        );
        if (Number.isFinite(fallbackGround)) {
          setCameraPosition(
            camera.position.x,
            fallbackGround + config.playerHeight,
            camera.position.z,
          );
        }
      }
      return;
    }

    const body = playerState.capsule.body;
    const currentVelocity = body.velocity;
    HORIZONTAL_VELOCITY.set(currentVelocity.x, 0, currentVelocity.z);
    let verticalVelocity = currentVelocity.y;

    if (isActive) {
      TEMP_FORWARD.set(0, 0, -1).applyQuaternion(camera.quaternion);
      TEMP_FORWARD.y = 0;
      if (TEMP_FORWARD.lengthSq() > 0.0001) {
        TEMP_FORWARD.normalize();
      } else {
        TEMP_FORWARD.set(0, 0, -1);
      }

      TEMP_RIGHT.copy(TEMP_FORWARD).cross(WORLD_UP).normalize();

      DESIRED_DIRECTION.set(0, 0, 0);
      if (movement.moveState.forward) DESIRED_DIRECTION.add(TEMP_FORWARD);
      if (movement.moveState.backward) DESIRED_DIRECTION.sub(TEMP_FORWARD);
      if (movement.moveState.right) DESIRED_DIRECTION.add(TEMP_RIGHT);
      if (movement.moveState.left) DESIRED_DIRECTION.sub(TEMP_RIGHT);

      if (DESIRED_DIRECTION.lengthSq() > 0) {
        DESIRED_DIRECTION.normalize();
        movement.direction.copy(DESIRED_DIRECTION);
        const targetSpeed =
          movement.moveState.sprint ?
            playerState.sprintSpeed
          : playerState.walkSpeed;
        const groundedMultiplier =
          movement.isGrounded ? 1 : playerState.airControl;
        DESIRED_DIRECTION.multiplyScalar(targetSpeed * groundedMultiplier);

        const blend = THREE.MathUtils.clamp(
          1 - Math.exp(-playerState.dampingStrength * delta),
          0,
          1,
        );
        HORIZONTAL_VELOCITY.lerp(DESIRED_DIRECTION, blend);
      } else {
        movement.direction.set(0, 0, 0);
        const damping = Math.exp(-playerState.dampingStrength * delta);
        HORIZONTAL_VELOCITY.multiplyScalar(damping);
      }

      if (movement.pendingJump && movement.isGrounded) {
        verticalVelocity = config.jumpSpeed;
        movement.pendingJump = false;
        movement.jumpBoost = false;
        movement.isGrounded = false;
      } else {
        movement.pendingJump = false;
      }
    } else {
      movement.direction.set(0, 0, 0);
      movement.pendingJump = false;
      movement.jumpBoost = false;
      HORIZONTAL_VELOCITY.set(0, 0, 0);
    }

    const capsulePosition = playerState.capsule.position;
    const groundHeight =
      terrainSampler ?
        terrainSampler(capsulePosition.x, capsulePosition.z)
      : null;

    let groundedFromHeight = false;
    if (
      Number.isFinite(groundHeight) &&
      Number.isFinite(playerState.capsuleHalfHeight)
    ) {
      const targetCenterY = groundHeight + playerState.capsuleHalfHeight;
      const centerDelta = targetCenterY - capsulePosition.y;
      const correctionSpeed = THREE.MathUtils.clamp(
        centerDelta / Math.max(delta, 0.016),
        -10,
        10,
      );
      if (Math.abs(centerDelta) > 0.02) {
        verticalVelocity += correctionSpeed;
      }
      groundedFromHeight =
        Math.abs(centerDelta) < 0.15 && Math.abs(verticalVelocity) <= 0.2;
      setCameraPosition(
        capsulePosition.x,
        groundHeight + config.playerHeight,
        capsulePosition.z,
      );
    } else {
      setCameraPosition(
        capsulePosition.x,
        capsulePosition.y + playerState.cameraOffset,
        capsulePosition.z,
      );
    }

    body.setVelocityX(HORIZONTAL_VELOCITY.x);
    body.setVelocityZ(HORIZONTAL_VELOCITY.z);
    body.setVelocityY(verticalVelocity);
    if (body.ammo && typeof body.ammo.activate === "function") {
      body.ammo.activate(true);
    }

    const impacts = body.impact || [];
    const groundedFromImpacts = impacts.some(
      (impact) => impact?.normal && impact.normal.y > 0.5,
    );

    const updatedVelocity = body.velocity;
    movement.velocity.set(
      updatedVelocity.x,
      updatedVelocity.y,
      updatedVelocity.z,
    );
    movement.isGrounded = groundedFromHeight || groundedFromImpacts;
  }

  function updateKinematicMovement(delta) {
    movement.velocity.x -= movement.velocity.x * config.movementDamping * delta;
    movement.velocity.z -= movement.velocity.z * config.movementDamping * delta;

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
    movement.pendingJump = false;
    movement.jumpBoost = false;

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

  return {
    controls,
    moveState: movement.moveState,
    velocity: movement.velocity,
    direction: movement.direction,
    update(delta) {
      const isActive = controls.isLocked;
      if (playerState.usingPhysics && playerState.capsule) {
        updatePhysicsMovement(delta, isActive);
      } else if (isActive) {
        updateKinematicMovement(delta);
      } else {
        movement.velocity.set(0, 0, 0);
        movement.direction.set(0, 0, 0);
      }
    },
    get isGrounded() {
      return movement.isGrounded;
    },
    set isGrounded(value) {
      movement.isGrounded = value;
    },
    config,
    collider: playerState.capsule,
    get usingPhysics() {
      return playerState.usingPhysics;
    },
  };
}
