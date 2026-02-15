import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

const DEFAULT_CONFIG = {
  floorLevel: 0,
  playerHeight: 1.6,
  gravity: 28,
  walkAcceleration: 50,
  sprintAcceleration: 450,
  movementDamping: 12,
  jumpSpeed: 12,
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
  };
}

function createInputHandler(movement, config) {
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
        if (isPressed && movement.isGrounded) {
          movement.velocity.y = config.jumpSpeed;
          movement.isGrounded = false;
        }
        //keep moving forward if forward is held when jump is initiated to prevent loss of momentum mid-jump
        if (isPressed && movement.isGrounded && movement.moveState.forward) {
          movement.velocity.z -= config.walkAcceleration * 0.1; //apply a small forward boost when jumping to maintain momentum
        }
        break;
      default:
        break;
    }
  };
}

export async function firstPersonSetup(camera, renderer, options = {}) {
  //add first-person pointer lock controls
  const controls = new PointerLockControls(camera, document.body);

  const { element: pointerHint } = buildPointerHint();

  const config = { ...DEFAULT_CONFIG, ...options };
  const movement = initializeMovementState();
  const handleKey = createInputHandler(movement, config);

  controls.addEventListener("lock", () => {
    pointerHint.style.display = "none";
  });

  controls.addEventListener("unlock", () => {
    // Restore the onscreen hint once pointer lock disengages so users know how to re-enter
    pointerHint.style.display = "";
    // Clear any lingering movement flags to prevent unintended motion after unlocking
    Object.keys(movement.moveState).forEach((key) => {
      movement.moveState[key] = false;
    });
    // Reset velocity to halt all momentum before control returns to UI interaction
    movement.velocity.set(0, 0, 0);
    // Snap the camera height back to the grounded position in case the unlock happened mid-jump
    camera.position.y = config.floorLevel + config.playerHeight;
    // Mark the player as grounded to sync the physics state with the reset pose
    movement.isGrounded = true;
  });

  renderer.domElement.addEventListener("click", () => {
    if (!controls.isLocked) controls.lock();
  });

  document.addEventListener("keydown", (event) => handleKey(event, true));
  document.addEventListener("keyup", (event) => handleKey(event, false));

  return {
    controls,
    moveState: movement.moveState,
    velocity: movement.velocity,
    direction: movement.direction,
    update(delta) {
      if (controls.isLocked) {
        movement.velocity.x -=
          movement.velocity.x * config.movementDamping * delta;
        movement.velocity.z -=
          movement.velocity.z * config.movementDamping * delta;

        movement.direction.z =
          Number(movement.moveState.forward) -
          Number(movement.moveState.backward);
        movement.direction.x =
          Number(movement.moveState.right) - Number(movement.moveState.left);
        if (movement.direction.lengthSq() > 0) movement.direction.normalize();

        const acceleration =
          movement.moveState.sprint ?
            config.sprintAcceleration
          : config.walkAcceleration;

        if (movement.moveState.forward || movement.moveState.backward)
          movement.velocity.z -= movement.direction.z * acceleration * delta;

        if (movement.moveState.left || movement.moveState.right)
          movement.velocity.x -= movement.direction.x * acceleration * delta;

        movement.velocity.y -= config.gravity * delta;

        controls.moveRight(-movement.velocity.x * delta);
        controls.moveForward(-movement.velocity.z * delta);
        camera.position.y += movement.velocity.y * delta;
      } else {
        movement.velocity.set(0, 0, 0);
      }

      const minY = config.floorLevel + config.playerHeight;
      if (camera.position.y <= minY) {
        camera.position.y = minY;
        movement.velocity.y = 0;
        movement.isGrounded = true;
      } else {
        movement.isGrounded = false;
      }
    },
    get isGrounded() {
      return movement.isGrounded;
    },
    set isGrounded(value) {
      movement.isGrounded = value;
    },
    config,
  };
}
