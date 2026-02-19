import * as THREE from "three";

export async function loadModel(loader, url, modelSize, position, scene) {
  return new Promise((resolve, reject) => {
    const ANIMATION_PLAYBACK_RATE = 1.0;

    loader.load(url, (gltf) => {
      const model = gltf.scene;
      let mixer = null;
      let activeAction = null;

      console.log("hut model loaded:", gltf);
      scene.add(model);

      const nodes = [];
      model.traverse((child) => {
        nodes.push({ name: child.name, type: child.type });
      });
      // console.table(nodes);

      if (position instanceof THREE.Vector3) {
        model.position.copy(position);
      } else if (position) {
        model.position.set(position.x, position.y, position.z);
      } else {
        model.position.set(12, -0.1, 0);
      }

      model.rotation.set(0, Math.PI / 1.2, 0);

      // Compute the bounding box of the model
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z); // Largest dimension

      // Uniformly scale the model so its largest axis matches targetSize
      if (maxAxis > 0) {
        const targetSize = modelSize; // Desired max size for any axis
        const scaleFactor = targetSize / maxAxis; // Calculate the scale factor to resize the model so its largest dimension matches targetSize
        model.scale.multiplyScalar(scaleFactor); // Apply the scale factor uniformly to the model
        model.updateWorldMatrix(true, true); // Update transforms after scaling
        bounds.setFromObject(model); // Recompute bounds after scaling
        bounds.getSize(size);
      } else {
        // If model has no size, just update its world matrix
        model.updateWorldMatrix(true, true);
      }

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations[0];
        activeAction = mixer.clipAction(clip);
        activeAction.reset();
        activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
        activeAction.play();
        // console.log(
        //   "Playing animation:",
        //   clip.name,
        //   "(duration:",
        //   clip.duration,
        //   "seconds)",
        // );
      }

      resolve({ model, mixer, activeAction });
    });
  });
}
