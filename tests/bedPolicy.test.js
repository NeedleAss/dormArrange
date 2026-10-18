// 床面全局约束回归：床面与同高度床尾只能放床品，历史位置、偏好和箱内分区都不能绕过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoom, makeItem, LIBRARY, parseItemsText, planMoveIn, planFocusField, applySteps,
  planSeasons, diffMonths, scatterOnDesk, computeSync, PRESETS
} from '../src/planner/index.js';
import { AFFINITY, hardOk } from '../src/planner/rank.js';
import { intersects } from '../src/planner/geometry.js';
import { assertValidPlacements } from './helpers.js';

const TEMPLATES = ['thu-4p-loft', 'nanqu', 'nanqu1'];
const OWNERS = ['A', 'B', 'C', 'D'];
const BED_SLOTS = ['bed', 'bedFoot'];
const ORDINARY = ['luggage', 'clothes', 'books', 'study', 'electronics', 'appliance',
  'toiletry', 'storage', 'food', 'sport', 'decor', 'misc', 'trash'];
const LIBRARY_CATEGORIES = new Map(LIBRARY.map((item) => [item.libId, item.category]));
const isBedding = (item) => item?.libId === 'bed-curtain' ||
  (LIBRARY_CATEGORIES.get(item?.libId) ?? item?.category) === 'bedding';

/** 保留真实库尺寸的测试用例之外，5cm物件用来证明拒绝来自床面规则，而非尺寸放不下。 */
function small(category, id = category, owner = 'A', extra = {}) {
  return makeItem('cup', {
    id, owner, name: `普通${category}物品`, category, libId: undefined,
    size: { w: 5, d: 5, h: 5 }, sizeSource: 'product', freq: 'daily',
    preferred: ['bed', 'bedFoot'], flags: { focusTool: false, disposable: false }, ...extra
  });
}

/** 用真实分区构造旧位置；不伪造高度，不修改物件尺寸。 */
function oldPlacement(room, item, zoneId) {
  const z = room.zones.find((zone) => zone.id === zoneId);
  return { itemId: item.id, zoneId, box: { x: z.box.x, y: z.box.y, z: z.box.z, ...item.size },
    rot: 0, lying: false, layer: 0, compressed: false };
}

/** 同时核对分区名、物理床体积及容器父链，避免“改名为inside”将物品藏到床上。 */
function assertBedPolicy(room, items, placements, label = '') {
  const byId = new Map(items.map((item) => [item.id, item]));
  const zones = new Map(room.zones.map((zone) => [zone.id, zone]));
  const beds = room.zones.filter((zone) => BED_SLOTS.includes(zone.slot));
  for (const p of Object.values(placements)) {
    const it = byId.get(p.itemId);
    assert.ok(it, `${label} ${p.itemId} 没有对应物品`);
    if (isBedding(it)) continue;
    assert.ok(!BED_SLOTS.includes(zones.get(p.zoneId)?.slot), `${label} ${it.name} 落到 ${p.zoneId}`);
    assert.ok(!beds.some((bed) => intersects(bed.box, p.box)), `${label} ${it.name} 的物理盒仍位于床上`);
    let current = p;
    const visited = new Set();
    while (current.zoneId.endsWith('.inside')) {
      const parentId = current.zoneId.slice(0, -'.inside'.length);
      assert.ok(!visited.has(parentId), `${label} 箱内父链循环`);
      visited.add(parentId);
      const parent = placements[parentId];
      assert.ok(parent, `${label} ${current.itemId} 的容器没有合法位置`);
      assert.ok(!BED_SLOTS.includes(zones.get(parent.zoneId)?.slot), `${label} ${it.name} 的容器仍在床上`);
      current = parent;
    }
  }
}

/** 测试只需父箱包围盒验证inside不越界，父子重叠由公共不变量工具明确允许。 */
function assertLayout(room, items, placements, label) {
  assertBedPolicy(room, items, placements, label);
  const inside = [...new Set(Object.values(placements).map((p) => p.zoneId).filter((id) => id.endsWith('.inside')))]
    .map((id) => ({ id, kind: 'inside', parentItemId: id.slice(0, -'.inside'.length),
      box: placements[id.slice(0, -'.inside'.length)].box }));
  assertValidPlacements(room, placements, inside);
}

