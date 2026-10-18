// B1：几何、高度图、挂杆与引擎集合的单测（docs/05 §1、§2、§10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom } from '../src/planner/index.js';
import { makeItem } from '../src/data/itemLibrary.js';
import { toLocal, toWorld, boxToLocal, localExtents, orientations, intersects } from '../src/planner/geometry.js';
import { Heightmap } from '../src/planner/heightmap.js';
import { HangRail } from '../src/planner/hang.js';
import { buildEngines, commitSpot, zoneFill } from '../src/planner/engines.js';
import { lcg, assertValidPlacements } from './helpers.js';

const room = buildRoom();
const Z = (id) => room.zones.find((z) => z.id === id);

test('toLocal / toWorld / boxToLocal 互逆（四种 front）', () => {
  for (const id of ['A.desk', 'C.desk', 'pub.cornerL', 'pub.sinkShelf']) {
    const z = Z(id);
    const rect = { u0: 4, v0: 6, a: 10, b: 8 };
    const box = toWorld(z, rect, 3, 5);
    const back = boxToLocal(z, box);
    assert.deepEqual([back.u0, back.v0, back.a, back.b, back.base, back.h], [4, 6, 10, 8, 3, 5], id);
    // 盒子的前沿角点在局部坐标中应位于 v0
    const { U, V } = localExtents(z);
    assert.ok(U > 0 && V > 0);
    const c = toLocal(z, box.x + box.w / 2, box.z + box.d / 2);
    assert.ok(Math.abs(c.u - 9) < 1e-9 && Math.abs(c.v - 10) < 1e-9, `${id} 中心 ${JSON.stringify(c)}`);
  }
});

test('A.desk 前沿是靠近椅子的一侧（v=0 在 x=60）', () => {
  const z = Z('A.desk');
  assert.deepEqual(toLocal(z, 60, 170), { u: 0, v: 0 });
});

test('orientations：放倒与旋转去重', () => {
  const lug = makeItem('luggage-24');
  assert.equal(orientations(lug, Z('A.underDesk')).length, 6);
  const nr = makeItem('lamp', { flags: { rotatable: false } });
  assert.equal(orientations(nr, Z('A.desk')).length, 1);
});

test('高度图：叠放需要承重与 60% 支撑，满了返回 null', () => {
  const hm = new Heightmap(Z('A.underDesk'));
  const box = makeItem('box-l', { id: 'b1' });
  const s1 = hm.findSpot(box);
  assert.ok(s1);
  assert.equal(s1.base, 0);
  commitSpot(hm, box, s1);
  const lamp = makeItem('lamp', { id: 'l1' });
  // 台灯不承重：在它上面不能放东西
  const lampOnly = new Heightmap(Z('A.underDesk'));
  commitSpot(lampOnly, lamp, { u0: 0, v0: 0, a: 40, b: 60, h: 40, base: 0 });
  assert.equal(lampOnly.findSpot(makeItem('box-desk', { id: 'x' })), null);
  // 大号收纳箱承重：可以叠
  const b2 = makeItem('box-m', { id: 'b2' });
  const s2 = hm.findSpot(b2);
  assert.ok(s2);
});

test('高度图：removeItem 重建后可以重新放入', () => {
  const hm = new Heightmap(Z('A.underDesk'));
  const lug = makeItem('luggage-24', { id: 'L' });
  const s = hm.findSpot(lug);
  assert.ok(s, '24 寸箱能立着进桌下');
  commitSpot(hm, lug, s);
  const lug2 = makeItem('luggage-24', { id: 'L2' });
  assert.equal(hm.findSpot(lug2), null);
  hm.removeItem('L');
  assert.ok(hm.findSpot(lug2));
});

test('高度图：blockRect / avoidRect 生效，maxEmptyRect 正确', () => {
  const hm = new Heightmap(Z('A.desk'));
  const full = hm.maxEmptyRect();
  assert.deepEqual(full, { a: 130, b: 60 });
  hm.blockRect({ u0: 0, v0: 0, a: 130, b: 30 });
  assert.deepEqual(hm.maxEmptyRect(), { a: 130, b: 30 });
  const s = hm.findSpot(makeItem('box-desk', { id: 'x' }));
  assert.ok(s.v0 >= 30);
  const hm2 = new Heightmap(Z('A.desk'));
  const s2 = hm2.findSpot(makeItem('box-desk', { id: 'x' }), { mode: 'near', origin: { u: 65, v: 10 },
    avoidRect: { u0: 0, v0: 0, a: 130, b: 40 } });
  assert.ok(s2.v0 >= 40);
});

