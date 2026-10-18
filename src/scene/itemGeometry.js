import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 图库只作轮廓观察；所有零件均为程序几何，坐标限于单位盒。
 * 每件物品合并为一份填充和一份线框，状态变化只需更新两份材质。
 */
function builder() {
  const solids = []; const lines = [];
  const point = p => new THREE.Vector3(p[0] - 0.5, p[1] - 0.5, p[2] - 0.5);
  function stroke(points, closed = false) {
    const vertices = closed ? [...points, points[0]] : points;
    for (let i = 1; i < vertices.length; i++) lines.push(...point(vertices[i - 1]).toArray(), ...point(vertices[i]).toArray());
  }
  function part(geometry, x, y, z, w, h, d, rotation = null) {
    const matrix = new THREE.Matrix4().compose(point([x, y, z]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0]))), new THREE.Vector3(w, h, d));
    geometry.applyMatrix4(matrix);
    const edges = new THREE.EdgesGeometry(geometry, 32);
    lines.push(...edges.getAttribute('position').array); edges.dispose();
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const key of Object.keys(flat.attributes)) if (!['position', 'normal'].includes(key)) flat.deleteAttribute(key);
    solids.push(flat);
  }
  function box(x, y, z, w, h, d, rot) { part(new THREE.BoxGeometry(1, 1, 1), x, y, z, w, h, d, rot); }
  function round(x, y, z, w, h, d) {
    part(new THREE.SphereGeometry(0.5, 12, 8), x, y, z, w, h, d);
    // 圆面没有硬边，补三条主剖面，保持软包、被褥、鞋面也有可读状态色。
    for (let plane = 0; plane < 3; plane++) {
      const points = Array.from({ length: 25 }, (_, i) => {
        const a = i / 24 * Math.PI * 2; const c = Math.cos(a) * 0.5; const s = Math.sin(a) * 0.5;
        return plane === 0 ? [x + c * w, y + s * h, z] : plane === 1 ? [x + c * w, y, z + s * d] : [x, y + c * h, z + s * d];
      });
      stroke(points);
    }
  }
  function cylinder(x, y, z, w, h, d, open = false, top = 1, rot) {
    part(new THREE.CylinderGeometry(0.5 * top, 0.5, 1, 16, 1, open), x, y, z, w, h, d, rot);
  }
  function ring(x, y, z, w, h, d, rot = [Math.PI / 2, 0, 0]) {
    const geometry = new THREE.TorusGeometry(0.465, 0.025, 5, 24);
    geometry.rotateX(rot[0]); geometry.rotateY(rot[1]); geometry.rotateZ(rot[2]);
    part(geometry, x, y, z, w, h, d);
  }
  function rod(a, b, thickness = 0.025) {
    const start = point(a); const end = point(b); const delta = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(thickness / 2, thickness / 2, delta.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    const edges = new THREE.EdgesGeometry(geometry, 35); lines.push(...edges.getAttribute('position').array); edges.dispose();
    const flat = geometry.toNonIndexed(); geometry.dispose(); flat.deleteAttribute('uv'); solids.push(flat);
  }
  function arc(center, rx, rz, y, start = 0, end = Math.PI * 2, count = 24) {
    const pts = Array.from({ length: count + 1 }, (_, i) => { const a = start + (end - start) * i / count; return [center[0] + Math.cos(a) * rx, y, center[1] + Math.sin(a) * rz]; });
    stroke(pts); return pts;
  }
  function loop(points, thickness = 0.025) {
    for (let i = 1; i < points.length; i++) rod(points[i - 1], points[i], thickness);
  }
  function finish() {
    const fill = mergeGeometries(solids, false);
    for (const solid of solids) solid.dispose();
    const edge = new THREE.BufferGeometry(); edge.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    return { fill, edge };
  }
  return { box, round, cylinder, ring, rod, stroke, arc, loop, part, finish };
}

