// Utility for adding lights to the scene
import * as THREE from "three";

/**
 * Create a pair of point lights above a reference position and add them to
 * the scene.  Returns an array containing the created lights.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} basePos  reference position (usually a model's location)
 * @param {object} [opts]
 * @param {number} [opts.color=0xffffff]
 * @param {number} [opts.baseIntensity=0]
 * @param {number} [opts.secondIntensityOffset=100]
 * @param {number} [opts.distance=25]
 * @param {number} [opts.decay=2]
 * @param {Array<object>} [opts.offsets]  position offsets for the two lights
 * @returns {THREE.PointLight[]}
 */
export function createPointLights(scene, basePos, opts = {}) {
  const {
    color = 0xffffff,
    baseIntensity = 0,
    secondIntensityOffset = 100,
    distance = 25,
    decay = 2,
    offsets = [
      { x: 0, y: 7, z: 0 },
      { x: -1, y: 10, z: 3 },
    ],
  } = opts;

  const lights = [];

  const light1 = new THREE.PointLight(color, baseIntensity, distance, decay);
  light1.position.set(
    basePos.x + offsets[0].x,
    basePos.y + offsets[0].y,
    basePos.z + offsets[0].z,
  );
  light1.castShadow = true;
  scene.add(light1);
  lights.push(light1);

  const light2 = new THREE.PointLight(
    color,
    baseIntensity + secondIntensityOffset,
    distance,
    decay,
  );
  light2.position.set(
    basePos.x + offsets[1].x,
    basePos.y + offsets[1].y,
    basePos.z + offsets[1].z,
  );
  light2.castShadow = true;
  scene.add(light2);
  lights.push(light2);

  return lights;
}

/**
 * Create a grid of spotlights attached to the ceiling.  Helps simulate an
 * array of gallery lights.  All the lights (and their targets) are added to
 * the scene and the resulting list of spotlights is returned.
 *
 * @param {THREE.Scene} scene
 * @param {object} params
 * @param {Array<number>} params.ceilingSize  [width, ?, depth]
 * @param {number} params.ceilingY
 * @param {number} params.wallThickness
 * @param {number} [params.numLightsPerSide=4]
 * @param {number} [params.color=0xffffff]
 * @param {number} [params.intensity=1]
 * @param {number} [params.distance=25]
 * @param {number} [params.decay=2]
 * @param {number} [params.angle=Math.PI/6.5]
 * @param {number} [params.penumbra=0.4]
 * @param {boolean} [params.showHelpers=false]  if true, adds small spheres at
 *   each light position for debugging/viewing layout
 * @returns {THREE.SpotLight[]}
 */
export function createCeilingLights(
  scene,
  {
    ceilingSize,
    ceilingY,
    wallThickness,
    numLightsPerSide = 4,
    color = 0xffffff,
    intensity = 1,
    distance = 25,
    decay = 2,
    angle = Math.PI / 6.5,
    penumbra = 0.4,
    showHelpers = false,
  } = {},
) {
  const lights = [];
  const [width, , depth] = ceilingSize;

  // grid of lights on X and Z axes
  for (let i = 0; i < numLightsPerSide; i++) {
    for (let j = 0; j < numLightsPerSide; j++) {
      const x = -width / 2 + (width / (numLightsPerSide + 1)) * (i + 1);
      const z = -depth / 2 + (depth / (numLightsPerSide + 1)) * (j + 1);
      const yOffset = ceilingY - wallThickness / 2 + 0.1;

      const light = new THREE.SpotLight(
        color,
        intensity,
        distance,
        angle,
        penumbra,
        decay,
      );
      light.position.set(x, yOffset, z);
      light.castShadow = true;

      // target down toward floor
      const target = new THREE.Object3D();
      const targetY = 0.1; // slightly above floor
      target.position.set(x, targetY, z);
      scene.add(target);
      light.target = target;

      scene.add(light);
      lights.push(light);

      if (showHelpers) {
        const sphereGeometry = new THREE.SphereGeometry(0.15, 12, 12);
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffaa });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(x, yOffset, z);
        scene.add(sphere);
      }
    }
  }

  return lights;
}