for (const templateId of TEMPLATES) for (const owner of OWNERS) {
  test(`${templateId}/${owner}：bed与bedFoot拒绝所有普通类别，旧accepts及强制preferred不能放行`, () => {
    const room = buildRoom({ templateId });
    for (const slot of BED_SLOTS) {
      const z = room.zones.find((zone) => zone.id === `${owner}.${slot}`);
      assert.deepEqual(z.accepts, ['bedding']);
      for (const category of ORDINARY) {
        const it = small(category, `${owner}-${slot}-${category}`, owner);
        for (const accepts of [[category], ['*']]) {
          assert.equal(hardOk(it, { ...z, accepts }), false, `${category}/${accepts}`);
        }
      }
      const legacy = structuredClone(room);
      legacy.zones.find((zone) => zone.id === z.id).accepts = ['*'];
      const items = ORDINARY.filter((category) => category !== 'trash').map((category) => small(category, `${owner}-${category}`, owner));
      const lockedZones = room.zones.filter((zone) => zone.id !== z.id).map((zone) => zone.id);
      const report = planMoveIn(legacy, items, { owner, lockedZones });
      assert.deepEqual(report.placements, {});
      assert.equal(report.summary.overflow, items.length);
      assert.equal(report.overflowIds.length, items.length);
      for (const it of items) {
        assert.equal(report.verdicts[it.id].status, 'overflow');
        assert.ok(report.verdicts[it.id].reasons.length > 0);
      }
    }
  });

  test(`${templateId}/${owner}：真实被子、枕头和床帘仍可放床，decor不因床帘例外全部放行`, () => {
    const room = buildRoom({ templateId });
    for (const slot of BED_SLOTS) {
      const z = room.zones.find((zone) => zone.id === `${owner}.${slot}`);
      for (const libId of ['quilt-winter', 'quilt-summer', 'pillow', 'bed-curtain']) {
        const it = makeItem(libId, { id: libId, owner });
        assert.equal(hardOk(it, z, { skipSize: true }), true, `${libId}@${slot}`);
      }
      assert.equal(hardOk(small('decor', 'ordinary-decor', owner, { name: '装饰摆件' }), z), false);
      assert.equal(hardOk(makeItem('box-l', { owner, category: 'bedding', preferred: ['bed'] }), z, { skipSize: true }), false,
        '已知收纳箱不能靠伪装bedding类别占床');
      const fakeCurtain = small('decor', 'fake-curtain', owner, { name: '床帘' });
      assert.equal(hardOk(fakeCurtain, z, { skipSize: true }), false, 'decor名称不能替代精确libId白名单');
    }
    for (const libId of ['quilt-winter', 'quilt-summer', 'pillow', 'bed-curtain']) {
      const it = makeItem(libId, { id: libId, owner });
      const lockedZones = room.zones.filter((z) => z.id !== `${owner}.bed`).map((z) => z.id);
      const report = planMoveIn(room, [it], { owner, lockedZones });
      assert.equal(report.placements[it.id]?.zoneId, `${owner}.bed`, libId);
      assertLayout(room, [it], report.placements, libId);
    }
  });
}