function openBasket(g, handle = false) {
  g.box(0.5, 0.05, 0.5, 0.94, 0.08, 0.88);
  const rim = y => {
    g.rod([0.04, y, 0.06], [0.96, y, 0.06]); g.rod([0.04, y, 0.94], [0.96, y, 0.94]);
    g.rod([0.04, y, 0.06], [0.04, y, 0.94]); g.rod([0.96, y, 0.06], [0.96, y, 0.94]);
  };
  rim(0.6); rim(0.28);
  for (let i = 0; i < 7; i++) {
    const x = 0.04 + i * 0.92 / 6;
    for (const z of [0.06, 0.94]) g.rod([x, 0.07, z], [x, 0.6, z], 0.018);
  }
  for (let i = 0; i < 4; i++) for (const x of [0.04, 0.96]) {
    const z = 0.06 + i * 0.88 / 3; g.rod([x, 0.07, z], [x, 0.6, z], 0.018);
  }
  if (handle) {
    for (const z of [0.18, 0.82]) g.loop([[0.15, 0.58, z], [0.25, 0.92, z], [0.75, 0.92, z], [0.85, 0.58, z]], 0.035);
  }
}

function books(g, folder = false) {
  const count = folder ? 1 : 7;
  for (let i = 0; i < count; i++) {
    const h = 0.94 / count; const y = 0.03 + i * h; const inset = i % 3 === 1 ? 0.035 : 0;
    g.box(0.5 + inset / 2, y + h / 2, 0.5, 0.86 - inset, h * 0.78, 0.85);
    g.box(0.5, y + h * 0.06, 0.5, 0.94, h * 0.1, 0.94);
    g.box(0.5, y + h * 0.94, 0.5, 0.94, h * 0.1, 0.94);
    g.box(0.045, y + h / 2, 0.5, 0.035, h * 0.9, 0.94);
    g.stroke([[0.12, y + h * 0.45, 0.955], [0.88, y + h * 0.45, 0.955]]);
  }
}

function liddedBox(g, parcel = false) {
  g.box(0.5, 0.43, 0.5, 0.94, 0.8, 0.93); g.box(0.5, 0.9, 0.5, 0.98, 0.12, 0.98);
  if (parcel) {
    g.stroke([[0.5, 0.965, 0.02], [0.5, 0.965, 0.98]]);
    g.stroke([[0.46, 0.965, 0.02], [0.46, 0.965, 0.98]]);
    g.stroke([[0.54, 0.965, 0.02], [0.54, 0.965, 0.98]]);
    g.box(0.73, 0.966, 0.35, 0.25, 0.008, 0.25);
  } else {
    for (const z of [0.023, 0.977]) g.loop([[0.37, 0.7, z], [0.37, 0.57, z], [0.63, 0.57, z], [0.63, 0.7, z]], 0.035);
  }
}

function foldedFabric(g, pillow = false, clothing = false) {
  const layers = pillow ? 1 : 3;
  for (let i = 0; i < layers; i++) {
    const h = 0.9 / layers; const y = 0.05 + h * (i + 0.5);
    g.round(0.5, y, 0.5, 0.96 - i * 0.02, h, 0.92);
    g.stroke([[0.09, y, 0.82], [0.18, y - h * 0.25, 0.94], [0.82, y - h * 0.25, 0.94], [0.91, y, 0.82]]);
  }
  if (clothing) {
    g.stroke([[0.28, 0.94, 0.25], [0.38, 0.96, 0.35], [0.62, 0.96, 0.35], [0.72, 0.94, 0.25]]);
    g.stroke([[0.5, 0.94, 0.36], [0.5, 0.94, 0.8]]);
  }
}

function shelf(g, shoe = false) {
  for (const x of [0.06, 0.94]) for (const z of [0.08, 0.92]) g.box(x, 0.5, z, 0.045, 0.98, 0.055);
  for (const y of shoe ? [0.08, 0.48, 0.9] : [0.05, 0.48, 0.95]) g.box(0.5, y, 0.5, 0.94, 0.035, 0.94);
  if (!shoe) {
    for (const x of [0.08, 0.92]) g.box(x, 0.5, 0.5, 0.035, 0.9, 0.94);
    g.rod([0.08, 0.1, 0.94], [0.92, 0.9, 0.94], 0.018);
  }
}

function bottle(g, x, z, w, h, d, pump = false) {
  g.cylinder(x, h * 0.42 + 0.03, z, w, h * 0.75, d, false, 0.85);
  g.cylinder(x, h * 0.85, z, w * 0.5, h * 0.16, d * 0.5);
  if (pump) { g.box(x, h * 0.96, z, w * 0.7, h * 0.06, d * 0.18); }
}

