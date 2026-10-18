import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createViewKit, COLORS, validBox } from './viewKit.js';
import { createCameraRig } from './cameraRig.js';
import { createRoomView } from './roomView.js';
import { createItemView } from './itemView.js';
import { createEffects } from './effects.js';
import { warningTexture } from './textures.js';

const sizeText = (box) => `${Math.round(box.w)}×${Math.round(box.d)}×${Math.round(box.h)} cm`;

// 所有对外调用和业务回调都在边界隔离，单项失败不会中断界面操作。
function reportSceneError(method, error) {
  console.error(`[Scene] ${method} 执行失败，已跳过`, error);
}

function safeCallback(callback, method) {
  return (...args) => {
    try { if (typeof callback === 'function') return callback(...args); }
    catch (error) { reportSceneError(method, error); }
  };
}

function emptyController() {
  return { pause() {}, resume() {}, seek() {}, stop() {} };
}

function guardSceneApi(api) {
  const guarded = {};
  for (const [name, method] of Object.entries(api)) {
    guarded[name] = (...args) => {
      let finish;
      try {
        if (name !== 'playSteps') return method(...args);
        const options = args[1] || {};
        let finished = false;
        finish = () => {
          if (finished) return;
          finished = true;
          safeCallback(options.onDone, 'playSteps.onDone')();
        };
        const controller = method(args[0], {
          ...options,
          onStep: safeCallback(options.onStep, 'playSteps.onStep'),
          onDone: finish,
        });
        const safeController = emptyController();
        for (const action of Object.keys(safeController)) {
          safeController[action] = (...controlArgs) => {
            try { return controller?.[action]?.(...controlArgs); }
            catch (error) { reportSceneError(`playSteps.${action}`, error); finish(); }
          };
        }
        return safeController;
      } catch (error) {
        reportSceneError(name, error);
        if (name === 'playSteps') { finish?.(); return emptyController(); }
        if (name === 'snapshot') return null;
      }
    };
  }
  return guarded;
}

