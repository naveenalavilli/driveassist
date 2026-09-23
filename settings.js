'use strict';

const settingsElements = {
  audio: document.querySelector('#enableAudio'),
  confidence: document.querySelector('#confidence'),
  lane: document.querySelector('#enableLane'),
  motion: document.querySelector('#enableMotion'),
  notifications: document.querySelector('#enableNotifications'),
  saveState: document.querySelector('#saveState'),
  speedLimit: document.querySelector('#speedLimit'),
};

function loadSetting(name, fallback) {
  try {
    const value = localStorage.getItem(`driveassist:${name}`);
    const parsed = value === null ? fallback : JSON.parse(value);
    if (typeof fallback === 'boolean' && typeof parsed !== 'boolean') return fallback;
    if (name === 'confidence' && ![0.45, 0.55, 0.7].includes(parsed)) return fallback;
    if (name === 'speedLimit' && !(Number.isInteger(parsed) && parsed >= 5 && parsed <= 85 && parsed % 5 === 0)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function saveSetting(name, value) {
  try {
    localStorage.setItem(`driveassist:${name}`, JSON.stringify(value));
    settingsElements.saveState.textContent = 'Saved on device';
  } catch {
    settingsElements.saveState.textContent = 'Could not save';
  }
}

function restoreSettings() {
  settingsElements.audio.checked = loadSetting('audio', true);
  settingsElements.confidence.value = String(loadSetting('confidence', 0.55));
  settingsElements.lane.checked = loadSetting('lane', false);
  settingsElements.motion.checked = loadSetting('motion', true);
  settingsElements.notifications.checked = loadSetting('notifications', false)
    && typeof Notification !== 'undefined'
    && Notification.permission === 'granted';
  settingsElements.speedLimit.value = String(loadSetting('speedLimit', ''));
}

async function updateNotifications() {
  if (!settingsElements.notifications.checked) {
    saveSetting('notifications', false);
    return;
  }
  if (typeof Notification === 'undefined') {
    settingsElements.notifications.checked = false;
    settingsElements.saveState.textContent = 'Notifications are not supported';
    return;
  }
  settingsElements.notifications.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    settingsElements.notifications.checked = permission === 'granted';
    saveSetting('notifications', settingsElements.notifications.checked);
    if (permission !== 'granted') settingsElements.saveState.textContent = 'Notification permission not granted';
  } catch {
    settingsElements.notifications.checked = false;
    saveSetting('notifications', false);
    settingsElements.saveState.textContent = 'Notifications are unavailable';
  } finally { settingsElements.notifications.disabled = false; }
}

restoreSettings();
settingsElements.audio.addEventListener('change', () => saveSetting('audio', settingsElements.audio.checked));
settingsElements.confidence.addEventListener('change', () => saveSetting('confidence', Number(settingsElements.confidence.value)));
settingsElements.lane.addEventListener('change', () => saveSetting('lane', settingsElements.lane.checked));
settingsElements.motion.addEventListener('change', () => saveSetting('motion', settingsElements.motion.checked));
settingsElements.notifications.addEventListener('change', updateNotifications);
settingsElements.speedLimit.addEventListener('change', () => saveSetting('speedLimit', Number(settingsElements.speedLimit.value)));
