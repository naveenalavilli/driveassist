'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../drive-core.js');

test('haversineMeters calculates a realistic short distance', () => {
  const meters = Core.haversineMeters(
    { latitude: 29.7604, longitude: -95.3698 },
    { latitude: 29.7614, longitude: -95.3698 },
  );
  assert.ok(meters > 110 && meters < 112);
});

test('speedMphFromPosition uses a device speed reading first', () => {
  assert.equal(Math.round(Core.speedMphFromPosition({ speed: 10 }, null)), 22);
});

test('speedMphFromPosition derives speed from distance and time when needed', () => {
  const speed = Core.speedMphFromPosition(
    { latitude: 29.7614, longitude: -95.3698, speed: null, timestamp: 10000 },
    { latitude: 29.7604, longitude: -95.3698, speed: null, timestamp: 0 },
  );
  assert.ok(speed > 24 && speed < 26);
});

test('filterRoadObjects keeps supported classes above the threshold', () => {
  const results = Core.filterRoadObjects([
    { class: 'car', score: 0.91 },
    { class: 'dog', score: 0.99 },
    { class: 'person', score: 0.4 },
    { class: 'stop sign', score: 0.72 },
  ], 0.55);
  assert.deepEqual(results.map((item) => item.class), ['car', 'stop sign']);
});

test('relativeProximity uses frame-relative box area', () => {
  assert.equal(Core.relativeProximity({ bbox: [0, 0, 400, 300] }, 1000, 800).label, 'near');
  assert.equal(Core.relativeProximity({ bbox: [0, 0, 50, 40] }, 1000, 800).label, 'far');
});

test('roadRisk marks a near centered person as critical', () => {
  const risk = Core.roadRisk({ class: 'person', score: 0.9, bbox: [300, 300, 400, 420] }, 1000, 800);
  assert.equal(risk.severity, 'critical');
  assert.equal(risk.centered, true);
});

function syntheticLaneImage(width, height, leftX, rightX) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  for (let y = Math.floor(height * 0.56); y <= Math.floor(height * 0.94); y += 1) {
    for (const laneX of [leftX, rightX]) {
      for (let x = laneX; x <= laneX + 2; x += 1) {
        const index = ((y * width) + x) * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
      }
    }
  }
  return { data, width, height };
}

test('analyzeLane finds centered lane markings', () => {
  const lane = Core.analyzeLane(syntheticLaneImage(100, 60, 30, 70), 100, 60);
  assert.equal(lane.state, 'centered');
  assert.ok(lane.confidence >= 0.8);
});

test('analyzeLane reports insufficient visual evidence', () => {
  const lane = Core.analyzeLane(syntheticLaneImage(100, 60, 50, 50), 100, 60);
  assert.equal(lane.state, 'searching');
});
