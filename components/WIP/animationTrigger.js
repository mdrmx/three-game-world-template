// proximity to models[2] (triceratops) triggers animation change
const model3 = models[2];
if (model3 && model3.collider && model3.clips?.length > 1) {
  // calculate squared distance in XZ plane between player and model
  const playerPos = playerCollider.position;
  const modelPos = model3.collider.position;
  const dx = modelPos.x - playerPos.x;
  const dz = modelPos.z - playerPos.z;
  const distSq = dx * dx + dz * dz;
  const activationDistanceSq = 30; // set activation distance (5 units) squared for comparison
  const isNear = distSq < activationDistanceSq;

  // Switch to clip[1] when near, clip[0] when far
  const targetClipIndex = isNear ? 1 : 0;
  if (model3.currentClipIndex !== targetClipIndex) {
    const newAction = model3.mixer.clipAction(model3.clips[targetClipIndex]);
    if (model3.activeAction) {
      model3.activeAction.fadeOut(1.5);
    }
    newAction.reset().fadeIn(0.3).play();
    model3.activeAction = newAction;
    model3.currentClipIndex = targetClipIndex;
  }
}

//log model position for debugging
if (model.collider) {
  const pos = model.collider.position;
  // console.log(pos);
  //if posY is below -10 respawn model at original position
  if (pos.y < -10) {
    const [spawnX, spawnY, spawnZ] = model.config.position;
    const body = model.collider.body;
    if (body && body.ammo) {
      // Reset physics body transform using Ammo.js
      const transform = new Ammo.btTransform();
      transform.setIdentity();
      transform.setOrigin(new Ammo.btVector3(spawnX, spawnY + 2, spawnZ));
      body.ammo.setWorldTransform(transform);
      body.ammo.getMotionState().setWorldTransform(transform);
      body.ammo.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
      body.ammo.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
      body.ammo.activate();
    }
    model.collider.position.set(spawnX, spawnY + 2, spawnZ);
    if (body) body.needUpdate = true;
  }
}
