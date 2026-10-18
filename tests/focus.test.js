// B3：第二话 腾桌 planFocusField + applySteps（docs/05 §5、§10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, planFocusField, applySteps, PRESETS, computeSync } from '../src/planner/index.js';
import { intersection, overlapArea2D } from '../src/planner/geometry.js';
import { assertValidPlacements } from './helpers.js';

const room = buildRoom();
const { items, placements } = PRESETS.messyDesk;
const byId = Object.fromEntries(items.map((it) => [it.id, it]));
const plan = planFocusField(room, items, placements);

/** 力场内（3D 相交且水平投影 > 1cm²）的非 focusTool 物品 */
function inField(pls, box) {
  return Object.values(pls).filter((p) => !byId[p.itemId].flags.focusTool &&
    intersection(p.box, box) && overlapArea2D(p.box, box) > 1).map((p) => p.itemId);
}

test('预设：力场内 4–6 件冲突，显示器不在力场内，至少一次级联', () => {
  assert.ok(plan.conflicts.length >= 4 && plan.conflicts.length <= 6, plan.conflicts.join());
  const mon = items.find((it) => it.libId === 'monitor-27');
  assert.ok(!plan.conflicts.includes(mon.id));
  assert.ok(plan.steps.some((s) => s.kind === 'cascade'));
  assert.ok(plan.steps.some((s) => s.kind === 'dispose'));
  assert.equal(plan.unresolved.length, 0);
  assert.deepEqual(inField(placements, plan.focusBox).sort(), [...plan.conflicts].sort());
});

test('应用 placementsAfter 后力场内没有任何非 focusTool 物品；applySteps 结果一致', () => {
  assert.deepEqual(inField(plan.placementsAfter, plan.focusBox), []);
  assert.deepEqual(applySteps(placements, plan.steps), plan.placementsAfter);
  assert.deepEqual(applySteps(placements, plan.steps, 0), placements);
  const half = applySteps(placements, plan.steps, 3);
  for (const st of plan.steps.slice(3)) assert.deepEqual(half[st.itemId], placements[st.itemId]);
});

test('非冲突、未被级联的物品位置不变；步骤数 ≤ 冲突数 + 级联数', () => {
  const touched = new Set(plan.steps.map((s) => s.itemId));
  const cascaded = new Set(plan.steps.filter((s) => s.kind === 'cascade').map((s) => s.itemId));
  for (const [id, p] of Object.entries(placements)) {
    if (plan.conflicts.includes(id) || cascaded.has(id)) continue;
    assert.deepEqual(plan.placementsAfter[id], p, id);
  }
  for (const id of touched) assert.ok(plan.conflicts.includes(id) || cascaded.has(id));
  assert.ok(plan.steps.length <= plan.conflicts.length + cascaded.size);
  // 级联步骤紧排在它服务的 move 之前
  plan.steps.forEach((s, i) => {
    assert.equal(s.idx, i);
    assert.ok(s.text.startsWith(`第 ${i + 1} 步：`));
    if (s.kind === 'cascade') {
      assert.equal(plan.steps[i + 1].kind, 'move');
      assert.ok(s.text.includes(`给「${plan.steps[i + 1].itemName}」腾位置`));
    }
    if (s.kind === 'dispose') { assert.equal(s.to, null); assert.equal(s.toZoneId, null); }
  });
});

test('syncAfter > syncBefore，metrics 自洽', () => {
  const m = plan.metrics;
  assert.ok(m.syncAfter > m.syncBefore, `${m.syncBefore} → ${m.syncAfter}`);
  assert.equal(m.moves, plan.steps.length);
  assert.equal(m.clearedArea, 75 * 35);
  const d = plan.steps.reduce((s, x) => s + x.distance, 0);
  assert.ok(Math.abs(m.distanceCm - d) < 0.11);
  const sync = computeSync(room, items, plan.placementsAfter, { focusBox: plan.focusBox });
  assert.ok(sync.total >= 0 && sync.total <= 100);
  assert.equal(sync.parts.focus, 1);
});

test('placementsAfter 不重叠、不越界、不进 keepClear；结果确定；不修改入参；≤ 50ms', () => {
  assertValidPlacements(room, placements);
  assertValidPlacements(room, plan.placementsAfter);
  const snap = JSON.stringify(placements);
  const t = performance.now();
  const again = planFocusField(room, items, placements);
  const ms = performance.now() - t;
  assert.ok(ms <= 50, `planFocusField 用时 ${ms.toFixed(1)}ms`);
  assert.equal(JSON.stringify(again), JSON.stringify(plan));
  assert.equal(JSON.stringify(placements), snap);
});

test('锁定分区里的物品不变', () => {
  for (const locked of [['A.hutch'], ['A.underDesk'], ['A.hutch', 'A.underDesk']]) {
    const p2 = planFocusField(room, items, placements, {}, { lockedZones: locked });
    for (const [id, p] of Object.entries(placements)) {
      if (locked.includes(p.zoneId)) assert.deepEqual(p2.placementsAfter[id], p, `${locked} ${id}`);
    }
    for (const p of Object.values(p2.placementsAfter)) {
      if (!placements[p.itemId] || placements[p.itemId].zoneId !== p.zoneId) assert.ok(!locked.includes(p.zoneId));
    }
    assertValidPlacements(room, p2.placementsAfter);
    assert.deepEqual(inField(p2.placementsAfter, p2.focusBox).sort(),
      p2.unresolved.map((u) => u.itemId).sort());
  }
});

test('力场尺寸预设：35×25 与 90×40；空桌没有步骤', () => {
  const small = planFocusField(room, items, placements, { w: 35, d: 25 });
  assert.ok(small.conflicts.length <= plan.conflicts.length);
  assert.deepEqual(inField(small.placementsAfter, small.focusBox).sort(), small.unresolved.map((u) => u.itemId).sort());
  const big = planFocusField(room, items, placements, { w: 90, d: 40 });
  assert.equal(big.metrics.clearedArea, 3600);
  assertValidPlacements(room, big.placementsAfter);
  const empty = planFocusField(room, items, {});
  assert.equal(empty.steps.length, 0);
  assert.equal(empty.metrics.syncAfter >= empty.metrics.syncBefore, true);
});

test('书桌锁定：照常报出冲突，不生成步骤，冲突全部进 unresolved', () => {
  const locked = planFocusField(room, items, placements, {}, { lockedZones: ['A.desk'] });
  assert.deepEqual(locked.conflicts, plan.conflicts);
  assert.equal(locked.steps.length, 0);
  assert.deepEqual(locked.unresolved.map((u) => u.itemId), plan.conflicts);
  for (const u of locked.unresolved) {
    assert.equal(u.reason, '书桌已锁定');
    assert.equal(u.suggestion, '解锁书桌后再腾桌');
  }
  assert.deepEqual(locked.placementsAfter, placements);
  assert.equal(locked.metrics.moves, 0);
  assert.equal(locked.metrics.syncAfter, locked.metrics.syncBefore);
  assert.equal(locked.metrics.syncBefore, plan.metrics.syncBefore);
});
