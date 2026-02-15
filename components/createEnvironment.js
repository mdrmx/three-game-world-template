import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

export async function createEnvironment(scene, hdrPath, floorTextures = {}) {
  //create sky background with HDR
  new HDRLoader().load(hdrPath, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping; //set mapping for sky texture to create realistic reflections
    scene.background = texture; //set background of scene to sky texture
    scene.environment = texture; //set environment of scene to sky texture for accurate lighting and reflections on objects
  });

  const textureLoader = new THREE.TextureLoader();
  const textureConfig =
    typeof floorTextures === "string" ?
      { diffuseMap: floorTextures }
    : floorTextures;

  const {
    diffuseMap,
    aoMap,
    armMap,
    normalMap,
    displacementMap,
    roughnessMap,
    repeat = 20,
  } = textureConfig || {};

  const loadTexture = (path, { isColor = false } = {}) => {
    if (!path) {
      return null;
    }
    const tex = textureLoader.load(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    if (isColor) {
      tex.encoding = THREE.sRGBEncoding;
    }
    return tex;
  };

  const baseTexture = loadTexture(diffuseMap, { isColor: true });
  const aoTexture = loadTexture(aoMap);
  const armTexture = loadTexture(armMap);
  const normalTexture = loadTexture(normalMap);
  const displacementTexture = loadTexture(displacementMap);
  const roughnessTexture = loadTexture(roughnessMap);

  const plane = new THREE.PlaneGeometry(500, 500, 32, 32);
  if (plane.attributes.uv) {
    //duplicate primary UVs to uv2 so aoMap works out of the box
    plane.setAttribute(
      "uv2",
      new THREE.BufferAttribute(plane.attributes.uv.array, 2),
    );
  }

  const materialParams = {
    map: baseTexture || undefined,
    aoMap: aoTexture || undefined,
    normalMap: normalTexture || undefined,
    displacementMap: displacementTexture || undefined,
    roughnessMap: roughnessTexture || undefined,
    roughness: 1,
    metalness: armTexture ? 1 : 0,
  };

  if (armTexture) {
    materialParams.metalnessMap = armTexture;
    materialParams.roughnessMap = materialParams.roughnessMap || armTexture;
    materialParams.aoMap = materialParams.aoMap || armTexture;
  }

  if (displacementTexture) {
    materialParams.displacementScale = 10;
    materialParams.displacementBias = -5;
  }

  const mat = new THREE.MeshStandardMaterial(materialParams);

  let mesh = new THREE.Mesh(plane, mat);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(Math.PI / -2, 0, 0); //rotate plane to be horizontal like a floor
  scene.add(mesh);
  return { floor: mesh };
}
