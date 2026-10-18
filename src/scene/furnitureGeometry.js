import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const AMBER = '#ff9a1f';
const FURNITURE = '#101014';

/** 只读取已有房型标识，照片只用于观察结构，不作为贴图或新增模板。 */
export function furnitureVariant(room) {
  const name = [room?.id, room?.name, room?.params?.templateId, room?.params?.name].filter(Boolean).join(' ');
  if (/nanqu[_ -]?new|nanqu1|south.*(?:new|renovat)|新(?:装修|南区)|南区.*(?:新|翻新)/i.test(name)) return 'nanqu-new';
  if (/nanqu|南区|south/i.test(name)) return 'nanqu';
  return 'zijing';
}

/**
 * 把同一家具的构件合并成少量绘制调用；构件边线先独立提取，保留接缝。
 * 所有水平坐标均位于 fixture.box 内，桌腿和床架仅沿 Y 向下支撑至地面。
 * @param {object} fixture 固定家具数据。
 * @param {object} room 房间数据，用既有分区 front 决定左右镜像。
 */
export function createFurnitureView(fixture, room) {
  const b = fixture.box;
  const w = Math.max(b.w, 0.001), h = Math.max(b.h, 0.001), d = Math.max(b.d, 0.001);
  const variant = furnitureVariant(room);
  const modern = variant === 'nanqu-new';
  const southern = variant === 'nanqu';
  const container = fixture.type === 'wardrobe' || fixture.type === 'hutch';
  const opacity = container ? 0.06 : 0.9;
  const batches = new Map();
  const edgeGeometries = [];
  const group = new THREE.Group();
  const deskZone = room.zones?.find((zone) => zone.owner === fixture.owner && zone.slot === 'desk');
  const front = deskZone?.front;
  const mirrored = front === '-x' || (!front && b.x + w / 2 > room.bounds.x + room.bounds.w / 2);
  group.position.set(b.x + (mirrored ? w : 0), b.y, b.z);
  if (mirrored) group.scale.x = -1;
  group.userData.box = { ...b };
  group.userData.furnitureVariant = variant;

  function add(geometry, matrix = null, style = 'main') {
    if (matrix) geometry.applyMatrix4(matrix);
    const positions = geometry.getAttribute('position');
    const floor = ['desk', 'loftBed'].includes(fixture.type) ? -Math.max(0, b.y) : 0;
    // 曲线插值可能轻微过冲，按原家具边界裁回，禁止模型扩大水平占地。
    for (let i = 0; i < positions.count; i += 1) {
      positions.setXYZ(i, THREE.MathUtils.clamp(positions.getX(i), 0, w),
        THREE.MathUtils.clamp(positions.getY(i), floor, h), THREE.MathUtils.clamp(positions.getZ(i), 0, d));
    }
    edgeGeometries.push(new THREE.EdgesGeometry(geometry, 24));
    if (!batches.has(style)) batches.set(style, []);
    // 合并前统一为非索引几何，避免圆柱、板和曲面索引格式不一致。
    const drawable = geometry.index ? geometry.toNonIndexed() : geometry;
    if (drawable !== geometry) geometry.dispose();
    batches.get(style).push(drawable);
  }

  function block(x, y, z, sx, sy, sz, style = 'main') {
    if (sx <= 0 || sy <= 0 || sz <= 0) return;
    add(new THREE.BoxGeometry(sx, sy, sz), new THREE.Matrix4().makeTranslation(x + sx / 2, y + sy / 2, z + sz / 2), style);
  }

  function rod(a, c, radius = 1.2, style = 'main') {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...c);
    const direction = end.clone().sub(start);
    if (direction.lengthSq() < 0.00001) return;
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 10);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const matrix = new THREE.Matrix4().compose(start.add(end).multiplyScalar(0.5), rotation, new THREE.Vector3(1, 1, 1));
    add(geometry, matrix, style);
  }

  function curve(points, radius = 1.1, style = 'main') {
    const path = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    add(new THREE.TubeGeometry(path, 28, radius, 7, false), null, style);
  }

  /** 侧板在 YZ 平面内挖长孔，圆角和开口都保留真实几何。 */
  function sidePanel(x, y, z, thickness, height, length, radius, slot = false, style = 'main') {
    const shape = roundedShape(length, height, radius);
    if (slot && height > 5 && length > 15) {
      const slotW = length * 0.46, slotH = height * (modern ? 0.36 : 0.29);
      const hole = roundedShape(slotW, slotH, slotH / 2);
      const offset = new THREE.Vector2((length - slotW) / 2, (height - slotH) * 0.57);
      shape.holes.push(new THREE.Path(hole.getPoints(8).map((point) => point.add(offset))));
    }
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 6 });
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(x + thickness, y, z);
    add(geometry, null, style);
  }

  function shelfFrame() {
    const t = Math.min(2, h / 8, w / 5, d / 15);
    // 两层边界板避开 hutch 分区的净空，不擅自增加中层碰撞面。
    block(0, 0, 0, w, t, d);
    block(0, h - t, 0, w, t, d);
    if (southern) {
      for (const z of [t / 2, d - t / 2]) rod([t / 2, t, z], [t / 2, h - t, z], t / 2);
      for (let i = 1; i <= 5; i += 1) rod([t / 2, h * i / 6, t], [t / 2, h * i / 6, d - t], 0.35);
      for (let i = 1; i <= 7; i += 1) rod([t / 2, t, d * i / 8], [t / 2, h - t, d * i / 8], 0.35);
      for (const z of [0, d - t]) block(0, 0, z, w, h, t);
    } else if (modern) {
      for (const z of [t / 2, d - t / 2]) {
        rod([t / 2, t, z], [t / 2, h - t, z], t / 2, 'light');
        rod([w - t / 2, t, z], [w - t / 2, h - t, z], t / 2, 'light');
      }
      block(0, 0, 0, t, h, d);
    } else {
      block(0, 0, 0, w, h, t);
      block(0, 0, d - t, w, h, t);
      block(0, 0, 0, t, h, d);
    }
  }

  function desk() {
    const planned = deskZone?.box;
    // 主桌投影严格跟随可放置分区；fixture 只提供 L 桌的完整外包络。
    const mainX = planned ? THREE.MathUtils.clamp(mirrored ? b.x + w - planned.x - planned.w : planned.x - b.x, 0, w) : 0;
    const mainZ = planned ? THREE.MathUtils.clamp(planned.z - b.z, 0, d) : 0;
    const mainW = planned ? Math.min(planned.w, w - mainX) : w;
    const mainD = planned ? Math.min(planned.d, d - mainZ) : d;
    block(mainX, 0, mainZ, mainW, h, mainD);
    const wingW = w - mainX - mainW;
    const sideZone = room.zones?.find((zone) => zone.owner === fixture.owner && zone.slot === 'underDesk');
    // B 模板把桌下侧边储物段留在 z 后端；翼部只覆盖这段，凹口保持为空。
    const wingD = sideZone ? Math.min(sideZone.box.d, mainD) : 0;
    const wingZ = mainZ + mainD - wingD;
    const shaped = (southern || modern) && wingW > 0.01 && wingD > 0;
    if (shaped) block(mainX + mainW, 0, wingZ, wingW, h, wingD);

    const leg = Math.min(3, mainW / 8, mainD / 12);
    const floor = -Math.max(0, b.y);
    if (b.y <= 0) return;
    const backZone = room.zones?.find((zone) => zone.owner === fixture.owner && zone.slot === 'underDeskBack');
    const cabinetD = southern && backZone ? THREE.MathUtils.clamp(backZone.box.z - b.z - mainZ, 0, mainD) : 0;
    if (cabinetD > leg * 2) {
      // 南区靠衣柜的抽屉段已由 B 排除规划容量，仅在该段补画桌体内部结构。
      const t = Math.min(2, leg), cabinetH = -floor;
      block(mainX, floor, mainZ, mainW, t, cabinetD);
      block(mainX, floor, mainZ, mainW, cabinetH, t);
      block(mainX, floor, mainZ + cabinetD - t, mainW, cabinetH, t);
      for (let i = 0; i < 3; i += 1) {
        const y = floor + i * cabinetH / 3;
        block(mainX + mainW - t, y + 0.4, mainZ + t, t, cabinetH / 3 - 0.8, cabinetD - t * 2);
        rod([mainX + mainW - 0.4, y + cabinetH / 6, mainZ + cabinetD * 0.32],
          [mainX + mainW - 0.4, y + cabinetH / 6, mainZ + cabinetD * 0.68], 0.4);
      }
    }
    for (const x of [mainX + leg / 2, mainX + mainW - leg / 2]) {
      for (const z of [mainZ + leg / 2, mainZ + mainD - leg / 2]) {
        if (cabinetD > 0 && z < mainZ + cabinetD) continue;
        rod([x, floor + leg / 2, z], [x, 0, z], leg / 2, modern ? 'light' : 'main');
      }
    }
    if (shaped) {
      for (const z of [wingZ + leg / 2, mainZ + mainD - leg / 2]) {
        rod([w - leg / 2, floor + leg / 2, z], [w - leg / 2, 0, z], leg / 2, modern ? 'light' : 'main');
      }
    }
    // 后横档位于靠墙桌边下方，不伸入脚前凹口。
    rod([mainX + leg / 2, -Math.min(12, b.y * 0.2), mainZ + leg],
      [mainX + leg / 2, -Math.min(12, b.y * 0.2), mainZ + mainD - leg], leg / 3);
  }

  function bed() {
    const beam = Math.min(4, w / 8, h / 3);
    block(0, 0, 0, beam, h * 0.72, d);
    block(w - beam, 0, 0, beam, h * 0.72, d);
    block(beam, 0, 0, w - beam * 2, h * 0.72, beam);
    block(beam, 0, d - beam, w - beam * 2, h * 0.72, beam);
    block(beam, h * 0.72, beam, w - beam * 2, h * 0.28, d - beam * 2);
    // 床面板分缝只表达结构，不增加被褥等物件。
    for (let i = 1; i < 9; i += 1) rod([beam, h * 0.98, d * i / 9], [w - beam, h * 0.98, d * i / 9], 0.25);
    const floor = -Math.max(0, b.y);
    if (b.y > 0) {
      for (const x of [beam / 2, w - beam / 2]) {
        for (const z of [beam / 2, d - beam / 2]) rod([x, floor + beam / 2, z], [x, 0, z], Math.min(1.6, beam / 2), modern ? 'light' : 'main');
      }
    }
  }

  function rail() {
    const t = Math.min(w, 3);
    if (southern || modern) {
      sidePanel((w - t) / 2, h * 0.025, d * 0.02, t, h * 0.95, d * 0.96, modern ? Math.min(7, h * 0.22) : 1.2, true);
      return;
    }
    const r = Math.min(w * 0.32, 1.2), x = w / 2;
    const z0 = d * 0.13, z1 = d * 0.87, top = h - r, bend = Math.min(8, h * 0.25);
    curve([[x, r, z0], [x, top - bend, z0], [x, top, z0 + bend], [x, top, z1 - bend], [x, top - bend, z1], [x, r, z1]], r);
    rod([x, h * 0.1, r], [x, h * 0.1, d - r], r);
    for (let i = 1; i < 5; i += 1) {
      const z = z0 + (z1 - z0) * i / 5;
      rod([x, h * 0.1, z], [x, top, z], r * 0.7);
    }
  }

  function ladder() {
    if (southern) {
      const n = 6, rise = h / n;
      // 储物踏步仍限制在现有梯子盒内；真实进深由房型数据决定。
      for (let i = 0; i < n; i += 1) {
        const rear = d * 0.7 * i / n;
        block(w * 0.04, rise * i, rear, w * 0.92, rise - 1, d - rear);
        block(w * 0.04, rise * (i + 1) - 1, rear, w * 0.92, 1, d - rear);
        rod([w * 0.35, rise * (i + 0.48), rear + 0.8], [w * 0.65, rise * (i + 0.48), rear + 0.8], 0.55);
      }
      for (const x of [w * 0.025, w * 0.975]) rod([x, h * 0.05, d * 0.5], [x, h - 1, d * 0.9], Math.min(0.8, w * 0.025));
      return;
    }
    // 直梯正面朝中央过道（±x）：x 是厚度，梯梁分列 z 两端，踏棍沿 z 连接。
    const radius = Math.min(1.6, w * 0.2, d * 0.06), inset = radius * 1.4;
    const x = w / 2, finish = modern ? 'light' : 'main';
    for (const z of [inset, d - inset]) {
      if (modern) curve([[x, radius, z], [x, h - 8, z], [x - Math.min(2, w / 4), h - radius, z]], radius, finish);
      else rod([x, radius, z], [x, h - radius, z], radius, finish);
    }
    const count = Math.max(3, Math.round(h / 26));
    for (let i = 1; i <= count; i += 1) {
      const y = (h - radius * 2) * i / (count + 1) + radius;
      rod([x, y, inset], [x, y, d - inset], radius * 0.8, finish);
    }
  }

  function wardrobe() {
    const t = Math.min(2, w / 8, d / 12);
    block(0, 0, 0, w, t, d);
    block(0, h - t, 0, w, t, d);
    block(0, 0, 0, w, h, t);
    block(0, 0, d - t, w, h, t);
    block(0, 0, t, t, h, d - t * 2);
    const gap = Math.min(0.8, d * 0.015);
    const hang = room.zones?.find((zone) => zone.owner === fixture.owner && zone.slot === 'wardrobeHang');
    const shelfEnd = modern && hang ? THREE.MathUtils.clamp(hang.box.z - b.z, 0, d) : 0;
    if (shelfEnd > t * 3 && shelfEnd < d - t * 2) {
      // 新装修柜体的非挂衣半边没有放置分区，层板限定在这里，避免穿过衣物。
      block(0, t, shelfEnd - t, w, h - t * 2, t);
      for (let i = 1; i <= 3; i += 1) block(t, h * i / 4, t, w - t, t, shelfEnd - t * 2);
      const doorStart = shelfEnd + gap / 2;
      sidePanel(w - t, t, doorStart, t, h - t * 2, d - t - doorStart, Math.min(4, d / 16));
      const handleZ = doorStart + Math.min(4, (d - doorStart) * 0.15);
      rod([w - 0.35, h * 0.43, handleZ], [w - 0.35, h * 0.57, handleZ], 0.35);
      const rodY = hang.rod?.y === undefined ? h * 0.9 : THREE.MathUtils.clamp(hang.rod.y - b.y, t, h - t);
      rod([w * 0.55, rodY, shelfEnd + t], [w * 0.55, rodY, d - t], Math.min(0.8, t / 2));
    } else {
      for (let i = 0; i < 2; i += 1) {
        const length = (d - t * 2 - gap) / 2;
        sidePanel(w - t, t, t + i * (length + gap), t, h - t * 2, length, modern ? Math.min(4, length / 8) : 0.5);
        const z = d / 2 + (i === 0 ? -1 : 1) * Math.min(4, d * 0.08);
        // 把手贴合柜门前面，依旧不越出柜体包围盒。
        rod([w - 0.35, h * 0.43, z], [w - 0.35, h * 0.57, z], 0.35);
      }
      rod([w * 0.55, h * 0.9, t], [w * 0.55, h * 0.9, d - t], Math.min(0.8, t / 2));
    }
  }

  function chair() {
    const seatY = h * 0.47, thick = Math.min(3.2, h * 0.04);
    block(w * 0.12, seatY, d * 0.12, w * 0.74, thick, d * 0.76);
    sidePanel(w * 0.84, h * 0.58, d * 0.14, w * 0.055, h * 0.37, d * 0.72, modern ? Math.min(6, d * 0.12) : 2);
    for (const z of [d * 0.17, d * 0.83]) {
      rod([w * 0.86, seatY + thick, z], [w * 0.86, h * 0.9, z], 0.8);
      if (southern) {
        rod([w * 0.18, seatY, z], [w * 0.32, 1, z], 0.9);
        rod([w * 0.32, 1, z], [w * 0.88, 1, z], 0.9);
        rod([w * 0.88, 1, z], [w * 0.72, seatY, z], 0.9);
      } else if (!modern) {
        for (const x of [w * 0.18, w * 0.78]) rod([x, 1, z], [x, seatY, z], 1.1);
      }
    }
    if (modern) {
      rod([w / 2, 6, d / 2], [w / 2, seatY, d / 2], 2);
      for (let i = 0; i < 5; i += 1) {
        const angle = i * Math.PI * 2 / 5;
        const x = w / 2 + Math.cos(angle) * w * 0.35, z = d / 2 + Math.sin(angle) * d * 0.35;
        rod([w / 2, 6, d / 2], [x, 3, z], 1.1);
        add(new THREE.CylinderGeometry(2, 2, 1.5, 9), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(x, 2, z));
      }
    }
  }

  function sink() {
    const rimY = h * 0.9, rimT = Math.min(3, h * 0.04);
    const outer = roundedShape(w, d, Math.min(4, w / 10));
    const hole = new THREE.Path();
    hole.absellipse(w / 2, d / 2, w * 0.34, d * 0.3, 0, Math.PI * 2, true);
    outer.holes.push(hole);
    const top = new THREE.ExtrudeGeometry(outer, { depth: rimT, bevelEnabled: false, curveSegments: 12 });
    top.rotateX(Math.PI / 2); top.translate(0, rimY + rimT, 0); add(top);
    const profile = [new THREE.Vector2(0.1, -h * 0.21), new THREE.Vector2(0.55, -h * 0.21), new THREE.Vector2(0.82, -h * 0.14), new THREE.Vector2(1, 0)];
    const basin = new THREE.LatheGeometry(profile, 24);
    basin.scale(w * 0.34, 1, d * 0.3); basin.translate(w / 2, rimY, d / 2); add(basin);
    for (const x of [w * 0.08, w * 0.92]) {
      for (const z of [d * 0.08, d * 0.92]) rod([x, 1.2, z], [x, rimY, z], 1.2);
    }
    const z = d * 0.9;
    curve([[w * 0.5, rimY, z], [w * 0.5, h - 1.3, z], [w * 0.5, h - 1.3, d * 0.72], [w * 0.5, rimY + rimT + 0.8, d * 0.7]], 0.8);
  }

  switch (fixture.type) {
    case 'desk': desk(); break;
    case 'loftBed': bed(); break;
    case 'bedRail': rail(); break;
    case 'ladder': ladder(); break;
    case 'hutch': shelfFrame(); break;
    case 'wardrobe': wardrobe(); break;
    case 'chair': chair(); break;
    case 'sink': sink(); break;
    case 'dryingRod': rod([Math.min(h, d) / 2, h / 2, d / 2], [w - Math.min(h, d) / 2, h / 2, d / 2], Math.min(h, d) / 2); break;
    default: block(0, 0, 0, w, h, d);
  }

  group.userData.fills = [];
  for (const [style, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((part) => part.dispose());
    const partOpacity = style === 'light' ? Math.min(opacity, 0.32) : opacity;
    const material = new THREE.MeshBasicMaterial({ color: style === 'light' ? '#d7d9d5' : FURNITURE, transparent: true, opacity: partOpacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `structure:${style}`;
    group.add(mesh);
    group.userData.fills.push({ mesh, opacity: partOpacity });
    if (!group.userData.fill || style === 'main') group.userData.fill = mesh;
  }
  const edgeGeometry = mergeGeometries(edgeGeometries, false);
  edgeGeometries.forEach((part) => part.dispose());
  const edge = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.8 }));
  group.add(edge);
  group.userData.edge = edge;
  // 原盒只作交互代理，既不写颜色也不写深度，不会盖住开放构件。
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  proxy.name = 'fixture-pick-proxy';
  proxy.position.set(w / 2, h / 2, d / 2);
  group.add(proxy);
  group.userData.pickProxy = proxy;
  return group;
}

/** 圆角矩形路径在局部坐标从 (0,0) 开始，便于按真实厘米组装。 */
function roundedShape(width, height, radius) {
  const r = Math.max(0.001, Math.min(radius, width / 2, height / 2));
  const shape = new THREE.Shape();
  shape.moveTo(r, 0);
  shape.lineTo(width - r, 0); shape.quadraticCurveTo(width, 0, width, r);
  shape.lineTo(width, height - r); shape.quadraticCurveTo(width, height, width - r, height);
  shape.lineTo(r, height); shape.quadraticCurveTo(0, height, 0, height - r);
  shape.lineTo(0, r); shape.quadraticCurveTo(0, 0, r, 0);
  return shape;
}
