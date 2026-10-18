// 真实物品轮廓的几何不变量：填充与线框有效，显示模型不得超出规划提供的厘米包围盒。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LIBRARY, makeItem } from '../src/planner/index.js';
import { createItemGeometry } from '../src/scene/itemGeometry.js';
import { createItemView } from '../src/scene/itemView.js';
import { createViewKit } from '../src/scene/viewKit.js';

const EPS = 0.0001;

/** 逐坐标检查，避免 NaN 被包围盒比较静默跳过；复杂度 O(顶点数)。 */
function assertGeometry(geometry, label, minimumVertices) {
  assert.ok(geometry?.isBufferGeometry, `${label} 必须提供可绘制几何`);
  const position = geometry.getAttribute('position');
  assert.ok(position && position.itemSize === 3 && position.count >= minimumVertices,
    `${label} 必须包含足够的三维顶点`);
  for (let i = 0; i < position.array.length; i += 1) {
    assert.ok(Number.isFinite(position.array[i]), `${label} 第 ${i} 个坐标必须有限`);
  }
  geometry.computeBoundingBox();
  assertBounds(geometry.boundingBox, { x: -0.5, y: -0.5, z: -0.5, w: 1, h: 1, d: 1 }, label);
}

/** 比较实际显示几何与契约 Box；浮点误差仅容忍万分之一厘米。 */
function assertBounds(actual, expected, label) {
  assert.ok(actual && !actual.isEmpty(), `${label} 包围盒不得为空`);
  for (const [axis, size] of [['x', 'w'], ['y', 'h'], ['z', 'd']]) {
    assert.ok(Number.isFinite(actual.min[axis]) && Number.isFinite(actual.max[axis]),
      `${label} 的 ${axis} 边界必须有限`);
    assert.ok(actual.min[axis] >= expected[axis] - EPS,
      `${label} 超出 Placement.box 的 ${axis} 下界`);
    assert.ok(actual.max[axis] <= expected[axis] + expected[size] + EPS,
      `${label} 超出 Placement.box 的 ${axis} 上界`);
  }
}

test('现有物品的填充和线框均非空、坐标有限且位于单位盒内', () => {
  assert.ok(LIBRARY.length > 0, '必须使用真实物品库执行轮廓回归');
  for (const entry of LIBRARY) {
    const shape = createItemGeometry(makeItem(entry.libId));
    try {
      assertGeometry(shape.fill, `${entry.libId} 填充`, 3);
      assertGeometry(shape.edge, `${entry.libId} 线框`, 2);
      assert.equal(shape.edge.getAttribute('position').count % 2, 0,
        `${entry.libId} 线框顶点应组成完整线段`);
    } finally {
      shape.fill?.dispose();
      shape.edge?.dispose();
    }
  }
});

// 姿态尺寸只按 Placement 契约交换；定向与模型变换全部交给实际显示代码，不复制其算法。
const poses = [
  { label: '原向', rot: 0, lying: false, dimensions: ({ w, d, h }) => ({ w, d, h }) },
  { label: '旋转九十度', rot: 90, lying: false, dimensions: ({ w, d, h }) => ({ w: d, d: w, h }) },
  { label: '放倒', rot: 0, lying: true, dimensions: ({ w, d, h }) => ({ w, d: h, h: d }) }
];

for (const pose of poses) {
  test(`现有物品${pose.label}后的真实显示模型不超出 Placement.box`, () => {
    const kit = createViewKit();
    const view = createItemView(kit);
    try {
      for (const entry of LIBRARY) {
        const item = makeItem(entry.libId, { id: `shape-${entry.libId}` });
        const box = { x: -135.25, y: 7.5, z: 240.75, ...pose.dimensions(item.size) };
        // 合成放倒姿态只验证显示层能容纳给定 Box，不要求规划器允许所有物品放倒。
        const placement = { itemId: item.id, zoneId: 'A.desk', box,
          rot: pose.rot, lying: pose.lying, layer: 0, compressed: false };
        view.setItems([item], { [item.id]: placement }, { animate: false });
        view.group.updateMatrixWorld(true);
        const actual = new THREE.Box3().setFromObject(view.group);
        assertBounds(actual, box, `${entry.libId} ${pose.label}`);
      }
    } finally {
      view.dispose();
      kit.dispose();
    }
  });
}
