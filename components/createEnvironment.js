// Environment/terrain setup for 3D scene
import * as THREE from "three";
import { ExtendedMesh } from "enable3d";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

const TILE_SIZE = 3; // Each tile is 20x20 units

export async function createEnvironment(
  scene,
  hdrPath,
  floorTextures = {},
  options = {},
  physics = null,
) {
  if (hdrPath) {
    // Load HDRI for sky/environment lighting
    new HDRLoader().load(hdrPath, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.environment = texture;
    });
  }

  // Prepare texture loader and config
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
  } = textureConfig || {};

  // Support both planeSize (square) and width/depth (rectangular)
  const {
    textureRepeat = 2,
    planeSize,
    width: inputWidth,
    depth: inputDepth,
    segments = 8,
    heightScale = 10,
    heightBias = -5,
    // Texture rotation options:
    // - Array of angles in radians: [0, Math.PI/2, Math.PI, ...]
    // - "natural": many rotations for organic textures (rocks, grass)
    // - "aligned": 0° and 180° only for structured textures (planks, tiles)
    // - "none": no rotation
    textureRotations = "aligned",
  } = options || {};

  // Resolve dimensions: width/depth take priority over planeSize
  const floorWidth = inputWidth ?? planeSize ?? 500;
  const floorDepth = inputDepth ?? planeSize ?? 500;

  // Resolve texture rotations
  const ROTATION_PRESETS = {
    natural: [
      0,
      Math.PI / 4,
      Math.PI / 2,
      (3 * Math.PI) / 4,
      Math.PI,
      (5 * Math.PI) / 4,
      (3 * Math.PI) / 2,
      (7 * Math.PI) / 4,
    ],
    aligned: [0, Math.PI], // 0° and 180° only - keeps patterns aligned
    none: [0],
  };

  const rotations =
    Array.isArray(textureRotations) ? textureRotations : (
      (ROTATION_PRESETS[textureRotations] ?? ROTATION_PRESETS.natural)
    );

  // How many times to repeat the floor textures per tile
  const repeat = textureRepeat;

  // Helper to load a texture (without setting repeat - we'll clone per tile)
  const loadTextureBase = async (path, { isColor = false } = {}) => {
    if (!path) {
      return null;
    }
    const tex = await textureLoader.loadAsync(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (isColor) {
      tex.encoding = THREE.sRGBEncoding;
    }
    return tex;
  };

  // Load all relevant textures in parallel
  const [
    baseTexture,
    aoTexture,
    armTexture,
    normalTexture,
    displacementTexture,
    roughnessTexture,
  ] = await Promise.all([
    loadTextureBase(diffuseMap, { isColor: true }),
    loadTextureBase(aoMap),
    loadTextureBase(armMap),
    loadTextureBase(normalMap),
    loadTextureBase(displacementMap),
    loadTextureBase(roughnessMap),
  ]);

  // Calculate number of tiles needed for each axis
  const tilesX = Math.ceil(floorWidth / TILE_SIZE);
  const tilesZ = Math.ceil(floorDepth / TILE_SIZE);
  const actualWidth = tilesX * TILE_SIZE;
  const actualDepth = tilesZ * TILE_SIZE;
  const halfWidth = actualWidth / 2;
  const halfDepth = actualDepth / 2;

  // Container for all tiles
  const floorGroup = new THREE.Group();
  floorGroup.name = "floorTiles";
  floorGroup.userData.selectable = false; // Exclude floor from editor selection

  // Track global height bounds across all tiles
  let globalMinHeight = Infinity;
  let globalMaxHeight = -Infinity;

  // Build a global height grid for terrain sampling
  const globalCols = tilesX * segments + 1;
  const globalRows = tilesZ * segments + 1;
  const globalGrid = Array.from({ length: globalRows }, () =>
    new Array(globalCols).fill(0),
  );

  // Create tiles
  for (let tileZ = 0; tileZ < tilesZ; tileZ++) {
    for (let tileX = 0; tileX < tilesX; tileX++) {
      // Random rotation for this tile's texture
      const textureRotation =
        rotations[Math.floor(Math.random() * rotations.length)];

      // Clone textures and apply rotation + repeat for this tile
      const cloneAndRotateTexture = (tex) => {
        if (!tex) return null;
        const cloned = tex.clone();
        cloned.needsUpdate = true;
        cloned.repeat.set(repeat, repeat);
        cloned.rotation = textureRotation;
        cloned.center.set(0.5, 0.5); // Rotate around center
        return cloned;
      };

      const tileBaseTexture = cloneAndRotateTexture(baseTexture);
      const tileAoTexture = cloneAndRotateTexture(aoTexture);
      const tileArmTexture = cloneAndRotateTexture(armTexture);
      const tileNormalTexture = cloneAndRotateTexture(normalTexture);
      const tileDisplacementTexture =
        cloneAndRotateTexture(displacementTexture);
      const tileRoughnessTexture = cloneAndRotateTexture(roughnessTexture);

      // Create tile geometry
      const tileGeometry = new THREE.PlaneGeometry(
        TILE_SIZE,
        TILE_SIZE,
        segments,
        segments,
      );

      // Duplicate UVs to uv2 for AO/lightmap support
      if (tileGeometry.attributes.uv) {
        tileGeometry.setAttribute(
          "uv2",
          new THREE.BufferAttribute(
            tileGeometry.attributes.uv.array.slice(),
            2,
          ),
        );
      }

      // Apply height displacement if texture available
      if (tileDisplacementTexture) {
        const heightInfo = extractHeightData(
          tileGeometry,
          displacementTexture, // Use original for pixel data
          repeat,
          heightScale,
          heightBias,
        );
        if (heightInfo) {
          applyHeightsToGeometry(tileGeometry, heightInfo.heights);
          if (heightInfo.min < globalMinHeight)
            globalMinHeight = heightInfo.min;
          if (heightInfo.max > globalMaxHeight)
            globalMaxHeight = heightInfo.max;

          // Copy heights to global grid
          const tileStartRow = tileZ * segments;
          const tileStartCol = tileX * segments;
          for (let r = 0; r < heightInfo.rows; r++) {
            for (let c = 0; c < heightInfo.cols; c++) {
              const globalR = tileStartRow + r;
              const globalC = tileStartCol + c;
              if (
                globalR < globalRows &&
                globalC < globalCols &&
                heightInfo.grid[r]
              ) {
                globalGrid[globalR][globalC] = heightInfo.grid[r][c];
              }
            }
          }
        }
      }

      // Create material for this tile
      const materialParams = {
        map: tileBaseTexture || undefined,
        aoMap: tileAoTexture || undefined,
        normalMap: tileNormalTexture || undefined,
        roughnessMap: tileRoughnessTexture || undefined,
        roughness: 1,
        metalness: tileArmTexture ? 1 : 0,
      };

      if (tileArmTexture) {
        materialParams.metalnessMap = tileArmTexture;
        materialParams.roughnessMap =
          materialParams.roughnessMap || tileArmTexture;
        materialParams.aoMap = materialParams.aoMap || tileArmTexture;
      }

      const tileMaterial = new THREE.MeshStandardMaterial(materialParams);

      // Create mesh
      const tileMesh = new ExtendedMesh(tileGeometry, tileMaterial);

      // Position tile: center the grid around origin
      const posX = tileX * TILE_SIZE - halfWidth + TILE_SIZE / 2;
      const posZ = tileZ * TILE_SIZE - halfDepth + TILE_SIZE / 2;
      tileMesh.position.set(posX, 0, posZ);
      tileMesh.rotation.set(-Math.PI / 2, 0, 0);

      floorGroup.add(tileMesh);

      // Add physics to each tile
      if (physics) {
        physics.add.existing(tileMesh, { mass: 0, shape: "concave" });

        // Set collision margin
        if (tileMesh.body && tileMesh.body.ammo) {
          const shape = tileMesh.body.ammo.getCollisionShape();
          if (shape && shape.setMargin) {
            shape.setMargin(0.05);
          }
        }

        // Set collision group/mask
        if (
          tileMesh.body &&
          tileMesh.body.setCollisionGroup &&
          tileMesh.body.setCollisionMask
        ) {
          const COLLISION_GROUP_PLAYER = 1 << 0;
          const COLLISION_GROUP_GROUND = 1 << 2;
          const COLLISION_GROUP_OBJECT = 1 << 3;
          tileMesh.body.setCollisionGroup(COLLISION_GROUP_GROUND);
          tileMesh.body.setCollisionMask(
            COLLISION_GROUP_PLAYER |
              COLLISION_GROUP_GROUND |
              COLLISION_GROUP_OBJECT,
          );
        }
      }
    }
  }

  // Mark floor as non-selectable in editor mode
  floorGroup.userData.selectable = false;
  scene.add(floorGroup);

  // Build heightBounds
  const heightBounds = {
    min: Number.isFinite(globalMinHeight) ? globalMinHeight : 0,
    max: Number.isFinite(globalMaxHeight) ? globalMaxHeight : 0,
  };

  // Build terrainData for gameplay height sampling
  const terrainData = {
    grid: globalGrid,
    rows: globalRows,
    cols: globalCols,
    cellSizeX: actualWidth / Math.max(globalCols - 1, 1),
    cellSizeZ: actualDepth / Math.max(globalRows - 1, 1),
    halfWidth: halfWidth,
    halfHeight: halfDepth,
    min: heightBounds.min,
    max: heightBounds.max,
  };

  return {
    floor: floorGroup,
    heightBounds,
    terrainData,
    // Export actual dimensions for use by walls/other systems
    floorSize: { width: actualWidth, depth: actualDepth },
  };
}

