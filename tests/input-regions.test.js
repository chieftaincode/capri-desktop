'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/js/input-regions.js'), 'utf8');
const regionsModule = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const covers = (rects, x, y) => rects.some(([rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);

test('Native input covers the character and chat controls, while other windows stay clickable', async () => {
  const { inputRegions } = await regionsModule;
  const rects = inputRegions({ width: 1920, height: 1080,
    capri: { hidden: false, p: { alpha: 1 }, dragging: true,
      canvas: { getBoundingClientRect: () => box(10, 20, 100, 200) },
      hit: (x, y) => x >= 20 && x < 40 && y >= 30 && y < 90 },
    panel: { rect: () => box(100, 100, 400, 300) }, chip: { visible: false } });
  assert.equal(covers(rects, 25, 40), true);
  assert.equal(covers(rects, 150, 150), true);
  assert.equal(covers(rects, 60, 40), false, 'transparent pixels beside Capri must pass through');
  assert.equal(covers(rects, 900, 500), false, 'dragging must never enable the whole screen');
});

test('Hidden character and panel leave an empty input shape; only the visible biochip accepts clicks', async () => {
  const { inputRegions } = await regionsModule;
  const state = { width: 1920, height: 1080, capri: { hidden: true, p: { alpha: 1 } },
    panel: { rect: () => null }, chip: { visible: false } };
  assert.deepEqual(inputRegions(state), []);
  state.chip = { visible: true, canvas: { getBoundingClientRect: () => box(10, 900, 90, 1000) } };
  assert.deepEqual(inputRegions(state), [[10, 900, 80, 100]]);
});
