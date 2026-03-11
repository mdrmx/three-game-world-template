import * as THREE from "three";

/**
 * Sets up basic raycasting behaviour on a renderer/canvas so the caller can
 * track which objects are hovered or clicked.  This mirrors the tutorial
 * example but is stripped down and adapted for use in the engine.
 *
 * @param {THREE.WebGLRenderer} renderer - renderer whose DOM element will
 *   receive pointer events.
 * @param {THREE.Scene} scene - scene containing the objects to test.
 * @param {THREE.Camera} camera - camera used to generate the ray.
 *
 * @returns {Object} an API for the picker:
 *   - update(time): call every frame with the current time to refresh hover
 *       highlighting.  (The caller is responsible for rendering.)
 *   - onHover(fn): register a callback(fn(object|null)) when the pointer moves
 *       over an object (null when it leaves everything).
 *   - onClick(fn): register a callback(fn(object, intersection)) invoked when
 *       the canvas is clicked/tapped and an object was hit.
 *   - dispose(): remove all event listeners when the picker is no longer needed.
 */
export function picker(renderer, scene, camera) {
  const canvas = renderer.domElement;

  const raycaster = new THREE.Raycaster();
  const pickPosition = { x: -100000, y: -100000 }; // offscreen until first move

  // allow temporarily disabling the picker (e.g. during fpv mode)
  let enabled = true;

  // utility: climb from any mesh to the object that was directly added to the
  // scene.  This helps when models are hierarchical and you want to treat the
  // entire model as one selectable unit instead of its individual children.
  function rootFromObject(obj) {
    while (obj.parent && obj.parent.type !== "Scene") {
      obj = obj.parent;
    }
    return obj;
  }

  // object currently under the pointer (hovered)
  let hoveredObject = null;

  // object that has been selected via click; only one at a time
  let selectedObject = null;
  // the specific mesh used for highlighting (may be a child of selectedObject)
  let selectedHighlightMesh = null;
  let selectedObjectSavedColor = 0;

  const hoverCallbacks = [];
  const clickCallbacks = [];
  const selectCallbacks = [];

  function getCanvasRelativePosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function setPickPosition(event) {
    const pos = getCanvasRelativePosition(event);
    pickPosition.x = (pos.x / canvas.width) * 2 - 1;
    pickPosition.y = (pos.y / canvas.height) * -2 + 1; // flip Y
  }

  function clearPickPosition() {
    pickPosition.x = -100000;
    pickPosition.y = -100000;
    notifyHover(null);
  }

  function notifyHover(object) {
    hoverCallbacks.forEach((fn) => fn(object));
  }

  function notifySelection(object) {
    selectCallbacks.forEach((fn) => fn(object));
  }

  // raycast at the given normalized position and report hover
  function pick(normalizedPosition) {
    if (!enabled) return null;
    raycaster.setFromCamera(normalizedPosition, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    let obj = intersects.length ? intersects[0].object : null;
    if (obj) obj = rootFromObject(obj);
    if (obj !== hoveredObject) {
      hoveredObject = obj;
      notifyHover(obj);
    }
    return obj;
  }

  function update() {
    if (!enabled) return;
    pick(pickPosition);
  }

  // track whether pointer has moved since last down
  let pointerDownPos = null;
  let pointerMoved = false;

  function onPointerDown(e) {
    if (!enabled) return;
    pointerDownPos = { x: e.clientX, y: e.clientY };
    pointerMoved = false;
  }

  function onPointerMoveDuringDown(e) {
    if (!pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (dx * dx + dy * dy > 25 /* 5px threshold squared */) {
      pointerMoved = true;
    }
  }

  function fireClick(event) {
    if (!enabled) return;
    // ignore if the user dragged the pointer significantly
    if (pointerMoved) return;

    setPickPosition(event);
    raycaster.setFromCamera(pickPosition, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length) {
      let obj = intersects[0].object;
      obj = rootFromObject(obj);
      clickCallbacks.forEach((fn) => fn(obj, intersects[0]));
      toggleSelection(obj);
    } else {
      // click on empty space should clear selection
      toggleSelection(null);
    }
  }

  function onMouseMove(e) {
    if (!enabled) return;
    setPickPosition(e);
  }

  function onMouseOut() {
    clearPickPosition();
  }

  function onTouchStart(e) {
    if (!enabled) return;
    e.preventDefault();
    setPickPosition(e.touches[0]);
  }

  function onTouchMove(e) {
    if (!enabled) return;
    setPickPosition(e.touches[0]);
  }

  function onClickEvent(e) {
    fireClick(e);
  }

  // attach listeners
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onPointerDown);
  canvas.addEventListener("mousemove", onPointerMoveDuringDown);
  canvas.addEventListener("mouseout", onMouseOut);
  canvas.addEventListener("mouseleave", onMouseOut);
  canvas.addEventListener("click", onClickEvent);

  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove);
  canvas.addEventListener("touchend", onMouseOut);

  function onHover(fn) {
    hoverCallbacks.push(fn);
  }

  function onClick(fn) {
    clickCallbacks.push(fn);
  }

  function onSelect(fn) {
    selectCallbacks.push(fn);
  }

  function dispose() {
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mousedown", onPointerDown);
    canvas.removeEventListener("mousemove", onPointerMoveDuringDown);
    canvas.removeEventListener("mouseout", onMouseOut);
    canvas.removeEventListener("mouseleave", onMouseOut);
    canvas.removeEventListener("click", onClickEvent);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onMouseOut);
  }

  /**
   * Select or deselect the given object.  Passing `null` clears the current
   * selection.  Only one object can be selected at a time.
   */
  // find a mesh with an emissive material inside the hierarchy
  function findHighlightMesh(o) {
    if (o.material && o.material.emissive !== undefined) {
      return o;
    }
    for (const child of o.children || []) {
      const found = findHighlightMesh(child);
      if (found) return found;
    }
    return null;
  }

  function toggleSelection(obj) {
    if (selectedObject === obj) {
      // deselect: restore previous mesh if available
      if (selectedHighlightMesh) {
        selectedHighlightMesh.material.emissive.setHex(
          selectedObjectSavedColor,
        );
      }
      selectedObject = null;
      selectedHighlightMesh = null;
      selectedObjectSavedColor = 0;
      notifySelection(null);
      return;
    }

    // clear previous
    if (selectedHighlightMesh) {
      selectedHighlightMesh.material.emissive.setHex(selectedObjectSavedColor);
    }

    if (obj) {
      selectedObject = obj;
      selectedHighlightMesh = findHighlightMesh(obj) || obj;
      if (selectedHighlightMesh && selectedHighlightMesh.material) {
        selectedObjectSavedColor =
          selectedHighlightMesh.material.emissive.getHex();
        selectedHighlightMesh.material.emissive.setHex(0xffff00);
      } else {
        selectedObjectSavedColor = 0;
      }
    } else {
      selectedObject = null;
      selectedHighlightMesh = null;
      selectedObjectSavedColor = 0;
    }
    notifySelection(selectedObject);
  }

  function setEnabled(val) {
    enabled = !!val;
    if (!enabled) {
      clearPickPosition();
    }
  }

  function isEnabled() {
    return enabled;
  }

  return { update, onHover, onClick, onSelect, dispose, setEnabled, isEnabled };
}
