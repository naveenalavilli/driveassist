'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../drive-core');
const { findCandidates } = require('../sign-reader');

function app() {
  const nodes = {};
  const stored = new Map([['driveassist:audio', 'false']]);
  const sandbox = {
    window: { DriveAssistCore: Core, addEventListener() {}, removeEventListener() {} },
    document: { querySelector: (selector) => nodes[selector] ||= {
      textContent: '', dataset: {}, hidden: false, disabled: false,
      getContext: () => ({ clearRect() {} }), showModal() { this.open = true; },
    } },
    navigator: {},
    localStorage: { getItem: (key) => stored.get(key) ?? null },
    clearInterval, cancelAnimationFrame() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../script.js'), 'utf8').replace(/initialize\(\);\s*$/, ''), sandbox);
  return { run: (source) => vm.runInContext(source, sandbox), nodes, stored };
}

test('cars and buses can trigger critical close-ahead warnings', () => {
  for (const object of ['car', 'bus']) {
    assert.equal(Core.roadRisk({ class: object, bbox: [250, 200, 500, 550] }, 1000, 800).severity, 'critical');
    assert.equal(Core.roadRisk({ class: object, bbox: [0, 0, 50, 50] }, 1000, 800).severity, 'info');
  }
});

test('live warnings prioritize severity, refresh during cooldown and expire', () => {
  const { run, nodes } = app();
  run("addAlert('person', 'critical', 'Person ahead', '', 5000, 3000); addAlert('lane', 'caution', 'Lane changing', '', 5000, 3000)");
  assert.equal(nodes['#latestAlert'].textContent, 'Person ahead');
  run("state.alerts.find(a => a.key === 'person').expiresAt = 0; addAlert('person', 'critical', 'Person still ahead', '', 5000, 3000)");
  assert.equal(nodes['#latestAlert'].textContent, 'Person still ahead');
  run('state.alerts.forEach(a => a.expiresAt = 0); renderAlerts()');
  assert.equal(nodes['#latestAlert'].textContent, 'Ready to assist');
});

test('GPS loss, poor accuracy and stale fixes remove speed and overspeed alerts', () => {
  const { run, nodes } = app();
  for (const loss of [
    'handlePositionError({code: 2})',
    'handlePosition({coords:{accuracy:100,speed:25},timestamp:Date.now()})',
    'state.lastSpeedAt = Date.now() - 6000; maintainStatus()',
    'handlePosition({coords:{accuracy:5,speed:25},timestamp:Date.now()-6000})',
  ]) {
    run('state.active = true; state.sessionSettings = {speedLimit:25}; handlePosition({coords:{accuracy:5,speed:25},timestamp:Date.now()})');
    assert.equal(nodes['#speedValue'].textContent, '56');
    run(loss);
    assert.equal(nodes['#speedValue'].textContent, '--');
    assert.equal(run("state.alerts.some(a => a.key === 'overspeed')"), false);
  }
});

test('overspeed clears once speed drops and rejected fixes cannot seed fallback', () => {
  const { run } = app();
  run('state.active=true; state.sessionSettings={speedLimit:25}; state.lastSpeedMph=45; updateSpeedWarning()');
  assert.equal(run("state.alerts.some(a=>a.key==='overspeed')"), true);
  run('state.lastSpeedMph=20; updateSpeedWarning()');
  assert.equal(run("state.alerts.some(a=>a.key==='overspeed')"), false);
  assert.equal(Core.speedMphFromPosition({latitude:1,longitude:1,timestamp:30000,speed:null}, {latitude:0,longitude:0,timestamp:0}), null);
  assert.equal(Core.speedMphFromPosition({latitude:1,longitude:1,timestamp:2000,speed:null}, {latitude:0,longitude:0,timestamp:0,accuracy:100}), null);
});

test('first start requires parked setup; no speed limit or lane guidance is assumed', async () => {
  const { run, nodes } = app();
  assert.equal(run('getSettings().speedLimit'), null);
  assert.equal(run('getSettings().lane'), false);
  await run('startDrive()');
  assert.equal(nodes['#setupDialog'].open, true);
  assert.equal(nodes['#setupLimit'].value, '');
});

test('sign parser requires explicit unambiguous supported text and confidence', () => {
  assert.equal(Core.parseSignText('SPEED\nLIMIT\n25', 90).limit, 25);
  for (const text of ['25', 'LIMIT 25', 'SPEED LIMIT 25 65', 'SPEED LIMIT 25 WHEN FLASHING',
    'SCHOOL SPEED LIMIT 20', 'SPEED LIMIT 30 KM/H', 'SPEED LIMIT 99', 'SPEED LIMIT 0', 'EXIT 25']) {
    assert.equal(Core.parseSignText(text, 95), null, text);
  }
  assert.equal(Core.parseSignText('SPEED LIMIT 25', 60), null);
  for (const text of ['STOP', 'YIELD', 'DO NOT ENTER', 'WRONG WAY', 'SCHOOL', 'PEDESTRIAN CROSSING', 'ROAD WORK AHEAD']) {
    assert.ok(Core.parseSignText(text, 90), text);
  }
});

test('sign confirmations require repeated nearby, recent, matching reads', () => {
  const sign = Core.parseSignText('SPEED LIMIT 25', 90);
  const first = Core.confirmSign(null, sign, [0.5, 0.2, 0.1, 0.2], 1000);
  assert.equal(first.confirmed, false);
  assert.equal(Core.confirmSign(first, sign, [0.52, 0.22, 0.1, 0.2], 2500).confirmed, true);
  assert.equal(Core.confirmSign(first, sign, [0.1, 0.2, 0.1, 0.2], 2500).confirmed, false);
  assert.equal(Core.confirmSign(first, sign, first.bbox, 8000).confirmed, false);
  assert.equal(Core.confirmSign(first, {...sign, limit:35}, first.bbox, 2500).confirmed, false);
  assert.equal(Core.confirmSign(first, null, first.bbox, 2500), null);
});

test('sign warnings vary with sign type, speed and proximity', () => {
  const limit = Core.parseSignText('SPEED LIMIT 25', 90);
  assert.equal(Core.signWarning(limit, 25).severity, 'info');
  assert.equal(Core.signWarning(limit, 30).severity, 'caution');
  assert.equal(Core.signWarning(limit, 40).severity, 'critical');
  assert.equal(Core.signWarning(limit, null).severity, 'info');
  const stop = Core.parseSignText('STOP', 90);
  assert.equal(Core.signWarning(stop, 0, 'near').severity, 'caution');
  assert.equal(Core.signWarning(stop, 25, 'near').severity, 'critical');
  assert.equal(Core.signWarning(Core.parseSignText('WRONG WAY', 90), 25).severity, 'critical');
});

test('sign limit is visible, never raises selected threshold, and expires', () => {
  const { run, nodes } = app();
  run('state.active=true; state.sessionSettings={speedLimit:35}; state.detectedLimit={limit:25,expiresAt:Date.now()+30000}; updateSpeedWarning()');
  assert.match(nodes['#limitStatus'].textContent, /25 mph · sign estimate/);
  run('state.detectedLimit.limit=65; updateSpeedWarning()');
  assert.match(nodes['#limitStatus'].textContent, /35 mph · selected/);
  run('state.detectedLimit.expiresAt=0; maintainStatus()');
  assert.equal(run('state.detectedLimit'), null);
});

test('stop clears alerts and invalidates pending camera/model results', () => {
  const { run } = app();
  run("state.active=true; state.session=4; state.laneWarningFrames=2; addAlert('person','critical','Person ahead',''); cleanUpDrive()");
  assert.equal(run('state.alerts.length'), 0);
  assert.equal(run('state.session'), 5);
  assert.equal(run('state.laneWarningFrames'), 0);
});

test('sign candidate filter finds a sign surface and ignores a blank dark frame', () => {
  const width = 320; const height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  assert.deepEqual(findCandidates({width, height, data}), []);
  for (let y = 30; y < 100; y += 1) for (let x = 220; x < 270; x += 1) {
    const i = (y * width + x) * 4;
    data[i] = 240; data[i+1] = 240; data[i+2] = 240; data[i+3] = 255;
  }
  const candidates = findCandidates({width, height, data});
  assert.equal(candidates.length, 1);
  assert.ok(Math.abs(candidates[0][0] - 220/320) < 0.01);
});

test('immediate object hazards retain priority over equally critical overspeed', () => {
  const { run, nodes } = app();
  run("addAlert('object:person','critical','Person ahead',''); addAlert('overspeed','critical','Above threshold','')");
  assert.equal(nodes['#latestAlert'].textContent, 'Person ahead');
});

test('confirmed sign observations adjust live threshold and warnings', async () => {
  const { run, nodes } = app();
  run(`state.active=true; state.sessionSettings={speedLimit:45}; state.lastSpeedMph=40;
    state.signReader={worker:{},read:async()=>[{sign:{type:'speed-limit',limit:25,label:'Speed limit 25 mph'},bbox:[0.7,0.2,0.1,0.2]}]}`);
  await run('readSigns(2000)');
  assert.match(nodes['#limitStatus'].textContent, /25 mph · sign estimate/);
  assert.equal(run("state.alerts.find(a=>a.key==='overspeed').severity"), 'critical');
  assert.equal(run('getSettings().speedLimit'), 45);
});

test('late OCR results cannot change a stopped session', async () => {
  const { run } = app();
  run(`state.active=true; let finishRead;
    state.signReader={worker:{},close(){},read:()=>new Promise(resolve=>{finishRead=resolve})};
    const pending=readSigns(2000); cleanUpDrive();
    finishRead([{sign:{type:'speed-limit',limit:25},bbox:[0.7,0.2,0.1,0.2]}]);`);
  await run('pending');
  assert.equal(run('state.detectedLimit'), null);
  assert.equal(run('state.alerts.length'), 0);
});

test('OCR failure leaves object assistance active and exposes unavailable state', async () => {
  const { run, nodes } = app();
  run(`state.active=true; state.sessionSettings={speedLimit:45};
    state.signReader={worker:{},close(){},read:async()=>{throw new Error('offline')}}`);
  await run('readSigns(2000)');
  assert.equal(run('state.active'), true);
  assert.equal(nodes['#signStatus'].textContent, 'Text signs unavailable');
  assert.equal(run('state.signReader'), null);
});

test('GPS loss activates motion fallback without enabling any speed warning', () => {
  const { run, nodes } = app();
  run(`state.active=true; state.motionAccess='listening'; state.sessionSettings={speedLimit:25};
    handlePosition({coords:{accuracy:5,speed:25},timestamp:Date.now()});
    state.motionReading=Core.analyzeMotion(null,{rotationRate:{alpha:30,beta:0,gamma:0}},Date.now());
    handlePositionError({code:2});`);
  assert.match(nodes['#motionStatus'].textContent,/Motion fallback/);
  assert.equal(nodes['#speedValue'].textContent,'--');
  assert.equal(nodes['#speedSource'].textContent,'Motion only');
  assert.equal(run("state.alerts.some(a=>a.key==='overspeed')"),false);
  run('handlePosition({coords:{accuracy:5,speed:10},timestamp:Date.now()})');
  assert.match(nodes['#motionStatus'].textContent,/GPS active/);
  assert.equal(nodes['#speedValue'].textContent,'22');
});

test('stale motion removes fallback status and its warning', () => {
  const { run, nodes } = app();
  run(`state.active=true; state.motionAccess='listening';
    state.motionReading={lastSampleAt:Date.now(),strong:true}; refreshMotionStatus();`);
  assert.equal(run("state.alerts.some(a=>a.key==='motion')"),true);
  run('state.motionReading.lastSampleAt=Date.now()-2000; maintainStatus()');
  assert.equal(nodes['#motionStatus'].textContent,'Motion unavailable');
  assert.notEqual(nodes['#speedSource'].textContent,'Motion only');
  assert.equal(run("state.alerts.some(a=>a.key==='motion')"),false);
});

test('motion denial, unsupported devices and opt-out do not stop assistance', async () => {
  const { run, nodes } = app();
  run("state.active=true; window.DeviceMotionEvent={requestPermission:async()=> 'denied'}");
  await run('startMotion(state.session)');
  assert.equal(nodes['#motionStatus'].textContent,'Motion permission denied');
  assert.equal(run('state.active'),true);
  run('delete window.DeviceMotionEvent');
  await run('startMotion(state.session)');
  assert.equal(nodes['#motionStatus'].textContent,'Motion unsupported');
  run('state.sessionSettings={motion:false}');
  await run('startMotion(state.session)');
  assert.equal(nodes['#motionStatus'].textContent,'Motion disabled');
});

test('late sensor permission cannot attach a listener after stopping', async () => {
  const { run, nodes } = app();
  run(`let grantMotion; let attached=0;
    window.addEventListener=()=>{attached++};
    window.DeviceMotionEvent={requestPermission:()=>new Promise(resolve=>{grantMotion=resolve})};
    const permission=startMotion(state.session); cleanUpDrive(); grantMotion('granted');`);
  await run('permission');
  assert.equal(run('attached'),0);
  assert.equal(nodes['#motionStatus'].textContent,'Motion off');
});
