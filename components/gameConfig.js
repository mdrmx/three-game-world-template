import * as THREE from "three";

export const GAME_CONFIG = {
  physics: {
    ammoPath: "/ammo",
  },
  environment: {
    hdrPath: "public/textures/hdr/sky2.hdr",
    planeSize: 150,
    segments: 400,
    textureRepeat: 8,
    heightScale: 0.3,
    heightBias: -1,
    floorTextureSet: "rocks",
    wallTextureSet: "damaged_plaster",
  },
  player: {
    capsuleRadius: 0.4,
    walkAcceleration: 4,
    sprintAcceleration: 8,
    jumpSpeed: 12,
  },
  model: {
    path: "/models/house.glb",
    scale: 1,
    position: new THREE.Vector3(2, 0.5, 0),
    mass: 0,
    animationPlaybackRate: 0.5,
    colliderOffset: new THREE.Vector3(0, 0, 0),
  },
  lighting: {
    ambientIntensity: 0.4,
    activationDistance: 7,
    activeLightIntensity: 20.8,
  },
};

export function createPbrTexturePaths(category, textureName) {
  return {
    diffuseMap: `textures/${category}/${textureName}/${textureName}_diff.jpg`,
    aoMap: `textures/${category}/${textureName}/${textureName}_ao.jpg`,
    armMap: `textures/${category}/${textureName}/${textureName}_arm.jpg`,
    normalMap: `textures/${category}/${textureName}/${textureName}_nor.jpg`,
    displacementMap: `textures/${category}/${textureName}/${textureName}_disp.jpg`,
    roughnessMap: `textures/${category}/${textureName}/${textureName}_rough.jpg`,
  };
}
