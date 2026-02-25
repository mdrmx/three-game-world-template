import * as THREE from "three";

// Optionally pass AmmoPhysics instance for physics bounding box
// options: { mass: number } (optional)
export async function loadModel(
  loader,
  url,
  modelSize,
  position,
  scene,
  physics = null,
  options = {},
) {
  return new Promise((resolve, reject) => {
    const ANIMATION_PLAYBACK_RATE = 1.0;

    loader.load(url, (gltf) => {
      const model = gltf.scene;
      let mixer = null;
      let activeAction = null;

      console.log("hut model loaded:", gltf);

      // Compute the bounding box of the model
      let bounds = new THREE.Box3().setFromObject(model);
      let size = bounds.getSize(new THREE.Vector3());
      let center = bounds.getCenter(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z); // Largest dimension

      // Uniformly scale the model so its largest axis matches targetSize
      if (maxAxis > 0) {
        const targetSize = modelSize; // Desired max size for any axis
        const scaleFactor = targetSize / maxAxis;
        model.scale.multiplyScalar(scaleFactor);
        model.updateWorldMatrix(true, true);
        // Recompute bounds and center after scaling
        bounds = new THREE.Box3().setFromObject(model);
        size = bounds.getSize(new THREE.Vector3());
        center = bounds.getCenter(new THREE.Vector3());
      } else {
        model.updateWorldMatrix(true, true);
        bounds = new THREE.Box3().setFromObject(model);
        size = bounds.getSize(new THREE.Vector3());
        center = bounds.getCenter(new THREE.Vector3());
      }

      // Center model geometry at origin (so collider wraps it)
      model.position.sub(center);

      // Place collider at requested world position, model at (0, -center.y, 0) inside collider
      let collider = null;
      let colliderPosition = new THREE.Vector3(12, -0.1, 0);
      if (position instanceof THREE.Vector3) {
        colliderPosition.copy(position);
      } else if (position) {
        colliderPosition.set(position.x, -position.y * 3, position.z);
      }

      model.rotation.set(0, Math.PI / 1.2, 0);

      if (physics) {
        // Allow static or dynamic by mass option (default: dynamic)
        const mass = typeof options.mass === "number" ? options.mass : 10;
        collider = physics.add.box(
          {
            width: size.x || 1,
            height: size.y / 4 || 1,
            depth: size.z || 1,
            x: colliderPosition.x,
            y: colliderPosition.y + (size.y || 1) / 2,
            z: colliderPosition.z,
            mass,
          },
          { lambert: { color: 0xff0000, transparent: true, opacity: 0 } },
        );
        // Place model at (0, -center.y, 0) so its geometry origin matches collider center
        model.position.set(0, -center.y, 0);
        collider.add(model);
        collider.position.set(
          colliderPosition.x,
          colliderPosition.y + (size.y || 1) / 2,
          colliderPosition.z,
        );
        // Hide collider visually
        const materials =
          Array.isArray(collider.material) ?
            collider.material
          : [collider.material];
        materials.forEach((mat) => {
          if (!mat) return;
          mat.transparent = true;
          mat.opacity = 0;
          mat.depthWrite = false;
        });
        scene.add(collider);
      } else {
        // Place model at requested world position
        model.position.add(colliderPosition);
        scene.add(model);
      }

      const nodes = [];
      model.traverse((child) => {
        nodes.push({ name: child.name, type: child.type });
      });
      // console.table(nodes);

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations[0];
        activeAction = mixer.clipAction(clip);
        activeAction.reset();
        activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
        activeAction.play();
      }

      resolve({ model, mixer, activeAction, collider });
    });
  });
}
