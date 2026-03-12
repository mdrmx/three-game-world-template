// Mode System: Editor/Play mode toggle with OrbitControls, object selection, and TransformControls
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { picker } from "./picker.js";

/**
 * Creates and manages the Editor/Play mode system with transform controls
 * @param {Object} options
 * @param {THREE.Camera} options.camera
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {THREE.Scene} options.scene
 * @param {Object} options.player - First-person controls wrapper
 * @param {Object} options.playerCollider - Physics collider for player
 * @param {number} options.playerHeight - Player height for camera offset
 * @param {Object} options.playerSpawn - Spawn position {x, y, z}
 * @param {Object} options.physics - AmmoPhysics instance for body sync
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
  physics = null,
}) {
  let currentMode = "editor"; // "editor" or "play"
  let selectedObject = null;
  let currentTransformMode = "translate"; // "translate", "rotate", or "scale"
  let currentAxisLock = null; // Track which axis is locked: "x", "y", "z", or null
  const modifiedObjects = new Set(); // Track all objects modified in editor mode

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

  // Set up TransformControls for editing objects
  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode("translate");
  transformControls.setSpace("world"); // Use world space by default

  // Add the transform controls gizmo helper to the scene
  // In Three.js 0.182+, TransformControls extends Controls (not Object3D)
  // so we must add getHelper() which is the actual Object3D gizmo
  let transformHelper = null;
  try {
    transformHelper = transformControls.getHelper();
    if (transformHelper && transformHelper.isObject3D) {
      // CRITICAL: Mark the transform helper as non-selectable to prevent
      // infinite recursion when it gets picked by the raycaster
      transformHelper.userData.selectable = false;
      transformHelper.traverse((child) => {
        child.userData.selectable = false;
      });
      scene.add(transformHelper);
      console.log("[Editor] TransformControls helper added to scene");
    } else {
      console.warn("[Editor] TransformControls helper is not an Object3D");
    }
  } catch (e) {
    console.error("[Editor] Failed to get TransformControls helper:", e);
  }

  // Disable orbit controls while dragging transform controls
  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;
  });

  // Helper: Sync physics body with visual object transform
  function syncPhysicsBody(object) {
    if (!physics || !object || !object.body) return false;

    const body = object.body;
    const pos = object.position;
    const quat = object.quaternion;
    const scale = object.scale;

    // Wake up the body if it was sleeping/frozen
    if (body.ammo) {
      // Re-enable simulation (undo DISABLE_SIMULATION = 4 if set)
      body.ammo.setActivationState(1); // ACTIVE_TAG
      body.ammo.activate(true);

      // Directly update the Ammo.js body transform
      const transform = new Ammo.btTransform();
      const origin = new Ammo.btVector3(pos.x, pos.y, pos.z);
      const rotation = new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w);
      const zeroVec = new Ammo.btVector3(0, 0, 0);

      transform.setIdentity();
      transform.setOrigin(origin);
      transform.setRotation(rotation);

      // Set transform on motion state AND rigid body
      body.ammo.setWorldTransform(transform);
      if (body.ammo.getMotionState()) {
        body.ammo.getMotionState().setWorldTransform(transform);
      }

      // Clear velocities to prevent drift
      body.ammo.setLinearVelocity(zeroVec);
      body.ammo.setAngularVelocity(zeroVec);

      // Update collision shape scale
      const collisionShape = body.ammo.getCollisionShape();
      if (collisionShape) {
        // Store original scale if not already stored
        if (!object.userData._originalPhysicsScale) {
          const currentScale = collisionShape.getLocalScaling();
          object.userData._originalPhysicsScale = {
            x: currentScale.x(),
            y: currentScale.y(),
            z: currentScale.z(),
          };
        }

        // Apply the visual scale relative to original physics scale
        const origPhysScale = object.userData._originalPhysicsScale;
        const origVisScale = object.userData._originalScale || {
          x: 1,
          y: 1,
          z: 1,
        };

        // Calculate new physics scale: original physics scale * (current vis scale / original vis scale)
        const newScaleX = origPhysScale.x * (scale.x / (origVisScale.x || 1));
        const newScaleY = origPhysScale.y * (scale.y / (origVisScale.y || 1));
        const newScaleZ = origPhysScale.z * (scale.z / (origVisScale.z || 1));

        const scaleVec = new Ammo.btVector3(newScaleX, newScaleY, newScaleZ);
        collisionShape.setLocalScaling(scaleVec);
        Ammo.destroy(scaleVec);

        // Update AABB to reflect new size
        physics.physicsWorld.updateSingleAabb(body.ammo);
      }

      // Clean up Ammo objects to prevent memory leaks
      Ammo.destroy(transform);
      Ammo.destroy(origin);
      Ammo.destroy(rotation);
      Ammo.destroy(zeroVec);
    }

    // Mark object as transformed in editor
    object.userData._editorTransformed = true;

    // Store the original scale for reference
    if (!object.userData._originalScale) {
      object.userData._originalScale = object.scale.clone();
    }

    return true;
  }

  // Sync physics on every transform change
  transformControls.addEventListener("objectChange", () => {
    if (selectedObject) {
      syncPhysicsBody(selectedObject);
      modifiedObjects.add(selectedObject); // Track this object was modified
      updateSelectionInfo();
    }
  });

  // Handle end of transform (good place for final sync)
  transformControls.addEventListener("change", () => {
    // Render update handled by animation loop
  });

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

  // Transform mode indicator UI (shows G/R/S keys)
  const transformModeUI = document.createElement("div");
  transformModeUI.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-family: sans-serif;
    font-size: 12px;
    border-radius: 4px;
    z-index: 1000;
    display: none;
  `;
  document.body.appendChild(transformModeUI);

  function updateTransformModeUI() {
    if (currentMode === "editor" && selectedObject) {
      const modes = {
        translate: {
          key: "G",
          label: "Move",
          active: currentTransformMode === "translate",
        },
        rotate: {
          key: "R",
          label: "Rotate",
          active: currentTransformMode === "rotate",
        },
        scale: {
          key: "S",
          label: "Scale",
          active: currentTransformMode === "scale",
        },
      };
      transformModeUI.innerHTML = `
        <strong>Transform Mode:</strong><br>
        ${Object.entries(modes)
          .map(
            ([mode, { key, label, active }]) =>
              `<span style="color: ${active ? "#00ff00" : "#888"}; margin-right: 8px;">
                [${key}] ${label}
              </span>`,
          )
          .join("")}
        <br><span style="color: #888; font-size: 10px;">[X/Y/Z] Axis lock | [Space] Toggle local/world</span>
      `;
      transformModeUI.style.display = "block";
    } else {
      transformModeUI.style.display = "none";
    }
  }

  function setTransformMode(mode) {
    currentTransformMode = mode;
    transformControls.setMode(mode);
    updateTransformModeUI();
    console.log(`[Editor] Transform mode: ${mode}`);
  }

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
      const rot = selectedObject.rotation;
      const scl = selectedObject.scale;
      selectionInfo.innerHTML = `
        <strong>Selected:</strong> ${name}<br>
        <strong>Position:</strong> x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}<br>
        <strong>Rotation:</strong> x: ${THREE.MathUtils.radToDeg(rot.x).toFixed(1)}°, y: ${THREE.MathUtils.radToDeg(rot.y).toFixed(1)}°, z: ${THREE.MathUtils.radToDeg(rot.z).toFixed(1)}°<br>
        <strong>Scale:</strong> x: ${scl.x.toFixed(2)}, y: ${scl.y.toFixed(2)}, z: ${scl.z.toFixed(2)}
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
    transformControls.enabled = true; // Enable transform controls
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
    updateTransformModeUI();
  }

  function switchToPlayMode() {
    currentMode = "play";
    window.__disablePointerLock = false; // Allow pointer lock in play mode
    orbitControls.enabled = false;
    objectPicker.setEnabled(false); // Disable object selection
    objectPicker.clearSelection(); // Clear any selection from editor mode

    // Sync ALL modified objects before switching to play mode
    console.log(
      `[Editor] Syncing ${modifiedObjects.size} modified objects to physics`,
    );
    for (const obj of modifiedObjects) {
      syncPhysicsBody(obj);
    }

    // Detach transform controls
    transformControls.detach();
    transformControls.enabled = false;

    // Reset axis lock state
    currentAxisLock = null;
    transformControls.showX = true;
    transformControls.showY = true;
    transformControls.showZ = true;

    selectedObject = null; // Reset local reference
    selectionInfo.style.display = "none"; // Hide selection info
    transformModeUI.style.display = "none"; // Hide transform mode UI

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
    // If there was a previously selected object, sync its physics before switching
    if (selectedObject && selectedObject !== obj) {
      syncPhysicsBody(selectedObject);
    }

    selectedObject = obj;

    // Store original transform when first selected (before any edits)
    if (obj && !obj.userData._originalScale) {
      obj.userData._originalScale = obj.scale.clone();
      // Also store original physics scale
      if (obj.body?.ammo) {
        const collisionShape = obj.body.ammo.getCollisionShape();
        if (collisionShape) {
          const currentScale = collisionShape.getLocalScaling();
          obj.userData._originalPhysicsScale = {
            x: currentScale.x(),
            y: currentScale.y(),
            z: currentScale.z(),
          };
        }
      }
    }

    updateSelectionInfo();
    updateTransformModeUI();

    if (obj) {
      // Validate object is a proper Object3D before attaching
      if (obj instanceof THREE.Object3D) {
        // Attach transform controls to selected object
        transformControls.attach(obj);
        console.log("[Editor] Selected:", obj.name || obj.type, obj);
      } else {
        console.warn("[Editor] Selected object is not an Object3D:", obj);
      }
    } else {
      // Detach transform controls when nothing selected
      transformControls.detach();
      console.log("[Editor] Selection cleared");
    }
  });

  // Enable picker by default for editor mode
  objectPicker.setEnabled(true);

  // Initialize mode indicator
  updateModeIndicator();

  // Initialize in editor mode
  window.__disablePointerLock = true;

  // Key listener for mode toggle and transform controls
  const keyHandler = (event) => {
    // Mode toggle
    if (event.code === "KeyL") {
      if (currentMode === "editor") {
        switchToPlayMode();
      } else {
        switchToEditorMode();
      }
      return;
    }

    // Transform mode keys (only in editor mode with object selected)
    if (currentMode !== "editor" || !selectedObject) return;

    switch (event.code) {
      case "KeyG": // Move (Grab)
        setTransformMode("translate");
        break;
      case "KeyR": // Rotate
        setTransformMode("rotate");
        break;
      case "KeyS": // Scale
        setTransformMode("scale");
        break;
      case "KeyX": // X axis constraint (toggle)
        if (currentAxisLock === "x") {
          // Already locked to X, unlock all
          transformControls.showX = true;
          transformControls.showY = true;
          transformControls.showZ = true;
          currentAxisLock = null;
        } else {
          transformControls.showX = true;
          transformControls.showY = false;
          transformControls.showZ = false;
          currentAxisLock = "x";
        }
        break;
      case "KeyY": // Y axis constraint (toggle)
        if (currentAxisLock === "y") {
          transformControls.showX = true;
          transformControls.showY = true;
          transformControls.showZ = true;
          currentAxisLock = null;
        } else {
          transformControls.showX = false;
          transformControls.showY = true;
          transformControls.showZ = false;
          currentAxisLock = "y";
        }
        break;
      case "KeyZ": // Z axis constraint (toggle)
        if (currentAxisLock === "z") {
          transformControls.showX = true;
          transformControls.showY = true;
          transformControls.showZ = true;
          currentAxisLock = null;
        } else {
          transformControls.showX = false;
          transformControls.showY = false;
          transformControls.showZ = true;
          currentAxisLock = "z";
        }
        break;
      case "Space": // Toggle local/world space
        event.preventDefault();
        const newSpace =
          transformControls.space === "world" ? "local" : "world";
        transformControls.setSpace(newSpace);
        console.log(`[Editor] Transform space: ${newSpace}`);
        break;
      case "Escape": // Clear axis constraints / deselect
        transformControls.showX = true;
        transformControls.showY = true;
        transformControls.showZ = true;
        currentAxisLock = null;
        break;
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
    transformControls,

    // Mode switching
    switchToEditorMode,
    switchToPlayMode,

    // Transform controls
    setTransformMode,
    syncPhysicsBody,

    // Update (call in animation loop)
    update,

    // Cleanup
    dispose: () => {
      window.removeEventListener("keydown", keyHandler);
      selectionInfo.remove();
      modeIndicator.remove();
      transformModeUI.remove();
      transformControls.detach();
      if (transformHelper) {
        scene.remove(transformHelper);
      }
      transformControls.dispose();
      orbitControls.dispose();
    },
  };
}
