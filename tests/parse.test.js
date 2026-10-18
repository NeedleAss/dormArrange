// B5：规则文本解析（docs/05 §8）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItemsText, PRESETS } from '../src/planner/index.js';

test('任务卡样例：7 个物品，水壶 1500W', () => {
  const items = parseItemsText('24寸行李箱，两床被子，27寸显示器，书20本，1500W电热水壶');
  assert.equal(items.length, 7);
  const by = (lib) => items.filter((it) => it.libId === lib);
  assert.equal(by('luggage-24').length, 1);
  assert.equal(by('quilt-winter').length, 2);
  assert.equal(by('monitor-27').length, 1);
  assert.equal(by('books-10').length, 2);
  const kettle = by('kettle');
  assert.equal(kettle.length, 1);
  assert.equal(kettle[0].powerW, 1500);
  assert.deepEqual(items.map((it) => it.id), ['it-001', 'it-002', 'it-003', 'it-004', 'it-005', 'it-006', 'it-007']);
  assert.ok(items.every((it) => it.owner === 'A'));
});

test('中文数字、数量词、书按 10 本一摞且余数缩高', () => {
  const items = parseItemsText('二十五本书、三双鞋', { owner: 'B', idPrefix: 'x' });
  const books = items.filter((it) => it.category === 'books');
  assert.equal(books.length, 3);
  assert.deepEqual(books.map((b) => b.size.h), [25, 25, 12.5]);
  assert.equal(items.filter((it) => it.libId === 'shoes').length, 3);
  assert.equal(items[0].id, 'x-001');
  assert.ok(items.every((it) => it.owner === 'B'));
  assert.equal(parseItemsText('十几本书').filter((it) => it.category === 'books').length, 2);
});

test('寸取最接近的规格；尺寸 长×宽×高 与 mm', () => {
  const [a] = parseItemsText('26寸行李箱');
  assert.equal(a.libId, 'luggage-28');
  assert.equal(a.sizeSource, 'estimated');
  const [m] = parseItemsText('24寸显示器');
  assert.equal(m.libId, 'monitor-24');
  const [b] = parseItemsText('收纳箱 60x40x30cm');
  assert.deepEqual(b.size, { w: 60, d: 40, h: 30 });
  assert.equal(b.sizeSource, 'product');
  const [c] = parseItemsText('收纳箱 600×400mm');
  assert.deepEqual(c.size, { w: 60, d: 40, h: 33 });
  const [d] = parseItemsText('衣架x2，台灯');
  assert.equal(d.libId, 'hangers');
  assert.equal(parseItemsText('衣架x2').length, 2);
});

test('不确定词与未匹配物品', () => {
  const [u] = parseItemsText('一个尺寸不确定的收纳箱');
  assert.equal(u.sizeSource, 'unknown');
  assert.ok(u.sizeRange && u.sizeRange.max.w > u.size.w);
  const [r] = parseItemsText('大概 50x30 的箱子');
  assert.equal(r.sizeSource, 'estimated');
  const [x] = parseItemsText('一台望远镜');
  assert.equal(x.libId, undefined);
  assert.equal(x.sizeSource, 'unknown');
  assert.equal(x.category, 'misc');
  const [y] = parseItemsText('乒乓球拍');
  assert.equal(y.category, 'sport');
  assert.equal(parseItemsText('').length, 0);
});

test('功率：瓦与 W', () => {
  const [h] = parseItemsText('800瓦吹风机');
  assert.equal(h.libId, 'hairdryer');
  assert.equal(h.powerW, 800);
  const [h2] = parseItemsText('吹风机');
  assert.equal(h2.powerW, null);
});

test('PRESETS.freshman 解析结果稳定且数量正确', () => {
  const a = parseItemsText(PRESETS.freshman);
  assert.equal(a.length, 30);
  assert.equal(JSON.stringify(a), JSON.stringify(parseItemsText(PRESETS.freshman)));
  assert.ok(a.some((it) => it.libId === 'guitar'));
  assert.ok(a.some((it) => it.libId === 'box-l' && it.sizeSource === 'unknown'));
});
