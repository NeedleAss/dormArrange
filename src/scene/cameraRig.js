import { MathUtils, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** @typedef {{x:number,y:number,z:number,w:number,d:number,h:number}} Box */

const TRANSITION_MS = 700;
const WORLD_UP = new Vector3(0, 1, 0);
// 从 +Y 看向地面时，以 -Z 为画面上方，保证世界 +X 始终朝屏幕右边。
const TOP_UP = new Vector3(0, 0, -1);
const ORBIT_DIRECTION = new Vector3(0.6, 1, -0.8).normalize();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function validBox(box) {
  return box && ['x', 'y', 'z', 'w', 'd', 'h'].every((key) => Number.isFinite(box[key]))
    && box.w >= 0 && box.d >= 0 && box.h >= 0;
}

function centerOf(box) {
  return new Vector3(box.x + box.w / 2, box.y + box.h / 2, box.z + box.d / 2);
}

/** 按屏幕的横纵投影估算距离，fraction 是目标在可用画幅中的占比。 */
function fitDistance(box, direction, up, fov, aspect, fraction) {
  const right = new Vector3().crossVectors(up, direction).normalize();
  const screenUp = new Vector3().crossVectors(direction, right).normalize();
  const extent = (axis) => (Math.abs(axis.x) * box.w + Math.abs(axis.y) * box.h
    + Math.abs(axis.z) * box.d) / 2;
  const tangent = Math.tan(MathUtils.degToRad(fov / 2));
  return Math.max(extent(screenUp) / (tangent * fraction),
    extent(right) / (tangent * aspect * fraction), 10) + extent(direction);
}

/**
 * 管理透视/蓝图相机；动画只由场景唯一的渲染循环调用 update 推进。
 * @param {{container:HTMLElement,domElement:HTMLElement,onCameraChange?:(camera:import('three').Camera)=>void}} options
 */
export function createCameraRig({ container, domElement, onCameraChange }) {
  let width = Math.max(1, container?.clientWidth || domElement.clientWidth || 1);
  let height = Math.max(1, container?.clientHeight || domElement.clientHeight || 1);
  let aspect = width / height;
  const perspective = new PerspectiveCamera(50, aspect, 1, 6000);
  const orthographic = new OrthographicCamera(-400 * aspect, 400 * aspect, 400, -400, 1, 6000);
  let camera = perspective;
  let controls;
  let room = null;
  let mode = 'orbit';
  let owner = 'A';
  let disposed = false;
  let transition = null;
  let halfHeight = 400;
  let topFrameBox = null;
  let topFraction = 0.88;
  const target = new Vector3();
  camera.position.copy(ORBIT_DIRECTION).multiplyScalar(650);
  camera.lookAt(target);

  function updateProjection() {
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    orthographic.left = -halfHeight * aspect;
    orthographic.right = halfHeight * aspect;
    orthographic.top = halfHeight;
    orthographic.bottom = -halfHeight;
    orthographic.updateProjectionMatrix();
  }

  function makeControls() {
    controls?.dispose();
    // OrbitControls 在初始化时记录 up，投影/坐标朝向切换后重新建立以免拖动轴错位。
    controls = new OrbitControls(camera, domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 8;
    controls.maxDistance = 5800;
    controls.minZoom = 0.2;
    controls.maxZoom = 20;
    controls.enableRotate = mode !== 'top';
    controls.maxPolarAngle = mode === 'top' ? Math.PI : Math.PI / 2 - 0.01;
    controls.enabled = !transition;
    if (!transition) controls.update();
  }

  makeControls();

  function topHalfHeight(box, fraction) {
    return Math.max(box.d, box.w / aspect, 1) / (2 * fraction);
  }

  function readState() {
    target.copy(controls.target);
    return { position: camera.position.clone(), target: target.clone(), up: camera.up.clone(),
      quaternion: camera.quaternion.clone(), fov: perspective.fov,
      // 滚轮改变正交相机 zoom，切换起点必须保存实际可见画幅。
      halfHeight: camera.isOrthographicCamera ? halfHeight / camera.zoom : halfHeight };
  }

  function applyState(state) {
    camera.position.copy(state.position);
    target.copy(state.target);
    controls.target.copy(target);
    camera.up.copy(state.up).normalize();
    perspective.fov = state.fov;
    halfHeight = state.halfHeight;
    if (state.quaternion) camera.quaternion.copy(state.quaternion);
    else camera.lookAt(target);
    updateProjection();
    camera.updateMatrixWorld();
  }

  /** 相机类型在起点切换，位置、目标与画幅在 700ms 内连续过渡。 */
  function goTo(nextMode, destination, immediate = false) {
    const start = readState();
    // 插值朝向而非每帧 lookAt：正上方与某些 seat 方向之间不会出现 up/视线共线翻转。
    destination.quaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(destination.position, destination.target, destination.up));
    const nextCamera = nextMode === 'top' ? orthographic : perspective;
    const changed = nextCamera !== camera;
    if (changed) {
      const distance = start.position.distanceTo(start.target);
      if (nextCamera.isOrthographicCamera) {
        start.halfHeight = Math.max(1, distance * Math.tan(MathUtils.degToRad(start.fov / 2)));
      } else {
        start.fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(start.halfHeight / Math.max(1, distance))), 5, 120);
      }
      camera = nextCamera;
    }
    mode = nextMode;
    transition = immediate ? null : { start, destination, startedAt: null };
    camera.zoom = 1;
    camera.position.copy(start.position);
    camera.up.copy(start.up);
    makeControls();
    applyState(immediate ? destination : start);
    if (immediate) makeControls();
    if (changed) onCameraChange?.(camera);
  }

  function roomState(nextMode) {
    const bounds = room?.bounds;
    if (!validBox(bounds)) return null;
    const center = centerOf(bounds);
    if (nextMode === 'top') {
      topFrameBox = bounds;
      topFraction = 0.88;
      return { target: center, position: center.clone().add(new Vector3(0,
        Math.max(bounds.w, bounds.d, bounds.h, 100) * 2, 0)),
      up: TOP_UP.clone(), fov: 50, halfHeight: topHalfHeight(bounds, topFraction) };
    }
    if (nextMode === 'seat') {
      const zone = room.zones?.find((entry) => entry.id === `${owner}.desk`);
      if (!validBox(zone?.box)) return null;
      const box = zone.box;
      const eye = centerOf(box);
      const aim = centerOf(box);
      eye.y = 115;
      aim.y = box.y;
      // front 指人在盒子的哪一侧；视线落在相反方向的桌面后沿。
      switch (zone.front) {
        case '+x': eye.x = box.x + box.w + 45; aim.x = box.x; break;
        case '-x': eye.x = box.x - 45; aim.x = box.x + box.w; break;
        case '+z': eye.z = box.z + box.d + 45; aim.z = box.z; break;
        case '-z': eye.z = box.z - 45; aim.z = box.z + box.d; break;
        default: return null;
      }
      return { position: eye, target: aim, up: WORLD_UP.clone(), fov: 70, halfHeight };
    }
    const distance = fitDistance(bounds, ORBIT_DIRECTION, WORLD_UP, 50, aspect, 0.88);
    return { target: center, position: center.clone().addScaledVector(ORBIT_DIRECTION, distance),
      up: WORLD_UP.clone(), fov: 50, halfHeight };
  }

  function setRoom(nextRoom, { immediate = true } = {}) {
    if (disposed) return;
    room = nextRoom;
    const destination = roomState(mode);
    if (destination) goTo(mode, destination, immediate);
  }

  function setCamera(nextMode, { owner: nextOwner = 'A' } = {}) {
    if (disposed || !['orbit', 'top', 'seat'].includes(nextMode)) return;
    owner = nextOwner;
    const destination = roomState(nextMode);
    if (destination) goTo(nextMode, destination);
  }

  /** 书桌采用前沿斜俯视，避免继承座位视角的低仰角遮住冲突物品。 */
  function focusDesk(zone) {
    if (disposed || !validBox(zone?.box)) return;
    const box = { ...zone.box, h: Math.max(1, Math.min(zone.box.h, 45)) };
    const front = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }[zone.front];
    if (!front) return focusBox(box);
    const direction = new Vector3(...front);
    direction.y = 1;
    direction.normalize();
    const target = centerOf(box);
    const distance = fitDistance(box, direction, WORLD_UP, 50, aspect, 0.4);
    goTo('orbit', { target, position: target.clone().addScaledVector(direction, distance),
      up: WORLD_UP.clone(), fov: 50, halfHeight });
  }

  /** @param {Box} box */
  function focusBox(box) {
    if (disposed || !validBox(box)) return;
    const center = centerOf(box);
    if (mode === 'top') {
      topFrameBox = box;
      topFraction = 0.4;
      const altitude = Math.max(room?.bounds?.h || 0, box.h, 100) * 2;
      goTo(mode, { position: center.clone().add(new Vector3(0, altitude, 0)), target: center,
        up: TOP_UP.clone(), fov: perspective.fov, halfHeight: topHalfHeight(box, topFraction) });
      return;
    }
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.001) direction.copy(ORBIT_DIRECTION);
    direction.y = Math.max(direction.y, direction.length() * 0.08);
    direction.normalize();
    const distance = fitDistance(box, direction, WORLD_UP, perspective.fov, aspect, 0.4);
    goTo(mode, { target: center, position: center.clone().addScaledVector(direction, distance),
      up: WORLD_UP.clone(), fov: perspective.fov, halfHeight });
  }

  function resize(nextWidth, nextHeight) {
    if (disposed) return;
    width = Math.max(1, Number(nextWidth) || 1);
    height = Math.max(1, Number(nextHeight) || 1);
    aspect = width / height;
    if (mode === 'top' && topFrameBox) {
      const nextHalfHeight = topHalfHeight(topFrameBox, topFraction);
      if (transition) transition.destination.halfHeight = nextHalfHeight;
      else halfHeight = nextHalfHeight;
    }
    updateProjection();
  }

  /** @param {number} now requestAnimationFrame 的毫秒时间戳。 */
  function update(now) {
    if (disposed) return;
    if (!transition) {
      controls.update();
      target.copy(controls.target);
      return;
    }
    if (transition.startedAt === null) transition.startedAt = now;
    const progress = MathUtils.clamp((now - transition.startedAt) / TRANSITION_MS, 0, 1);
    const eased = easeInOutCubic(progress);
    const { start, destination } = transition;
    applyState({ position: start.position.clone().lerp(destination.position, eased),
      target: start.target.clone().lerp(destination.target, eased),
      up: start.up.clone().lerp(destination.up, eased),
      quaternion: start.quaternion.clone().slerp(destination.quaternion, eased),
      fov: MathUtils.lerp(start.fov, destination.fov, eased),
      halfHeight: MathUtils.lerp(start.halfHeight, destination.halfHeight, eased) });
    if (progress === 1) {
      transition = null;
      makeControls();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    transition = null;
    controls.dispose();
    room = null;
    topFrameBox = null;
  }

  return { get camera() { return camera; }, get controls() { return controls; },
    setRoom, setCamera, focusBox, focusDesk, resize, update, dispose };
}
