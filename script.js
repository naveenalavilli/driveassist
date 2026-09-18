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
};

const state = {
  active: false,
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
  notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  stream: null,
};

const DETECTION_INTERVAL_MS = 260;
const LANE_INTERVAL_MS = 520;
const MAX_ALERTS = 5;

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
  return {
    audio: loadSetting('audio', true),
    confidence: Number(loadSetting('confidence', 0.55)),
    lane: loadSetting('lane', true),
    notifications: loadSetting('notifications', false),
    speedLimit: Number(loadSetting('speedLimit', 65)),
  };
}

function announceAlert(title, message, severity) {
  const settings = getSettings();
  if (settings.audio) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      state.audioContext ||= new AudioContextClass();
      const oscillator = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      oscillator.frequency.value = severity === 'critical' ? 880 : 620;
      gain.gain.setValueAtTime(0.08, state.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioContext.currentTime + 0.22);
      oscillator.connect(gain).connect(state.audioContext.destination);
      oscillator.start();
      oscillator.stop(state.audioContext.currentTime + 0.23);
    } catch {
      // The visual warning remains available when Web Audio is unavailable.
    }
  }

  if (settings.notifications && document.hidden && state.notificationPermission === 'granted') {
    try {
      new Notification(title, { body: message, icon: 'icons/icon-192.png', tag: title });
    } catch {
      // Notification support differs across mobile browsers.
    }
  }
}

function renderAlerts() {
  const latest = state.alerts[0];
  elements.latestAlert.textContent = latest?.title || 'Ready to assist';
  elements.latestAlert.dataset.severity = latest?.severity || 'info';
}

function addAlert(key, severity, title, message, cooldownMs = 5000) {
  const now = Date.now();
  if (now - (state.lastAlertAt.get(key) || 0) < cooldownMs) return;
  state.lastAlertAt.set(key, now);
  state.alerts.unshift({ key, severity, title, message, date: new Date(now) });
  state.alerts = state.alerts.slice(0, MAX_ALERTS);
  renderAlerts();
  if (severity === 'critical' || severity === 'caution') announceAlert(title, message, severity);
}

function modelAvailable() {
  return typeof window.cocoSsd !== 'undefined' && typeof window.tf !== 'undefined';
}