// Extracts height data from a displacement texture and geometry
function extractHeightData(geometry, texture, repeat, scale, bias) {
  const image = texture?.image;
  if (!image) {
    return null;
  }

  // Draw image to canvas to access pixel data
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  // Calculate grid size from geometry
  const { count } = geometry.attributes.position;
  const geometryParams = geometry.parameters || {};
  const widthSegments =
    geometryParams.widthSegments ??
    Math.max(Math.round(Math.sqrt(count)) - 1, 1);
  const heightSegments = geometryParams.heightSegments ?? widthSegments;

  let cols = Math.max(widthSegments + 1, 1);
  let rows = Math.max(heightSegments + 1, 1);
  if (cols * rows !== count) {
    cols = Math.max(Math.round(Math.sqrt(count)), 1);
    rows = Math.max(Math.round(count / cols), 1);
  }

  // Fill heights and grid from pixel data
  const heights = new Float32Array(count);
  const grid = Array.from({ length: rows }, () => new Array(cols));
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  const uvAttr = geometry.attributes.uv;

  for (let i = 0; i < count; i += 1) {
    // Map UV to pixel, extract height, and store in grid
    const u = wrapUv((uvAttr.getX(i) * repeat) % 1);
    const v = wrapUv((uvAttr.getY(i) * repeat) % 1);
    const x = Math.floor(u * (canvas.width - 1));
    const y = Math.floor((1 - v) * (canvas.height - 1));
    const idx = (y * canvas.width + x) * 4;
    const heightValue = pixels[idx] / 255;
    const mappedHeight = heightValue * scale + bias;
    heights[i] = mappedHeight;
    const row = Math.floor(i / cols);
    const col = i % cols;
    if (grid[row]) {
      grid[row][col] = mappedHeight;
    }
    if (mappedHeight < minHeight) minHeight = mappedHeight;
    if (mappedHeight > maxHeight) maxHeight = mappedHeight;
  }

  // Validate height range
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    return null;
  }

  return { heights, grid, rows, cols, min: minHeight, max: maxHeight };
}

// Applies height values to the Z coordinate of geometry vertices
function applyHeightsToGeometry(geometry, heights) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    position.setZ(i, heights[i]);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

// Ensures UV coordinates are wrapped to [0,1]
function wrapUv(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
