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
    try {
      const tex = await textureLoader.loadAsync(path);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      if (isColor) tex.encoding = THREE.sRGBEncoding;
      return tex;
    } catch (err) {
      // sometimes a path is wrong or file missing; warn and continue with null
      console.warn("texture load failed", path, err);
      return null;
    }
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

/**
 * Create room walls and optional ceiling around a rectangular floor.
 *
 * @param {Object} options
 * @param {THREE.Scene} options.scene - The scene to add walls to
 * @param {Object} options.physics - Physics instance
 * @param {number} [options.planeSize] - Square floor size (legacy, use width/depth instead)
 * @param {number} [options.width] - Floor width (X axis)
 * @param {number} [options.depth] - Floor depth (Z axis)
 * @param {number} [options.wallHeight=5] - Height of walls
 * @param {number} [options.wallThickness=0.5] - Thickness of walls
 * @param {number} [options.segments=1] - Number of segments for wall geometry
 * @param {number} [options.textureRepeat=1] - Texture repeat factor
 * @param {Object} [options.wallTextures={}] - Texture paths for walls
 * @param {Object} [options.ceilingTextures={}] - Texture paths for ceiling
 * @param {Object} [options.walls] - Which walls to create: { north, south, east, west }
 * @param {boolean} [options.ceiling=true] - Whether to create ceiling/roof
 * @param {Object} [options.playerCollider] - Optional player collider to set collision masks
 * @returns {Object} Room data including dimensions and created elements
 */
export async function createRoomWalls({
  scene,
  physics,
  // Support both legacy planeSize and new width/depth
  planeSize,
  width: inputWidth,
  depth: inputDepth,
  wallHeight = 5,
  wallThickness = 0.5,
  segments = 1,
  textureRepeat = 1,
  wallTextures = {},
  ceilingTextures = {},
  // Wall configuration: true = create, false = skip
  // Default: all walls enabled
  walls = { north: true, south: true, east: true, west: true },
  // Ceiling/roof toggle
  ceiling = true,
  playerCollider = null,
} = {}) {
  // Resolve dimensions
  const roomWidth = inputWidth ?? planeSize;
  const roomDepth = inputDepth ?? planeSize;

  if (!scene || !physics || !roomWidth || !roomDepth) {
    throw new Error(
      "createRoomWalls requires scene, physics, and dimensions (width/depth or planeSize)",
    );
  }

  const halfWidth = roomWidth / 2;
  const halfDepth = roomDepth / 2;

  // build materials (may be slow, so we await)
  const wallMaterial = await buildMaterial(wallTextures, textureRepeat);
  const ceilingMaterial = await buildMaterial(ceilingTextures, textureRepeat);

  // collision groups: player vs walls
  const COLLISION_GROUP_PLAYER = 1 << 0;
  const COLLISION_GROUP_WALL = 1 << 1;

  // Track created walls for return value
  const createdWalls = [];

  // Wall definitions: position, size, and which config key enables it
  const wallConfigs = [
    {
      key: "north",
      position: { x: 0, y: wallHeight / 2, z: -halfDepth - wallThickness / 2 },
      size: [roomWidth + wallThickness * 2, wallHeight, wallThickness],
    },
    {
      key: "south",
      position: { x: 0, y: wallHeight / 2, z: halfDepth + wallThickness / 2 },
      size: [roomWidth + wallThickness * 2, wallHeight, wallThickness],
    },
    {
      key: "west",
      position: { x: -halfWidth - wallThickness / 2, y: wallHeight / 2, z: 0 },
      size: [wallThickness, wallHeight, roomDepth + wallThickness * 2],
    },
    {
      key: "east",
      position: { x: halfWidth + wallThickness / 2, y: wallHeight / 2, z: 0 },
      size: [wallThickness, wallHeight, roomDepth + wallThickness * 2],
    },
  ];

  // Create enabled walls
  for (const config of wallConfigs) {
    // Check if this wall is enabled (default to true if not specified)
    const isEnabled = walls[config.key] !== false;
    if (!isEnabled) continue;

    const { position, size } = config;
    // Calculate segments based on wall dimensions
    const isNorthSouth = config.key === "north" || config.key === "south";
    const widthSegs = isNorthSouth ? segments : 1;
    const heightSegs = segments;
    const depthSegs = isNorthSouth ? 1 : segments;

    const wallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        size[0],
        size[1],
        size[2],
        widthSegs,
        heightSegs,
        depthSegs,
      ),
      wallMaterial,
    );
    wallMesh.position.set(position.x, position.y, position.z);
    wallMesh.name = `wall_${config.key}`;
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

    createdWalls.push({ key: config.key, mesh: wallMesh });
  }

  // Ceiling (optional)
  const ceilingY = wallHeight + wallThickness / 2;
  const ceilingSize = [
    roomWidth + wallThickness * 2,
    wallThickness,
    roomDepth + wallThickness * 2,
  ];

  let ceilingMesh = null;
  if (ceiling) {
    ceilingMesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        ceilingSize[0],
        ceilingSize[1],
        ceilingSize[2],
        segments,
        1,
        segments,
      ),
      ceilingMaterial,
    );
    ceilingMesh.position.set(0, ceilingY, 0);
    ceilingMesh.name = "ceiling";
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
  }

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
    // Dimensions
    roomSize: { width: roomWidth, depth: roomDepth },
    ceilingSize,
    ceilingY,
    wallThickness,
    wallHeight,
    // Created elements
    walls: createdWalls,
    ceiling: ceilingMesh,
    hasCeiling: ceiling,
  };
}