async function loadModel() {
  if (state.model) return state.model;
  if (state.modelPromise) return state.modelPromise;
  setChip(elements.modelStatus, 'AI loading', 'working');
  state.modelPromise = (async () => {
    if (!modelAvailable()) throw new Error('The AI libraries could not be loaded. Check your connection and retry.');
    if (typeof window.tf.ready === 'function') await window.tf.ready();
    state.model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    setChip(elements.modelStatus, 'AI ready', 'success');
    return state.model;
  })().catch((error) => {
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
  if (!getSettings().lane || !state.active) return;
  const processContext = elements.processingCanvas.getContext('2d', { willReadFrequently: true });
  processContext.drawImage(elements.video, 0, 0, elements.processingCanvas.width, elements.processingCanvas.height);
  const imageData = processContext.getImageData(0, 0, elements.processingCanvas.width, elements.processingCanvas.height);
  const lane = Core.analyzeLane(imageData, imageData.width, imageData.height);
  const stateLabels = {
    centered: 'Centered',
    'drifting-left': 'Correct right',
    'drifting-right': 'Correct left',
    searching: 'Searching',
    unavailable: 'Unavailable',
  };
  if (lane.state.startsWith('drifting')) {
    state.laneWarningFrames += 1;
    if (state.laneWarningFrames >= 3) {
      addAlert('lane', 'caution', 'Lane position changing', stateLabels[lane.state], 6500);
    }
  } else {
    state.laneWarningFrames = 0;
  }
  drawLane(context, lane, elements.detectionCanvas.width, elements.detectionCanvas.height);
}

async function detectFrame(now) {
  if (!state.active || state.detectionBusy || !state.model || now - state.lastDetectionAt < DETECTION_INTERVAL_MS) return;
  state.detectionBusy = true;
  state.lastDetectionAt = now;
  try {
    const settings = getSettings();
    const predictions = await state.model.detect(elements.video, 20, settings.confidence);
    if (!state.active) return;
    resizeCanvases();
    const context = elements.detectionCanvas.getContext('2d');
    context.clearRect(0, 0, elements.detectionCanvas.width, elements.detectionCanvas.height);
    const roadObjects = Core.filterRoadObjects(predictions, settings.confidence);
    for (const prediction of roadObjects) {
      const risk = Core.roadRisk(prediction, elements.video.videoWidth, elements.video.videoHeight);
      drawPrediction(context, prediction, risk);
      if (risk.severity === 'critical') {
        addAlert(`object:${prediction.class}`, 'critical', `${prediction.class} close ahead`, 'Slow down and keep your attention on the road.', 4500);
      }
    }
    if (now - state.lastLaneAt >= LANE_INTERVAL_MS) {
      state.lastLaneAt = now;
      analyzeCurrentLane(context);
    }
  } catch (error) {
    addAlert('detection-error', 'info', 'Road analysis paused', error.message || 'Could not analyze this frame.', 10000);
  } finally {
    state.detectionBusy = false;
  }
}

function frameLoop(now) {
  if (!state.active) {
    state.frameRequest = null;
    return;
  }
  detectFrame(now);
  state.frameRequest = requestAnimationFrame(frameLoop);
}

function handlePosition(geolocationPosition) {
  const position = {
    accuracy: geolocationPosition.coords.accuracy,
    latitude: geolocationPosition.coords.latitude,
    longitude: geolocationPosition.coords.longitude,
    speed: geolocationPosition.coords.speed,
    timestamp: geolocationPosition.timestamp,
  };
  if (position.accuracy > 80) {
    elements.speedSource.textContent = 'GPS signal weak';
    state.lastPosition = position;
    return;
  }
  const nextSpeed = Core.speedMphFromPosition(position, state.lastPosition);
  state.lastPosition = position;
  if (nextSpeed === null || nextSpeed > 180) return;
  state.lastSpeedMph = state.lastSpeedMph === null ? nextSpeed : (state.lastSpeedMph * 0.65) + (nextSpeed * 0.35);
  elements.speedValue.textContent = Core.formatSpeed(state.lastSpeedMph);
  elements.speedSource.textContent = position.speed === null ? 'GPS estimate' : 'Device GPS';
  const speedLimit = getSettings().speedLimit;
  if (state.lastSpeedMph > speedLimit + 3) {
    addAlert('overspeed', 'critical', 'Over speed limit', `${Math.round(state.lastSpeedMph)} mph · selected limit ${speedLimit} mph`, 8000);
  }
}

function handlePositionError(error) {
  const messages = {
    1: 'Location permission was denied. Speed alerts are unavailable.',
    2: 'Location is temporarily unavailable.',
    3: 'Location request timed out.',
  };
  elements.speedSource.textContent = 'Speed unavailable';
  addAlert('location', 'info', 'GPS speed unavailable', messages[error.code] || error.message, 12000);
}

function startLocation() {
  if (!('geolocation' in navigator)) {
    elements.speedSource.textContent = 'Not supported';
    return;
  }
  state.geoWatchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 10000,
  });
}

function waitForVideo() {
  return new Promise((resolve, reject) => {
    if (elements.video.readyState >= 2) return resolve();
    const timeout = setTimeout(() => reject(new Error('The camera did not become ready in time.')), 12000);
    elements.video.addEventListener('loadeddata', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    return undefined;
  });
}

function cleanUpDrive() {
  state.active = false;
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
  elements.speedValue.textContent = '--';
  elements.speedSource.textContent = 'Waiting for GPS';
  setChip(elements.cameraStatus, 'Camera off', 'neutral');
}

async function startDrive() {
  clearError();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError('DriveAssist needs HTTPS and a browser with camera support.');
    return;
  }
  elements.startButton.disabled = true;
  setChip(elements.appStatus, 'Starting', 'working');
  try {
    await loadModel();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, height: { ideal: 720 }, width: { ideal: 1280 } },
    });
    state.stream = stream;
    elements.video.srcObject = stream;
    await elements.video.play();
    await waitForVideo();
    resizeCanvases();
    state.active = true;
    elements.videoShell.dataset.active = 'true';
    elements.startButton.hidden = true;
    elements.stopButton.hidden = false;
    setChip(elements.appStatus, 'Drive active', 'success');
    setChip(elements.cameraStatus, 'Camera live', 'success');
    addAlert('ready', 'info', 'DriveAssist is active', 'Road awareness is processing locally on this device.', 0);
    startLocation();
    state.frameRequest = requestAnimationFrame(frameLoop);
  } catch (error) {
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
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

function initialize() {
  initializeInstallPrompt();
  registerServiceWorker();
  renderAlerts();
  elements.startButton.addEventListener('click', startDrive);
  elements.stopButton.addEventListener('click', () => stopDrive(true));
  window.addEventListener('pagehide', () => stopDrive(false));
  window.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.screen.orientation?.addEventListener('change', handleViewportChange);
  loadModel().catch(() => {});
}

initialize();
