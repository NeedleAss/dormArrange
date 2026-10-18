import * as THREE from 'three';
import { CATEGORY, COLORS, validBox, easeInOutCubic } from './viewKit.js';
import { createItemGeometry, itemShapeKey } from './itemGeometry.js';

const AXES = [
  { order: [0, 1, 2], rotation: [0, 0, 0] },
  { order: [2, 1, 0], rotation: [0, Math.PI / 2, 0] },
  { order: [0, 2, 1], rotation: [Math.PI / 2, 0, 0] },
  { order: [1, 2, 0], rotation: [Math.PI / 2, Math.PI / 2, 0] },
  { order: [1, 0, 2], rotation: [0, 0, Math.PI / 2] },
  { order: [2, 0, 1], rotation: [0, Math.PI / 2, Math.PI / 2] },
].map(axis => {
  // 先放倒，再绕世界 Y 轴转；单位模型旋转，最终 Box 尺寸保持不变。
  const q = new THREE.Quaternion();
  if (axis.rotation[0]) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), axis.rotation[0]));
  if (axis.rotation[2]) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), axis.rotation[2]));
  if (axis.rotation[1]) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), axis.rotation[1]));
  return { ...axis, quaternion: q };
});

const STATES = { fits: COLORS.green, relocate: COLORS.amber, uncertain: COLORS.cyan, overflow: COLORS.red, banned: COLORS.red, conflict: COLORS.red, moved: COLORS.purple, stored: COLORS.stored };

