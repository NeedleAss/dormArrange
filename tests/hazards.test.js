// 危险品回归：导入后的物品必须统一过规则，分类、功率和收纳路径不能绕过安全门。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoom, checkRules, computeSync, makeItem, parseItemsText,
  planMoveIn, planFocusField, planSeasons, scatterOnDesk, PRESETS
} from '../src/planner/index.js';
import { assertValidPlacements } from './helpers.js';

const TEMPLATES = ['thu-4p-loft', 'nanqu', 'nanqu1'];
const DANGEROUS_NAMES = [
  '打火机', '点火石', '打火石', '镁棒', '火柴', '蜡烛',
  '汽油', '煤油', '丁烷气罐', '酒精燃料', '烟花', '爆竹',
  '强酸', '强碱', '浓硫酸', '氰化物', '毒害品'
];

/** 只使用现有 Item 字段；模拟 AI 将非电器危险品解析成小件杂物。 */
function smallItem(name, id = 'hazard-001', overrides = {}) {
  return {
    id, name, category: 'misc', size: { w: 3, d: 2, h: 8 },
    sizeSource: 'product', freq: 'daily', owner: 'A', powerW: 0,
    flags: {
      stackable: false, canBearLoad: false, rotatable: true, canLieDown: false,
      hangable: false, fragile: false, focusTool: false, disposable: false
    },
    ...overrides
  };
}

/** 构造真实已在专注区里的危险品，验证腾桌不能把它藏进其他收纳区。 */
function onFocus(room, item) {
  const { focusBox } = planFocusField(room, [], {});
  return {
    itemId: item.id, zoneId: 'A.desk',
    box: {
      x: focusBox.x + (focusBox.w - item.size.w) / 2,
      y: focusBox.y,
      z: focusBox.z + (focusBox.d - item.size.d) / 2,
      ...item.size
    },
    rot: 0, lying: false, layer: 0, compressed: false
  };
}

for (const name of DANGEROUS_NAMES) {
  test(`通用安全规则：${name} 即使是零功率杂物也禁入`, () => {
    const item = smallItem(name);
    const before = structuredClone(item);
    const result = checkRules(item);
    assert.equal(result.banned, true, name);
    assert.ok(result.ruleId, '禁用结果需要可追溯的规则编号');
    assert.match(result.reason, /[\u4e00-\u9fff]/u, '必须提供中文原因');
    assert.deepEqual(checkRules(item), result);
    assert.deepEqual(item, before);
  });
}

for (const name of ['打 火 机', '打\u3000火\u3000石', '打\u200b火\u200d机\ufeff', 'ＬＩＧＨＴＥＲ']) {
  test(`安全匹配规范化：${JSON.stringify(name)}`, () => {
    assert.equal(checkRules(smallItem(name)).banned, true);
    const parsed = parseItemsText(name);
    assert.equal(parsed.length, 1);
    assert.equal(checkRules(parsed[0]).banned, true, '离线导入也必须命中');
  });
}

for (const name of ['LED电子蜡烛（无火）', '打火机保护套', '打火石科普书', '烟花爆竹科普书', '酒精棉片', 'highlighter']) {
  test(`安全相似名称：${name} 不误禁`, () => {
    const item = smallItem(name);
    assert.equal(checkRules(item).banned, false);
    const parsed = parseItemsText(name);
    assert.ok(parsed.length > 0);
    assert.ok(parsed.every((it) => !checkRules(it).banned));
  });
}

test('含真实火柴的收纳盒不能用“收纳盒”名称豁免', () => {
  assert.equal(checkRules(smallItem('火柴收纳盒（内含真火柴）')).banned, true);
});

for (const name of ['打火机保护套（内含打火机）', 'LED电子蜡烛（无火）附带打火机']) {
  test(`安全名称豁免仅限配件本身：${name} 仍含危险物`, () => {
    assert.equal(checkRules(smallItem(name)).banned, true);
  });
}

