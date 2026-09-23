'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../drive-core');

const sample = (acceleration = {x:0,y:0,z:0}, rotationRate = {alpha:0,beta:0,gamma:0}) => ({ acceleration, rotationRate });

test('motion analysis requires sustained movement and clears it when it resolves', () => {
  let reading = null;
  for (const now of [1000, 1100, 1200]) {
    reading = Core.analyzeMotion(reading, sample({x:5,y:0,z:0}), now);
    assert.equal(reading.strong, false);
  }
  reading = Core.analyzeMotion(reading, sample({x:5,y:0,z:0}), 1300);
  assert.equal(reading.strong, true);
  reading = Core.analyzeMotion(reading, sample(), 1400);
  assert.equal(reading.strong, false);
});

test('rotation cues work without an accelerometer or inferred speed', () => {
  let reading = Core.analyzeMotion(null, sample(null, {alpha:0,beta:30,gamma:0}), 1000);
  reading = Core.analyzeMotion(reading, sample(null, {alpha:0,beta:30,gamma:0}), 1300);
  assert.equal(reading.rotating, true);
  assert.equal(reading.strong, false);
  assert.equal('speed' in reading, false);
});

test('axis orientation does not change scalar motion cues', () => {
  const first = Core.analyzeMotion(null, sample({x:5,y:0,z:0}), 1000);
  const rotated = Core.analyzeMotion(null, sample({x:0,y:0,z:-5}), 1000);
  assert.equal(first.acceleration, rotated.acceleration);
});

test('null, nonfinite and gravity-only sensor data do not become motion measurements', () => {
  for (const event of [{}, {accelerationIncludingGravity:{x:0,y:9.81,z:0}},
    sample({x:null,y:0,z:0},null), sample({x:Infinity,y:0,z:0},null)]) {
    const reading = Core.analyzeMotion(null,event,1000);
    assert.equal(Core.motionIsFresh(reading,1000), false);
    assert.equal(reading.strong, false);
  }
});

test('sensor gaps reset persistence and old readings expire', () => {
  let reading = Core.analyzeMotion(null, sample({x:5,y:0,z:0}), 1000);
  reading = Core.analyzeMotion(reading, sample({x:5,y:0,z:0}), 2000);
  assert.equal(reading.strong, false);
  assert.equal(Core.motionIsFresh(reading,3501), false);
  assert.equal(Core.motionIsFresh(reading,1999), false);
});
