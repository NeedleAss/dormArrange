// B4：同步率 computeSync + 第三话 换季 planSeasons / diffMonths + PRESETS.growth（docs/05 §6、§7、§10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, parseItemsText, planSeasons, diffMonths, computeSync, PRESETS, makeItem, scatterOnDesk,
  planFocusField } from '../src/planner/index.js';
import { insideZoneFor } from '../src/planner/seasons.js';
import { contains } from '../src/planner/geometry.js';
import { assertValidPlacements } from './helpers.js';

const room = buildRoom();
const items = parseItemsText(PRESETS.freshman);
const plan = planSeasons(room, items);
const byId = Object.fromEntries(items.map((it) => [it.id, it]));
const zoneById = new Map(room.zones.map((z) => [z.id, z]));

/** 本计划里所有 inside 分区（由各月锚点行李箱的 placement 生成） */
function insideZones(p) {
  const pls = p.byMonth[p.months[0]].placements;
  return items.filter((it) => it.flags.container && pls[it.id])
    .map((it) => insideZoneFor(it, pls[it.id], zoneById.get(pls[it.id].zoneId)));
}

test('每个月都没有重叠、不越界、不进 keepClear；inside 分区包含在行李箱盒子内', () => {
  const inz = insideZones(plan);
  assert.ok(inz.length >= 1);
  for (const z of inz) {
    const parent = plan.byMonth[9].placements[z.parentItemId];
    assert.ok(contains(parent.box, z.box), z.id);
  }
  for (const m of plan.months) assertValidPlacements(room, plan.byMonth[m].placements, inz);
});

test('当月不活跃的季节物品都在 tier 2 或 inside 分区；活跃的都在可达分区', () => {
  let storedCount = 0;
  for (const m of plan.months) {
    const bm = plan.byMonth[m];
    for (const it of items) {
      if (!it.months || it.months.length >= 12) continue;
      const p = bm.placements[it.id];
      if (!p) { assert.ok(bm.overflow.includes(it.id)); continue; }
      if (!it.months.includes(m)) {
        storedCount++;
        assert.ok(bm.stored.includes(it.id), `${m} 月 ${it.name}`);
        const z = zoneById.get(p.zoneId);
        assert.ok(p.zoneId.endsWith('.inside') || z.tier === 2, `${m} 月 ${it.name} 收在 ${p.zoneId}`);
      } else {
        assert.ok(bm.active.includes(it.id));
        assert.ok(!p.zoneId.endsWith('.inside'), `${m} 月 ${it.name} 在用却在箱内`);
      }
    }
  }
  assert.ok(storedCount > 0);
});

test('compare.on.maxFill ≤ compare.off.maxFill；off 计划没有箱内分区、不压缩', () => {
  assert.ok(plan.compare.on.maxFill <= plan.compare.off.maxFill, JSON.stringify(plan.compare));
  assert.ok(plan.compare.on.overflowMonths <= plan.compare.off.overflowMonths);
  const off = planSeasons(room, items, { tdm: false, compare: false });
  assert.equal(off.compare, undefined);
  for (const m of off.months) {
    for (const p of Object.values(off.byMonth[m].placements)) {
      assert.ok(!p.zoneId.endsWith('.inside'));
      assert.equal(p.compressed && !byId[p.itemId].flags.compressible, false);
    }
  }
});

test('稳定性：锚点全年不动；季节物品状态不变的相邻月份位置不变', () => {
  const ms = plan.months;
  for (let i = 1; i < ms.length; i++) {
    const A = plan.byMonth[ms[i - 1]], B = plan.byMonth[ms[i]];
    for (const it of items) {
      const pa = A.placements[it.id], pb = B.placements[it.id];
      if (!pa || !pb) continue;
      const seasonal = it.months && it.months.length < 12;
      const sameState = !seasonal || (A.active.includes(it.id) === B.active.includes(it.id));
      if (sameState) assert.deepEqual(pb, pa, `${ms[i - 1]}→${ms[i]} ${it.name}`);
    }
  }
});

test('matrix 形状正确且与 zoneFill 一致', () => {
  const { zoneIds, months, fill } = plan.matrix;
  assert.deepEqual(months, plan.months);
  assert.equal(fill.length, zoneIds.length);
  zoneIds.forEach((id, zi) => {
    assert.equal(fill[zi].length, months.length);
    months.forEach((m, mi) => assert.equal(fill[zi][mi], plan.byMonth[m].zoneFill[id] ?? 0));
    assert.ok(fill[zi].some((v) => v > 0));
  });
  assert.ok(zoneIds.some((id) => id.endsWith('.inside')), '箱内分区应出现在矩阵里');
});

test('diffMonths：10→11 月取出冬被和羽绒服，3→4 月收起，文案与形状正确', () => {
  const s1011 = diffMonths(plan.byMonth[10], plan.byMonth[11], items, room);
  const names = s1011.filter((s) => s.kind === 'retrieve').map((s) => byId[s.itemId].libId).sort();
  assert.deepEqual(names, ['down-jacket', 'quilt-winter']);
  const s34 = diffMonths(plan.byMonth[3], plan.byMonth[4], items, room);
  assert.ok(s34.some((s) => s.kind === 'store' && byId[s.itemId].libId === 'quilt-winter'));
  for (const s of [...s1011, ...s34]) {
    assert.ok(s.text.startsWith(`第 ${s.idx + 1} 步：`));
    if (s.kind === 'store' && s.toZoneId.endsWith('.inside')) assert.match(s.text, /行李箱里/);
    assert.ok(s.distance >= 0);
  }
  assert.deepEqual(diffMonths(plan.byMonth[12], plan.byMonth[1], items, room), []);
});

