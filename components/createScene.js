import * as THREE from "three";

export async function createScene() {
  //create scene for our project
  const scene = new THREE.Scene();

  //create camera
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    1000,
  );

  scene.add(camera);

  //create renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding; //needed for accurate color representation of textures and materials
  renderer.toneMapping = THREE.ACESFilmicToneMapping; //needed for accurate rendering of HDR textures and realistic lighting effects
  renderer.toneMappingExposure = 1.25; //adjusts overall brightness of the scene to ensure HDR textures and lighting look correct without being too dark or washed out

  document.body.appendChild(renderer.domElement);

  return { scene, camera, renderer };
}
