import * as THREE from 'three';

const PALETTE = Object.freeze({
  amber: '#ff9a1f',
  orange: '#ff5a00',
  cyan: '#2ee6ff',
  red: '#e5161c',
  green: '#39ff7a',
  grid: '#2a1d0c',
  furniture: '#101014',
});

/**
 * 宿舍几何只解释 Room 数据；相机和交互由上层统一管理。
 * @param {{box:Function,label:Function,disposeObject:Function}} kit 共用绘图与资源管理工具。
 */
export function createRoomView(kit) {
  const group = new THREE.Group();
  group.name = 'room';
  const zoneData = new Map();
  const zoneViews = new Map();
  const fixedTargets = [];
  const fixtureViews = [];

  /** @param {object} box */
  function validBox(box) {
    return box && ['x', 'y', 'z', 'w', 'd', 'h'].every((key) => Number.isFinite(box[key]))
      && box.w >= 0 && box.d >= 0 && box.h >= 0;
  }

  /** 最小角坐标保持原样传给 kit，避免把宽深高的含义互换。 */
  function makeBox(box, options) {
    const view = kit.box(box, options);
    group.add(view);
    return view;
  }

  function setPick(view, kind, datum) {
    const mesh = view.userData.fill;
    const pick = { kind, id: datum.id, label: datum.label || datum.type || datum.id, box: { ...datum.box } };
    view.userData.pick = pick;
    if (mesh) mesh.userData.pick = pick;
    return mesh;
  }

  /** 斜线在保留空间的底面内裁切，不延伸到相邻分区。 */
  function makeKeepClearStripes(box) {
    if (box.w <= 0 || box.d <= 0) return null;
    const coordinates = [];
    const spacing = Math.max(16, (box.w + box.d) / 80);
    for (let sum = spacing; sum < box.w + box.d; sum += spacing) {
      const x0 = Math.max(0, sum - box.d);
      const x1 = Math.min(box.w, sum);
      coordinates.push(
        box.x + x0, box.y + 0.3, box.z + sum - x0,
        box.x + x1, box.y + 0.3, box.z + sum - x1,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
    const material = new THREE.LineBasicMaterial({ color: PALETTE.red, transparent: true, opacity: 0.22, depthWrite: false });
    const stripes = new THREE.LineSegments(geometry, material);
    stripes.name = 'keep-clear-stripes';
    return stripes;
  }

  function clear() {
    for (const child of [...group.children]) kit.disposeObject(child);
    group.clear();
    fixedTargets.length = 0;
    fixtureViews.length = 0;
    zoneViews.clear();
    zoneData.clear();
  }

  /** @param {object|null} room */
  function setRoom(room) {
    clear();
    if (!room) return;
    for (const wall of room.walls || []) {
      if (!validBox(wall.box)) continue;
      const view = makeBox(wall.box, { fill: PALETTE.amber, fillOpacity: 0.04, line: PALETTE.amber, lineOpacity: 0.35 });
      view.name = wall.id;
    }
    for (const opening of room.openings || []) {
      if (!validBox(opening.box)) continue;
      const view = makeBox(opening.box, { fill: PALETTE.cyan, fillOpacity: 0, line: PALETTE.cyan, lineOpacity: 0.9 });
      view.name = opening.id;
      if (view.userData.fill) view.userData.fill.visible = false;
    }
    for (const fixture of room.fixtures || []) {
      if (!validBox(fixture.box)) continue;
      const container = fixture.type === 'wardrobe' || fixture.type === 'hutch';
      const view = makeBox(fixture.box, {
        fill: PALETTE.furniture,
        fillOpacity: container ? 0.06 : 0.9,
        line: PALETTE.amber,
        lineOpacity: 0.8,
      });
      view.name = fixture.id;
      fixtureViews.push({ fixture, view, opacity: container ? 0.06 : 0.9 });
      const target = setPick(view, 'fixture', fixture);
      if (target) fixedTargets.push(target);
    }
    for (const zone of room.zones || []) {
      if (validBox(zone.box)) zoneData.set(zone.id, zone);
    }
  }

  /**
   * map 即当前应显示的分区集合；传空对象可恢复默认隐藏。
   * @param {Record<string,'empty'|'designing'|'done'>|Map<string,string>} map
   */
  function setZoneStatus(map = {}) {
    for (const { view } of zoneViews.values()) {
      kit.disposeObject(view);
      group.remove(view);
    }
    zoneViews.clear();
    const entries = map instanceof Map ? map.entries() : Object.entries(map || {});
    for (const [id, status] of entries) {
      const zone = zoneData.get(id);
      if (!zone || !['empty', 'designing', 'done'].includes(status)) continue;
      const keepClear = zone.kind === 'keepClear';
      const color = status === 'done' ? PALETTE.green
        : status === 'designing' ? PALETTE.orange
          : keepClear ? PALETTE.red : PALETTE.grid;
      const view = makeBox(zone.box, {
        fill: color, fillOpacity: 0.012, line: color,
        lineOpacity: status === 'empty' ? (keepClear ? 0.4 : 0.65) : 0.9,
        dashed: status === 'empty' || (keepClear && status !== 'done'),
      });
      view.name = `zone:${id}`;
      const target = setPick(view, 'zone', zone);
      if (keepClear) {
        const stripes = makeKeepClearStripes(zone.box);
        // kit 盒子的变换在组上时，把世界坐标纹理放到独立子组。
        if (stripes) {
          group.updateMatrixWorld(true);
          view.attach(stripes);
        }
      }
      if (status === 'done') {
        const b = zone.box;
        const label = kit.label('LOCKED', new THREE.Vector3(b.x + b.w / 2, b.y + b.h + 4, b.z + b.d / 2), PALETTE.green);
        group.updateMatrixWorld(true);
        view.attach(label);
      }
      zoneViews.set(id, { view, status, target });
    }
  }

  /** 上层 RAF 毫秒时间；切分为半秒开关，形成准确的 1Hz 闪烁。 */
  function update(time = 0) {
    const bright = Math.floor(time / 500) % 2 === 0;
    for (const { view, status } of zoneViews.values()) {
      if (status !== 'designing') continue;
      const edge = view.userData.edge;
      if (edge?.material) edge.material.opacity = bright ? 0.95 : 0.2;
    }
  }

  function getTargets() {
    return fixedTargets.concat([...zoneViews.values()].map((entry) => entry.target).filter(Boolean));
  }

  /** 聚焦桌面时减弱上方遮挡，切回其他视角恢复，不改变真实几何。 */
  function focusDesk(zone = null) {
    for (const { fixture, view, opacity } of fixtureViews) {
      const a = fixture.box;
      const b = zone?.box;
      const overhead = b && a.x < b.x + b.w && a.x + a.w > b.x
        && a.z < b.z + b.d && a.z + a.d > b.z && a.y + a.h > b.y
        && (a.y >= b.y || /bed|loft|rail|hutch|shelf/i.test(fixture.type));
      view.userData.fill.material.opacity = overhead ? 0.015 : opacity;
      view.userData.edge.material.opacity = overhead ? 0.12 : 0.8;
    }
  }

  return {
    group,
    setRoom,
    setZoneStatus,
    update,
    getTargets,
    focusDesk,
    getZone: (id) => zoneData.get(id),
    dispose: clear,
  };
}
