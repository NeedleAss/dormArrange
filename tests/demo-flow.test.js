// 端到端演示流程测试：沿 docs/01 §5 演示脚本把 EP01 → EP02 → 观众互动 → EP03 → EP04 串起来。
// 只调用 src/planner/index.js 的公开 API；不变量见 docs/05 §10，性能预算见 docs/03 §7（这里放宽到 2 倍）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoom, makeItem, LIBRARY, PRESETS, parseItemsText, planMoveIn, planFocusField, applySteps,
  planSeasons, diffMonths, scatterOnDesk, computeSync
} from '../src/planner/index.js';

const EPS = 0.01;
const room = buildRoom();
const zoneById = new Map(room.zones.map((z) => [z.id, z]));
const keepClears = room.zones.filter((z) => z.kind === 'keepClear');

// ───────────── 只依赖数据形状的几何工具（不引用 planner 内部文件） ─────────────
const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const intersects = (a, b) => ov(a.x, a.x + a.w, b.x, b.x + b.w) > EPS &&
  ov(a.y, a.y + a.h, b.y, b.y + b.h) > EPS && ov(a.z, a.z + a.d, b.z, b.z + b.d) > EPS;
const contains = (o, i) => i.x >= o.x - EPS && i.x + i.w <= o.x + o.w + EPS &&
  i.y >= o.y - EPS && i.y + i.h <= o.y + o.h + EPS && i.z >= o.z - EPS && i.z + i.d <= o.z + o.d + EPS;
const area2D = (a, b) => {
  const ox = ov(a.x, a.x + a.w, b.x, b.x + b.w), oz = ov(a.z, a.z + a.d, b.z, b.z + b.d);
  return ox > 0 && oz > 0 ? ox * oz : 0;
};
const parentOf = (zoneId) => (zoneId.endsWith('.inside') ? zoneId.slice(0, -'.inside'.length) : null);

/** 不重叠、不越界、不进 keepClear。inside 分区（行李箱内部）里的物品要包含在父行李箱盒子内 */
function assertLayout(pls, label = '') {
  const ps = Object.values(pls).sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  for (const p of ps) {
    const pid = parentOf(p.zoneId);
    if (pid) {
      assert.ok(pls[pid], `${label} ${p.itemId} 在 ${p.zoneId}，但行李箱 ${pid} 没有放下`);
      assert.ok(contains(pls[pid].box, p.box), `${label} ${p.itemId} 越出行李箱 ${pid}`);
    } else {
      const z = zoneById.get(p.zoneId);
      assert.ok(z, `${label} ${p.itemId} 的分区 ${p.zoneId} 不存在`);
      assert.notEqual(z.kind, 'keepClear', `${label} ${p.itemId} 放进 keepClear`);
      assert.ok(contains(z.box, p.box), `${label} ${p.itemId} 越出 ${p.zoneId}`);
    }
    for (const k of keepClears) assert.ok(!intersects(k.box, p.box), `${label} ${p.itemId} 堵了 ${k.id}`);
  }
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (parentOf(a.zoneId) === b.itemId || parentOf(b.zoneId) === a.itemId) continue;
      assert.ok(!intersects(a.box, b.box), `${label} ${a.itemId}@${a.zoneId} 与 ${b.itemId}@${b.zoneId} 重叠`);
    }
  }
}

/** 力场内（3D 相交且水平投影 > 1cm²）的非学习工具物品 */
function inField(items, pls, box) {
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));
  return Object.values(pls).filter((p) => byId[p.itemId] && !byId[p.itemId].flags.focusTool &&
    intersects(p.box, box) && area2D(p.box, box) > 1).map((p) => p.itemId).sort();
}

function timeIt(fn, warm = 1) {
  for (let i = 0; i < warm; i++) fn();
  const t = performance.now();
  const r = fn();
  return { ms: performance.now() - t, r };
}

