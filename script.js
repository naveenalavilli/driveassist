'use strict';

const Core = window.DriveAssistCore;
const elements = {
  appStatus: document.querySelector('#appStatus'),
  cameraStatus: document.querySelector('#cameraStatus'),
  detectionCanvas: document.querySelector('#detectionCanvas'),
  errorPanel: document.querySelector('#errorPanel'),
  errorText: document.querySelector('#errorText'),
  installButton: document.querySelector('#installButton'),
  latestAlert: document.querySelector('#latestAlert'),
  modelStatus: document.querySelector('#modelStatus'),
  processingCanvas: document.querySelector('#processingCanvas'),
  speedSource: document.querySelector('#speedSource'),
  speedValue: document.querySelector('#speedValue'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  video: document.querySelector('#roadCamera'),
  videoShell: document.querySelector('#videoShell'),
  limitStatus: document.querySelector('#limitStatus'),
  signStatus: document.querySelector('#signStatus'),
  motionStatus: document.querySelector('#motionStatus'),
  setupDialog: document.querySelector('#setupDialog'),
  setupForm: document.querySelector('#setupForm'),
  setupLimit: document.querySelector('#setupLimit'),
  setupLane: document.querySelector('#setupLane'),
  setupMotion: document.querySelector('#setupMotion'),
  setupCancel: document.querySelector('#setupCancel'),
};

const state = {
  active: false,
  starting: false,
  sessionAbort: null,
  wakeLock: null,
  lastFrameAt: 0,
  lastVideoTime: -1,
  lastAnalysisAt: 0,
  laneEstimate: null,
  alerts: [],
  audioContext: null,
  deferredInstallPrompt: null,
  detectionBusy: false,
  frameRequest: null,
  geoWatchId: null,
  laneWarningFrames: 0,
  lastAlertAt: new Map(),
  lastDetectionAt: 0,
  lastLaneAt: 0,
  lastPosition: null,
  lastSpeedMph: null,
  model: null,
  modelPromise: null,
  modelAttempt: 0,
  notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  stream: null,
  session: 0,
  lastSpeedAt: 0,
  maintenanceTimer: null,
  lastAudioAt: 0,
  lastAudioSeverity: 'info',
  signReader: null,
  signBusy: false,
  lastSignAt: 0,
  detectedLimit: null,
  stopSignObservation: null,
  sessionSettings: null,
  motionAccess: 'off',
  motionReading: null,
  motionListeningAt: 0,
  gpsStatus: 'Waiting for GPS',
};

const DETECTION_INTERVAL_MS = 260;
const LANE_INTERVAL_MS = 520;
const GPS_MAX_AGE_MS = 5000;
const SIGN_LIMIT_TTL_MS = 30000;

function setChip(element, label, tone) {
  element.textContent = label;
  element.dataset.tone = tone || 'neutral';
}

function showError(message) {
  elements.errorText.textContent = message;
  elements.errorPanel.hidden = false;
}

function clearError() {
  elements.errorPanel.hidden = true;
  elements.errorText.textContent = '';
}

function loadSetting(name, fallback) {
  try {
    const value = localStorage.getItem(`driveassist:${name}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getSettings() {
  const settings = {
    audio: loadSetting('audio', true),
    confidence: Number(loadSetting('confidence', 0.55)),
    lane: loadSetting('lane', false),
    motion: loadSetting('motion', true),
    notifications: loadSetting('notifications', false),
    speedLimit: loadSetting('speedLimit', null),
    ...state.sessionSettings,
  };
  for (const [name, fallback] of Object.entries({ audio: true, lane: false, motion: true, notifications: false })) {
    if (typeof settings[name] !== 'boolean') settings[name] = fallback;
  }
  if (![0.45, 0.55, 0.7].includes(settings.confidence)) settings.confidence = 0.55;
  if (!Core.validSpeedLimit(settings.speedLimit)) settings.speedLimit = null;
  return settings;
}

function announceAlert(title, message, severity) {
  const now = Date.now();
  if (now - state.lastAudioAt < 2000 && !(severity === 'critical' && state.lastAudioSeverity !== 'critical')) return false;
  const settings = getSettings();
  if (settings.audio) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      state.audioContext ||= new AudioContextClass();
      if (state.audioContext.state !== 'running') return false;
      const oscillator = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      oscillator.frequency.value = severity === 'critical' ? 880 : 620;
      gain.gain.setValueAtTime(0.08, state.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioContext.currentTime + 0.22);
      oscillator.connect(gain).connect(state.audioContext.destination);
      oscillator.start();
      oscillator.stop(state.audioContext.currentTime + 0.23);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      state.lastAudioAt = now;
      state.lastAudioSeverity = severity;
      return true;
    } catch {
      // The visual warning remains available when Web Audio is unavailable.
    }
  }
  return false;
}

function notifyPaused() {
  if (!getSettings().notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title = 'DriveAssist paused';
  const options = { body: 'Assistance stopped because the app is hidden. Restart only while parked.', icon: 'icons/icon-192.png', tag: 'driveassist-paused' };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, options)).catch(() => {});
  } else {
    try { new Notification(title, options); } catch { /* Browser does not support notifications. */ }
  }
}

function renderAlerts() {
  state.alerts = Core.currentAlerts(state.alerts, Date.now());
  const latest = state.alerts[0];
  const title = latest?.title || (state.active ? 'Monitoring road' : 'Ready to assist');
  if (elements.latestAlert.textContent !== title) elements.latestAlert.textContent = title;
  elements.latestAlert.dataset.severity = latest?.severity || 'info';
}

function clearAlert(key) {
  state.alerts = state.alerts.filter((alert) => alert.key !== key);
  renderAlerts();
}

function addAlert(key, severity, title, message, cooldownMs = 5000, ttlMs = 3000) {
  const now = Date.now();
  state.alerts = state.alerts.filter((alert) => alert.key !== key);
  state.alerts.push({ key, severity, title, message, updatedAt: now, expiresAt: now + ttlMs });
  renderAlerts();
  const lastSound = state.lastAlertAt.get(key);
  const escalated = severity === 'critical' && lastSound?.severity === 'caution';
  if (state.alerts[0]?.key === key && (escalated || !lastSound || now - lastSound.at >= cooldownMs)) {
    if ((severity === 'critical' || severity === 'caution') && announceAlert(title, message, severity)) {
      state.lastAlertAt.set(key, { at: now, severity });
    }
  }
}

function modelAvailable() {
  return typeof window.cocoSsd !== 'undefined' && typeof window.tf !== 'undefined';
}

async function loadModel() {
  if (state.model) return state.model;
  if (state.modelPromise) return state.modelPromise;
  setChip(elements.modelStatus, 'AI loading', 'working');
  const attempt = ++state.modelAttempt;
  const operation = (async () => {
    if (!modelAvailable()) throw new Error('The AI libraries could not be loaded. Restore your connection and reload the page.');
    if (typeof window.tf.ready === 'function') await window.tf.ready();
    if (attempt !== state.modelAttempt) return null;
    const model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    if (attempt !== state.modelAttempt) { model.dispose?.(); return null; }
    return model;
  })();
  state.modelPromise = startupStep(operation, new AbortController().signal).then((model) => {
    state.model = model;
    setChip(elements.modelStatus, 'AI ready', 'success');
    return model;
  }).catch((error) => {
    if (attempt === state.modelAttempt) state.modelAttempt += 1;
    state.modelPromise = null;
    setChip(elements.modelStatus, 'AI unavailable', 'danger');
    showError(error.message || 'The road-awareness model failed to load.');
    throw error;
  });
  return state.modelPromise;
}

function resizeCanvases() {
  const width = elements.video.videoWidth || 1280;
  const height = elements.video.videoHeight || 720;
  if (elements.detectionCanvas.width !== width) elements.detectionCanvas.width = width;
  if (elements.detectionCanvas.height !== height) elements.detectionCanvas.height = height;
}

function handleViewportChange() {
  requestAnimationFrame(resizeCanvases);
  setTimeout(resizeCanvases, 180);
}

function drawPrediction(context, prediction, risk) {
  const [x, y, width, height] = prediction.bbox;
  const color = risk.severity === 'critical' ? '#ff5c68' : risk.severity === 'caution' ? '#ffca57' : '#47e6b1';
  const label = `${prediction.class} · ${Math.round(prediction.score * 100)}% · ${risk.proximity}`;
  context.strokeStyle = color;
  context.lineWidth = Math.max(3, elements.detectionCanvas.width / 360);
  context.strokeRect(x, y, width, height);
  context.font = `${Math.max(16, elements.detectionCanvas.width / 46)}px Inter, system-ui, sans-serif`;
  const metrics = context.measureText(label);
  const labelHeight = Math.max(32, elements.detectionCanvas.width / 27);
  const labelY = Math.max(0, y - labelHeight);
  context.fillStyle = 'rgba(5, 13, 25, 0.9)';
  context.beginPath();
  context.roundRect(x, labelY, metrics.width + 20, labelHeight, 8);
  context.fill();
  context.fillStyle = color;
  context.fillText(label, x + 10, labelY + labelHeight * 0.7);
}

function drawLane(context, lane, sourceWidth, sourceHeight) {
  if (!lane || lane.leftX === null || lane.rightX === null) return;
  const scaleX = sourceWidth / elements.processingCanvas.width;
  const scaleY = sourceHeight / elements.processingCanvas.height;
  const yBottom = elements.processingCanvas.height * 0.92 * scaleY;
  const yTop = elements.processingCanvas.height * 0.58 * scaleY;
  const convergence = sourceWidth * 0.12;
  context.lineWidth = Math.max(4, sourceWidth / 260);
  context.strokeStyle = lane.state === 'centered' ? 'rgba(71, 230, 177, 0.82)' : 'rgba(255, 202, 87, 0.9)';
  context.setLineDash([18, 12]);
  context.beginPath();
  context.moveTo(lane.leftX * scaleX, yBottom);
  context.lineTo((lane.leftX * scaleX) + convergence, yTop);
  context.moveTo(lane.rightX * scaleX, yBottom);
  context.lineTo((lane.rightX * scaleX) - convergence, yTop);
  context.stroke();
  context.setLineDash([]);
}

function analyzeCurrentLane(context) {
  if (!getSettings().lane || !state.active) { state.laneEstimate = null; clearAlert('lane'); return; }
  const processContext = elements.processingCanvas.getContext('2d', { willReadFrequently: true });
  processContext.drawImage(elements.video, 0, 0, elements.processingCanvas.width, elements.processingCanvas.height);
  const imageData = processContext.getImageData(0, 0, elements.processingCanvas.width, elements.processingCanvas.height);
  const lane = Core.analyzeLane(imageData, imageData.width, imageData.height);
  const previousLane = state.laneEstimate;
  state.laneEstimate = lane;
  const stateLabels = {
    centered: 'Centered',
    'drifting-left': 'Correct right',
    'drifting-right': 'Correct left',
    searching: 'Searching',
    unavailable: 'Unavailable',
  };
  if (lane.state.startsWith('drifting')) {
    state.laneWarningFrames = previousLane?.state === lane.state ? state.laneWarningFrames + 1 : 1;
    if (state.laneWarningFrames >= 3) {
      addAlert('lane', 'caution', 'Lane position changing', stateLabels[lane.state], 6500);
    }
  } else {
    state.laneWarningFrames = 0;
    clearAlert('lane');
  }
}

async function detectFrame(now) {
  if (!state.active || state.detectionBusy || !state.model || now - state.lastDetectionAt < DETECTION_INTERVAL_MS) return;
  state.detectionBusy = true;
  state.lastDetectionAt = now;
  const session = state.session;
  const capturedAt = Date.now();
  try {
    const settings = getSettings();
    const predictions = await state.model.detect(elements.video, 20, settings.confidence);
    if (!state.active || session !== state.session) return;
    if (Date.now() - capturedAt > 3000) { markAnalysisUnavailable(); return; }
    state.lastAnalysisAt = Date.now();
    setChip(elements.modelStatus, 'AI active', 'success');
    clearAlert('detection-error');
    resizeCanvases();
    const context = elements.detectionCanvas.getContext('2d');
    context.clearRect(0, 0, elements.detectionCanvas.width, elements.detectionCanvas.height);
    const roadObjects = Core.filterRoadObjects(predictions, settings.confidence);
    const objectAlerts = new Map();
    let stopSign = null;
    for (const prediction of roadObjects) {
      const risk = Core.roadRisk(prediction, elements.video.videoWidth, elements.video.videoHeight);
      drawPrediction(context, prediction, risk);
      if (prediction.class === 'stop sign') {
        if (!stopSign || prediction.score > stopSign.score) stopSign = prediction;
        continue;
      }
      if (risk.severity === 'critical') {
        objectAlerts.set(`object:${prediction.class}`, prediction);
      }
    }
    state.alerts = state.alerts.filter((alert) => !alert.key.startsWith('object:') || objectAlerts.has(alert.key));
    for (const [key, prediction] of objectAlerts) {
      addAlert(key, 'critical', `${prediction.class} close ahead`, 'Check the road ahead.', 4500);
    }
    const stopBox = stopSign?.bbox.map((value, index) => value / (index % 2 ? elements.video.videoHeight : elements.video.videoWidth));
    state.stopSignObservation = stopSign
      ? Core.confirmSign(state.stopSignObservation, { type: 'stop', label: 'Stop sign' }, stopBox, Date.now()) : null;
    if (state.stopSignObservation?.confirmed) {
      const warning = Core.signWarning(state.stopSignObservation.sign, state.lastSpeedMph,
        Core.relativeProximity(stopSign, elements.video.videoWidth, elements.video.videoHeight).label);
      addAlert('stop-sign', warning.severity, warning.title, 'Check the posted sign and road ahead.', 6000);
    } else if (!stopSign) clearAlert('stop-sign');
    if (now - state.lastLaneAt >= LANE_INTERVAL_MS) {
      state.lastLaneAt = now;
      analyzeCurrentLane(context);
    }
    drawLane(context, state.laneEstimate, elements.detectionCanvas.width, elements.detectionCanvas.height);
    renderAlerts();
  } catch (error) {
    if (!state.active || session !== state.session) return;
    markAnalysisUnavailable();
  } finally {
    if (session === state.session) state.detectionBusy = false;
  }
}

function markAnalysisUnavailable() {
  state.laneEstimate = null;
  state.laneWarningFrames = 0;
  state.stopSignObservation = null;
  state.alerts = state.alerts.filter((alert) => !alert.key.startsWith('object:') && alert.key !== 'lane' && alert.key !== 'stop-sign');
  elements.detectionCanvas.getContext('2d').clearRect(0, 0, elements.detectionCanvas.width, elements.detectionCanvas.height);
  setChip(elements.modelStatus, 'AI paused', 'warning');
  addAlert('detection-error', 'info', 'Road analysis paused', 'No recent analysis is available.', 10000);
}

function frameLoop(now) {
  if (!state.active) {
    state.frameRequest = null;
    return;
  }
  detectFrame(now);
  readSigns(now);
  state.frameRequest = requestAnimationFrame(frameLoop);
}

function handlePosition(geolocationPosition) {
  if (!state.active) return;
  const position = {
    accuracy: geolocationPosition.coords.accuracy,
    latitude: geolocationPosition.coords.latitude,
    longitude: geolocationPosition.coords.longitude,
    speed: geolocationPosition.coords.speed,
    timestamp: geolocationPosition.timestamp,
  };
  if (!Number.isFinite(position.timestamp) || !Number.isFinite(position.accuracy) || position.accuracy < 0 || position.accuracy > 80
    || Date.now() - position.timestamp > GPS_MAX_AGE_MS || position.timestamp > Date.now() + 1000) {
    invalidateSpeed('GPS signal weak or stale');
    return;
  }
  if (state.lastPosition && position.timestamp <= state.lastPosition.timestamp) return;
  const deviceSpeed = Number.isFinite(position.speed) && position.speed >= 0;
  // Keep the anchor until a full second has elapsed; frequent fixes otherwise
  // continually reset the position/time fallback before it can produce a speed.
  if (!deviceSpeed && state.lastPosition && position.timestamp - state.lastPosition.timestamp < 1000) return;
  const nextSpeed = Core.speedMphFromPosition(position, state.lastPosition);
  if (!Number.isFinite(nextSpeed) || nextSpeed > 180) {
    // Accumulate displacement until it exceeds GPS uncertainty, up to 10s.
    if (!state.lastPosition || nextSpeed > 180 || position.timestamp - state.lastPosition.timestamp >= 10000) state.lastPosition = position;
    invalidateSpeed('Waiting for GPS', false);
    return;
  }
  state.lastPosition = position;
  clearAlert('location');
  state.lastSpeedAt = position.timestamp;
  state.lastSpeedMph = deviceSpeed || state.lastSpeedMph === null ? nextSpeed : (state.lastSpeedMph * 0.65) + (nextSpeed * 0.35);
  elements.speedValue.textContent = Core.formatSpeed(state.lastSpeedMph);
  elements.speedSource.textContent = deviceSpeed ? 'GPS estimate' : 'GPS position estimate';
  updateSpeedWarning();
  refreshMotionStatus();
}

function invalidateSpeed(label, resetPosition = true) {
  state.gpsStatus = label;
  state.lastSpeedMph = null;
  state.lastSpeedAt = 0;
  if (resetPosition) state.lastPosition = null;
  elements.speedValue.textContent = '--';
  elements.speedSource.textContent = label;
  clearAlert('overspeed');
  state.alerts = state.alerts.filter((alert) => !alert.key.startsWith('sign:speed-limit'));
  renderAlerts();
  refreshMotionStatus();
}

// Called synchronously from Start so permission-gated browsers retain the gesture.
async function startMotion(session) {
  state.motionReading = null;
  if (!getSettings().motion) { state.motionAccess = 'disabled'; refreshMotionStatus(); return; }
  const MotionEvent = window.DeviceMotionEvent;
  if (!MotionEvent) { state.motionAccess = 'unsupported'; refreshMotionStatus(); return; }
  state.motionAccess = 'requesting';
  refreshMotionStatus();
  try {
    const permission = typeof MotionEvent.requestPermission === 'function'
      ? await MotionEvent.requestPermission() : 'granted';
    if (session !== state.session) return;
    state.motionAccess = permission === 'granted' ? 'listening' : 'denied';
    if (permission === 'granted') {
      state.motionListeningAt = Date.now();
      window.addEventListener('devicemotion', handleMotion);
    }
  } catch {
    if (session !== state.session) return;
    state.motionAccess = 'denied';
  }
  refreshMotionStatus();
}

function handleMotion(event) {
  if (!state.active || state.motionAccess !== 'listening') return;
  state.motionReading = Core.analyzeMotion(state.motionReading, event, Date.now());
  refreshMotionStatus();
}

function refreshMotionStatus() {
  const now = Date.now();
  if (state.lastSpeedAt && now - state.lastSpeedAt > GPS_MAX_AGE_MS) {
    invalidateSpeed('GPS stale');
    return;
  }
  const fresh = state.active && state.motionAccess === 'listening' && Core.motionIsFresh(state.motionReading, now);
  const gpsAvailable = Number.isFinite(state.lastSpeedMph) && state.lastSpeedAt > 0
    && now - state.lastSpeedAt <= GPS_MAX_AGE_MS;
  let label;
  if (fresh) {
    label = gpsAvailable ? 'Motion ready · GPS active'
      : state.motionReading.strong ? 'Motion fallback · strong movement'
        : state.motionReading.rotating ? 'Motion fallback · phone rotation' : 'Motion fallback · no speed';
  } else {
    const labels = { off: 'Motion off', disabled: 'Motion disabled', unsupported: 'Motion unsupported',
      denied: 'Motion permission denied', requesting: 'Motion permission pending' };
    label = labels[state.motionAccess] || (state.motionReading || now - state.motionListeningAt > 4000
      ? 'Motion unavailable' : 'Waiting for motion sensors');
  }
  if (elements.motionStatus.textContent !== label) elements.motionStatus.textContent = label;
  elements.motionStatus.dataset.tone = fresh ? (gpsAvailable ? 'success' : 'warning') : 'neutral';
  if (fresh && !gpsAvailable) {
    // Preserve the GPS boundary: motion never populates mph or speed-based alerts.
    elements.speedSource.textContent = 'Motion only';
    if (state.motionReading.strong) {
      addAlert('motion', 'caution', 'Strong phone movement', 'Motion-only estimate. Check the road and phone mount.', 8000, 1500);
    } else clearAlert('motion');
  } else {
    if (elements.speedSource.textContent === 'Motion only') elements.speedSource.textContent = state.gpsStatus;
    clearAlert('motion');
  }
}

function updateSpeedWarning() {
  const manual = getSettings().speedLimit;
  const detected = state.detectedLimit;
  const limit = Core.validSpeedLimit(manual) ? Math.min(manual, detected?.limit || manual) : null;
  elements.limitStatus.textContent = limit === null ? 'Select speed threshold'
    : detected && detected.limit <= manual ? `Alert ${limit} mph · sign estimate` : `Alert ${limit} mph · selected`;
  if (Number.isFinite(state.lastSpeedMph) && limit !== null && state.lastSpeedMph > limit + 3) {
    addAlert('overspeed', state.lastSpeedMph > limit + 10 ? 'critical' : 'caution',
      `Above ${limit} mph ${detected && detected.limit <= manual ? 'sign estimate' : 'selected threshold'}`,
      'Check posted signs and your speed.', 8000, GPS_MAX_AGE_MS);
  } else clearAlert('overspeed');
}

function maintainStatus() {
  if (state.active && state.stream) {
    const track = state.stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended' || track.muted) { cameraInterrupted(); return; }
    if (elements.video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = elements.video.currentTime;
      state.lastFrameAt = Date.now();
    } else if (Date.now() - state.lastFrameAt > 5000) { cameraInterrupted(); return; }
    if (Date.now() - state.lastAnalysisAt > 5000) markAnalysisUnavailable();
  }
  if (state.lastSpeedAt && Date.now() - state.lastSpeedAt > GPS_MAX_AGE_MS) invalidateSpeed('GPS stale');
  if (state.detectedLimit && state.detectedLimit.expiresAt <= Date.now()) state.detectedLimit = null;
  if (state.active) updateSpeedWarning();
  refreshMotionStatus();
  renderAlerts();
}

async function initializeSigns(session) {
  let reader;
  setChip(elements.signStatus, 'Signs loading', 'working');
  try {
    reader = new window.DriveAssistSignReader();
    state.signReader = reader;
    await reader.initialize();
    if (session !== state.session || !state.active) { reader.close(); return; }
    setChip(elements.signStatus, 'Signs experimental', 'success');
  } catch {
    reader?.close();
    if (session !== state.session) return;
    state.signReader = null;
    setChip(elements.signStatus, 'Text signs unavailable', 'warning');
  }
}

async function readSigns(now) {
  if (!state.signReader?.worker || state.signBusy || now - state.lastSignAt < 1600) return;
  state.signBusy = true;
  state.lastSignAt = now;
  const session = state.session;
  const capturedAt = Date.now();
  try {
    const observations = await state.signReader.read(elements.video);
    if (!state.active || session !== state.session || Date.now() - capturedAt > 6000) return;
    const activeKeys = new Set();
    const warnings = new Map();
    for (const { sign, bbox } of observations) {
      const key = `sign:${sign.type}`;
      activeKeys.add(key);
      if (sign.type === 'speed-limit') {
        // OCR can lower the selected threshold, never silently increase it.
        if (!state.detectedLimit || sign.limit <= state.detectedLimit.limit) {
          state.detectedLimit = { limit: sign.limit, expiresAt: Date.now() + SIGN_LIMIT_TTL_MS };
        }
        updateSpeedWarning();
      }
      const warning = Core.signWarning(sign, state.lastSpeedMph, bbox[2] * bbox[3] >= 0.035 ? 'near' : 'far');
      const rank = { info: 0, caution: 1, critical: 2 };
      if (!warnings.has(key) || rank[warning.severity] > rank[warnings.get(key).severity]) warnings.set(key, warning);
    }
    for (const [key, warning] of warnings) {
      addAlert(key, warning.severity, warning.title, 'Experimental sign estimate. Check the posted sign.', 8000, 6000);
    }
    state.alerts = state.alerts.filter((alert) => !alert.key.startsWith('sign:') || activeKeys.has(alert.key));
    renderAlerts();
  } catch {
    if (session === state.session) {
      state.signReader?.close();
      state.signReader = null;
      setChip(elements.signStatus, 'Text signs unavailable', 'warning');
      state.detectedLimit = null;
      state.alerts = state.alerts.filter((alert) => !alert.key.startsWith('sign:'));
      updateSpeedWarning();
    }
  } finally {
    if (session === state.session) state.signBusy = false;
  }
}

function handlePositionError(error) {
  if (!state.active) return;
  const messages = {
    1: 'Location permission was denied. Speed alerts are unavailable.',
    2: 'Location is temporarily unavailable.',
    3: 'Location request timed out.',
  };
  invalidateSpeed('Speed unavailable');
  addAlert('location', 'info', 'GPS speed unavailable', messages[error.code] || error.message, 12000);
}

function startLocation() {
  if (!('geolocation' in navigator)) {
    invalidateSpeed('GPS unsupported');
    return;
  }
  const session = state.session;
  try {
    state.geoWatchId = navigator.geolocation.watchPosition(
      (position) => { if (session === state.session) handlePosition(position); },
      (error) => { if (session === state.session) handlePositionError(error); }, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 10000,
    });
  } catch { invalidateSpeed('GPS unavailable'); }
}

function waitForVideo(signal) {
  return new Promise((resolve, reject) => {
    if (elements.video.readyState >= 2) return resolve();
    const finish = (error) => {
      clearTimeout(timeout);
      elements.video.removeEventListener('loadeddata', ready);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const cancel = () => finish(new Error('Startup cancelled'));
    const timeout = setTimeout(() => finish(new Error('The camera did not become ready in time.')), 12000);
    elements.video.addEventListener('loadeddata', ready, { once: true });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    return undefined;
  });
}

function startupStep(operation, signal, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); callback(value); };
    const cancel = () => finish(reject, new Error('Startup cancelled'));
    const timer = setTimeout(() => finish(reject, new Error('Startup timed out. Check permissions and connection, then retry.')), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(operation).then((value) => finish(resolve, value), (error) => finish(reject, error));
    if (signal.aborted) cancel();
  });
}

function cameraInterrupted() {
  if (!state.active && !state.starting) return;
  stopDrive(false);
  setChip(elements.appStatus, 'Camera interrupted', 'danger');
  showError('Camera feed interrupted. Restart assistance only while parked.');
}

async function keepScreenAwake(session) {
  if (!navigator.wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (session !== state.session || !state.active) { await lock.release(); return; }
    state.wakeLock = lock;
    lock.addEventListener('release', () => { if (state.wakeLock === lock) state.wakeLock = null; });
  } catch { /* Unsupported or denied wake lock does not block assistance. */ }
}

function handleVisibilityChange() {
  if (document.hidden && (state.active || state.starting)) {
    notifyPaused();
    stopDrive(false);
    addAlert('hidden', 'info', 'Paused — tap Start when parked', 'Assistance stops when this screen is hidden.', 0, 60000);
  }
}

function cleanUpDrive() {
  state.session += 1;
  state.sessionAbort?.abort();
  state.sessionAbort = null;
  state.starting = false;
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
  state.laneEstimate = null;
  state.active = false;
  window.removeEventListener('devicemotion', handleMotion);
  state.motionAccess = 'off';
  state.motionReading = null;
  state.motionListeningAt = 0;
  state.gpsStatus = 'Waiting for GPS';
  clearInterval(state.maintenanceTimer);
  state.maintenanceTimer = null;
  state.signReader?.close();
  state.signReader = null;
  state.signBusy = false;
  state.detectedLimit = null;
  state.stopSignObservation = null;
  state.lastSpeedAt = 0;
  state.laneWarningFrames = 0;
  state.lastDetectionAt = 0;
  state.lastLaneAt = 0;
  state.lastSignAt = 0;
  state.alerts = [];
  state.lastAlertAt.clear();
  state.lastAudioAt = 0;
  state.lastAudioSeverity = 'info';
  if (state.frameRequest !== null) cancelAnimationFrame(state.frameRequest);
  state.frameRequest = null;
  state.detectionBusy = false;
  if (state.geoWatchId !== null) navigator.geolocation.clearWatch(state.geoWatchId);
  state.geoWatchId = null;
  state.lastPosition = null;
  state.lastSpeedMph = null;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.video.srcObject = null;
  elements.detectionCanvas.getContext('2d').clearRect(0, 0, elements.detectionCanvas.width, elements.detectionCanvas.height);
  elements.videoShell.dataset.active = 'false';
  elements.startButton.hidden = false;
  elements.startButton.disabled = false;
  elements.stopButton.hidden = true;
  elements.stopButton.textContent = 'Stop';
  elements.speedValue.textContent = '--';
  elements.speedSource.textContent = 'Waiting for GPS';
  setChip(elements.cameraStatus, 'Camera off', 'neutral');
  setChip(elements.signStatus, 'Signs off', 'neutral');
  if (state.model) setChip(elements.modelStatus, 'AI ready', 'success');
  updateSpeedWarning();
  renderAlerts();
  refreshMotionStatus();
}

async function startDrive() {
  clearError();
  if (state.active || state.starting || document.hidden) return;
  if ((!loadSetting('setupComplete', false) && !state.sessionSettings) || !Core.validSpeedLimit(getSettings().speedLimit)) {
    elements.setupLimit.value = Core.validSpeedLimit(getSettings().speedLimit) ? String(getSettings().speedLimit) : '';
    elements.setupLane.checked = getSettings().lane;
    elements.setupMotion.checked = getSettings().motion;
    elements.setupDialog.showModal();
    return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError('DriveAssist needs HTTPS and a browser with camera support.');
    return;
  }
  elements.startButton.disabled = true;
  elements.startButton.hidden = true;
  elements.stopButton.hidden = false;
  elements.stopButton.textContent = 'Cancel startup';
  state.starting = true;
  state.sessionAbort = new AbortController();
  const signal = state.sessionAbort.signal;
  const session = ++state.session;
  setChip(elements.appStatus, 'Starting', 'working');
  try {
    // Denial or unavailable sensors must not block camera/GPS assistance.
    startMotion(session);
    // Unlock audio during the user's click, before awaiting camera/model work.
    if (getSettings().audio) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        state.audioContext ||= new AudioContextClass();
        state.audioContext.resume().catch(() => {});
      }
    }
    await startupStep(loadModel(), signal);
    if (session !== state.session) return;
    const cameraRequest = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, height: { ideal: 720 }, width: { ideal: 1280 } },
    }).then((stream) => {
      if (session !== state.session || signal.aborted) stream.getTracks().forEach((track) => track.stop());
      return stream;
    });
    const stream = await startupStep(cameraRequest, signal);
    if (session !== state.session) { stream.getTracks().forEach((track) => track.stop()); return; }
    state.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => { if (session === state.session) cameraInterrupted(); }, { once: true });
      track.addEventListener('mute', () => { if (session === state.session && state.active) cameraInterrupted(); }, { once: true });
    }
    elements.video.srcObject = stream;
    await startupStep(elements.video.play(), signal, 12000);
    await waitForVideo(signal);
    if (session !== state.session) return;
    resizeCanvases();
    state.active = true;
    state.starting = false;
    state.lastFrameAt = Date.now();
    state.lastAnalysisAt = Date.now();
    state.lastVideoTime = -1;
    keepScreenAwake(session);
    refreshMotionStatus();
    elements.videoShell.dataset.active = 'true';
    elements.startButton.hidden = true;
    elements.stopButton.hidden = false;
    elements.stopButton.textContent = 'Stop';
    setChip(elements.appStatus, 'Drive active', 'success');
    setChip(elements.cameraStatus, 'Camera live', 'success');
    addAlert('ready', 'info', 'DriveAssist is active', 'Road awareness is processing locally on this device.', 0);
    startLocation();
    updateSpeedWarning();
    state.maintenanceTimer = setInterval(maintainStatus, 500);
    initializeSigns(session);
    state.frameRequest = requestAnimationFrame(frameLoop);
  } catch (error) {
    if (session !== state.session) return;
    cleanUpDrive();
    const permissionDenied = error?.name === 'NotAllowedError';
    showError(permissionDenied
      ? 'Camera permission was denied. Allow camera access in browser settings, then retry.'
      : (error.message || 'DriveAssist could not start.'));
    setChip(elements.appStatus, 'Start failed', 'danger');
  }
}

function stopDrive(addStoppedAlert = true) {
  cleanUpDrive();
  setChip(elements.appStatus, 'Ready', 'neutral');
  if (addStoppedAlert) addAlert('stopped', 'info', 'Drive ended', 'Camera and GPS access have stopped.', 0);
}

function initializeInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('./sw.js');
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage('cache-models');
      } catch { /* Online assistance remains usable without a service worker. */ }
    });
  }
}

function initialize() {
  initializeInstallPrompt();
  registerServiceWorker();
  renderAlerts();
  elements.startButton.addEventListener('click', startDrive);
  elements.stopButton.addEventListener('click', () => stopDrive(true));
  elements.setupCancel.addEventListener('click', () => elements.setupDialog.close());
  elements.setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const speedLimit = Number(elements.setupLimit.value);
    if (!Core.validSpeedLimit(speedLimit) || !elements.setupForm.reportValidity()) return;
    state.sessionSettings = { speedLimit, lane: elements.setupLane.checked, motion: elements.setupMotion.checked };
    try {
      localStorage.setItem('driveassist:speedLimit', JSON.stringify(speedLimit));
      localStorage.setItem('driveassist:lane', JSON.stringify(elements.setupLane.checked));
      localStorage.setItem('driveassist:motion', JSON.stringify(elements.setupMotion.checked));
      localStorage.setItem('driveassist:setupComplete', 'true');
      state.sessionSettings = null;
    } catch { /* Session preferences still apply when storage is unavailable. */ }
    elements.setupDialog.close();
    startDrive();
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', () => stopDrive(false));
  window.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.screen.orientation?.addEventListener('change', handleViewportChange);
  loadModel().catch(() => {});
  updateSpeedWarning();
}

initialize();