test('床单、被套、枕套、床褥按床品解析；床头柜和床边收纳筐不因名称含床而放行', () => {
  for (const name of ['床单', '被套', '枕套', '床褥']) {
    const items = parseItemsText(name);
    assert.equal(items.length, 1, name);
    assert.equal(items[0].category, 'bedding', name);
    const room = buildRoom();
    const report = planMoveIn(room, items, { lockedZones: room.zones.filter((z) => z.id !== 'A.bed').map((z) => z.id) });
    assert.equal(report.placements[items[0].id]?.zoneId, 'A.bed', name);
  }
  for (const name of ['床头柜', '床边收纳筐', '床单收纳袋', '被子收纳袋', '枕套收纳袋', '床垫清洁剂', '床单夹']) {
    const [it] = parseItemsText(name);
    assert.ok(it, name);
    assert.notEqual(it.category, 'bedding', name);
    assert.equal(hardOk(it, { ...buildRoom().zones.find((z) => z.id === 'A.bed'), accepts: ['*'] }, { skipSize: true }), false);
  }
  for (const it of LIBRARY) if (!isBedding(it)) {
    assert.ok(!it.preferred?.some((slot) => BED_SLOTS.includes(slot)), `${it.libId} 仍偏好床面`);
  }
  for (const category of ORDINARY) {
    assert.ok(!AFFINITY[category]?.some((slot) => BED_SLOTS.includes(slot)), `${category} 仍将床作为亲和落点`);
  }
});

for (const templateId of TEMPLATES) test(`${templateId}：合法床外容器及inside内容恢复时原位保留，锁区不引发额外移动`, () => {
  const room = buildRoom({ templateId });
  const box = makeItem('luggage-24', { id: 'legitimate-case' });
  const inner = small('clothes', 'legitimate-inside', 'A', { months: [1] });
  const items = [box, inner];
  const month = planSeasons(room, items, { months: [7], tdm: true, compare: false }).byMonth[7];
  const existing = month.placements;
  assert.ok(existing[box.id]);
  assert.equal(existing[inner.id]?.zoneId, `${box.id}.inside`);
  assertLayout(room, items, existing, '原合法箱内布局');
  const before = structuredClone({ room, items, existing });
  for (const lockedZones of [[], [existing[box.id].zoneId]]) {
    const report = planMoveIn(room, items, { existing, lockedZones });
    assert.deepEqual(report.placements, existing);
    assert.equal(report.summary.overflow, 0);
    assert.deepEqual(report.overflowIds, []);
    for (const item of items) assert.equal(report.verdicts[item.id].zoneId, existing[item.id].zoneId);
    assertLayout(room, items, report.placements, '保留合法箱内布局');
    assert.deepEqual(planMoveIn(room, items, { existing, lockedZones }), report);
  }
  assert.deepEqual({ room, items, existing }, before);
});