test('库物品身份、低功率和学习工具标志不能豁免真实危险物', () => {
  const fakeLamp = makeItem('lamp', {
    id: 'fake-lamp', name: '打火机', category: 'misc', powerW: 1,
    flags: { focusTool: true, disposable: true }
  });
  assert.equal(checkRules(fakeLamp).banned, true);
  assert.equal(checkRules(smallItem('台灯', 'hidden-lighter', { libId: 'lighter' })).banned, true);
  assert.equal(checkRules(makeItem('lamp')).banned, false);
  assert.equal(checkRules(makeItem('cup')).banned, false);
});

test('离线解析跳过明确不携带的分句，保留其他分句的真实危险品且不伪造 AI 结论', () => {
  const items = parseItemsText('不带打火机，不携带点火石，没有汽油，只带台灯，另外还有火柴');
  assert.equal(items.length, 2);
  assert.ok(items.some((it) => it.libId === 'lamp'));
  assert.ok(items.some((it) => it.name === '火柴' && checkRules(it).banned));
  assert.ok(items.every((it) => !Object.hasOwn(it, 'safety')));
});

test('AI blocked 与 review 均保守拦截陌生物品，原因必须区分明确危险与待核实', () => {
  const blocked = smallItem('未知物件甲', 'blocked', {
    safety: { status: 'blocked', reason: '识别到该物件含有易燃组分' }
  });
  const review = smallItem('未知物件乙', 'review', {
    safety: { status: 'review', reason: '成分和用途尚未确认' }
  });
  const blockedResult = checkRules(blocked);
  const reviewResult = checkRules(review);
  assert.equal(blockedResult.banned, true);
  assert.equal(reviewResult.banned, true);
  assert.match(blockedResult.reason, /AI.*拦截|明确.*拦截/u);
  assert.match(reviewResult.reason, /待核实/u);
  assert.ok(blockedResult.reason.includes(blocked.safety.reason));
  assert.ok(reviewResult.reason.includes(review.safety.reason));
  assert.notEqual(blockedResult.reason, reviewResult.reason);
});

test('AI clear 只允许普通物品，不能覆盖火种、校规电器或功率规则', () => {
  const safety = { status: 'clear', reason: 'AI 未发现风险' };
  for (const item of [
    smallItem('打火机', 'fire', { safety }),
    smallItem('电饭锅', 'cooker', { safety }),
    smallItem('台灯', 'overpower', { safety, powerW: 1500 })
  ]) {
    assert.equal(checkRules(item).banned, true, item.name);
  }
  const safe = makeItem('cup', { safety });
  assert.equal(checkRules(safe).banned, false);
  const report = planMoveIn(buildRoom(), [safe]);
  assert.notEqual(report.verdicts[safe.id].status, 'banned');
  assert.ok(report.placements[safe.id]);
});

for (const safety of [
  {},
  { status: 'allow', reason: '通过' },
  { status: 'clear' },
  { status: 'clear', reason: '' },
  { status: 'clear', reason: '\u3000 ' },
  { status: 'clear', reason: 42 },
  { status: 'blocked', reason: '' },
  { status: 'review', reason: '' }
]) {
  test(`AI 安全字段非法或缺少有效原因时不放行：${JSON.stringify(safety)}`, () => {
    const item = smallItem('未知物件', 'invalid-safety', { safety });
    const before = structuredClone(item);
    const result = checkRules(item);
    assert.equal(result.banned, true);
    assert.match(result.reason, /未取得有效|核实|拦截/u);
    assert.deepEqual(item, before);
  });
}

