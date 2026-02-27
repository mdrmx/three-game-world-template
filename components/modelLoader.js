import * as THREE from "three";

// Optionally pass AmmoPhysics instance for physics bounding box
// options object may include:
//   mass             – number (0 makes collider static; default ≈10)
//   colliderOffset   – Vector3 | {x,y,z}; shifts the **bounding box** relative
//                      to the supplied position.  When physics is enabled the
//                      mesh is automatically offset inside the collider so its
//                      world location remains unchanged.  Ignored when physics
//                      is null.
//   modelOffset      – Vector3 | {x,y,z}; additionally moves the visible model
//                      away from the supplied position (independent of collider).
//                      Applies with or without physics.
//   rotation         – Euler angles (Vector3 or {x,y,z}) specifying additional
//                      rotation to apply to both model and collider.  This is
//                      combined with the small fixed orientation that existed
//                      previously (0, 1.2π, 0) so the default behaviour stays
//                      unchanged unless you provide your own values.
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
      let collider = null;

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

      // compute base world position from caller
      const basePos = new THREE.Vector3(12, -0.1, 0);
      if (position instanceof THREE.Vector3) {
        basePos.copy(position);
      } else if (position) {
        basePos.set(position.x, -position.y * 3, position.z);
      }

      // compute optional offsets
      const colliderOff =
        options.colliderOffset ?
          options.colliderOffset instanceof THREE.Vector3 ?
            options.colliderOffset
          : new THREE.Vector3(
              options.colliderOffset.x || 0,
              options.colliderOffset.y || 0,
              options.colliderOffset.z || 0,
            )
        : new THREE.Vector3();

      const modelOff =
        options.modelOffset ?
          options.modelOffset instanceof THREE.Vector3 ?
            options.modelOffset
          : new THREE.Vector3(
              options.modelOffset.x || 0,
              options.modelOffset.y || 0,
              options.modelOffset.z || 0,
            )
        : new THREE.Vector3();

      const colliderPosition = basePos.clone().add(colliderOff);

      // apply fixed base orientation and optional user rotation
      const baseEuler = new THREE.Euler(0, Math.PI / 1.2, 0);
      const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);
      let finalQuat = baseQuat.clone();
      if (options.rotation) {
        const r =
          options.rotation instanceof THREE.Vector3 ?
            new THREE.Euler(
              options.rotation.x,
              options.rotation.y,
              options.rotation.z,
            )
          : new THREE.Euler(
              options.rotation.x || 0,
              options.rotation.y || 0,
              options.rotation.z || 0,
            );
        const userQuat = new THREE.Quaternion().setFromEuler(r);
        finalQuat.multiply(userQuat);
      }
      model.quaternion.copy(finalQuat);

      if (physics) {
        // Allow static or dynamic by mass option (default: dynamic)
        const mass = typeof options.mass === "number" ? options.mass : 10;
        collider = physics.add.box(
          {
            width: size.x || 1,
            height: size.y || 1,
            depth: size.z || 1,
            x: colliderPosition.x,
            y: colliderPosition.y + (size.y || 1) / 2,
            z: colliderPosition.z,
            mass,
          },
          { lambert: { color: 0xff0000, transparent: true, opacity: 0 } },
        );
        // centre geometry inside collider
        model.position.set(0, -center.y, 0);
        // if a collider offset was supplied, move the model back the other way
        model.position.add(colliderOff.clone().negate());
        // then add any explicit model offset relative to base position
        model.position.add(modelOff);
        // ensure collider shares model rotation
        if (finalQuat) {
          collider.quaternion.copy(finalQuat);
        }

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
        // Place model at requested world position plus any modelOffset
        const worldPos = basePos.clone().add(modelOff);
        model.position.add(worldPos);
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
