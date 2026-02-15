import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

export async function createEnvironment(
  scene,
  hdrPath,
  floorTextures = {},
  physics = null,
  options = {},
) {
  new HDRLoader().load(hdrPath, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
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
  } = textureConfig || {};

  const {
    textureRepeat,
    planeSize = 500,
    segments = 128,
    heightScale = 10,
    heightBias = -5,
    physicsShape = "concaveMesh",
    physicsMargin = 0.05,
    physicsFriction = 1,
    physicsRestitution = 0,
  } = options || {};

  const repeat = textureRepeat ?? textureConfig?.repeat ?? 60;

  const loadTexture = async (path, { isColor = false } = {}) => {
    if (!path) {
      return null;
    }
    const tex = await textureLoader.loadAsync(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    if (isColor) {
      tex.encoding = THREE.sRGBEncoding;
    }
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

  const plane = new THREE.PlaneGeometry(
    planeSize,
    planeSize,
    segments,
    segments,
  );
  if (plane.attributes.uv) {
    plane.setAttribute(
      "uv2",
      new THREE.BufferAttribute(plane.attributes.uv.array, 2),
    );
  }

  let heightInfo = null;
  let heightBounds = { min: 0, max: 0 };
  let terrainData = null;

  if (displacementTexture) {
    heightInfo = extractHeightData(
      plane,
      displacementTexture,
      repeat,
      heightScale,
      heightBias,
    );
    if (heightInfo) {
      applyHeightsToGeometry(plane, heightInfo.heights);
      heightBounds = { min: heightInfo.min, max: heightInfo.max };
    }
  }

  if (heightInfo) {
    const geometryParams = plane.parameters || {};
    const width = geometryParams.width ?? planeSize;
    const depth = geometryParams.height ?? planeSize;
    const cols = Math.max(heightInfo.cols ?? 0, 1);
    const rows = Math.max(heightInfo.rows ?? 0, 1);
    const cellSizeX = width / Math.max(cols - 1, 1);
    const cellSizeZ = depth / Math.max(rows - 1, 1);
    terrainData = {
      grid: heightInfo.grid,
      rows,
      cols,
      cellSizeX,
      cellSizeZ,
      halfWidth: width / 2,
      halfHeight: depth / 2,
      min: heightInfo.min,
      max: heightInfo.max,
    };
  }

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

  const mat = new THREE.MeshStandardMaterial(materialParams);

  const mesh = new THREE.Mesh(plane, mat);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(Math.PI / -2, 0, 0);
  scene.add(mesh);

  if (physics) {
    const basePhysicsConfig = {
      mass: 0,
      collisionFlags: 1,
      margin: physicsMargin,
    };

    const shapeType =
      physicsShape === "heightfield" ? "concaveMesh" : physicsShape;
    if (physicsShape === "heightfield") {
      console.warn(
        "Heightfield physics shape is not supported via add.existing; falling back to concaveMesh.",
      );
    }

    physics.add.existing(mesh, {
      ...basePhysicsConfig,
      shape: shapeType,
    });
    if (mesh.body) {
      mesh.body.setFriction(physicsFriction);
      mesh.body.setRestitution(physicsRestitution);
    }
  }

  return { floor: mesh, heightBounds, terrainData };
}

function extractHeightData(geometry, texture, repeat, scale, bias) {
  const image = texture?.image;
  if (!image) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

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

  const heights = new Float32Array(count);
  const grid = Array.from({ length: rows }, () => new Array(cols));
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  const uvAttr = geometry.attributes.uv;

  for (let i = 0; i < count; i += 1) {
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

  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    return null;
  }

  return { heights, grid, rows, cols, min: minHeight, max: maxHeight };
}

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

function wrapUv(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