for (const templateId of TEMPLATES) {
  test(`${templateId}：入住修复旧床位并保留其他合法位置，锁定旧违规床位时明确overflow`, () => {
    const room = buildRoom({ templateId });
    const ordinary = small('storage', 'old-storage');
    const retained = small('study', 'retained-study', 'A', { preferred: ['hutch'] });
    const items = [ordinary, retained];
    const existing = { [ordinary.id]: oldPlacement(room, ordinary, 'A.bedFoot'),
      [retained.id]: oldPlacement(room, retained, 'A.hutch') };
    const before = structuredClone({ room, items, existing });
    const fixed = planMoveIn(room, items, { existing });
    assert.ok(fixed.placements[ordinary.id]);
    assert.deepEqual(fixed.placements[retained.id], existing[retained.id]);
    assert.equal(fixed.verdicts[ordinary.id].zoneId, fixed.placements[ordinary.id].zoneId);
    assertLayout(room, items, fixed.placements, '修复后');
    assert.deepEqual(planMoveIn(room, items, { existing }), fixed);
    const locked = planMoveIn(room, items, { existing, lockedZones: ['A.bedFoot'] });
    assert.ok(!locked.placements[ordinary.id]);
    assert.equal(locked.verdicts[ordinary.id].status, 'overflow');
    assert.ok(locked.overflowIds.includes(ordinary.id));
    assert.match(locked.verdicts[ordinary.id].reasons.join(' '), /床|锁/u);
    assert.deepEqual(locked.placements[retained.id], existing[retained.id]);
    assert.deepEqual({ room, items, existing }, before);
  });

  test(`${templateId}：床外无容量不能用床兜底；旧床违规使安全审查否决`, () => {
    const room = buildRoom({ templateId });
    const item = makeItem('luggage-24', { id: 'old-luggage' });
    const old = { [item.id]: oldPlacement(room, item, 'A.bedFoot') };
    const lockedZones = room.zones.filter((z) => !BED_SLOTS.includes(z.slot)).map((z) => z.id);
    const report = planMoveIn(room, [item], { existing: old, lockedZones });
    assert.deepEqual(report.placements, {});
    assert.equal(report.verdicts[item.id].status, 'overflow');
    assert.ok(report.overflowIds.includes(item.id));
    const sync = computeSync(room, [item], old);
    assert.ok(sync.parts.safety < 1);
    assert.equal(sync.votes.space, false);
    assert.ok(sync.notes.some((note) => /床/u.test(note)));
  });

  test(`${templateId}：腾桌修复旧床违规；锁区、容量不足与危险品都明确unresolved`, () => {
    const room = buildRoom({ templateId });
    const item = small('storage', 'old-storage');
    const placements = { [item.id]: oldPlacement(room, item, 'A.bed') };
    const before = structuredClone(placements);
    const plan = planFocusField(room, [item], placements);
    assert.equal(plan.unresolved.length, 0);
    assert.ok(plan.steps.some((step) => step.itemId === item.id));
    assertLayout(room, [item], plan.placementsAfter, '腾桌修复');
    assert.deepEqual(applySteps(placements, plan.steps), plan.placementsAfter);
    for (const lockedZones of [['A.bed'], room.zones.filter((z) => !BED_SLOTS.includes(z.slot)).map((z) => z.id)]) {
      const blocked = planFocusField(room, [item], placements, {}, { lockedZones });
      assert.deepEqual(blocked.placementsAfter[item.id], placements[item.id]);
      assert.ok(!blocked.steps.some((step) => step.itemId === item.id));
      assert.ok(blocked.unresolved.some((entry) => entry.itemId === item.id && /床|锁|空间/u.test(entry.reason)));
    }
    const dangerous = { ...item, name: '打火机' };
    const safety = planFocusField(room, [dangerous], placements);
    assert.deepEqual(safety.placementsAfter, placements);
    assert.equal(safety.steps.length, 0);
    assert.ok(safety.unresolved.some((entry) => entry.itemId === item.id));
    assert.deepEqual(placements, before);
  });

  test(`${templateId}：scatter不能静默沿用已有床违规，合法障碍物保持不动`, () => {
    const room = buildRoom({ templateId });
    const item = small('storage', 'bad-existing');
    const valid = small('study', 'good-existing');
    const bad = { [item.id]: oldPlacement(room, item, 'A.bed') };
    assert.throws(() => scatterOnDesk(room, [item], { existing: bad }), /床|planMoveIn|入住/u);
    const existing = { [valid.id]: oldPlacement(room, valid, 'A.hutch') };
    const before = structuredClone(existing);
    const scattered = scatterOnDesk(room, [item], { existing, existingItems: [valid] });
    assertLayout(room, [item, valid], { ...existing, ...scattered }, 'scatter');
    assert.deepEqual(existing, before);
  });

  for (const tdm of [false, true]) test(`${templateId}：换季tdm=${tdm}全年12月无普通物件落床，箱内与压缩不可绕过`, () => {
    const room = buildRoom({ templateId });
    const items = parseItemsText(PRESETS.freshman);
    const before = structuredClone({ room, items });
    const plan = planSeasons(room, items, { tdm, compare: false });
    assert.equal(plan.months.length, 12);
    for (const month of plan.months) {
      const result = plan.byMonth[month];
      assertLayout(room, items, result.placements, `${month}月`);
      for (const item of items) {
        const placed = result.placements[item.id];
        if (!placed && !item.flags?.disposable && item.category !== 'trash') assert.ok(result.overflow.includes(item.id), `${month}月${item.name}未列滞留`);
        if (!placed) assert.ok(!result.active.includes(item.id) && !result.stored.includes(item.id));
      }
    }
    assert.deepEqual(planSeasons(room, items, { tdm, compare: false }), plan);
    assert.deepEqual({ room, items }, before);
  });

  test(`${templateId}：入住与互动乱桌每个腾桌步骤终点均合法，结果确定且输入不变`, () => {
    const room = buildRoom({ templateId });
    const fresh = parseItemsText(PRESETS.freshman);
    assertLayout(room, fresh, planMoveIn(room, fresh).placements, '新生');
    const items = parseItemsText('书20本，水杯，耳机，快递盒，台灯', { idPrefix: 'bed-interactive' });
    const placements = scatterOnDesk(room, items);
    const before = structuredClone({ room, items, placements });
    const plan = planFocusField(room, items, placements);
    for (let i = 0; i <= plan.steps.length; i++) assertLayout(room, items, applySteps(placements, plan.steps, i), `前${i}步`);
    assert.deepEqual(planFocusField(room, items, placements), plan);
    assert.deepEqual({ room, items, placements }, before);
  });
}

