// 2.5D 高度图放置引擎（docs/05 §2）。
// 每个非 hang、非 keepClear 的分区一个 Heightmap：把底面切成 r×r 的格子，记录每格当前顶面高度。
// 新物品落在它脚下的最高点上，因此天然不会与已有物品重叠；格子覆盖一律向外取整，宁可保守。
//
// 复杂度：findSpot 为 O(朝向数 × 位置数 × 物品格数)。分区 ≤ 2000 格，stride 在格数 > 1500 时取 2。

import { EPS, localExtents, orientations, toWorld, boxToLocal, intersection } from './geometry.js';

/** 格子区间：向外取整。EPS 用于吸收浮点误差，避免 59.999999 被算成多占一格 */
function cellRange(p0, len, r, n) {
  const i0 = Math.max(0, Math.floor((p0 + EPS) / r));
  const i1 = Math.min(n - 1, Math.ceil((p0 + len - EPS) / r) - 1);
  return [i0, i1];
}

const rectsOverlap = (p, q) =>
  Math.min(p.u0 + p.a, q.u0 + q.a) - Math.max(p.u0, q.u0) > EPS &&
  Math.min(p.v0 + p.b, q.v0 + q.b) - Math.max(p.v0, q.v0) > EPS;

export class Heightmap {
  /**
   * @param {import('../core/types.js').Zone} zone
   * @param {import('../core/types.js').Zone[]} [keepClears]  会把与本分区 3D 相交部分的投影格封锁
   */
  constructor(zone, keepClears = []) {
    this.zone = zone;
    const { U, V } = localExtents(zone);
    this.U = U; this.V = V;
    this.r = U * V <= 10000 ? 2 : 5;
    this.nu = Math.max(0, Math.floor((U + EPS) / this.r));
    this.nv = Math.max(0, Math.floor((V + EPS) / this.r));
    const n = this.nu * this.nv;
    this.top = new Float32Array(n);
    this.bear = new Uint8Array(n).fill(1);
    this.block = new Uint8Array(n);
    this.owner = new Int32Array(n).fill(-1);
    /** @type {{ itemId:string, u0:number, v0:number, a:number, b:number, base:number, h:number, canBear:boolean, layer:number, pl:any }[]} */
    this.placed = [];
    this.locked = false;
    for (const kc of keepClears) {
      const ix = intersection(kc.box, zone.box);
      if (ix) this.blockRect(boxToLocal(zone, ix));
    }
  }

  get kind() { return 'grid'; }

  /** 把局部矩形覆盖的格子封锁（keepClear 投影、专注区等） */
  blockRect(rect) {
    const [i0, i1] = cellRange(rect.u0, rect.a, this.r, this.nu);
    const [j0, j1] = cellRange(rect.v0, rect.b, this.r, this.nv);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.block[j * this.nu + i] = 1;
  }