/** 物品按 id 增量更新；动画由场景唯一 RAF 推进。 */
export function createItemView(kit) {
  const group = new THREE.Group(); group.name = 'items';
  const records = new Map(); let states = {}; let selected = null;
  function apply(id, b, { opacity = 1, scale = 1 } = {}) {
    const r = records.get(id); if (!r || !validBox(b)) return;
    r.box = { ...b }; r.opacity = opacity; r.scale = scale;
    orient(r, b);
    kit.setBox(r.view, b); r.view.scale.multiplyScalar(Math.max(scale, 0.001));
    dashDistances(r);
    r.view.visible = opacity > 0.001;
    r.view.userData.fill.material.opacity = 0.25 * opacity;
    r.view.userData.edge.material.opacity = opacity;
    r.view.userData.pickMesh.userData.pick.box = { ...b };
  }
  /** 根据实际 Box 匹配轴序；动画仅给 Box，也能识别后续放倒与旋转。 */
  function orient(r, b) {
    const size = r.item.size || { w: b.w, h: b.h, d: b.d };
    const original = [size.w, size.h, size.d]; const actual = [b.w, b.h, b.d];
    const options = r.item.flags?.canLieDown || r.placement?.lying ? AXES : AXES.slice(0, 2);
    let best = options[0]; let score = Infinity;
    for (const candidate of options) {
      let cost = candidate.order.reduce((sum, source, axis) => sum + Math.log(Math.max(actual[axis], 0.001) / Math.max(original[source], 0.001)) ** 2, 0);
      if (r.placement?.compressed) {
        const compressed = Number(r.item.flags?.compressible) || 1;
        cost = candidate.order.reduce((sum, source, axis) => sum + Math.log(Math.max(actual[axis], 0.001) / Math.max(original[source] * (source === 1 ? compressed : 1), 0.001)) ** 2, 0);
      }
      // 正方形底面不必每帧翻转，契约的 rot 只用于同分时定向。
      if ((r.placement?.rot === 90) === (candidate.order[0] !== 0)) cost -= 0.00001;
      if (cost < score) { best = candidate; score = cost; }
    }
    r.view.userData.model.quaternion.copy(best.quaternion);
  }
  /** 虚线距离以旋转后的世界厘米计算，复杂度 O(线段数)。 */
  function dashDistances(r) {
    const edge = r.view.userData.edge; if (!edge.material.isLineDashedMaterial) return;
    const positions = edge.geometry.getAttribute('position'); const distances = new Float32Array(positions.count);
    const delta = new THREE.Vector3(); const quaternion = r.view.userData.model.quaternion;
    for (let i = 0; i < positions.count; i += 2) {
      delta.set(positions.getX(i + 1) - positions.getX(i), positions.getY(i + 1) - positions.getY(i), positions.getZ(i + 1) - positions.getZ(i));
      delta.applyQuaternion(quaternion).multiply(r.view.scale); distances[i + 1] = delta.length();
    }
    edge.geometry.setAttribute('lineDistance', new THREE.BufferAttribute(distances, 1));
  }
  function style(r) {
    const state = states[r.id] || (r.overflow ? 'overflow' : 'fits'); r.state = state;
    const edge = r.view.userData.edge; const dashed = state === 'uncertain';
    if (edge.material.isLineDashedMaterial !== dashed) {
      edge.material.dispose();
      edge.material = dashed ? new THREE.LineDashedMaterial({ transparent: true, dashSize: 5, gapSize: 3, depthWrite: false }) : new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
    }
    edge.material.color.set(selected === r.id ? COLORS.white : STATES[state] || COLORS.amber);
    edge.material.opacity = r.opacity;
    dashDistances(r);
  }
  function remove(r) { kit.disposeObject(r.view); records.delete(r.id); if (selected === r.id) selected = null; }
  function setItems(items = [], placements = {}, { animate = true, overflowIds = [] } = {}) {
    const now = performance.now(); const byId = new Map(items.map(item => [item.id, item]));
    const unplaced = items.filter(item => !validBox(placements[item.id]?.box));
    const rank = new Map(overflowIds.map((id, i) => [id, i]));
    unplaced.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    const bays = new Map(); let x = 0;
    for (const item of unplaced) {
      const s = item.size; if (!s || !['w', 'd', 'h'].every(k => Number.isFinite(s[k]) && s[k] >= 0)) continue;
      // 最小角 z=-20-d，正常行李尺寸完整落在指定的门外滞留带。
      bays.set(item.id, { x, y: 0, z: -20 - s.d, ...s }); x += s.w + 12;
    }
    for (const r of records.values()) {
      if (byId.has(r.id)) continue;
      if (animate) { if (!r.removing) r.tween = { start: now, duration: 600, from: { ...r.box }, to: { ...r.box }, alpha0: r.opacity, alpha1: 0, removing: true }; r.removing = true; }
      else remove(r);
    }
    for (const item of items) {
      const placed = placements[item.id]?.box;
      const b = validBox(placed) ? placed : bays.get(item.id); if (!validBox(b)) continue;
      let r = records.get(item.id); const fresh = !r;
      if (fresh) {
        const shape = createItemGeometry(item); const view = new THREE.Group();
        const model = new THREE.Group(); model.name = 'shape:' + shape.key;
        const fill = new THREE.Mesh(shape.fill, new THREE.MeshBasicMaterial({ color: CATEGORY[item.category] || CATEGORY.misc, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
        const edge = new THREE.LineSegments(shape.edge, new THREE.LineBasicMaterial({ color: COLORS.green, transparent: true, opacity: 1, depthWrite: false }));
        // 代理仅用于命中测试；不写颜色或深度，因此不会盖住真实组合轮廓。
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
        view.name = 'item:' + item.id; const pick = { kind: 'item', id: item.id, label: item.name, box: { ...b }, sizeSource: item.sizeSource };
        proxy.userData.pick = pick; fill.userData.pick = pick;
        model.add(fill, edge); view.add(model, proxy);
        Object.assign(view.userData, { fill, edge, model, pickMesh: proxy, shapeKey: shape.key }); group.add(view);
        r = { id: item.id, item, view, box: { ...b }, opacity: animate ? 0 : 1, scale: 1, overflow: !placements[item.id], placement: placements[item.id] }; records.set(item.id, r);
        apply(r.id, b, { opacity: r.opacity });
      }
      r.item = item; r.placement = placements[item.id];
      if (r.view.userData.shapeKey !== itemShapeKey(item)) {
        const shape = createItemGeometry(item);
        r.view.userData.fill.geometry.dispose(); r.view.userData.edge.geometry.dispose();
        r.view.userData.fill.geometry = shape.fill; r.view.userData.edge.geometry = shape.edge;
        r.view.userData.shapeKey = shape.key; r.view.userData.model.name = 'shape:' + shape.key;
      }
      r.overflow = !validBox(placements[item.id]?.box); r.removing = false;
      r.view.userData.fill.material.color.set(CATEGORY[item.category] || CATEGORY.misc);
      Object.assign(r.view.userData.fill.userData.pick, { label: item.name, sizeSource: item.sizeSource });
      const moved = ['x', 'y', 'z', 'w', 'd', 'h'].some(k => r.box[k] !== b[k]);
      if (animate && r.tween && !r.tween.removing && ['x', 'y', 'z', 'w', 'd', 'h'].every(k => r.tween.to[k] === b[k])) { /* 同一目标不重启补间。 */ }
      else if (animate && (fresh || moved || r.opacity < 1 || r.scale !== 1)) r.tween = { start: now, duration: 600, from: { ...r.box }, to: { ...b }, alpha0: r.opacity, alpha1: 1 };
      else { r.tween = null; apply(r.id, b); }
      style(r);
    }
    return { width: Math.max(x - 12, 0), count: unplaced.length };
  }
  function setItemStates(map = {}) { states = map instanceof Map ? Object.fromEntries(map) : { ...map }; for (const r of records.values()) style(r); }
  function update(now) {
    for (const r of records.values()) {
      if (r.tween) {
        const t = Math.min(1, Math.max(0, (now - r.tween.start) / r.tween.duration)), e = easeInOutCubic(t); const b = {};
        for (const k of ['x', 'y', 'z', 'w', 'd', 'h']) b[k] = THREE.MathUtils.lerp(r.tween.from[k], r.tween.to[k], e);
        apply(r.id, b, { opacity: THREE.MathUtils.lerp(r.tween.alpha0, r.tween.alpha1, e) });
        if (t === 1) { const deleting = r.tween.removing; r.tween = null; if (deleting) { remove(r); continue; } }
      }
      if (r.id !== selected && ['banned', 'conflict'].includes(r.state)) {
        const hz = r.state === 'conflict' ? 2 : 1; r.view.userData.edge.material.opacity = r.opacity * (Math.floor(now / (500 / hz)) % 2 ? 0.18 : 1);
      }
    }
  }
  return { group, setItems, setItemStates, update, apply, get: id => records.get(id),
    cancelTween(id) { const r = records.get(id); if (r) r.tween = null; },
    select(id) { selected = records.has(id) ? id : null; for (const r of records.values()) style(r); },
    getTargets: () => [...records.values()].filter(r => r.view.visible && !r.removing).map(r => r.view.userData.pickMesh),
    dispose() { for (const r of records.values()) kit.disposeObject(r.view); records.clear(); } };
}