for (const templateId of TEMPLATES) {
  test(`${templateId}：文本导入的危险品被入住拒绝，原因明确且不分配位置`, () => {
    const room = buildRoom({ templateId });
    const items = parseItemsText('打火机，点火石，丁烷气罐，烟花，强酸');
    assert.equal(items.length, 5);
    const before = structuredClone({ room, items });
    const report = planMoveIn(room, items);
    assert.deepEqual(report.placements, {});
    assert.equal(report.summary.banned, items.length);
    assert.equal(report.summary.total, items.length);
    for (const it of items) {
      const verdict = report.verdicts[it.id];
      assert.equal(verdict.status, 'banned');
      assert.ok(verdict.reasons.length > 0);
      assert.ok(verdict.suggestions.length > 0);
      assert.ok(!report.placements[it.id]);
    }
    assert.deepEqual(planMoveIn(room, items), report);
    assert.deepEqual({ room, items }, before);
  });

  test(`${templateId}：已有危险品也不能由 existing 路径重新获准入住`, () => {
    const room = buildRoom({ templateId });
    const item = smallItem('打火机');
    const existing = { [item.id]: onFocus(room, item) };
    const before = structuredClone(existing);
    const report = planMoveIn(room, [item], { existing });
    assert.equal(report.verdicts[item.id].status, 'banned');
    assert.ok(!report.placements[item.id]);
    assert.deepEqual(existing, before);
  });

  test(`${templateId}：乱桌和换季均不生成危险品位置`, () => {
    const room = buildRoom({ templateId });
    const danger = smallItem('打火石', 'danger', { months: [1] });
    const safe = makeItem('cup', { id: 'safe-cup' });
    const items = [danger, safe];
    const before = structuredClone(items);
    const scatter = scatterOnDesk(room, items);
    assert.ok(!scatter[danger.id]);
    assert.ok(scatter[safe.id]);
    assert.deepEqual(scatterOnDesk(room, items), scatter);
    assertValidPlacements(room, scatter);
    const opts = { months: [1, 7], compare: false };
    const seasons = planSeasons(room, items, opts);
    for (const month of seasons.months) {
      const result = seasons.byMonth[month];
      assert.ok(!result.placements[danger.id]);
      assert.ok(!result.active.includes(danger.id));
      assert.ok(!result.stored.includes(danger.id));
      assertValidPlacements(room, result.placements);
    }
    assert.deepEqual(planSeasons(room, items, opts), seasons);
    assert.deepEqual(items, before);
  });

  for (const disposable of [false, true]) {
    test(`${templateId}：腾桌保留现有危险品且提示移出宿舍（可丢弃=${disposable}）`, () => {
      const room = buildRoom({ templateId });
      const item = smallItem('打火机');
      item.flags.disposable = disposable;
      const placements = { [item.id]: onFocus(room, item) };
      const before = structuredClone({ item, placements });
      const plan = planFocusField(room, [item], placements);
      assert.deepEqual(plan.placementsAfter[item.id], placements[item.id]);
      assert.ok(!plan.steps.some((step) => step.itemId === item.id), '不能生成收纳或直接扔掉危险品的步骤');
      const unresolved = plan.unresolved.find((entry) => entry.itemId === item.id);
      assert.ok(unresolved, '危险品需要显式列为未解决');
      assert.match(unresolved.reason, /[\u4e00-\u9fff]/u);
      assert.match(unresolved.suggestion, /移出宿舍|带离宿舍|宿管|管理人员/u);
      assert.deepEqual(planFocusField(room, [item], placements), plan);
      assert.deepEqual({ item, placements }, before);
    });
  }

  test(`${templateId}：已经放在室内的危险品使安全审查不通过，未放入不扣安全分`, () => {
    const room = buildRoom({ templateId });
    const item = smallItem('点火石');
    const placements = { [item.id]: onFocus(room, item) };
    const sync = computeSync(room, [item], placements);
    assert.ok(sync.parts.safety < 1);
    assert.equal(sync.votes.space, false);
    assert.ok(sync.notes.some((note) => /危险|禁用|禁止|点火石/u.test(note)));
    assert.equal(computeSync(room, [item], {}).parts.safety, 1);
  });

  for (const status of ['blocked', 'review']) {
    test(`${templateId}：陌生物品 AI ${status} 在全部规划入口均保留拦截`, () => {
      const room = buildRoom({ templateId });
      const item = smallItem('未知物件', 'ai-risk', {
        safety: { status, reason: status === 'blocked' ? '发现危险组分' : '成分尚待核实' },
        months: [1]
      });
      const items = [item];
      const placements = { [item.id]: onFocus(room, item) };
      const before = structuredClone({ items, placements });
      const report = planMoveIn(room, items);
      assert.equal(report.verdicts[item.id].status, 'banned');
      assert.ok(report.verdicts[item.id].reasons.some((reason) => reason.includes(item.safety.reason)));
      assert.ok(!report.placements[item.id]);
      assert.deepEqual(scatterOnDesk(room, items), {});
      const seasons = planSeasons(room, items, { months: [1, 7], compare: false });
      for (const month of seasons.months) {
        const result = seasons.byMonth[month];
        assert.ok(!result.placements[item.id]);
        assert.ok(!result.active.includes(item.id));
        assert.ok(!result.stored.includes(item.id));
        assert.ok(result.overflow.includes(item.id), '待处理物品不能在换季清单中悄然消失');
      }
      const focus = planFocusField(room, items, placements);
      assert.deepEqual(focus.placementsAfter, placements);
      assert.equal(focus.steps.length, 0);
      assert.ok(focus.unresolved.some((entry) => entry.itemId === item.id && entry.reason.includes(item.safety.reason)));
      assert.equal(computeSync(room, items, placements).votes.space, false);
      assert.deepEqual({ items, placements }, before);
    });
  }
}

