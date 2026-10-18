// 三种宿舍模板的尺寸、校准与规划安全回归；只使用现有物品库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DEFAULT_PARAMS, buildRoom, makeItem, parseItemsText, planMoveIn, planFocusField, PRESETS
} from '../src/planner/index.js';
import { assertValidPlacements } from './helpers.js';

const TEMPLATE_IDS = ['thu-4p-loft', 'nanqu', 'nanqu1'];
const FIXTURE_TYPES = new Set([
  'loftBed', 'bedRail', 'desk', 'hutch', 'wardrobe', 'ladder', 'chair', 'sink', 'dryingRod'
]);
const EPS = 1e-7;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 判断两个盒子有正体积交集；相贴的边界不算侵占。 */
function overlaps(a, b) {
  return ['x', 'y', 'z'].every((axis, i) => {
    const length = ['w', 'h', 'd'][i];
    return Math.min(a[axis] + a[length], b[axis] + b[length]) - Math.max(a[axis], b[axis]) > EPS;
  });
}

/** 尺寸均为有效厘米值，且家具/分区位于室内与阳台总边界内。 */
function assertRoomGeometry(room) {
  const boxes = [
    ['bounds', room.bounds],
    ...['walls', 'openings', 'fixtures', 'zones'].flatMap((key) => room[key].map((v) => [v.id, v.box]))
  ];
  for (const [id, b] of boxes) {
    for (const key of ['x', 'y', 'z', 'w', 'd', 'h']) {
      assert.ok(Number.isFinite(b[key]), `${room.id}/${id}.${key} 必须有限`);
    }
    for (const key of ['w', 'd', 'h']) assert.ok(b[key] > 0, `${room.id}/${id}.${key} 必须为正`);
  }
  // 墙和门窗位于边界上的墙厚内，因此只校验室内家具与分区。
  for (const v of [...room.fixtures, ...room.zones]) {
    for (const [axis, length] of [['x', 'w'], ['y', 'h'], ['z', 'd']]) {
      assert.ok(v.box[axis] >= room.bounds[axis] - EPS, `${room.id}/${v.id} 越出 ${axis} 下界`);
      assert.ok(v.box[axis] + v.box[length] <= room.bounds[axis] + room.bounds[length] + EPS,
        `${room.id}/${v.id} 越出 ${axis} 上界`);
    }
  }
  for (const fx of room.fixtures) assert.ok(FIXTURE_TYPES.has(fx.type), `${room.id}/${fx.id} 超出现有家具类型`);
  const clears = room.zones.filter((z) => z.kind === 'keepClear');
  for (const zone of room.zones.filter((z) => z.kind !== 'keepClear')) {
    for (const clear of clears) assert.ok(!overlaps(zone.box, clear.box),
      `${room.id}/${zone.id} 侵入 ${clear.id}`);
  }
}

/** 冻结入参，确保模板选择和深合并过程不会反写校准值。 */
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

test('紫荆参数和原入住/腾桌演示保持不变，Room采用已确认的正面直梯版本', () => {
  const room = buildRoom();
  const move = planMoveIn(room, parseItemsText(PRESETS.freshman));
  const focus = planFocusField(room, PRESETS.messyDesk.items, PRESETS.messyDesk.placements);
  assert.equal(sha(DEFAULT_PARAMS), '889efc8de678269a7a430ae276108321a9e4de21514eeb5c1deb182bd57a6258');
  assert.equal(sha(room), 'a8899720e66c72f3c1f9bac259065f65eba52bb001dcfb4228e5382309e0a7b5');
  assert.equal(sha(move), '7794afb3c0278d0bda506a03530579e49d89e242a918bad7952be8503e754fea');
  assert.equal(sha(focus), '474d5042d22fb888078b06dfd80394cd1fe17bb0c508bee2ec80a17e4a260a9d');
  assert.deepEqual(move.summary, { fits: 22, relocate: 9, uncertain: 2, overflow: 0, banned: 1, total: 34 });
  assert.equal(focus.steps.length, 7);
  assert.equal(focus.metrics.syncBefore, 75);
  assert.equal(focus.metrics.syncAfter, 100);
  assert.deepEqual(buildRoom({ templateId: 'thu-4p-loft' }), room);
});

