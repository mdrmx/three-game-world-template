import * as THREE from "three";

export async function loadModel(loader, url, position, scene, camera) {
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

      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z);

      if (maxAxis > 0) {
        const targetSize = 22;
        const scaleFactor = targetSize / maxAxis;
        model.scale.multiplyScalar(scaleFactor);
        model.updateWorldMatrix(true, true);
        bounds.setFromObject(model);
        bounds.getSize(size);
      } else {
        model.updateWorldMatrix(true, true);
      }

      // Center the model and update camera frustum so the asset appears correctly
      const worldCenter = bounds.getCenter(new THREE.Vector3());
      model.userData.boundingCenter = model.worldToLocal(worldCenter.clone());

      const maxSize = Math.max(size.x, size.y, size.z);
      const safeMaxSize = Math.max(maxSize, 0.0001);
      const halfSize = safeMaxSize * 0.5;
      const distance =
        halfSize / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      const viewOffset = new THREE.Vector3(0, halfSize * 1.5, distance * 1.25);

      const desiredNear = Math.max(0.0001, Math.min(1, halfSize * 0.01));
      const desiredFar = Math.max(camera.far, distance * 10);
      if (camera.near !== desiredNear || camera.far !== desiredFar) {
        camera.near = desiredNear;
        camera.far = desiredFar;
        camera.updateProjectionMatrix();
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
