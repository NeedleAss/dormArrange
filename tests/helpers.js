// 测试公共工具：固定种子 LCG 与 docs/05 §10 的不变量断言。
import assert from 'node:assert/strict';
import { intersects, contains } from '../src/planner/geometry.js';

/** 固定种子线性同余发生器（Numerical Recipes 参数），返回 [0, 1) */
export function lcg(seed = 12345) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * 断言 placements 满足：两两不相交、都在其分区内、不与 keepClear 相交。
 * extraZones：inside 等动态分区。inside 分区里的物品与其父行李箱的重叠是允许的。
 */
export function assertValidPlacements(room, placements, extraZones = []) {
  const zones = new Map([...room.zones, ...extraZones].map((z) => [z.id, z]));
  const kcs = room.zones.filter((z) => z.kind === 'keepClear');
  const ps = Object.values(placements).sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  const parentOf = (p) => zones.get(p.zoneId)?.parentItemId;
  for (const p of ps) {
    const z = zones.get(p.zoneId);
    assert.ok(z, `${p.itemId} 的分区 ${p.zoneId} 不存在`);
    assert.notEqual(z.kind, 'keepClear', `${p.itemId} 放进了 keepClear`);
    assert.ok(contains(z.box, p.box), `${p.itemId} 越出分区 ${p.zoneId}: ${JSON.stringify(p.box)} ⊄ ${JSON.stringify(z.box)}`);
    for (const k of kcs) assert.ok(!intersects(k.box, p.box), `${p.itemId} 与 ${k.id} 相交`);
  }
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (parentOf(a) === b.itemId || parentOf(b) === a.itemId) continue;
      assert.ok(!intersects(a.box, b.box), `${a.itemId}@${a.zoneId} 与 ${b.itemId}@${b.zoneId} 重叠`);
    }
  }
}