test('三模板返回完整独立参数，照片差异反映到尺寸、家具比例和门窗/阳台', () => {
  const rooms = TEMPLATE_IDS.map((templateId) => buildRoom({ templateId }));
  for (const room of rooms) {
    assert.equal(room.params.templateId, room.id);
    assert.equal(room.params.sizeSource, 'estimated');
    assert.deepEqual(Object.keys(room.params).sort(), Object.keys(DEFAULT_PARAMS).sort());
    for (const key of ['room', 'door', 'balcony', 'unit']) {
      assert.deepEqual(Object.keys(room.params[key]).sort(), Object.keys(DEFAULT_PARAMS[key]).sort());
    }
    assert.equal(room.fixtures.filter((fx) => fx.type === 'loftBed').length, 4);
    assert.ok(room.openings.some((opening) => opening.type === 'door'));
    assert.ok(room.openings.some((opening) => opening.type === 'window'));
  }
  assert.equal(new Set(rooms.map((room) => JSON.stringify(room.params.room))).size, 3);
  assert.equal(new Set(rooms.map((room) => JSON.stringify(room.params.unit))).size, 3);
  assert.equal(new Set(rooms.map((room) => room.params.unit.deskLen / room.params.unit.bedLen)).size, 3);
  assert.equal(new Set(rooms.map((room) => room.params.unit.wardrobeLen / room.params.unit.bedLen)).size, 3);
  assert.equal(rooms[1].params.balcony.enabled, false);
  assert.ok(!rooms[1].openings.some((opening) => opening.type === 'balconyDoor'));
  assert.ok(!rooms[1].zones.some((zone) => zone.id === 'pub.balcony'));
  assert.equal(rooms[1].bounds.d, rooms[1].params.room.d);
  for (const room of [rooms[0], rooms[2]]) {
    assert.equal(room.params.balcony.enabled, true);
    assert.ok(room.openings.some((opening) => opening.type === 'balconyDoor'));
    assert.equal(room.bounds.d, room.params.room.d + room.params.balcony.d);
  }
  assert.notDeepEqual(rooms[1].openings, rooms[2].openings);
});

for (const templateId of TEMPLATE_IDS) {
  test(`${templateId}：生成确定、不修改入参、结果与模板基底相互隔离`, () => {
    const beforeDefault = JSON.stringify(DEFAULT_PARAMS);
    const params = freezeDeep({ templateId });
    const room = buildRoom(params);
    const snapshot = structuredClone(room);
    assert.deepEqual(buildRoom(params), snapshot);
    assert.deepEqual(buildRoom(room.params), snapshot);
    room.params.room.w += 100;
    room.params.unit.deskLen += 10;
    room.params.occupants.pop();
    room.zones[0].box.w += 10;
    assert.deepEqual(buildRoom(params), snapshot);
    assert.equal(JSON.stringify(DEFAULT_PARAMS), beforeDefault);
    assert.deepEqual(params, { templateId });
  });

  test(`${templateId}：嵌套校准覆盖对应模板，其余参数保留且尺寸有效`, () => {
    const base = buildRoom({ templateId });
    const params = freezeDeep({
      templateId,
      room: { w: base.params.room.w + 40, d: base.params.room.d + 40, h: base.params.room.h + 20 },
      unit: { deskDepth: base.params.unit.deskDepth + 2, deskH: base.params.unit.deskH + 1 },
      balcony: { d: base.params.balcony.d + 20 }
    });
    const copy = JSON.stringify(params);
    const room = buildRoom(params);
    assert.equal(room.params.room.w, params.room.w);
    assert.equal(room.params.room.d, params.room.d);
    assert.equal(room.params.unit.deskDepth, params.unit.deskDepth);
    assert.equal(room.params.unit.deskH, params.unit.deskH);
    assert.equal(room.params.unit.len, base.params.unit.len);
    assert.equal(room.params.unit.wardrobeLen, base.params.unit.wardrobeLen);
    assert.equal(room.params.balcony.enabled, base.params.balcony.enabled);
    assert.equal(room.params.balcony.doorX, base.params.balcony.doorX);
    assert.equal(room.params.balcony.d, params.balcony.d);
    assert.equal(room.params.name, base.params.name);
    assert.equal(JSON.stringify(params), copy);
    assert.deepEqual(buildRoom(params), room);
    assertRoomGeometry(room);
    assertValidPlacements(room, planMoveIn(room, parseItemsText(PRESETS.freshman)).placements);
  });

  test(`${templateId}：所有盒尺寸有效，可用空间避开腿部、椅子及公共通道`, () => {
    assertRoomGeometry(buildRoom({ templateId }));
  });

  test(`${templateId}：入住结果确定、物件位于可用分区内且通道安全`, () => {
    const room = buildRoom({ templateId });
    const items = parseItemsText(PRESETS.freshman);
    const before = JSON.stringify({ room, items });
    const report = planMoveIn(room, items);
    assert.deepEqual(planMoveIn(room, items), report);
    assert.ok(Object.keys(report.placements).length > 0);
    assertValidPlacements(room, report.placements);
    assert.equal(JSON.stringify({ room, items }), before);
    assert.equal(report.summary.total, items.length);
  });
}