  /**
   * 找位置（docs/05 §2.4）。返回 null 表示放不下。
   * @param {any} item
   * @param {{ mode?: 'store'|'near'|'reach', origin?: {u:number,v:number}, avoidRect?: any, penaltyRect?: any, size?: any }} [opts]
   */
  findSpot(item, opts = {}) {
    if (this.locked) return null;
    const { nu, nv, r, U, V, top, bear, block } = this;
    const zh = this.zone.box.h;
    const mode = opts.mode ?? 'store';
    const avoid = opts.avoidRect ?? null;
    const pen = opts.penaltyRect ?? null;
    const origin = opts.origin ?? { u: U / 2, v: 0 };
    const stride = nu * nv > 1500 ? 2 : 1;
    let best = null;
    for (const o of orientations(item, this.zone, opts.size)) {
      const ca = Math.ceil((o.a - EPS) / r), cb = Math.ceil((o.b - EPS) / r);
      if (ca > nu || cb > nv || o.h > zh + EPS) continue;
      for (let j = 0; j <= nv - cb; j += stride) {
        for (let i = 0; i <= nu - ca; i += stride) {
          const u0 = i * r, v0 = j * r;
          if (avoid && rectsOverlap({ u0, v0, a: o.a, b: o.b }, avoid)) continue;
          let maxTop = 0, blocked = false;
          for (let jj = j; jj < j + cb && !blocked; jj++) {
            const row = jj * nu;
            for (let ii = i; ii < i + ca; ii++) {
              const c = row + ii;
              if (block[c]) { blocked = true; break; }
              if (top[c] > maxTop) maxTop = top[c];
            }
          }
          if (blocked) continue;
          const base = maxTop;
          if (base + o.h > zh + EPS) continue;
          if (base > EPS) {
            if (!this.zone.stackable) continue;
            let sup = 0, bad = false;
            for (let jj = j; jj < j + cb; jj++) {
              const row = jj * nu;
              for (let ii = i; ii < i + ca; ii++) {
                const c = row + ii;
                if (top[c] >= base - 1) { sup++; if (!bear[c]) bad = true; }
              }
            }
            if (bad || sup / (ca * cb) < 0.6) continue;   // 压在不能承重的东西上，或支撑面积不足 60%
          }
          let s;
          if (mode === 'near') s = Math.hypot(u0 + o.a / 2 - origin.u, v0 + o.b / 2 - origin.v) + 2 * base;
          else if (mode === 'reach') s = 2 * base + 0.3 * (V - (v0 + o.b)) + 0.2 * Math.abs(u0 + o.a / 2 - U / 2);
          else s = base + 0.5 * (V - (v0 + o.b)) + 0.05 * u0;
          if (pen && rectsOverlap({ u0, v0, a: o.a, b: o.b }, pen)) s += 50;
          if (!best || s < best.s - EPS ||
              (Math.abs(s - best.s) <= EPS && (j < best.j || (j === best.j && i < best.i)))) {
            best = { u0, v0, a: o.a, b: o.b, h: o.h, lying: o.lying, ka: o.ka, kb: o.kb, kh: o.kh, base, s, i, j };
          }
        }
      }
    }
    if (!best) return null;
    const { i, j, ...spot } = best;
    return spot;
  }