test('挂杆：一维装箱，超长不挂，删除后空隙复用', () => {
  const rail = new HangRail(Z('A.wardrobeHang'));
  const coats = [];
  for (let i = 0; i < 20; i++) {
    const c = makeItem('coat', { id: `c${String(i).padStart(2, '0')}` });
    const s = rail.findSpot(c);
    if (!s) break;
    coats.push(commitSpot(rail, c, s));
  }
  assert.equal(coats.length, 11);   // 70 / 6 = 11
  const long = makeItem('coat', { id: 'long', hang: { thickness: 2, length: 120 } });
  assert.equal(rail.findSpot(long), null);
  rail.removeItem('c03');
  const s = rail.findSpot(makeItem('coat', { id: 'n' }));
  assert.equal(s.offset, 18);
  assertValidPlacements(room, Object.fromEntries(coats.map((p) => [p.itemId, p])));
});

/** 用固定种子生成 50 个随机物品，依次放进 3 个分区 */
function randomRun(seed) {
  const rnd = lcg(seed);
  const libs = ['box-m', 'box-desk', 'books-10', 'lamp', 'cup', 'snack-box', 'headphones', 'folder', 'luggage-20', 'keyboard'];
  const items = [];
  for (let i = 0; i < 50; i++) {
    const lib = libs[Math.floor(rnd() * libs.length)];
    const k = 0.5 + rnd();
    const base = makeItem(lib);
    items.push(makeItem(lib, { id: `r-${String(i).padStart(3, '0')}`,
      size: { w: Math.round(base.size.w * k), d: Math.round(base.size.d * k), h: Math.round(base.size.h * k) },
      flags: { canBearLoad: rnd() < 0.6, canLieDown: rnd() < 0.3 } }));
  }
  const zoneIds = ['A.desk', 'A.underDesk', 'pub.entryL'];
  const engines = buildEngines(room, {}, { items });
  const placements = {};
  for (const it of items) {
    for (const zid of zoneIds) {
      const s = engines[zid].findSpot(it, { mode: it.id.endsWith('7') ? 'reach' : 'store' });
      if (s) { placements[it.id] = commitSpot(engines[zid], it, s); break; }
    }
  }
  return { items, placements, engines };
}

test('随机 50 件放入 3 个分区：不重叠、不越界、不进 keepClear、高度不超、结果确定', () => {
  for (const seed of [1, 42, 2026]) {
    const { items, placements } = randomRun(seed);
    const n = Object.keys(placements).length;
    assert.ok(n >= 20, `seed ${seed} 只放下 ${n} 件`);
    assertValidPlacements(room, placements);
    for (const p of Object.values(placements)) {
      const z = Z(p.zoneId);
      assert.ok(p.box.y + p.box.h <= z.box.y + z.box.h + 0.01);
      assert.ok(p.layer >= 0);
    }
    assert.equal(JSON.stringify(placements), JSON.stringify(randomRun(seed).placements));
    // 用这些 placements 重建引擎后再放：仍然满足不变量
    const eng2 = buildEngines(room, placements, { items });
    const extra = makeItem('box-desk', { id: 'zz-extra' });
    const s = eng2['pub.entryL'].findSpot(extra);
    if (s) {
      const all = { ...placements, [extra.id]: commitSpot(eng2['pub.entryL'], extra, s) };
      assertValidPlacements(room, all);
    }
    const fill = zoneFill(room, items, placements);
    for (const v of Object.values(fill)) assert.ok(v >= 0 && v <= 1);
  }
});

test('buildEngines：keepClear 不建引擎，锁定分区拒绝新物品', () => {
  const eng = buildEngines(room, {}, { lockedZones: ['A.hutch'] });
  assert.equal(eng['pub.aisle'], undefined);
  assert.equal(eng['A.hutch'].findSpot(makeItem('books-10')), null);
  assert.ok(eng['A.wardrobeHang'] instanceof HangRail);
});

test('与 keepClear 相交的分区会封锁对应格子', () => {
  // 人为构造一个和过道相交的分区
  const fake = { id: 'X.f', slot: 'f', owner: 'A', kind: 'floor', front: '+z', tier: 1, accepts: ['*'], stackable: true,
    box: { x: 100, y: 0, z: 0, w: 60, d: 40, h: 50 } };
  const hm = new Heightmap(fake, room.zones.filter((z) => z.kind === 'keepClear'));
  const it = makeItem('box-desk', { id: 'q' });
  for (let k = 0; k < 10; k++) {
    const s = hm.findSpot(it);
    if (!s) break;
    const p = commitSpot(hm, it, s);
    assert.ok(!intersects(p.box, Z('pub.aisle').box));
  }
});
