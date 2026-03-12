// Mode System: Editor/Play mode toggle with OrbitControls and object selection
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { picker } from "./picker.js";

/**
 * Creates and manages the Editor/Play mode system
 * @param {Object} options
 * @param {THREE.Camera} options.camera
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {THREE.Scene} options.scene
 * @param {Object} options.player - First-person controls wrapper
 * @param {Object} options.playerCollider - Physics collider for player
 * @param {number} options.playerHeight - Player height for camera offset
 * @param {Object} options.playerSpawn - Spawn position {x, y, z}
 * @returns {Object} Mode system controls and state
 */
export function createModeSystem({
  camera,
  renderer,
  scene,
  player,
  playerCollider,
  playerHeight,
  playerSpawn,
}) {
  let currentMode = "editor"; // "editor" or "play"
  let selectedObject = null;

  // Set up OrbitControls for editor mode
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 1;
  orbitControls.maxDistance = 500;
  orbitControls.maxPolarAngle = Math.PI / 2 + 0.1; // Slightly below horizon

  // Position camera for editor view
  camera.position.set(playerSpawn.x, playerSpawn.y + 20, playerSpawn.z + 30);
  orbitControls.target.set(playerSpawn.x, playerSpawn.y, playerSpawn.z);
  orbitControls.update();

  // Object picker for editor mode
  const objectPicker = picker(renderer, scene, camera);

  // Selection info UI
  const selectionInfo = document.createElement("div");
  selectionInfo.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-family: sans-serif;
    font-size: 12px;
    border-radius: 4px;
    z-index: 1000;
    display: none;
  `;
  document.body.appendChild(selectionInfo);

  // Mode indicator UI
  const modeIndicator = document.createElement("div");
  modeIndicator.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-family: sans-serif;
    font-size: 14px;
    border-radius: 4px;
    z-index: 1000;
  `;
  document.body.appendChild(modeIndicator);

  function updateModeIndicator() {
    modeIndicator.textContent =
      currentMode === "editor" ?
        "EDITOR MODE (Press L for Play)"
      : "PLAY MODE (Press L for Editor)";
  }

  function updateSelectionInfo() {
    if (selectedObject && currentMode === "editor") {
      const name = selectedObject.name || selectedObject.type || "Object";
      const pos = selectedObject.position;
      selectionInfo.innerHTML = `
        <strong>Selected:</strong> ${name}<br>
        <strong>Position:</strong> x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}
      `;
      selectionInfo.style.display = "block";
    } else {
      selectionInfo.style.display = "none";
    }
  }

  function switchToEditorMode() {
    currentMode = "editor";
    window.__disablePointerLock = true; // Prevent click-to-lock in editor
    orbitControls.enabled = true;
    objectPicker.setEnabled(true); // Enable object selection
    // Hide pointer lock hint
    const hint = document.getElementById("pointer-lock-hint");
    if (hint) hint.style.display = "none";
    // Unlock pointer if locked
    if (player?.controls?.isLocked) {
      player.controls.unlock();
    }
    // Position orbit camera at current player position, looking at player
    if (playerCollider) {
      const pos = playerCollider.position;
      camera.position.set(pos.x, pos.y + 15, pos.z + 20);
      orbitControls.target.set(pos.x, pos.y, pos.z);
      orbitControls.update();
    }
    updateModeIndicator();
    updateSelectionInfo();
  }

  function switchToPlayMode() {
    currentMode = "play";
    window.__disablePointerLock = false; // Allow pointer lock in play mode
    orbitControls.enabled = false;
    objectPicker.setEnabled(false); // Disable object selection
    objectPicker.clearSelection(); // Clear any selection from editor mode
    selectedObject = null; // Reset local reference
    selectionInfo.style.display = "none"; // Hide selection info
    // Show pointer lock hint
    const hint = document.getElementById("pointer-lock-hint");
    if (hint) hint.style.display = "";
    // Position camera at player capsule
    if (playerCollider) {
      camera.position.copy(playerCollider.position);
      camera.position.y += playerHeight + 0.03;
    }
    // Lock pointer for first-person controls
    if (player?.controls && !player.controls.isLocked) {
      player.controls.lock();
    }
    updateModeIndicator();
  }

  // Set up object selection callback
  objectPicker.onSelect((obj) => {
    selectedObject = obj;
    updateSelectionInfo();
    if (obj) {
      console.log("[Editor] Selected:", obj.name || obj.type, obj);
    } else {
      console.log("[Editor] Selection cleared");
    }
  });

  // Enable picker by default for editor mode
  objectPicker.setEnabled(true);

  // Initialize mode indicator
  updateModeIndicator();

  // Initialize in editor mode
  window.__disablePointerLock = true;

  // Key listener for mode toggle
  const keyHandler = (event) => {
    if (event.code === "KeyL") {
      if (currentMode === "editor") {
        switchToPlayMode();
      } else {
        switchToEditorMode();
      }
    }
  };
  window.addEventListener("keydown", keyHandler);

  // Update function to call in animation loop
  function update() {
    if (currentMode === "editor") {
      orbitControls.update();
      objectPicker.update();
    }
  }

  return {
    // State getters
    getMode: () => currentMode,
    getSelectedObject: () => selectedObject,
    isEditorMode: () => currentMode === "editor",
    isPlayMode: () => currentMode === "play",

    // Controls
    orbitControls,
    objectPicker,

    // Mode switching
    switchToEditorMode,
    switchToPlayMode,

    // Update (call in animation loop)
    update,

    // Cleanup
    dispose: () => {
      window.removeEventListener("keydown", keyHandler);
      selectionInfo.remove();
      modeIndicator.remove();
      orbitControls.dispose();
    },
  };
}
