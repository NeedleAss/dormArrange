import * as THREE from 'three';
import { COLORS, center, easeInOutCubic, validBox } from './viewKit.js';

const cloneBox = (box) => box ? { ...box } : null;
const lerpBox = (from, to, t) => Object.fromEntries(
  ['x', 'y', 'z', 'w', 'd', 'h'].map((key) => [key, THREE.MathUtils.lerp(from[key], to[key], t)]),
);

/** 六边形图案由程序生成；纹理颜色通过材质统一染色。 */
function hexTexture(box) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  const radius = 20;
  const rowHeight = Math.sqrt(3) * radius;
  for (let col = -1; col < 19; col += 1) {
    for (let row = -1; row < 17; row += 1) {
      const x = col * radius * 1.5;
      const y = row * rowHeight + (col % 2) * rowHeight / 2;
      ctx.beginPath();
      for (let corner = 0; corner < 6; corner += 1) {
        const angle = corner * Math.PI / 3;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (corner === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // 纹理随真实厘米尺寸平铺，避免长桌上六边形被拉伸。
  texture.repeat.set(Math.max(box.w / 200, 0.1), Math.max(box.d / 200, 0.1));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 特效仅在主场景的 update 中推进，不创建额外渲染循环。
 * @param {object} kit 共用盒子、标签、资源释放工具。
 * @param {{get:Function,apply:Function,cancelTween:Function}} items 物品显示控制器。
 */
export function createEffects(kit, items) {
  const group = new THREE.Group();
  group.name = 'effects';
  const tolerances = new Map();
  const trails = [];
  let field = null;
  let fieldState = 'conflict';
  let playback = null;
  let latestPlayback = null;
  let lastNow = null;

  function remove(object) {
    if (object) kit.disposeObject(object);
  }

  function clearTrails() {
    for (const trail of trails) remove(trail.object);
    trails.length = 0;
  }

  function refreshField() {
    if (!field) return;
    const color = fieldState === 'clear' ? COLORS.green : COLORS.orange;
    field.box.userData.fill.material.color.set(color);
    field.box.userData.edge.material.color.set(color);
    field.top.material.color.set(color);
    if (field.label) {
      remove(field.label);
      field.label = null;
    }
    if (fieldState === 'clear') {
      const box = field.bounds;
      field.label = kit.label('FIELD CLEAR / 净空',
        new THREE.Vector3(box.x + box.w / 2, box.y + box.h + 7, box.z + box.d / 2), COLORS.green);
      field.group.add(field.label);
    }
  }

  /** @param {object|null} box 世界坐标最小角盒。 */
  function showFocusField(box) {
    if (field) remove(field.group);
    field = null;
    fieldState = 'conflict';
    if (!validBox(box)) return;
    const container = new THREE.Group();
    container.name = 'focus-field';
    const volume = kit.box(box, { fill: COLORS.orange, fillOpacity: 0.12, line: COLORS.orange, lineOpacity: 0.8 });
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(box.w, 0.001), Math.max(box.d, 0.001)),
      new THREE.MeshBasicMaterial({ color: COLORS.orange, map: hexTexture(box), transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.set(box.x + box.w / 2, box.y + box.h + 0.25, box.z + box.d / 2);
    container.add(volume, top);
    group.add(container);
    field = { group: container, box: volume, top, label: null, bounds: cloneBox(box) };
    refreshField();
  }

  function setFocusFieldState(state) {
    if (state !== 'conflict' && state !== 'clear') return;
    fieldState = state;
    refreshField();
  }

  /** 容差盒已经是世界坐标，不能再叠加物品位置。 */
  function showTolerance(itemId, box) {
    remove(tolerances.get(itemId));
    tolerances.delete(itemId);
    if (!validBox(box)) return;
    const view = kit.box(box, { fill: COLORS.green, fillOpacity: 0.025, line: COLORS.green, lineOpacity: 0.8, dashed: true });
    view.name = `tolerance:${itemId}`;
    group.add(view);
    tolerances.set(itemId, view);
  }

  function trajectory(step) {
    if (!validBox(step.from)) return null;
    const a = center(step.from);
    const b = validBox(step.to) ? center(step.to) : a.clone();
    const control = a.clone().lerp(b, 0.5);
    // 二次贝塞尔中点只取控制点高度的一半，因此抬高 60cm 才能在中段离开直线 30cm。
    control.y += 60;
    const curve = new THREE.QuadraticBezierCurve3(a, control, b);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
      new THREE.LineDashedMaterial({ color: COLORS.purple, transparent: true, opacity: 0.85, dashSize: 6, gapSize: 4, depthWrite: false }),
    );
    line.name = `move-trail:${step.itemId}`;
    line.computeLineDistances();
    group.add(line);
    const trail = { object: line, remaining: Infinity, curve };
    trails.push(trail);
    return trail;
  }

  /** 显示缩放交由物品控制器完成，逻辑 Box 始终保留实际尺寸。 */
  function applyStep(step, t, arc = true) {
    if (!items.get(step.itemId) || !validBox(step.from)) return;
    const target = validBox(step.to) ? step.to : step.from;
    const box = lerpBox(step.from, target, t);
    if (arc && step.to && t > 0 && t < 1) box.y += 120 * t * (1 - t);
    const hiding = !step.to || step.kind === 'store';
    const revealing = step.kind === 'retrieve';
    const amount = hiding ? 1 - t : revealing ? t : 1;
    items.apply(step.itemId, box, { opacity: amount, scale: amount });
  }

  function retireTrail(state) {
    if (state.trail) state.trail.remaining = 2000;
    state.trail = null;
  }

  function beginStep(state) {
    if (state.index >= state.steps.length) return;
    const step = state.steps[state.index];
    state.begun = true;
    items.cancelTween(step.itemId);
    applyStep(step, 0, false);
    state.trail = trajectory(step);
    state.onStep?.(state.index);
  }

  function finish(state) {
    if (state.finished || state.stopped || playback !== state) return;
    state.finished = true;
    playback = null;
    state.onDone?.();
  }

  /**
   * @param {Array<object>} steps
   * @param {{stepMs?:number,onStep?:Function,onDone?:Function}} options
   */
  function playSteps(steps, { stepMs = 900, onStep, onDone } = {}) {
    if (playback) {
      playback.stopped = true;
      retireTrail(playback);
    }
    clearTrails();
    const snapshots = new Map();
    const copy = (steps || []).map((step) => ({ ...step, from: cloneBox(step.from), to: cloneBox(step.to) }));
    for (const step of copy) {
      const record = items.get(step.itemId);
      if (record && !snapshots.has(step.itemId)) {
        snapshots.set(step.itemId, {
          box: cloneBox(record.box),
          opacity: Number.isFinite(record.opacity) ? record.opacity : 1,
          scale: Number.isFinite(record.scale) ? record.scale : 1,
        });
      }
      items.cancelTween(step.itemId);
    }
    const state = {
      steps: copy, snapshots, onStep, onDone,
      stepMs: Number.isFinite(stepMs) ? Math.max(1, stepMs) : 900,
      index: 0, elapsed: 0, paused: false, stopped: false, finished: false, begun: false, trail: null,
    };
    playback = state;
    latestPlayback = state;
    const controller = {
      pause() {
        if (playback === state && !state.stopped && !state.finished) state.paused = true;
      },
      resume() {
        if (playback !== state || state.stopped || state.finished) return;
        state.paused = false;
        if (!state.begun && state.index < state.steps.length) beginStep(state);
      },
      seek(index) {
        // 自然播完后仍可回看；新的播放会使旧控制器失效。
        if (latestPlayback !== state || state.stopped) return;
        playback = state;
        state.finished = false;
        for (const [id, snapshot] of snapshots) {
          items.cancelTween(id);
          if (validBox(snapshot.box)) items.apply(id, snapshot.box, { opacity: snapshot.opacity, scale: snapshot.scale });
        }
        clearTrails();
        state.trail = null;
        const last = Number.isFinite(index) ? Math.max(-1, Math.min(copy.length - 1, Math.floor(index))) : -1;
        for (let i = 0; i <= last; i += 1) applyStep(copy[i], 1, false);
        state.index = last + 1;
        state.elapsed = 0;
        state.begun = false;
        state.paused = true;
      },
      stop() {
        if (playback !== state || state.stopped || state.finished) return;
        state.stopped = true;
        retireTrail(state);
        playback = null;
      },
    };
    if (copy.length) beginStep(state);
    else finish(state);
    return controller;
  }

  /** RAF 毫秒时间是唯一时钟；暂停期间轨迹倒计时也一起冻结。 */
  function update(now) {
    if (!Number.isFinite(now)) return;
    const delta = lastNow === null ? 0 : Math.max(0, now - lastNow);
    lastNow = now;
    if (field) field.box.userData.edge.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(now * Math.PI * 2 / 1000));
    const paused = playback?.paused;
    if (!paused) {
      for (let i = trails.length - 1; i >= 0; i -= 1) {
        if (Number.isFinite(trails[i].remaining)) trails[i].remaining -= delta;
        if (trails[i].remaining <= 0) { remove(trails[i].object); trails.splice(i, 1); }
      }
    }
    const state = playback;
    if (!state || state.paused || state.stopped || state.finished) return;
    state.elapsed += delta;
    // 大帧间隔仍逐个触发开始回调，不能跳过中间的搬运步骤。
    while (playback === state && !state.paused && state.index < state.steps.length) {
      if (!state.begun) beginStep(state);
      if (playback !== state || state.paused) break;
      const t = Math.min(1, state.elapsed / state.stepMs);
      applyStep(state.steps[state.index], easeInOutCubic(t));
      if (t < 1) break;
      retireTrail(state);
      state.elapsed -= state.stepMs;
      state.index += 1;
      state.begun = false;
      if (state.index < state.steps.length) beginStep(state);
    }
    if (playback === state && state.index >= state.steps.length && !state.paused) finish(state);
  }

  function dispose() {
    if (playback) playback.stopped = true;
    playback = null;
    latestPlayback = null;
    clearTrails();
    for (const view of tolerances.values()) remove(view);
    tolerances.clear();
    if (field) remove(field.group);
    field = null;
    lastNow = null;
    group.clear();
  }

  return { group, showFocusField, setFocusFieldState, showTolerance, playSteps, update, dispose };
}