test('南区储物楼梯使用完整55cm占地，桌面及桌下规划区留在楼梯前', () => {
  const room = buildRoom({ templateId: 'nanqu' });
  for (const owner of room.params.occupants) {
    const ladder = room.fixtures.find((fx) => fx.id === `${owner}.ladder#fx`);
    assert.equal(ladder.box.d, 55);
    for (const slot of ['desk', 'underDesk', 'underDeskBack']) {
      const zone = room.zones.find((z) => z.id === `${owner}.${slot}`);
      assert.ok(zone.box.z + zone.box.d <= ladder.box.z + EPS, `${zone.id} 越过楼梯前沿`);
      assert.ok(!overlaps(zone.box, ladder.box), `${zone.id} 与储物楼梯重叠`);
    }
  }
});

for (const templateId of ['thu-4p-loft', 'nanqu1']) {
  test(`${templateId}：四席直梯位于衣柜朝过道正面，左右镜像且不侵入可用分区`, () => {
    const room = buildRoom({ templateId });
    const u = room.params.unit;
    const ladders = new Map();
    const aisle = room.zones.find((z) => z.id === 'pub.aisle');
    for (const owner of room.params.occupants) {
      const ladder = room.fixtures.find((fx) => fx.id === `${owner}.ladder#fx`);
      const wardrobe = room.fixtures.find((fx) => fx.id === `${owner}.wardrobe#fx`);
      const desk = room.fixtures.find((fx) => fx.id === `${owner}.desk#fx`);
      const right = ['C', 'D'].includes(owner);
      const b = ladder.box;
      ladders.set(owner, b);
      assert.equal(b.w, 10, `${owner} 梯厚应沿x`);
      assert.equal(b.d, 35, `${owner} 梯宽应沿z`);
      assert.equal(b.y, 0);
      assert.equal(b.h, u.bedY);
      assert.equal(b.x, right ? room.params.room.w - u.bedW : u.bedW - 10);
      assert.ok(b.z >= wardrobe.box.z, `${owner} 梯子应落在衣柜正面范围`);
      assert.equal(b.z + b.d, wardrobe.box.z + wardrobe.box.d, `${owner} 梯子应靠衣柜邻桌端`);
      assert.equal(b.z + b.d, desk.box.z, `${owner} 梯子不得跨入书桌`);
      assert.ok(right ? b.x + b.w <= wardrobe.box.x : b.x >= wardrobe.box.x + wardrobe.box.w,
        `${owner} 梯子应处在衣柜面向过道一侧`);
      assert.ok(!overlaps(b, desk.box), `${owner} 直梯与固定桌板相交`);
      assert.ok(!overlaps(b, aisle.box), `${owner} 直梯侵入中央过道`);
      for (const zone of room.zones.filter((z) => z.kind !== 'keepClear')) {
        assert.ok(!overlaps(b, zone.box), `${owner} 直梯侵入可用分区 ${zone.id}`);
      }
    }
    for (const [leftOwner, rightOwner] of [['A', 'C'], ['B', 'D']]) {
      const left = ladders.get(leftOwner);
      const right = ladders.get(rightOwner);
      assert.deepEqual(right, { ...left, x: room.params.room.w - left.x - left.w });
    }
  });
}