/** 创建唯一渲染循环，并对外提供稳定的 Scene API。 */
function buildScene(container, { onSelect, onHover } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.fog = new THREE.Fog(COLORS.bg, 900, 3500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  const oldPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.append(renderer.domElement, labels.domElement);
  renderer.domElement.style.display = 'block';

  const kit = createViewKit();
  const roomView = createRoomView(kit);
  const items = createItemView(kit);
  const effects = createEffects(kit, items);
  scene.add(roomView.group, items.group, effects.group);

  const grid = new THREE.Group();
  grid.name = 'ground-grid';
  scene.add(grid);
  function rebuildGrid(bounds = { x: -300, z: -300, w: 600, d: 600 }) {
    for (const child of [...grid.children]) {
      grid.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    const minX = Math.floor((bounds.x - 180) / 60) * 60;
    const maxX = Math.ceil((bounds.x + bounds.w + 180) / 60) * 60;
    const minZ = Math.floor((bounds.z - 200) / 60) * 60;
    const maxZ = Math.ceil((bounds.z + bounds.d + 180) / 60) * 60;
    const makeGrid = (step, color, y, name) => {
      const vertices = [];
      for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) vertices.push(x, y, minZ, x, y, maxZ);
      for (let z = Math.ceil(minZ / step) * step; z <= maxZ; z += step) vertices.push(minX, y, z, maxX, y, z);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.name = name;
      grid.add(lines);
    };
    makeGrid(10, '#120d06', -0.2, '10cm-grid');
    makeGrid(60, COLORS.grid, -0.1, '60cm-grid');
  }
  rebuildGrid();

  const cameraRig = createCameraRig({ container, domElement: renderer.domElement });
  let room = null;
  let disposed = false;
  let frame = 0;
  let selectedId = null;
  let toleranceId = null;
  let hoveredId = null;
  let selectedLabel = null;
  let hoverLabel = null;
  let overflowGroup = null;
  const overflowMap = warningTexture();
  let bloomEnabled = false;
  let composer = null;
  let bloomPass = null;
  let renderPass = null;
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let lastFrame = null;

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function setNodeLabel(oldLabel, text, box, color) {
    if (oldLabel) kit.disposeObject(oldLabel);
    if (!text || !validBox(box)) return null;
    const label = kit.label(`${text}\n${sizeText(box)}`, new THREE.Vector3(box.x + box.w / 2, box.y + box.h + 12, box.z + box.d / 2), color);
    scene.add(label);
    return label;
  }

  function updateSelectedLabel() {
    if (!selectedId) return;
    const record = items.get(selectedId);
    if (!record) {
      selectedId = null;
      items.select(null);
      if (selectedLabel) kit.disposeObject(selectedLabel);
      selectedLabel = null;
      onSelect?.(null);
      return;
    }
    const box = record.box;
    if (selectedLabel) {
      selectedLabel.position.set(box.x + box.w / 2, box.y + box.h + 12, box.z + box.d / 2);
      const source = record.item.sizeSource ? ` · ${record.item.sizeSource}` : '';
      selectedLabel.element.textContent = `${record.item.name}\n${sizeText(box)}${source}`;
    }
  }

  function clearHover() {
    if (hoveredId !== null) onHover?.(null);
    hoveredId = null;
    if (hoverLabel) kit.disposeObject(hoverLabel);
    hoverLabel = null;
  }

  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, cameraRig.camera);
    const itemHit = raycaster.intersectObjects(items.getTargets(), false)[0];
    if (itemHit) return itemHit.object.userData.pick;
    const roomHit = raycaster.intersectObjects(roomView.getTargets(), false)[0];
    return roomHit?.object.userData.pick ?? null;
  }

  function pointerMove(event) {
    const pick = pickAt(event.clientX, event.clientY);
    const nextId = pick?.id ?? null;
    if (nextId !== hoveredId) {
      hoveredId = nextId;
      onHover?.(nextId);
      if (hoverLabel) kit.disposeObject(hoverLabel);
      hoverLabel = pick && pick.kind !== 'item'
        ? setNodeLabel(null, pick.label, pick.box, pick.kind === 'zone' ? COLORS.cyan : COLORS.amber)
        : null;
    }
  }

  function pointerLeave() { clearHover(); }
  function click(event) {
    if (disposed) return;
    const pick = pickAt(event.clientX, event.clientY);
    selectedId = pick?.kind === 'item' ? pick.id : null;
    items.select(selectedId);
    if (selectedLabel) kit.disposeObject(selectedLabel);
    selectedLabel = null;
    if (selectedId) {
      const item = items.get(selectedId);
      const b = item.box;
      const source = item.item.sizeSource ? ` · ${item.item.sizeSource}` : '';
      selectedLabel = kit.label(`${item.item.name}\n${sizeText(b)}${source}`, new THREE.Vector3(b.x + b.w / 2, b.y + b.h + 12, b.z + b.d / 2), COLORS.white);
      scene.add(selectedLabel);
    }
    onSelect?.(selectedId);
  }
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerleave', pointerLeave);
  renderer.domElement.addEventListener('click', click);

  function resize() {
    if (disposed) return;
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    labels.setSize(width, height);
    cameraRig.resize(width, height);
    composer?.setSize(width, height);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function ensureComposer() {
    if (composer) return;
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, cameraRig.camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.6, 0.4, 0.2);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
  }

  function render(now) {
    if (disposed) return;
    if (lastFrame !== null) {
      fpsFrames += 1;
      fpsElapsed += Math.max(now - lastFrame, 0);
      if (fpsElapsed >= 1000) {
        if (bloomEnabled && fpsFrames * 1000 / fpsElapsed < 40) bloomEnabled = false;
        fpsFrames = 0;
        fpsElapsed = 0;
      }
    }
    lastFrame = now;
    cameraRig.update(now);
    items.update(now);
    roomView.update(now);
    effects.update(now);
    updateSelectedLabel();
    if (bloomEnabled && composer) {
      renderPass.camera = cameraRig.camera;
      composer.render();
    } else renderer.render(scene, cameraRig.camera);
    labels.render(scene, cameraRig.camera);
    frame = requestAnimationFrame(render);
  }
  frame = requestAnimationFrame(render);

  function refreshOverflowBay(result) {
    if (overflowGroup) kit.disposeObject(overflowGroup);
    overflowGroup = null;
    if (!result.count || result.width <= 0) return;
    const group = new THREE.Group();
    group.name = 'overflow-bay';
    const width = Math.max(result.width + 24, 90);
    const depth = 150;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: overflowMap, color: '#ffffff', transparent: true, opacity: 0.44, depthWrite: false, side: THREE.DoubleSide }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(width / 2 - 12, 0.2, -95);
    plane.material.map.repeat.set(width / 64, depth / 64);
    const bayLabel = kit.label('OVERFLOW BAY / 滞留区', [width / 2 - 12, 0.5, -177], COLORS.orange);
    group.add(plane, bayLabel);
    scene.add(group);
    overflowGroup = group;
  }

  function setRoom(nextRoom) {
    if (disposed) return;
    const hadRoom = Boolean(room);
    room = nextRoom || null;
    if (toleranceId !== null) effects.showTolerance(toleranceId, null);
    toleranceId = null;
    selectedId = null;
    items.select(null);
    if (selectedLabel) kit.disposeObject(selectedLabel);
    selectedLabel = null;
    clearHover();
    roomView.setRoom(room);
    cameraRig.setRoom(room, { immediate: !hadRoom });
    if (room?.bounds) rebuildGrid(room.bounds);
    else rebuildGrid();
  }

  function setItems(nextItems, placements = {}, { animate = true, overflowIds = [] } = {}) {
    if (disposed) return;
    const result = items.setItems(nextItems, placements, { animate, overflowIds });
    refreshOverflowBay(result);
    if (selectedId && !items.get(selectedId)) {
      selectedId = null;
      items.select(null);
      if (selectedLabel) kit.disposeObject(selectedLabel);
      selectedLabel = null;
      onSelect?.(null);
    }
  }

  function focusOn(id) {
    const item = items.get(id);
    if (item) { roomView.focusDesk(null); return cameraRig.focusBox(item.box); }
    const zone = roomView.getZone(id);
    if (zone && (zone.slot === 'desk' || /\.desk$/.test(zone.id))) {
      roomView.focusDesk(zone);
      return cameraRig.focusDesk(zone);
    }
    roomView.focusDesk(null);
    if (zone) cameraRig.focusBox(zone.box);
  }

  return guardSceneApi({
    setRoom,
    setZoneStatus: (map) => { if (!disposed) roomView.setZoneStatus(map); },
    setItems,
    setItemStates: (map) => { if (!disposed) items.setItemStates(map); },
    showTolerance: (itemId, box) => {
      if (disposed) return;
      // 容差跟随当前选择；取消选择或换房时清除上一个物品的幽灵盒。
      if (toleranceId !== null && toleranceId !== itemId) effects.showTolerance(toleranceId, null);
      effects.showTolerance(itemId, box);
      toleranceId = validBox(box) ? itemId : null;
    },
    showFocusField: (box) => { if (!disposed) effects.showFocusField(box); },
    setFocusFieldState: (state) => { if (!disposed) effects.setFocusFieldState(state); },
    playSteps: (steps, { stepMs = 900, onStep, onDone } = {}) => disposed
      ? { pause() {}, resume() {}, seek() {}, stop() {} }
      : effects.playSteps(steps, { stepMs, onStep, onDone }),
    setCamera: (mode, { owner = 'A' } = {}) => { if (!disposed) { roomView.focusDesk(null); cameraRig.setCamera(mode, { owner }); } },
    focusOn,
    setBloom(on) { if (disposed) return; if (on) ensureComposer(); bloomEnabled = Boolean(on && composer); },
    snapshot() { if (disposed) return null; try { if (bloomEnabled && composer) composer.render(); else renderer.render(scene, cameraRig.camera); return renderer.domElement.toDataURL('image/png'); } catch (error) { reportSceneError('snapshot', error); return null; } },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('click', click);
      clearHover();
      if (selectedLabel) kit.disposeObject(selectedLabel);
      if (overflowGroup) kit.disposeObject(overflowGroup);
      roomView.dispose(); items.dispose(); effects.dispose(); cameraRig.dispose(); kit.dispose();
      for (const child of [...grid.children]) { grid.remove(child); child.geometry.dispose(); child.material.dispose(); }
      overflowMap.dispose();
      bloomPass?.dispose?.(); composer?.dispose();
      renderer.dispose();
      renderer.domElement.remove(); labels.domElement.remove();
      container.style.position = oldPosition;
      onSelect?.(null); onHover?.(null);
    },
  });
}

/** 即使 WebGL 初始化失败也返回完整接口，便于外壳继续交互。 */
export function createScene(container, options = {}) {
  try {
    return buildScene(container, {
      onSelect: safeCallback(options?.onSelect, 'onSelect'),
      onHover: safeCallback(options?.onHover, 'onHover'),
    });
  } catch (error) {
    reportSceneError('createScene', error);
    return guardSceneApi({
      setRoom() {}, setZoneStatus() {}, setItems() {}, setItemStates() {},
      showTolerance() {}, showFocusField() {}, setFocusFieldState() {},
      playSteps(steps, { onDone } = {}) { onDone?.(); return emptyController(); },
      setCamera() {}, focusOn() {}, setBloom() {}, snapshot() { return null; }, dispose() {},
    });
  }
}