  /** 支撑格里最上层物品的 layer + 1；直接放在底面为 0 */
  _layerAt(u0, v0, a, b, base) {
    if (base <= EPS) return 0;
    const [i0, i1] = cellRange(u0, a, this.r, this.nu);
    const [j0, j1] = cellRange(v0, b, this.r, this.nv);
    let layer = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.nu + i;
      const ow = this.owner[c];
      if (ow >= 0 && this.top[c] >= base - 1) layer = Math.max(layer, this.placed[ow].layer + 1);
    }
    return Math.max(layer, 1);
  }

  _paint(idx) {
    const e = this.placed[idx];
    const [i0, i1] = cellRange(e.u0, e.a, this.r, this.nu);
    const [j0, j1] = cellRange(e.v0, e.b, this.r, this.nv);
    const t = e.base + e.h;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.nu + i;
      if (t >= this.top[c]) { this.top[c] = t; this.bear[c] = e.canBear ? 1 : 0; this.owner[c] = idx; }
    }
  }

  /**
   * 提交一个落点。返回世界盒子与 layer。
   * @param {any} item
   * @param {{u0:number,v0:number,a:number,b:number,h:number,base:number,lying?:boolean}} spot
   * @param {any} [pl]  调用方生成的 Placement（存起来，便于克隆/重建后导出）
   */
  commit(item, spot, pl) {
    const layer = this._layerAt(spot.u0, spot.v0, spot.a, spot.b, spot.base);
    this.placed.push({ itemId: item.id, u0: spot.u0, v0: spot.v0, a: spot.a, b: spot.b, base: spot.base, h: spot.h,
      canBear: !!item.flags?.canBearLoad, layer, pl });
    this._paint(this.placed.length - 1);
    return { box: toWorld(this.zone, spot, spot.base, spot.h), layer };
  }

  /** 由已有 Placement 的世界盒子反算局部矩形并填入（不做任何检查） */
  commitFromWorld(item, p) {
    const l = boxToLocal(this.zone, p.box);
    this.placed.push({ itemId: p.itemId, u0: l.u0, v0: l.v0, a: l.a, b: l.b, base: l.base, h: l.h,
      canBear: !!item?.flags?.canBearLoad, layer: p.layer ?? 0, pl: p });
    this._paint(this.placed.length - 1);
  }

  /** 移除后按原顺序重放其余物品重建网格（docs/05 §2.8） */
  removeItem(itemId) {
    const idx = this.placed.findIndex((e) => e.itemId === itemId);
    if (idx < 0) return false;
    this.placed.splice(idx, 1);
    this.top.fill(0); this.bear.fill(1); this.owner.fill(-1);
    for (let k = 0; k < this.placed.length; k++) this._paint(k);
    return true;
  }

  has(itemId) { return this.placed.some((e) => e.itemId === itemId); }

  clone() {
    const c = Object.create(Heightmap.prototype);
    Object.assign(c, this);
    c.top = this.top.slice(); c.bear = this.bear.slice(); c.block = this.block.slice(); c.owner = this.owner.slice();
    c.placed = this.placed.map((e) => ({ ...e }));
    return c;
  }

  /** 占用率：已放物品体积 / 分区体积 */
  fill() {
    const b = this.zone.box;
    const cap = b.w * b.d * b.h;
    if (cap <= 0) return 0;
    let v = 0;
    for (const e of this.placed) v += e.a * e.b * e.h;
    return Math.min(1, v / cap);
  }

  /**
   * 最大空矩形（docs/05 §2.9）：把 top == 0 且 block == 0 的格子看成 1，
   * 直方图 + 单调栈，O(nu·nv)。返回 { a, b }（cm，a 沿 u，b 沿 v）。
   */
  maxEmptyRect() {
    const { nu, nv, r } = this;
    const hgt = new Int32Array(nu);
    let best = { area: 0, a: 0, b: 0 };
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const c = j * nu + i;
        hgt[i] = this.top[c] <= EPS && !this.block[c] ? hgt[i] + 1 : 0;
      }
      const st = [];
      for (let i = 0; i <= nu; i++) {
        const hi = i < nu ? hgt[i] : 0;
        while (st.length && hgt[st[st.length - 1]] >= hi) {
          const hh = hgt[st.pop()];
          const left = st.length ? st[st.length - 1] + 1 : 0;
          const width = i - left;
          if (hh * width > best.area) best = { area: hh * width, a: width * r, b: hh * r };
        }
        st.push(i);
      }
    }
    return { a: best.a, b: best.b };
  }

  /**
   * 以落点为中心，在 u / v 方向分别向外扩展，直到碰到 top > base + 0.5 或 block 的格子（docs/05 §4.4）。
   * 调用前应先 removeItem 该物品。返回 { maxA, maxB }（cm）。
   */
  expandFrom(spot) {
    const { nu, nv, r, top, block } = this;
    const [i0, i1] = cellRange(spot.u0, spot.a, r, nu);
    const [j0, j1] = cellRange(spot.v0, spot.b, r, nv);
    const free = (i, j) => { const c = j * nu + i; return !block[c] && top[c] <= spot.base + 0.5; };
    const colFree = (i) => { for (let j = j0; j <= j1; j++) if (!free(i, j)) return false; return true; };
    const rowFree = (j) => { for (let i = i0; i <= i1; i++) if (!free(i, j)) return false; return true; };
    let L = 0; while (i0 - L - 1 >= 0 && colFree(i0 - L - 1)) L++;
    let R = 0; while (i1 + R + 1 < nu && colFree(i1 + R + 1)) R++;
    let F = 0; while (j0 - F - 1 >= 0 && rowFree(j0 - F - 1)) F++;
    let B = 0; while (j1 + B + 1 < nv && rowFree(j1 + B + 1)) B++;
    return { maxA: spot.a + (L + R) * r, maxB: spot.b + (F + B) * r };
  }
}