/** 显式覆盖现有库；无 libId 的导入物品按名称和类别选同类轮廓。 */
export function itemShapeKey(item) {
  if (item.libId) return item.libId;
  const name = item.name || '';
  const match = [['lamp', /灯/], ['cup', /杯/], ['headphones', /耳机/], ['fan-desk', /风扇/], ['monitor-27', /显示器|屏幕/], ['laptop', /电脑|笔记本/], ['shoes', /鞋/], ['backpack', /书包|背包/], ['guitar', /吉他|尤克/], ['basin', /盆/], ['bucket', /桶/], ['toiletry-basket', /篮|筐/], ['desk-shelf', /书架/], ['parcel', /快递|纸箱/]];
  return match.find(([, re]) => re.test(name))?.[0] || ({ luggage: 'luggage-24', clothes: 'clothes-stack', bedding: 'quilt-winter', books: 'books-10', study: 'folder', electronics: 'power-strip', appliance: 'heater', toiletry: 'toiletry-basket', storage: 'box-m', food: 'snack-box', sport: 'yoga-mat', decor: 'bed-curtain', trash: 'parcel' }[item.category] || 'bag-move');
}

/**
 * 构建复杂度与零件/采样点数线性相关；固定上限避免物品数量增加时产生高阶开销。
 * @param {object} item 只读取物品类别与尺寸，不导入规划器和数据内部实现。
 */