test('planSeasons 结果确定、不修改入参、≤ 800ms', () => {
  const snap = JSON.stringify(items);
  const t = performance.now();
  const again = planSeasons(room, items);
  const ms = performance.now() - t;
  assert.ok(ms <= 800, `planSeasons 用时 ${ms.toFixed(0)}ms`);
  assert.equal(JSON.stringify(again), JSON.stringify(plan));
  assert.equal(JSON.stringify(items), snap);
});

test('computeSync：0..100、三审与 notes、腾桌后不降', () => {
  const s = computeSync(room, items, {}, { moves: 7, decisions: 10, swaps: 9 });
  assert.ok(s.total >= 0 && s.total <= 100);
  assert.deepEqual(s.votes, { time: false, space: false, mind: true });
  assert.ok(s.notes.some((n) => n.startsWith('空：')));
  assert.ok(s.notes.some((n) => n.includes('超过 5 步')));
  const { items: mi, placements: mp } = PRESETS.messyDesk;
  const before = computeSync(room, mi, mp);
  assert.equal(before.votes.mind, false);
  assert.ok(before.notes.some((n) => n.startsWith('心：专注区里还有')));
  const after = computeSync(room, mi, planFocusField(room, mi, mp).placementsAfter);
  assert.ok(after.total >= before.total);
  // 堵通道扣 safety
  const box = makeItem('box-l', { id: 'blk' });
  const bad = { blk: { itemId: 'blk', zoneId: 'pub.entryL', box: { x: 140, y: 0, z: 10, w: 40, d: 40, h: 30 },
    rot: 0, lying: false, layer: 0, compressed: false } };
  const sb = computeSync(room, [box], bad);
  assert.equal(sb.parts.safety, 0.5);
  assert.equal(sb.votes.space, false);
});

test('PRESETS.growth：4 个快照，形状符合 Snapshot，同步率先降后升且与重算一致', () => {
  const g = PRESETS.growth;
  assert.equal(g.length, 4);
  assert.deepEqual(g.map((s) => s.label), ['大一上 · 入住', '大一下', '大二上 · 满桌', '大二上 · 腾桌后']);
  for (const s of g) {
    for (const k of ['id', 'label', 'semester', 'createdAt', 'roomParams', 'items', 'placements', 'sync', 'focusMinutes']) {
      assert.ok(k in s, `${s.id} 缺 ${k}`);
    }
    assert.ok(!Number.isNaN(Date.parse(s.createdAt)));
    assertValidPlacements(buildRoom(s.roomParams), s.placements);
    assert.equal(s.sync, computeSync(room, s.items, s.placements).total);
  }
  assert.ok(g[0].sync > g[2].sync && g[3].sync > g[2].sync, g.map((s) => s.sync).join('→'));
  assert.ok(g[1].sync < g[0].sync);
});

test('scatterOnDesk：东西堆在桌面前沿，作为 planFocusField 输入能腾干净', () => {
  const its = parseItemsText('零食箱，书20本，水杯，耳机，快递盒，台灯', { idPrefix: 'sc' });
  const pl = scatterOnDesk(room, its, { owner: 'A' });
  assert.ok(Object.values(pl).filter((p) => p.zoneId === 'A.desk').length >= 4);
  assertValidPlacements(room, pl);
  assert.equal(JSON.stringify(pl), JSON.stringify(scatterOnDesk(room, its, { owner: 'A' })));
  const fp = planFocusField(room, its, pl);
  assert.ok(fp.conflicts.length >= 2);
  assertValidPlacements(room, fp.placementsAfter);
  assert.ok(fp.metrics.syncAfter >= fp.metrics.syncBefore);
});

test('predictGrowth：每学期 +5 本书，书架在某学期满；形状符合 GrowthForecast；结果确定', async () => {
  const { predictGrowth } = await import('../src/planner/index.js');
  const g = predictGrowth(items, room);
  assert.deepEqual(g.semesters, ['Y1-F', 'Y1-S', 'Y2-F', 'Y2-S', 'Y3-F', 'Y3-S', 'Y4-F', 'Y4-S']);
  for (const arr of Object.values(g.fill)) {
    assert.equal(arr.length, 8);
    assert.ok(arr.every((v) => v >= 0 && v <= 1));
  }
  assert.ok(g.fill['A.hutch'][7] >= g.fill['A.hutch'][0]);
  assert.ok(g.firstOverflow && g.semesters.includes(g.firstOverflow.semester));
  assert.match(g.text, /\+5 本书/);
  assert.equal(JSON.stringify(predictGrowth(items, room)), JSON.stringify(g));
  const none = predictGrowth([makeItem('lamp', { id: 'l' })], room, { semesters: 2 });
  assert.equal(none.firstOverflow, null);
  assert.equal(none.semesters.length, 2);
});
