import { PhysicsLoader } from "@enable3d/ammo-physics";
import { GameWorld } from "./components/GameWorld.js";
import { GAME_CONFIG } from "./components/gameConfig.js";

PhysicsLoader(GAME_CONFIG.physics.ammoPath, async () => {
  const game = new GameWorld(GAME_CONFIG);
  await game.init();
  game.start();
});