export function createItemGeometry(item) {
  const g = builder(); const key = itemShapeKey(item);
  if (key.startsWith('luggage-')) {
    g.box(0.5, 0.47, 0.5, 0.88, 0.78, 0.86);
    for (const x of [0.16, 0.84]) for (const z of [0.2, 0.8]) g.cylinder(x, 0.055, z, 0.12, 0.09, 0.12);
    for (const x of [0.35, 0.65]) g.box(x, 0.89, 0.61, 0.025, 0.16, 0.04);
    g.box(0.5, 0.97, 0.61, 0.35, 0.035, 0.07);
    for (const z of [0.055, 0.945]) {
      g.stroke([[0.08, 0.12, z], [0.08, 0.84, z], [0.92, 0.84, z], [0.92, 0.12, z]], true);
      for (const x of [0.25, 0.42, 0.59, 0.76]) g.stroke([[x, 0.21, z], [x, 0.75, z]]);
    }
  } else if (['books-10', 'folder'].includes(key)) books(g, key === 'folder');
  else if (['box-l', 'box-m', 'snack-box', 'parcel'].includes(key)) liddedBox(g, key === 'parcel');
  else if (key === 'box-desk') {
    openBasket(g);
    g.box(0.5, 0.36, 0.5, 0.025, 0.56, 0.9); g.box(0.75, 0.36, 0.5, 0.025, 0.56, 0.9);
  } else if (['toiletry-basket', 'bed-basket'].includes(key)) {
    openBasket(g, key === 'toiletry-basket');
    if (key === 'bed-basket') for (const x of [0.2, 0.8]) g.loop([[x, 0.52, 0.88], [x, 0.94, 0.88], [x, 0.94, 0.66], [x, 0.77, 0.66]], 0.04);
  } else if (['shoe-rack', 'desk-shelf', 'riser'].includes(key)) {
    if (key === 'riser') { g.box(0.5, 0.92, 0.5, 0.96, 0.13, 0.94); for (const x of [0.08, 0.92]) g.box(x, 0.46, 0.5, 0.09, 0.88, 0.9); }
    else shelf(g, key === 'shoe-rack');
  } else if (key === 'lamp') {
    g.cylinder(0.5, 0.045, 0.5, 0.86, 0.07, 0.86);
    g.rod([0.5, 0.08, 0.6], [0.34, 0.56, 0.67], 0.05); g.rod([0.34, 0.56, 0.67], [0.68, 0.91, 0.45], 0.04);
    g.round(0.34, 0.56, 0.67, 0.11, 0.065, 0.11); g.box(0.53, 0.94, 0.4, 0.87, 0.065, 0.29, [0, 0, -0.05]);
    g.stroke([[0.15, 0.91, 0.28], [0.89, 0.91, 0.28]]);
  } else if (key === 'cup') {
    g.cylinder(0.43, 0.46, 0.5, 0.7, 0.84, 0.87, false, 0.88);
    g.cylinder(0.43, 0.92, 0.5, 0.75, 0.065, 0.93); g.cylinder(0.43, 0.97, 0.5, 0.28, 0.04, 0.32);
    g.loop([[0.73, 0.75, 0.5], [0.93, 0.75, 0.5], [0.96, 0.48, 0.5], [0.75, 0.4, 0.5]], 0.07);
  } else if (key === 'headphones') {
    const pts = Array.from({ length: 17 }, (_, i) => { const a = i / 16 * Math.PI; return [0.5 + 0.39 * Math.cos(a), 0.45, 0.4 + 0.52 * Math.sin(a)]; });
    g.loop(pts, 0.055);
    for (const x of [0.12, 0.88]) { g.round(x, 0.5, 0.28, 0.22, 0.8, 0.4); g.round(x, 0.52, 0.25, 0.14, 0.58, 0.28); }
  } else if (key === 'fan-desk') {
    g.round(0.5, 0.055, 0.53, 0.8, 0.1, 0.89); g.box(0.5, 0.3, 0.59, 0.09, 0.49, 0.12);
    g.ring(0.5, 0.66, 0.5, 0.98, 0.68, 1, [0, 0, 0]);
    g.ring(0.5, 0.66, 0.57, 0.98, 0.68, 1, [0, 0, 0]);
    for (const r of [0.16, 0.28, 0.39]) {
      const pts = Array.from({ length: 25 }, (_, i) => [0.5 + Math.cos(i / 24 * Math.PI * 2) * r, 0.66 + Math.sin(i / 24 * Math.PI * 2) * r * 0.68, 0.45]); g.stroke(pts);
    }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.stroke([[0.5, 0.66, 0.44], [0.5 + Math.cos(a) * 0.46, 0.66 + Math.sin(a) * 0.32, 0.44]]); }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2; g.round(0.5 + Math.cos(a) * 0.19, 0.66 + Math.sin(a) * 0.13, 0.52, 0.39, 0.18, 0.055);
    }
    g.round(0.5, 0.66, 0.42, 0.12, 0.085, 0.13);
  } else if (key.startsWith('monitor-')) {
    g.box(0.5, 0.645, 0.62, 0.98, 0.67, 0.09); g.box(0.5, 0.65, 0.568, 0.9, 0.57, 0.012);
    g.box(0.5, 0.21, 0.64, 0.075, 0.31, 0.12); g.box(0.5, 0.035, 0.52, 0.53, 0.055, 0.87);
  } else if (key === 'laptop') {
    // 库里的实际高度仅 2cm：闭合机身与上盖都必须装在这个高度内。
    g.box(0.5, 0.29, 0.5, 0.98, 0.54, 0.98); g.box(0.5, 0.79, 0.5, 0.98, 0.38, 0.98);
    g.box(0.5, 0.99, 0.52, 0.16, 0.012, 0.2); g.stroke([[0.17, 0.52, 0.015], [0.83, 0.52, 0.015]]);
    for (const x of [0.06, 0.1, 0.14]) g.box(x, 0.25, 0.02, 0.018, 0.16, 0.018);
  } else if (key === 'keyboard') {
    g.box(0.5, 0.27, 0.5, 0.98, 0.5, 0.94);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) g.box(0.055 + col * 0.074, 0.67, 0.17 + row * 0.19, 0.061, 0.28, 0.14);
    g.box(0.46, 0.67, 0.91, 0.46, 0.28, 0.12);
  } else if (key === 'power-strip') {
    g.box(0.47, 0.42, 0.5, 0.86, 0.76, 0.9);
    for (let i = 0; i < 4; i++) for (const z of [0.34, 0.66]) g.box(0.15 + i * 0.2, 0.83, z, 0.028, 0.02, 0.17);
    g.loop([[0.9, 0.4, 0.5], [0.97, 0.4, 0.5], [0.98, 0.4, 0.9]], 0.025);
  } else if (['quilt-winter', 'quilt-summer', 'pillow', 'bath-towel', 'bed-curtain', 'clothes-stack', 'e-blanket'].includes(key)) {
    foldedFabric(g, key === 'pillow', key === 'clothes-stack');
    if (key === 'bed-curtain') for (const x of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) g.stroke([[x, 0.95, 0.18], [x, 0.95, 0.82]]);
    if (key === 'e-blanket') { g.box(0.85, 0.5, 0.9, 0.19, 0.4, 0.14); g.stroke([[0.73, 0.5, 0.92], [0.64, 0.5, 0.97], [0.1, 0.5, 0.97]]); }
  } else if (['coat', 'down-jacket'].includes(key)) {
    g.round(0.5, 0.45, 0.53, 0.56, 0.84, 0.75);
    for (const x of [0.16, 0.84]) g.round(x, 0.47, 0.5, 0.25, 0.76, 0.63);
    g.ring(0.5, 0.87, 0.5, 0.32, 0.32, 0.7); g.stroke([[0.5, 0.1, 0.145], [0.5, 0.81, 0.145]]);
    if (key === 'down-jacket') for (const y of [0.2, 0.35, 0.5, 0.65]) g.stroke([[0.24, y, 0.19], [0.76, y, 0.19]]);
  } else if (key === 'shoes') {
    for (const z of [0.25, 0.75]) {
      g.round(0.5, 0.14, z, 0.96, 0.22, 0.43); g.round(0.45, 0.47, z, 0.84, 0.59, 0.39);
      g.round(0.22, 0.72, z, 0.3, 0.47, 0.38); g.ring(0.22, 0.9, z, 0.28, 0.29, 0.34);
      for (const x of [0.4, 0.5, 0.6]) g.stroke([[x, 0.72, z - 0.13], [x + 0.05, 0.72, z + 0.13]]);
    }
  } else if (key === 'bag-move' || key === 'backpack') {
    g.round(0.5, 0.45, 0.52, 0.94, 0.82, 0.88);
    g.loop([[0.32, 0.79, 0.5], [0.32, 0.96, 0.5], [0.68, 0.96, 0.5], [0.68, 0.79, 0.5]], 0.04);
    if (key === 'backpack') {
      g.round(0.5, 0.32, 0.15, 0.66, 0.42, 0.22);
      for (const x of [0.22, 0.78]) g.loop([[x, 0.77, 0.83], [x, 0.7, 0.97], [x, 0.19, 0.97], [x, 0.14, 0.77]], 0.045);
      g.stroke([[0.22, 0.43, 0.053], [0.78, 0.43, 0.053]]);
    } else for (const z of [0.1, 0.9]) g.loop([[0.23, 0.54, z], [0.23, 0.95, z], [0.77, 0.95, z], [0.77, 0.54, z]], 0.04);
  } else if (key === 'basin' || key === 'bucket') {
    const height = key === 'bucket' ? 0.8 : 0.84;
    g.cylinder(0.5, height / 2 + 0.04, 0.5, 0.92, height, 0.92, true, 1.04);
    g.cylinder(0.5, 0.045, 0.5, 0.84, 0.04, 0.84); g.ring(0.5, height + 0.04, 0.5, 0.99, 0.34, 0.99);
    if (key === 'basin') for (const y of [0.31, 0.55]) g.ring(0.5, y, 0.5, 0.95, 0.22, 0.95);
    else g.loop([[0.08, 0.69, 0.5], [0.13, 0.95, 0.5], [0.87, 0.95, 0.5], [0.92, 0.69, 0.5]], 0.035);
  } else if (key === 'skincare') {
    bottle(g, 0.22, 0.29, 0.31, 0.96, 0.36, true); bottle(g, 0.63, 0.3, 0.29, 0.74, 0.35);
    g.cylinder(0.76, 0.2, 0.74, 0.4, 0.36, 0.4); g.cylinder(0.76, 0.4, 0.74, 0.42, 0.06, 0.42);
  } else if (key === 'hairdryer') {
    g.cylinder(0.47, 0.72, 0.5, 0.38, 0.78, 0.63, false, 0.8, [0, 0, Math.PI / 2]);
    g.box(0.47, 0.33, 0.5, 0.2, 0.57, 0.34, [0, 0, -0.15]);
    g.ring(0.1, 0.72, 0.5, 0.4, 0.5, 0.38, [0, Math.PI / 2, 0]);
  } else if (key === 'kettle') {
    g.cylinder(0.48, 0.43, 0.5, 0.65, 0.73, 0.87, false, 0.74); g.cylinder(0.48, 0.83, 0.5, 0.55, 0.05, 0.72);
    g.round(0.48, 0.92, 0.5, 0.14, 0.12, 0.2); g.loop([[0.73, 0.75, 0.5], [0.94, 0.74, 0.5], [0.94, 0.27, 0.5], [0.75, 0.26, 0.5]], 0.065);
    g.rod([0.22, 0.63, 0.5], [0.04, 0.78, 0.5], 0.12); g.cylinder(0.48, 0.035, 0.5, 0.74, 0.05, 0.92);
  } else if (key === 'rice-cooker' || key === 'noodle-box') {
    g.cylinder(0.5, 0.4, 0.5, 0.77, 0.72, 0.91, false, 0.94); g.cylinder(0.5, 0.8, 0.5, 0.79, 0.08, 0.95);
    for (const x of [0.07, 0.93]) g.box(x, 0.65, 0.5, 0.12, 0.12, 0.28);
    g.box(0.5, 0.9, 0.5, 0.31, 0.12, 0.18);
    if (key === 'rice-cooker') g.box(0.5, 0.4, 0.03, 0.27, 0.24, 0.04);
  } else if (key === 'heater') {
    g.box(0.5, 0.49, 0.5, 0.86, 0.88, 0.63); g.box(0.5, 0.04, 0.5, 0.96, 0.055, 0.91);
    for (const x of [0.17, 0.3, 0.43, 0.56, 0.69, 0.82]) g.rod([x, 0.15, 0.17], [x, 0.82, 0.17], 0.025);
    for (const y of [0.23, 0.43, 0.63]) g.stroke([[0.12, y, 0.16], [0.88, y, 0.16]]);
  } else if (key === 'umbrella') {
    g.cylinder(0.5, 0.56, 0.5, 0.64, 0.8, 0.64, false, 0.12); g.rod([0.5, 0.04, 0.5], [0.5, 0.97, 0.5], 0.065);
    g.loop([[0.5, 0.2, 0.5], [0.5, 0.05, 0.5], [0.78, 0.05, 0.5], [0.78, 0.17, 0.5]], 0.08);
    g.ring(0.5, 0.42, 0.5, 0.7, 0.35, 0.7);
  } else if (key === 'guitar') {
    g.round(0.5, 0.22, 0.5, 0.9, 0.39, 0.79); g.round(0.5, 0.43, 0.5, 0.67, 0.28, 0.73);
    g.box(0.5, 0.7, 0.5, 0.13, 0.42, 0.28); g.box(0.5, 0.95, 0.5, 0.2, 0.09, 0.35);
    g.ring(0.5, 0.38, 0.12, 0.27, 0.1, 0.27, [0, 0, 0]); g.box(0.5, 0.18, 0.1, 0.34, 0.025, 0.055);
    for (let i = 0; i < 6; i++) { const x = 0.455 + i * 0.018; g.stroke([[x, 0.2, 0.07], [x, 0.96, 0.31]]); }
    for (const y of [0.61, 0.68, 0.75, 0.82]) g.stroke([[0.43, y, 0.34], [0.57, y, 0.34]]);
  } else if (key === 'yoga-mat') {
    g.cylinder(0.5, 0.5, 0.5, 0.95, 0.96, 0.95);
    for (const r of [0.14, 0.27, 0.39]) g.arc([0.5, 0.5], r, r, 0.985);
    for (const y of [0.22, 0.77]) g.ring(0.5, y, 0.5, 0.99, 0.36, 0.99);
  } else if (key === 'hangers') {
    for (const z of [0.2, 0.5, 0.8]) {
      g.loop([[0.08, 0.17, z], [0.5, 0.65, z], [0.92, 0.17, z], [0.08, 0.17, z]], 0.035);
      g.loop([[0.5, 0.65, z], [0.5, 0.9, z], [0.64, 0.95, z], [0.69, 0.85, z]], 0.03);
    }
  } else if (key === 'sock-dryer') {
    for (const z of [0.07, 0.93]) g.rod([0.06, 0.7, z], [0.94, 0.7, z]);
    for (const x of [0.06, 0.94]) g.rod([x, 0.7, 0.07], [x, 0.7, 0.93]);
    for (let i = 0; i < 5; i++) { const x = 0.1 + 0.2 * i; g.rod([x, 0.7, 0.07], [x, 0.7, 0.93]); for (const z of [0.2, 0.8]) g.box(x, 0.37, z, 0.06, 0.59, 0.08); }
    g.loop([[0.2, 0.7, 0.5], [0.5, 0.96, 0.5], [0.8, 0.7, 0.5]], 0.025);
  } else {
    // 自定义物品缺少库匹配时仍用软袋轮廓，避免回到整块包围盒。
    g.round(0.5, 0.43, 0.5, 0.94, 0.8, 0.94); g.loop([[0.3, 0.78, 0.5], [0.3, 0.96, 0.5], [0.7, 0.96, 0.5], [0.7, 0.78, 0.5]], 0.04);
  }
  return { ...g.finish(), key };
}
