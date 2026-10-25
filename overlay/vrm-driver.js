import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const TARGET_HEIGHT = 2.2;
const EYE_HEIGHT = 2.05;
const BONE_NAMES = [
  'spine', 'chest', 'head',
  'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
  'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg',
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, k) => a + (b - a) * k;
const setRot = (bone, x, y = 0, z = 0) => {
  if (bone) bone.rotation.set(x, y, z);
};

export async function loadVRM(url, scene) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error(`loadVRM: no VRM data in ${url}`);

  if (VRMUtils.removeUnnecessaryVertices) VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);

  // The wrapper carries the per-frame transform; vrm.scene keeps its own
  // rotation (from rotateVRM0), uniform scale and ground offset.
  const wrapper = new THREE.Group();
  wrapper.add(vrm.scene);

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = box.max.y - box.min.y;
  if (height > 0) vrm.scene.scale.setScalar(TARGET_HEIGHT / height);
  vrm.scene.updateMatrixWorld(true);
  vrm.scene.position.y = -new THREE.Box3().setFromObject(vrm.scene).min.y;

  wrapper.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(wrapper);

  // Look target lives in the wrapper so gaze follows the body.
  const lookTarget = new THREE.Object3D();
  lookTarget.name = 'vrm-look-target';
  wrapper.add(lookTarget);
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  const bones = {};
  for (const name of BONE_NAMES) {
    bones[name] = vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  const expr = vrm.expressionManager;
  const setExpr = (name, w) => {
    if (expr?.getExpression(name)) expr.setValue(name, clamp(w, 0, 1));
  };

  return {
    vrm,

    update(dt = 0, s) {
      const t = s.t ?? 0;
      const level = clamp(s.level ?? 0, 0, 1);
      const talk = clamp(s.talk ?? 0, 0, 1);
      const think = clamp(s.think ?? 0, 0, 1);
      const moving = clamp(s.moving ?? 0, 0, 1);
      const sw = Math.sin(s.walkPhase ?? 0);
      const gx = clamp(s.gaze?.x ?? 0, -1, 1);
      const gy = clamp(s.gaze?.y ?? 0, -1, 1);

      wrapper.position.set(s.x ?? 0, s.hop ?? 0, 0);
      wrapper.rotation.y = s.yaw ?? 0;

      const mouth = level * talk;
      const wob = 0.5 + 0.5 * Math.sin(t * 7.3);
      setExpr('aa', mouth * (0.6 + 0.4 * wob));
      setExpr('oh', mouth * 0.4 * (1 - wob));
      setExpr('happy', 0.35 * talk);
      setExpr('relaxed', 0.4 * think);
      setExpr('blink', s.blink ?? 0);

      lookTarget.position.set(gx * 1.2, EYE_HEIGHT + gy * 0.7, 2.5);

      const breath = Math.sin(t * 1.9);
      setRot(bones.spine, 0.012 * breath);
      setRot(bones.chest, 0.02 + 0.02 * breath);

      const idleYaw = 0.03 * Math.sin(t * 0.55);
      const idlePitch = 0.02 * Math.sin(t * 0.8 + 1);
      const idleRoll = 0.02 * Math.sin(t * 0.45);
      const talkNod = 0.05 * level * talk * (0.5 + 0.5 * Math.sin(t * 5.5));
      setRot(
        bones.head,
        (s.nod ?? 0) + idlePitch + talkNod - 0.06 * think,
        (s.headYaw ?? 0) + idleYaw,
        (s.tilt ?? 0) + idleRoll + 0.14 * think,
      );

      // Occasional talking gestures, only while not thinking.
      const gate = clamp(Math.sin(t * 0.5) * 1.5 - 0.3, 0, 1);
      const gesture = gate * (0.6 + 0.4 * Math.sin(t * 3.3)) * talk * (0.4 + 0.6 * level) * (1 - think);
      const lg = 0.35 * gesture;

      const walkArm = 0.4 * moving * sw;
      const walkLeg = 0.5 * moving * sw;
      const walkKnee = 0.5 * moving;

      // Character's right arm hangs at +1.2 on z, lifts toward the chin when thinking.
      setRot(
        bones.rightUpperArm,
        lerp(0, 0.15, think) - walkArm * (1 - think) - 0.35 * gesture,
        0,
        lerp(1.2, -1.2, think) - 0.4 * gesture,
      );
      setRot(bones.rightLowerArm, 0, lerp(0.15, 2.3, think) + 0.8 * gesture, 0);

      // Character's left arm hangs at -1.2 on z.
      setRot(bones.leftUpperArm, walkArm - 0.35 * lg, 0, -1.2 + 0.4 * lg);
      setRot(bones.leftLowerArm, 0, -0.15 - 0.6 * lg, 0);

      setRot(bones.leftUpperLeg, -walkLeg, 0, 0);
      setRot(bones.rightUpperLeg, walkLeg, 0, 0);
      setRot(bones.leftLowerLeg, walkKnee * Math.max(0, -sw), 0, 0);
      setRot(bones.rightLowerLeg, walkKnee * Math.max(0, sw), 0, 0);

      vrm.update(dt);
    },
  };
}