test('默认乱桌全步骤与成长所有快照无床尾行李箱，保留物品与真实同步率', () => {
  const room = buildRoom();
  const { items, placements } = PRESETS.messyDesk;
  assertLayout(room, items, placements, '默认乱桌');
  const plan = planFocusField(room, items, placements);
  for (let i = 0; i <= plan.steps.length; i++) assertLayout(room, items, applySteps(placements, plan.steps, i), `默认前${i}步`);
  assert.deepEqual(applySteps(placements, plan.steps), plan.placementsAfter);
  const disposed = new Set(plan.steps.filter((s) => s.kind === 'dispose').map((s) => s.itemId));
  for (const item of items) if (!disposed.has(item.id)) assert.ok(plan.placementsAfter[item.id], `未处理的${item.name}不能消失`);
  for (const snapshot of PRESETS.growth) {
    const snapshotRoom = buildRoom(snapshot.roomParams);
    assertLayout(snapshotRoom, snapshot.items, snapshot.placements, snapshot.label);
    assert.equal(snapshot.sync, computeSync(snapshotRoom, snapshot.items, snapshot.placements).total);
  }
});

test('旧床上容器及其inside内容必须一起校验，不能保留箱内普通物件间接占床', () => {
  const room = buildRoom();
  const box = makeItem('luggage-24', { id: 'bed-case' });
  const inner = small('clothes', 'inner');
  const retained = makeItem('pillow', { id: 'good-pillow' });
  const parent = oldPlacement(room, box, 'A.bedFoot');
  const existing = { [box.id]: parent,
    [inner.id]: { ...parent, itemId: inner.id, zoneId: `${box.id}.inside`, box: { ...parent.box, ...inner.size } },
    [retained.id]: oldPlacement(room, retained, 'A.bed') };
  const items = [box, inner, retained];
  const before = structuredClone({ items, existing });
  const fixed = planMoveIn(room, items, { existing });
  assertLayout(room, items, fixed.placements, '修复床上箱内');
  assert.deepEqual(fixed.placements[retained.id], existing[retained.id]);
  for (const it of [box, inner]) assert.ok(fixed.placements[it.id] || fixed.overflowIds.includes(it.id));
  const focus = planFocusField(room, items, existing);
  for (const it of [box, inner]) {
    const unresolved = focus.unresolved.some((entry) => entry.itemId === it.id);
    assert.ok(unresolved || (focus.placementsAfter[it.id] && !BED_SLOTS.includes(focus.placementsAfter[it.id].zoneId.split('.').at(-1))));
  }
  const allowed = Object.fromEntries(Object.entries(focus.placementsAfter).filter(([id]) => !focus.unresolved.some((entry) => entry.itemId === id)));
  assertBedPolicy(room, items, allowed, '腾桌箱内');
  assert.deepEqual({ items, existing }, before);
});

test('旧位置伪造非床zoneId不能保留实际床上盒子，腾桌也必须检查物理床面', () => {
  const room = buildRoom();
  const item = small('storage', 'disguised-bed-item');
  const forged = { ...oldPlacement(room, item, 'A.bed'), zoneId: 'A.hutch' };
  const existing = { [item.id]: forged };
  const before = structuredClone(existing);
  const report = planMoveIn(room, [item], { existing });
  assert.ok(report.placements[item.id] || report.overflowIds.includes(item.id));
  assertLayout(room, [item], report.placements, '假分区入住');
  const plan = planFocusField(room, [item], existing);
  assert.equal(plan.unresolved.length, 0);
  assert.ok(plan.steps.some((step) => step.itemId === item.id));
  assertLayout(room, [item], plan.placementsAfter, '假分区腾桌');
  assert.deepEqual(existing, before);
});

