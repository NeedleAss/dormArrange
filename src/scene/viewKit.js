import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export const COLORS = { bg: '#050506', grid: '#2a1d0c', amber: '#ff9a1f', orange: '#ff5a00', red: '#e5161c', green: '#39ff7a', cyan: '#2ee6ff', purple: '#8b5cf6', white: '#f4efe6', stored: '#5b3f9e' };
export const CATEGORY = { luggage: '#c2410c', clothes: '#a855f7', bedding: '#64748b', books: '#eab308', study: '#facc15', electronics: '#0ea5e9', appliance: '#f43f5e', toiletry: '#14b8a6', storage: '#a16207', food: '#fb923c', sport: '#22c55e', decor: '#ec4899', trash: '#6b7280', misc: '#9ca3af' };
export const easeInOutCubic = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
export const center = b => new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2);
export const validBox = b => b && ['x', 'y', 'z', 'w', 'd', 'h'].every(k => Number.isFinite(b[k])) && b.w >= 0 && b.d >= 0 && b.h >= 0;

/** 单位盒与边线共享，重建房间时只释放实例材质。 */
export function createViewKit() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(geometry);
  const shared = new Set([geometry, edges]);
  function box(b, { fill = '#101014', fillOpacity = 0, line = COLORS.amber, lineOpacity = 0.8, dashed = false } = {}) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: fillOpacity, depthWrite: false, side: THREE.DoubleSide }));
    const edge = new THREE.LineSegments(edges, dashed ? new THREE.LineDashedMaterial({ color: line, transparent: true, opacity: lineOpacity, dashSize: 5, gapSize: 3 }) : new THREE.LineBasicMaterial({ color: line, transparent: true, opacity: lineOpacity }));
    // 虚线实例单独持有距离属性，不能污染共享边线几何。
    if (dashed) edge.geometry = edges.clone();
    group.add(mesh, edge); group.userData.fill = mesh; group.userData.edge = edge;
    setBox(group, b); return group;
  }
  function updateDashDistances(group) {
    const edge = group.userData.edge;
    if (!edge.material.isLineDashedMaterial) return;
    const points = edge.geometry.getAttribute('position');
    const distances = new Float32Array(points.count);
    // shader 使用缩放前的距离，按世界厘米重算每条边，保持 5cm/3cm 节奏。
    for (let i = 0; i < points.count; i += 2) {
      distances[i + 1] = Math.hypot((points.getX(i + 1) - points.getX(i)) * group.scale.x,
        (points.getY(i + 1) - points.getY(i)) * group.scale.y,
        (points.getZ(i + 1) - points.getZ(i)) * group.scale.z);
    }
    edge.geometry.setAttribute('lineDistance', new THREE.BufferAttribute(distances, 1));
  }
  function setBox(group, b) {
    group.position.copy(center(b));
    group.scale.set(Math.max(b.w, 0.001), Math.max(b.h, 0.001), Math.max(b.d, 0.001));
    group.userData.box = { ...b };
    updateDashDistances(group);
  }
  function label(text, position, color = COLORS.amber) {
    const el = document.createElement('div'); el.textContent = text; el.className = 'fangcun-scene-label';
    Object.assign(el.style, { color, background: 'rgba(5,5,6,.88)', border: '1px solid ' + color, padding: '5px 8px', font: '11px/1.5 monospace', whiteSpace: 'pre', pointerEvents: 'none', letterSpacing: '0' });
    const object = new CSS2DObject(el);
    el.style.pointerEvents = 'none';
    if (position?.isVector3) object.position.copy(position); else if (Array.isArray(position)) object.position.fromArray(position); else if (position) object.position.set(position.x, position.y, position.z);
    return object;
  }
  function disposeObject(object) {
    if (!object) return;
    object.traverse(child => {
      child.element?.remove();
      if (child.geometry && !shared.has(child.geometry)) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach(m => { if (m.map && !m.map.userData.shared) m.map.dispose(); m.dispose(); });
    });
    object.removeFromParent(); object.clear();
  }
  function setEdgeStyle(object, { color, dashed = false, opacity = 0.9 }) {
    const edge = object.userData.edge; edge.material.dispose();
    if (dashed && shared.has(edge.geometry)) edge.geometry = edges.clone();
    if (!dashed && !shared.has(edge.geometry)) { edge.geometry.dispose(); edge.geometry = edges; }
    edge.material = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 5, gapSize: 3 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    if (dashed) updateDashDistances(object);
  }
  return { box, setBox, label, disposeObject, setEdgeStyle, dispose() { geometry.dispose(); edges.dispose(); } };
}