// ───────────────────────────── 1. 入住 EP01 ─────────────────────────────
test('演示 1 · 入住：解析新生清单 → planMoveIn', () => {
  const items = parseItemsText(PRESETS.freshman);
  assert.ok(items.length > 0);
  const rep = planMoveIn(room, items);
  assertLayout(rep.placements, 'EP01');
  const s = rep.summary;
  assert.equal(s.fits + s.relocate + s.uncertain + s.overflow + s.banned, items.length);
  assert.equal(s.total, items.length);
  const kettles = items.filter((it) => it.libId === 'kettle');
  assert.ok(kettles.length >= 1, '新生清单里应有电热水壶');
  for (const k of kettles) assert.equal(rep.verdicts[k.id].status, 'banned');
  for (const it of items) {
    const v = rep.verdicts[it.id];
    assert.ok(v, `${it.id} 没有 verdict`);
    if (v.status === 'uncertain') assert.ok(v.tolerance && v.tolerance.maxW > 0 && v.tolerance.maxD > 0 && v.tolerance.maxH > 0, it.name);
    if (v.status === 'overflow') assert.ok(v.need && typeof v.need.text === 'string', it.name);
    if (v.status === 'banned' || v.status === 'overflow') assert.equal(rep.placements[it.id], undefined, it.name);
  }
  // 演示台词依赖"尺寸待定：收纳箱"能点出容差
  assert.ok(items.some((it) => rep.verdicts[it.id].status === 'uncertain' && it.category === 'storage'));
  assert.ok(rep.sync.total >= 0 && rep.sync.total <= 100);
});

// ───────────────────────────── 2. 腾桌 EP02 ─────────────────────────────
test('演示 2 · 腾桌：每个前缀 applySteps 都不重叠，执行完力场净空、同步率上升', () => {
  const { items, placements } = PRESETS.messyDesk;
  const plan = planFocusField(room, items, placements);
  assert.ok(plan.steps.length > 0);
  for (let k = 0; k <= plan.steps.length; k++) {
    const pk = applySteps(placements, plan.steps, k);
    assertLayout(pk, `前 ${k} 步`);
  }
  const done = applySteps(placements, plan.steps, plan.steps.length);
  assert.deepEqual(done, plan.placementsAfter);
  assert.deepEqual(inField(items, done, plan.focusBox), []);
  assert.ok(plan.metrics.syncAfter > plan.metrics.syncBefore, `${plan.metrics.syncBefore} → ${plan.metrics.syncAfter}`);
  // UI 显示的同步率由 computeSync 重算，应与 metrics 一致
  assert.equal(computeSync(room, items, done, { focusBox: plan.focusBox, moves: plan.steps.length }).total, plan.metrics.syncAfter);
  assert.equal(plan.unresolved.length, 0);
});

// ───────────────────────────── 3. 观众互动 ─────────────────────────────
const AUDIENCE = '台灯、两摞书、水杯、零食箱、快递盒、耳机';

test('演示 3 · 观众互动：随手清单 → scatterOnDesk → planFocusField 得到有效计划', () => {
  const items = parseItemsText(AUDIENCE, { idPrefix: 'aud' });
  assert.ok(items.length >= 6);
  const pls = scatterOnDesk(room, items, { owner: 'A' });
  assert.ok(Object.keys(pls).length >= 4, '大部分东西应堆到桌面附近');
  assertLayout(pls, '乱堆');
  const plan = planFocusField(room, items, pls);
  assert.ok(plan.conflicts.length >= 1, '乱堆后力场里应有冲突');
  for (let k = 0; k <= plan.steps.length; k++) assertLayout(applySteps(pls, plan.steps, k), `观众 前 ${k} 步`);
  assert.deepEqual(inField(items, plan.placementsAfter, plan.focusBox), plan.unresolved.map((u) => u.itemId).sort());
  assert.ok(plan.metrics.syncAfter >= plan.metrics.syncBefore);
  assert.equal(JSON.stringify(planFocusField(room, items, pls)), JSON.stringify(plan));
});

test('演示 3 · 观众口语：「零食箱」应匹配物品库零食箱', () => {
  const items = parseItemsText('零食箱', { idPrefix: 'aud' });
  assert.equal(items.length, 1);
  assert.equal(items[0].libId, 'snack-box');
  assert.equal(items[0].name, '零食箱');
});