test('diffMonths拒绝旧目标月的床违规，不能通过换季步骤重新引入床尾行李箱', () => {
  const room = buildRoom();
  const item = makeItem('luggage-24', { id: 'legacy-month-case' });
  const old = { [item.id]: oldPlacement(room, item, 'A.bedFoot') };
  const current = { placements: {}, active: [], stored: [], overflow: [item.id], zoneFill: {} };
  const target = { placements: old, active: [], stored: [item.id], overflow: [], zoneFill: {} };
  const before = structuredClone({ current, target });
  assert.throws(() => diffMonths(current, target, [item], room), /床|planSeasons|重新/u);
  assert.deepEqual({ current, target }, before);
});

test('修复床上普通支撑箱不能让上方床品悬空；锁定床面时两者都明确未解决', () => {
  const room = buildRoom();
  const box = makeItem('box-m', { id: 'illegal-bed-support' });
  const pillow = makeItem('pillow', { id: 'supported-pillow' });
  const support = oldPlacement(room, box, 'A.bed');
  const upper = oldPlacement(room, pillow, 'A.bed');
  upper.box.y = support.box.y + support.box.h;
  upper.layer = 1;
  const items = [box, pillow];
  const existing = { [box.id]: support, [pillow.id]: upper };
  assertValidPlacements(room, existing);
  const before = structuredClone({ items, existing });
  const report = planMoveIn(room, items, { existing });
  assertLayout(room, items, report.placements, '入住支撑修复');
  assert.ok(report.placements[pillow.id] || report.overflowIds.includes(pillow.id));
  if (report.placements[pillow.id]) {
    const p = report.placements[pillow.id];
    const z = room.zones.find((zone) => zone.id === p.zoneId);
    assert.equal(p.box.y, z.box.y, '上方枕头应重新落到真实平面，不能留在原箱顶高度');
  }
  const plan = planFocusField(room, items, existing);
  assert.equal(plan.unresolved.length, 0);
  assertLayout(room, items, plan.placementsAfter, '腾桌支撑修复');
  const p = plan.placementsAfter[pillow.id];
  assert.equal(p.box.y, room.zones.find((zone) => zone.id === p.zoneId).box.y);
  const lowerStep = plan.steps.findIndex((step) => step.itemId === box.id);
  const upperStep = plan.steps.findIndex((step) => step.itemId === pillow.id);
  assert.ok(upperStep >= 0 && lowerStep > upperStep, '必须先移动上方床品，再抽走违规箱');
  for (let i = 1; i <= plan.steps.length; i++) assertValidPlacements(room, applySteps(existing, plan.steps, i));
  const locked = planFocusField(room, items, existing, {}, { lockedZones: ['A.bed'] });
  assert.deepEqual(locked.placementsAfter, existing);
  assert.equal(locked.steps.length, 0);
  for (const item of items) assert.ok(locked.unresolved.some((entry) => entry.itemId === item.id));
  assert.deepEqual({ items, existing }, before);
});

