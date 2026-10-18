import test from 'node:test';
import assert from 'node:assert/strict';
import { displacement } from '../src/geometry.js';

test('barrel sampling is symmetric, finite, centered, and independently scaled by viewport axis', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [3840, 2160]]) {
    assert.deepEqual(displacement(width / 2, height / 2, width, height, .035), [0, 0]);
    for (let i = 0; i <= 10; i++) {
      const x = width * i / 10, y = height * i / 10;
      const d = displacement(x, y, width, height, .035);
      const reverse = displacement(width - x, height - y, width, height, .035);
      d.forEach((value, axis) => {
        assert.ok(Number.isFinite(value));
        assert.ok(Math.abs(value + reverse[axis]) < 1e-10);
      });
    }
    const [x, y] = displacement(width, height, width, height, .035);
    assert.equal(x, .035 * width / 2);
    assert.equal(y, .035 * height / 2);
    assert.deepEqual(displacement(width, height, width, height, 0), [0, 0]);
  }
});

test('protected controls and padding remain undisplaced with a smooth monotonic taper', () => {
  const region = { left: 50, top: 60, right: 150, bottom: 100 };
  for (const x of [44, 50, 100, 150, 156]) for (const y of [54, 80, 106]) {
    assert.ok(displacement(x, y, 1000, 800, .035, [region]).every(v => v === 0));
  }
  let last = 0;
  for (let distance = 1; distance <= 24; distance++) {
    const x = region.right + 6 + distance;
    const raw = displacement(x, 80, 1000, 800, .035);
    const d = displacement(x, 80, 1000, 800, .035, [region]);
    const weight = d[0] / raw[0];
    assert.ok(weight > last && weight <= 1);
    last = weight;
  }
  assert.equal(last, 1);
});

test('overlapping protected regions use the most protective weight', () => {
  const regions = [{ left: 0, top: 0, right: 70, bottom: 70 }, { left: 60, top: 60, right: 140, bottom: 140 }];
  for (const [x, y] of [[20, 20], [65, 65], [130, 130]]) {
    assert.ok(displacement(x, y, 400, 400, .035, regions).every(v => v === 0));
  }
});
