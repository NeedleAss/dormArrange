import * as THREE from 'three';
import { CATEGORY, COLORS, validBox, easeInOutCubic } from './viewKit.js';

const STATES = { fits: COLORS.green, relocate: COLORS.amber, uncertain: COLORS.cyan, overflow: COLORS.red, banned: COLORS.red, conflict: COLORS.red, moved: COLORS.purple, stored: COLORS.stored };

/** 物品按 id 增量更新；动画由场景唯一 RAF 推进。 */
export function createItemView(kit) {
  const group = new THREE.Group(); group.name = 'items';
  const records = new Map(); let states = {}; let selected = null;
  function apply(id, b, { opacity = 1, scale = 1 } = {}) {
    const r = records.get(id); if (!r || !validBox(b)) return;
    r.box = { ...b }; r.opacity = opacity; r.scale = scale;
    kit.setBox(r.view, b); r.view.scale.multiplyScalar(Math.max(scale, 0.001));
    r.view.visible = opacity > 0.001;
    r.view.userData.fill.material.opacity = 0.25 * opacity;
    r.view.userData.edge.material.opacity = opacity;
    r.view.userData.fill.userData.pick.box = { ...b };
  }
  function style(r) {
    const state = states[r.id] || (r.overflow ? 'overflow' : 'fits'); r.state = state;
    kit.setEdgeStyle(r.view, { color: selected === r.id ? COLORS.white : STATES[state] || COLORS.amber, dashed: state === 'uncertain', opacity: r.opacity });
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
        const view = kit.box(b, { fill: CATEGORY[item.category] || CATEGORY.misc, fillOpacity: 0.25, line: COLORS.green });
        view.name = 'item:' + item.id; const pick = { kind: 'item', id: item.id, label: item.name, box: { ...b }, sizeSource: item.sizeSource };
        view.userData.fill.userData.pick = pick; group.add(view);
        r = { id: item.id, item, view, box: { ...b }, opacity: animate ? 0 : 1, scale: 1, overflow: !placements[item.id] }; records.set(item.id, r);
      }
      r.item = item; r.overflow = !validBox(placements[item.id]?.box); r.removing = false;
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
    getTargets: () => [...records.values()].filter(r => r.view.visible && !r.removing).map(r => r.view.userData.fill),
    dispose() { for (const r of records.values()) kit.disposeObject(r.view); records.clear(); } };
}