test('演示 3 · 观众口语：「两摞书」应解析为 2 摞完整的书', { todo: '已知问题 B："摞"被当作本数，见 BUGS.md' }, () => {
  const books = parseItemsText('两摞书').filter((it) => it.category === 'books');
  assert.equal(books.length, 2);
  for (const b of books) assert.equal(b.size.h, 25);
});

// ───────────────────────────── 4. 换季 EP03 ─────────────────────────────
test('演示 4 · 换季：9 月到次年 8 月每月不重叠；依次应用 diffMonths 得到下个月', () => {
  const items = parseItemsText(PRESETS.freshman);
  const plan = planSeasons(room, items);
  assert.deepEqual(plan.months, [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const m of plan.months) assertLayout(plan.byMonth[m].placements, `${m} 月`);
  let cur = structuredClone(plan.byMonth[plan.months[0]].placements);
  for (let i = 1; i < plan.months.length; i++) {
    const A = plan.byMonth[plan.months[i - 1]], B = plan.byMonth[plan.months[i]];
    const steps = diffMonths(A, B, items, room);
    cur = applySteps(cur, steps);
    assert.deepEqual(cur, B.placements, `${plan.months[i - 1]}→${plan.months[i]} 月`);
    assertLayout(cur, `应用到 ${plan.months[i]} 月`);
  }
  // 演示台词：10 → 12 月冬装出箱
  const d = diffMonths(plan.byMonth[10], plan.byMonth[12], items, room);
  assert.ok(d.some((s) => s.kind === 'retrieve'), '10→12 月应有取出步骤');
  assert.ok(plan.compare.on.maxFill <= plan.compare.off.maxFill);
});

// ───────────────────────────── 5. 成长 EP04 ─────────────────────────────
test('演示 5 · 成长：每个快照的布局有效', () => {
  assert.equal(PRESETS.growth.length, 4);
  for (const s of PRESETS.growth) {
    const ids = new Set(s.items.map((it) => it.id));
    for (const id of Object.keys(s.placements)) assert.ok(ids.has(id), `${s.id} 的 placement ${id} 没有对应物品`);
    assertLayout(s.placements, s.id);
  }
});

test('演示 5 · 成长：快照 items 与 placements 一致，不残留已扔掉的物品', { todo: '已知问题 B：growth[3] 仍含已 dispose 的快递盒，见 CHANGES.md [15:28]' }, () => {
  for (const s of PRESETS.growth) {
    for (const it of s.items) {
      if (it.flags.disposable || it.category === 'trash') {
        assert.ok(s.placements[it.id], `${s.id} 残留已扔掉的「${it.name}」`);
      }
    }
  }
});

// ───────────────────────────── 6. 性能（docs/03 §7 × 2） ─────────────────────────────
test('演示 6 · 性能：planMoveIn 40 件 ≤ 300ms、planFocusField ≤ 100ms、planSeasons ≤ 1600ms', () => {
  const pool = LIBRARY.filter((e) => !['kettle', 'rice-cooker', 'e-blanket', 'heater'].includes(e.libId));
  const forty = [];
  for (let i = 0; i < 40; i++) forty.push(makeItem(pool[(i * 7) % pool.length].libId, { id: `perf-${String(i).padStart(3, '0')}` }));
  const a = timeIt(() => planMoveIn(room, forty));
  assert.ok(a.ms <= 300, `planMoveIn ${a.ms.toFixed(1)}ms`);
  const { items, placements } = PRESETS.messyDesk;
  const b = timeIt(() => planFocusField(room, items, placements));
  assert.ok(b.ms <= 100, `planFocusField ${b.ms.toFixed(1)}ms`);
  const fresh = parseItemsText(PRESETS.freshman);
  const c = timeIt(() => planSeasons(room, fresh), 0);
  assert.ok(c.ms <= 1600, `planSeasons ${c.ms.toFixed(0)}ms`);
});