test('违规床上箱的inside内容继承锁区，不静默移出锁定床位', () => {
  const room = buildRoom();
  const box = makeItem('luggage-24', { id: 'locked-bed-case' });
  const inner = small('clothes', 'locked-inner');
  const parent = oldPlacement(room, box, 'A.bedFoot');
  const child = { ...parent, itemId: inner.id, zoneId: `${box.id}.inside`, box: { ...parent.box, ...inner.size } };
  const items = [box, inner];
  const existing = { [box.id]: parent, [inner.id]: child };
  const before = structuredClone(existing);
  const report = planMoveIn(room, items, { existing, lockedZones: ['A.bedFoot'] });
  for (const item of items) {
    assert.ok(!report.placements[item.id]);
    assert.equal(report.verdicts[item.id].status, 'overflow');
    assert.ok(report.overflowIds.includes(item.id));
    assert.match(report.verdicts[item.id].reasons.join(' '), /锁/u);
  }
  const plan = planFocusField(room, items, existing, {}, { lockedZones: ['A.bedFoot'] });
  assert.deepEqual(plan.placementsAfter, existing);
  assert.equal(plan.steps.length, 0);
  for (const item of items) assert.ok(plan.unresolved.some((entry) => entry.itemId === item.id && /锁/u.test(entry.reason)));
  assert.deepEqual(existing, before);
});

test('安全拦截父箱后inside子物不得保留无父位置，锁定祖先时仍明确安全冲突', () => {
  const room = buildRoom();
  const box = { ...makeItem('luggage-24', { id: 'blocked-parent-case' }),
    safety: { status: 'blocked', reason: '容器受到危险化学品污染，核实前禁止安排' } };
  const inner = small('clothes', 'blocked-parent-content');
  const parent = oldPlacement(room, box, 'A.underDesk');
  const child = { ...parent, itemId: inner.id, zoneId: `${box.id}.inside`,
    box: { x: parent.box.x + 2, y: parent.box.y + 2.5, z: parent.box.z + 2, ...inner.size } };
  const items = [box, inner];
  const existing = { [box.id]: parent, [inner.id]: child };
  const before = structuredClone({ room, items, existing });
  for (const lockedZones of [[], ['A.underDesk']]) {
    const report = planMoveIn(room, items, { existing, lockedZones });
    assert.equal(report.verdicts[box.id].status, 'banned');
    assert.ok(!report.placements[box.id]);
    assert.equal(report.verdicts[inner.id].status, 'overflow');
    assert.ok(!report.placements[inner.id], '父箱被安全拦截时，子物不能保留悬空inside位置或自动绕过安全处理');
    assert.ok(report.overflowIds.includes(inner.id));
    assert.match(report.verdicts[inner.id].reasons.join(' '), /安全|禁用|拦截/u);
    assert.deepEqual(planMoveIn(room, items, { existing, lockedZones }), report);
    assert.deepEqual({ room, items, existing }, before, '不能静默修改既有位置或锁区');
  }
});

test('入住新候选inside继承父容器锁区，不能通过未直接锁定的箱内分区绕过', () => {
  const room = buildRoom();
  const box = makeItem('luggage-24', { id: 'locked-candidate-case' });
  const inner = small('clothes', 'new-inside-candidate', 'A', { preferred: ['inside'] });
  const parent = oldPlacement(room, box, 'A.underDesk');
  const inside = { id: `${box.id}.inside`, slot: 'inside', label: '锁定箱内', owner: 'A', kind: 'inside',
    parentItemId: box.id, front: '+x', tier: 2, accepts: ['clothes'], stackable: true,
    box: { x: parent.box.x + 2, y: parent.box.y + 2.5, z: parent.box.z + 2, w: 38, d: 22, h: 61 } };
  const roomPlus = { ...room, zones: [...room.zones, inside] };
  const items = [box, inner];
  const existing = { [box.id]: parent };
  // 只剩inside未直接列入锁区；父箱所在桌下已锁，箱内也必须拒绝新增物品。
  const lockedZones = room.zones.map((zone) => zone.id);
  const before = structuredClone({ roomPlus, items, existing, lockedZones });
  const report = planMoveIn(roomPlus, items, { existing, lockedZones });
  assert.deepEqual(report.placements[box.id], parent, '合法既有父箱保持原位');
  assert.ok(!report.placements[inner.id], '锁定祖先应阻止箱内新增落点');
  assert.equal(report.verdicts[inner.id].status, 'overflow');
  assert.ok(report.overflowIds.includes(inner.id));
  assert.deepEqual(planMoveIn(roomPlus, items, { existing, lockedZones }), report);
  assert.deepEqual({ roomPlus, items, existing, lockedZones }, before);
});