for (const templateId of ['nanqu', 'nanqu1']) test(`${templateId}：L形桌公开盒是外包络，可用桌面与物件均不进入凹口`, () => {
  const room = buildRoom({ templateId });
  const u = room.params.unit;
  assert.ok(u.depth > u.deskDepth);
  assert.ok(u.deskLen > u.underDeskSideLen);
  const notches = [];
  for (const owner of room.params.occupants) {
    const desk = room.zones.find((z) => z.id === `${owner}.desk`);
    const fx = room.fixtures.find((f) => f.id === `${owner}.desk#fx`);
    const right = ['C', 'D'].includes(owner);
    assert.equal(fx.box.w, u.depth);
    assert.ok(desk.box.w <= u.deskDepth);
    const notch = {
      x: right ? room.params.room.w - u.depth : u.deskDepth,
      y: u.deskH,
      z: fx.box.z,
      w: u.depth - u.deskDepth,
      d: u.deskLen - u.underDeskSideLen,
      h: desk.box.h
    };
    assert.ok(!overlaps(desk.box, notch), `${owner} 桌面分区进入L形凹口`);
    notches.push(notch);
  }
  // 锁住其他区域，让规划器在左右四张桌面上实际尝试多种现有物品。
  const lockedZones = room.zones.filter((z) => z.slot !== 'desk').map((z) => z.id);
  const items = room.params.occupants.flatMap((owner) =>
    ['laptop', 'lamp', 'box-desk', 'cup', 'keyboard', 'monitor-24'].map((libId) =>
      makeItem(libId, { id: `${owner}-${libId}`, owner })));
  const report = planMoveIn(room, items, { lockedZones });
  assertValidPlacements(room, report.placements);
  for (const owner of room.params.occupants) {
    assert.ok(Object.values(report.placements).some((p) => p.zoneId === `${owner}.desk`), `${owner} 未尝试桌面落点`);
  }
  for (const p of Object.values(report.placements)) {
    assert.equal(p.zoneId.split('.')[1], 'desk');
    for (const notch of notches) assert.ok(!overlaps(p.box, notch), `${p.itemId} 悬在L桌凹口`);
  }
});

for (const [templateId, enabled] of [['nanqu', true], ['nanqu1', false]]) {
  test(`${templateId}：校准阳台开关为${enabled}后几何有效、规划通道安全`, () => {
    const params = freezeDeep({ templateId, balcony: { enabled } });
    const room = buildRoom(params);
    assert.equal(room.params.balcony.enabled, enabled);
    assert.equal(room.openings.some((opening) => opening.type === 'balconyDoor'), enabled);
    assert.equal(room.zones.some((zone) => zone.id === 'pub.balconyWalk'), enabled);
    assert.equal(room.zones.some((zone) => zone.id === 'pub.balcony'), enabled);
    assert.equal(room.bounds.d, room.params.room.d + (enabled ? room.params.balcony.d : 0));
    assertRoomGeometry(room);
    const report = planMoveIn(room, parseItemsText(PRESETS.freshman));
    assertValidPlacements(room, report.placements);
    assert.deepEqual(buildRoom(params), room);
    assert.deepEqual(params, { templateId, balcony: { enabled } });
  });
}

test('新模板拒绝净空冲突和无效厘米值，以中文RangeError说明且不污染入参或基底', () => {
  const bases = new Map(['nanqu', 'nanqu1'].map((templateId) => [templateId, buildRoom({ templateId })]));
  const invalid = [
    { templateId: 'nanqu', unit: { deskLen: 120 } },
    { templateId: 'nanqu1', room: { d: 600 } },
    ...['nanqu', 'nanqu1'].flatMap((templateId) => [
      { templateId, balcony: { enabled: true, doorX: 20 } },
      { templateId, room: { w: 200 } },
      { templateId, room: { w: NaN } },
      { templateId, unit: { hutchH: 1 } }
    ])
  ];
  for (const value of invalid) {
    const before = structuredClone(value);
    const params = freezeDeep(value);
    assert.throws(() => buildRoom(params), (error) => {
      assert.ok(error instanceof RangeError, `${JSON.stringify(before)} 应抛出RangeError`);
      assert.match(error.message, /^宿舍校准无效：[\u4e00-\u9fff\s\S]+/);
      return true;
    });
    assert.deepEqual(params, before);
    assert.deepEqual(buildRoom({ templateId: value.templateId }), bases.get(value.templateId));
  }
});
