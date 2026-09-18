'use strict';

const settingsElements = {
  audio: document.querySelector('#enableAudio'),
  confidence: document.querySelector('#confidence'),
  lane: document.querySelector('#enableLane'),
  notifications: document.querySelector('#enableNotifications'),
  saveState: document.querySelector('#saveState'),
  speedLimit: document.querySelector('#speedLimit'),
};

function loadSetting(name, fallback) {
  try {
    const value = localStorage.getItem(`driveassist:${name}`);
    return value === null ? fallback : JSON.parse(value);
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
  settingsElements.lane.checked = loadSetting('lane', true);
  settingsElements.notifications.checked = loadSetting('notifications', false)
    && typeof Notification !== 'undefined'
    && Notification.permission === 'granted';
  settingsElements.speedLimit.value = String(loadSetting('speedLimit', 65));
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
  const permission = await Notification.requestPermission();
  settingsElements.notifications.checked = permission === 'granted';
  saveSetting('notifications', settingsElements.notifications.checked);
}

restoreSettings();
settingsElements.audio.addEventListener('change', () => saveSetting('audio', settingsElements.audio.checked));
settingsElements.confidence.addEventListener('change', () => saveSetting('confidence', Number(settingsElements.confidence.value)));
settingsElements.lane.addEventListener('change', () => saveSetting('lane', settingsElements.lane.checked));
settingsElements.notifications.addEventListener('change', updateNotifications);
settingsElements.speedLimit.addEventListener('change', () => saveSetting('speedLimit', Number(settingsElements.speedLimit.value)));
