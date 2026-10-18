// 盒子运算与分区局部坐标（docs/05 §1）。全部 O(1) 纯函数。

/** @typedef {import('../core/types.js').Box} Box */
/** @typedef {import('../core/types.js').Zone} Zone */

/** 浮点比较容差（cm） */
export const EPS = 0.01;

const ov1 = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/** 三个轴的区间都有正长度重叠（各轴重叠 > EPS） */
export function intersects(a, b) {
  return ov1(a.x, a.x + a.w, b.x, b.x + b.w) > EPS &&
    ov1(a.y, a.y + a.h, b.y, b.y + b.h) > EPS &&
    ov1(a.z, a.z + a.d, b.z, b.z + b.d) > EPS;
}

/** inner ⊆ outer（允许 EPS） */
export function contains(outer, inner) {
  return inner.x >= outer.x - EPS && inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y >= outer.y - EPS && inner.y + inner.h <= outer.y + outer.h + EPS &&
    inner.z >= outer.z - EPS && inner.z + inner.d <= outer.z + outer.d + EPS;
}

/** x-z 平面上的重叠面积 */
export function overlapArea2D(a, b) {
  const ox = ov1(a.x, a.x + a.w, b.x, b.x + b.w);
  const oz = ov1(a.z, a.z + a.d, b.z, b.z + b.d);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

/** 3D 相交部分（不相交返回 null） */
export function intersection(a, b) {
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  const z0 = Math.max(a.z, b.z), z1 = Math.min(a.z + a.d, b.z + b.d);
  if (x1 - x0 <= EPS || y1 - y0 <= EPS || z1 - z0 <= EPS) return null;
  return { x: x0, y: y0, z: z0, w: x1 - x0, d: z1 - z0, h: y1 - y0 };
}

export function center(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 };
}

/** 两个盒子中心点之间的 3D 欧氏距离 */
export function dist(a, b) {
  const ca = center(a), cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z);
}

export function volume(size) {
  return size.w * size.d * size.h;
}

/** 分区局部尺寸：U 沿前沿，V 为深度 */
export function localExtents(zone) {
  const b = zone.box;
  return zone.front === '+x' || zone.front === '-x' ? { U: b.d, V: b.w } : { U: b.w, V: b.d };
}

/** 世界 (x, z) → 局部 (u, v) */
export function toLocal(zone, x, z) {
  const b = zone.box;
  switch (zone.front) {
    case '+x': return { u: z - b.z, v: (b.x + b.w) - x };
    case '-x': return { u: z - b.z, v: x - b.x };
    case '+z': return { u: x - b.x, v: (b.z + b.d) - z };
    default:   return { u: x - b.x, v: z - b.z };      // '-z'
  }
}

/**
 * 局部矩形 → 世界盒子
 * @param {Zone} zone
 * @param {{u0:number, v0:number, a:number, b:number}} r  a 沿 u，b 沿 v
 * @param {number} base  相对分区底面的高度
 * @param {number} h
 * @returns {Box}
 */
export function toWorld(zone, r, base, h) {
  const bx = zone.box;
  const y = bx.y + base;
  switch (zone.front) {
    case '+x': return { x: bx.x + bx.w - (r.v0 + r.b), y, z: bx.z + r.u0, w: r.b, d: r.a, h };
    case '-x': return { x: bx.x + r.v0, y, z: bx.z + r.u0, w: r.b, d: r.a, h };
    case '+z': return { x: bx.x + r.u0, y, z: bx.z + bx.d - (r.v0 + r.b), w: r.a, d: r.b, h };
    default:   return { x: bx.x + r.u0, y, z: bx.z + r.v0, w: r.a, d: r.b, h };
  }
}

/** 世界盒子 → 局部矩形 + base（toWorld 的逆） */
export function boxToLocal(zone, box) {
  const bx = zone.box;
  const base = box.y - bx.y;
  switch (zone.front) {
    case '+x': return { u0: box.z - bx.z, v0: bx.x + bx.w - (box.x + box.w), a: box.d, b: box.w, base, h: box.h };
    case '-x': return { u0: box.z - bx.z, v0: box.x - bx.x, a: box.d, b: box.w, base, h: box.h };
    case '+z': return { u0: box.x - bx.x, v0: bx.z + bx.d - (box.z + box.d), a: box.w, b: box.d, base, h: box.h };
    default:   return { u0: box.x - bx.x, v0: box.z - bx.z, a: box.w, b: box.d, base, h: box.h };
  }
}

/** 局部 a 是否对应世界 x 方向（front 为 ±z 时） */
export function uIsWorldX(zone) {
  return zone.front === '+z' || zone.front === '-z';
}

/**
 * 物品的候选朝向（docs/05 §1.3）。
 * 返回 [{ a, b, h, lying, sx, sz }]：(a, b) 是局部 footprint，(sx, sz) 是世界 x、z 方向的长度。
 * rotatable 为 false 时只取 footprint 与世界轴一致（sx = 立着/放倒时的 w）的那种。
 * @param {import('../core/types.js').Item} item
 * @param {Zone} zone
 * @param {import('../core/types.js').Size3} [sizeOverride]  压缩后的尺寸等
 */
export function orientations(item, zone, sizeOverride) {
  const s = sizeOverride ?? item.size;
  const shapes = [{ sx: s.w, sz: s.d, h: s.h, lying: false }];
  if (item.flags?.canLieDown) {
    shapes.push({ sx: s.w, sz: s.h, h: s.d, lying: true }, { sx: s.h, sz: s.d, h: s.w, lying: true });
  }
  const ux = uIsWorldX(zone);
  const out = [];
  const seen = new Set();
  for (const sh of shapes) {
    const worldOpts = [{ sx: sh.sx, sz: sh.sz }];
    if (item.flags?.rotatable !== false) worldOpts.push({ sx: sh.sz, sz: sh.sx });
    for (const wo of worldOpts) {
      const a = ux ? wo.sx : wo.sz;
      const b = ux ? wo.sz : wo.sx;
      const key = `${a}|${b}|${sh.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, h: sh.h, lying: sh.lying });
    }
  }
  return out;
}