test('腾桌不抽走危险品的下层支撑物，学习工具标志也不能免除处理', () => {
  const room = buildRoom();
  const support = smallItem('普通收纳盒', 'support', { size: { w: 12, d: 12, h: 10 } });
  support.flags.stackable = true;
  support.flags.canBearLoad = true;
  const danger = smallItem('点火石', 'danger');
  danger.flags.focusTool = true;
  const base = onFocus(room, support);
  const upper = {
    ...onFocus(room, danger),
    box: { ...onFocus(room, danger).box, y: base.box.y + base.box.h },
    layer: 1
  };
  const placements = { [support.id]: base, [danger.id]: upper };
  const items = [support, danger];
  const before = structuredClone({ items, placements });
  const plan = planFocusField(room, items, placements);
  assert.deepEqual(plan.placementsAfter, placements);
  assert.equal(plan.steps.length, 0);
  assert.ok(plan.unresolved.some((entry) => entry.itemId === danger.id));
  assert.ok(plan.unresolved.some((entry) => entry.itemId === support.id));
  assert.equal(plan.metrics.clearedArea, 0);
  assert.equal(computeSync(room, items, placements).votes.space, false);
  assert.deepEqual({ items, placements }, before);
});

test('新床面政策下原演示仍拒绝危险品，结果确定且新位置通过安全审查', () => {
  const room = buildRoom();
  const items = parseItemsText(PRESETS.freshman);
  const report = planMoveIn(room, items);
  const danger = items.filter((item) => checkRules(item).banned);
  assert.ok(danger.length > 0);
  for (const item of danger) {
    assert.equal(report.verdicts[item.id].status, 'banned');
    assert.ok(!report.placements[item.id]);
    assert.ok(report.overflowIds.includes(item.id));
  }
  assert.deepEqual(planMoveIn(room, items), report);
  const focus = planFocusField(room, PRESETS.messyDesk.items, PRESETS.messyDesk.placements);
  assert.deepEqual(planFocusField(room, PRESETS.messyDesk.items, PRESETS.messyDesk.placements), focus);
  assert.equal(computeSync(room, PRESETS.messyDesk.items, focus.placementsAfter).parts.safety, 1);
  assertValidPlacements(room, focus.placementsAfter);
});
