import * as THREE from "three";

// create a material from an optional set of texture paths
async function buildMaterial(textureConfig = {}, repeat = 1) {
  const textureLoader = new THREE.TextureLoader();
  const {
    diffuseMap,
    aoMap,
    armMap,
    normalMap,
    displacementMap,
    roughnessMap,
  } = textureConfig || {};

  // simple no‑texture fallback
  if (
    !diffuseMap &&
    !aoMap &&
    !armMap &&
    !normalMap &&
    !displacementMap &&
    !roughnessMap
  ) {
    return new THREE.MeshStandardMaterial({ color: 0x888888 });
  }

  const loadTexture = async (path, { isColor = false } = {}) => {
    if (!path) return null;
    const tex = await textureLoader.loadAsync(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    if (isColor) tex.encoding = THREE.sRGBEncoding;
    return tex;
  };

  const [
    baseTexture,
    aoTexture,
    armTexture,
    normalTexture,
    displacementTexture,
    roughnessTexture,
  ] = await Promise.all([
    loadTexture(diffuseMap, { isColor: true }),
    loadTexture(aoMap),
    loadTexture(armMap),
    loadTexture(normalMap),
    loadTexture(displacementMap),
    loadTexture(roughnessMap),
  ]);

  const materialParams = {
    map: baseTexture || undefined,
    aoMap: aoTexture || undefined,
    normalMap: normalTexture || undefined,
    roughnessMap: roughnessTexture || undefined,
    roughness: 1,
    metalness: armTexture ? 1 : 0,
  };

  if (armTexture) {
    materialParams.metalnessMap = armTexture;
    materialParams.roughnessMap = materialParams.roughnessMap || armTexture;
    materialParams.aoMap = materialParams.aoMap || armTexture;
  }

  return new THREE.MeshStandardMaterial(materialParams);
}

// public API: create room walls + ceiling around a square floor
export async function createRoomWalls({
  scene,
  physics,
  planeSize,
  wallHeight = 5,
  wallThickness = 0.5,
  textureRepeat = 1,
  wallTextures = {},
  ceilingTextures = {},
  playerCollider = null,
} = {}) {
  if (!scene || !physics || typeof planeSize !== "number") {
    throw new Error("createRoomWalls requires scene, physics and planeSize");
  }

  const halfSize = planeSize / 2;

  // build materials (may be slow, so we await)
  const wallMaterial = await buildMaterial(wallTextures, textureRepeat);
  const ceilingMaterial = await buildMaterial(ceilingTextures, textureRepeat);

  // collision groups: player vs walls
  const COLLISION_GROUP_PLAYER = 1 << 0;
  const COLLISION_GROUP_WALL = 1 << 1;

  const wallPositions = [
    { x: 0, y: wallHeight / 2, z: -halfSize - wallThickness / 2 }, // Back
    { x: 0, y: wallHeight / 2, z: halfSize + wallThickness / 2 }, // Front
    { x: -halfSize - wallThickness / 2, y: wallHeight / 2, z: 0 }, // Left
    { x: halfSize + wallThickness / 2, y: wallHeight / 2, z: 0 }, // Right
  ];

  wallPositions.forEach(({ x, y, z }) => {
    const isSideWall = Math.abs(x) > 0;
    let size;
    if (isSideWall) {
      size = [wallThickness, wallHeight, halfSize * 2 + wallThickness * 2];
    } else {
      size = [halfSize * 2 + wallThickness * 2, wallHeight, wallThickness];
    }

    const wallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      wallMaterial,
    );
    wallMesh.position.set(x, y, z);
    scene.add(wallMesh);

    physics.add.existing(wallMesh, {
      mass: 0,
      shape: "box",
      width: size[0],
      height: size[1],
      depth: size[2],
      collisionGroup: COLLISION_GROUP_WALL,
      collisionMask: COLLISION_GROUP_PLAYER | COLLISION_GROUP_WALL,
    });
  });

  // ceiling
  const ceilingY = wallHeight + wallThickness / 2;
  const ceilingSize = [
    halfSize * 2 + wallThickness * 2,
    wallThickness,
    halfSize * 2 + wallThickness * 2,
  ];

  const ceilingMesh = new THREE.Mesh(
    new THREE.BoxGeometry(...ceilingSize),
    ceilingMaterial,
  );
  ceilingMesh.position.set(0, ceilingY, 0);
  scene.add(ceilingMesh);
  physics.add.existing(ceilingMesh, {
    mass: 0,
    shape: "box",
    width: ceilingSize[0],
    height: ceilingSize[1],
    depth: ceilingSize[2],
    collisionGroup: COLLISION_GROUP_WALL,
    collisionMask: COLLISION_GROUP_PLAYER | COLLISION_GROUP_WALL,
  });

  // if caller supplied the player collider update its collision flags
  if (
    playerCollider &&
    playerCollider.body &&
    playerCollider.body.setCollisionGroup &&
    playerCollider.body.setCollisionMask
  ) {
    playerCollider.body.setCollisionGroup(COLLISION_GROUP_PLAYER);
    playerCollider.body.setCollisionMask(
      COLLISION_GROUP_WALL | COLLISION_GROUP_PLAYER,
    );
  }

  return {
    ceilingSize,
    ceilingY,
    wallThickness,
    wallHeight,
  };
}
``;
