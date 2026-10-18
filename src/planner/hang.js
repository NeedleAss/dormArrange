// 挂杆一维装箱（docs/05 §2.6）。
// 规格里是"used 累加"；这里改成"按区间找第一个空隙"（first-fit），
// 这样 removeItem 后其余衣物不必整体平移，EP02/EP03 的"未移动物品位置不变"才能成立。复杂度 O(n log n)。

import { EPS } from './geometry.js';

export class HangRail {
  /** @param {import('../core/types.js').Zone} zone */
  constructor(zone) {
    this.zone = zone;
    const b = zone.box;
    this.axis = zone.rod?.axis ?? 'x';
    this.start = this.axis === 'x' ? b.x : b.z;
    this.L = this.axis === 'x' ? b.w : b.d;
    this.rodY = zone.rod?.y ?? b.y + b.h;
    this.maxLen = this.rodY - b.y;
    /** @type {{ itemId:string, offset:number, thickness:number, length:number, pl:any }[]} */
    this.placed = [];
    this.locked = false;
  }

  get kind() { return 'rail'; }

  /** 按 offset 排序后的已占区间 */
  _sorted() {
    return [...this.placed].sort((p, q) => p.offset - q.offset || (p.itemId < q.itemId ? -1 : 1));
  }

  /** 第一个能容纳 thickness 的空隙起点；没有返回 -1 */
  _gap(thickness) {
    let cur = 0;
    for (const e of this._sorted()) {
      if (e.offset - cur >= thickness - EPS) return cur;
      cur = Math.max(cur, e.offset + e.thickness);
    }
    return this.L - cur >= thickness - EPS ? cur : -1;
  }

  canHang(item) {
    return !!(item.flags?.hangable && item.hang && item.hang.length <= this.maxLen + EPS);
  }

  /** 返回 { offset, thickness, length } 或 null */
  findSpot(item) {
    if (this.locked || !this.canHang(item)) return null;
    const off = this._gap(item.hang.thickness);
    return off < 0 ? null : { offset: off, thickness: item.hang.thickness, length: item.hang.length, base: 0 };
  }

  /** 由一维落点生成世界盒子：垂直于杆的方向取分区深度居中的 min(深度, 50) */
  boxFor(spot) {
    const b = this.zone.box;
    const y = this.rodY - spot.length;
    if (this.axis === 'x') {
      const dd = Math.min(b.d, 50);
      return { x: this.start + spot.offset, y, z: b.z + (b.d - dd) / 2, w: spot.thickness, d: dd, h: spot.length };
    }
    const ww = Math.min(b.w, 50);
    return { x: b.x + (b.w - ww) / 2, y, z: this.start + spot.offset, w: ww, d: spot.thickness, h: spot.length };
  }

  commit(item, spot, pl) {
    this.placed.push({ itemId: item.id, offset: spot.offset, thickness: spot.thickness, length: spot.length, pl });
    return { box: this.boxFor(spot), layer: 0 };
  }

  commitFromWorld(item, p) {
    const offset = (this.axis === 'x' ? p.box.x : p.box.z) - this.start;
    const thickness = this.axis === 'x' ? p.box.w : p.box.d;
    this.placed.push({ itemId: p.itemId, offset, thickness, length: p.box.h, pl: p });
  }

  removeItem(itemId) {
    const idx = this.placed.findIndex((e) => e.itemId === itemId);
    if (idx < 0) return false;
    this.placed.splice(idx, 1);
    return true;
  }

  has(itemId) { return this.placed.some((e) => e.itemId === itemId); }

  clone() {
    const c = Object.create(HangRail.prototype);
    Object.assign(c, this);
    c.placed = this.placed.map((e) => ({ ...e }));
    return c;
  }

  /** 剩余可挂厚度（tolerance 用：L − 其他已用长度） */
  freeLength() {
    let used = 0;
    for (const e of this.placed) used += e.thickness;
    return Math.max(0, this.L - used);
  }

  /** 占用率：按长度 */
  fill() {
    return this.L > 0 ? Math.min(1, (this.L - this.freeLength()) / this.L) : 0;
  }

  maxEmptyRect() {
    return { a: this.freeLength(), b: Math.min(this.axis === 'x' ? this.zone.box.d : this.zone.box.w, 50) };
  }
}
