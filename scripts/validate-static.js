'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'info.html', '404.html', 'offline.html', 'privacy.html'];
const errors = [];

for (const htmlFile of htmlFiles) {
  const source = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) errors.push(`${htmlFile}: duplicate IDs ${[...new Set(duplicateIds)].join(', ')}`);

  for (const match of source.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:https?:|data:|#|mailto:|tel:)/.test(reference)) continue;
    const cleanReference = reference.split(/[?#]/)[0] || '.';
    const resolved = path.resolve(root, cleanReference);
    if (!resolved.startsWith(root) || !fs.existsSync(resolved)) {
      errors.push(`${htmlFile}: missing local reference ${reference}`);
    }
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) {
  if (!fs.existsSync(path.join(root, icon.src))) errors.push(`manifest: missing icon ${icon.src}`);
}

const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
for (const match of serviceWorker.matchAll(/'\.\/([^']+)'/g)) {
  const candidate = match[1];
  if (candidate && !fs.existsSync(path.join(root, candidate))) {
    errors.push(`sw.js: missing cached file ${candidate}`);
  }
}

const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['startButton', 'stopButton', 'roadCamera', 'speedValue', 'latestAlert', 'motionStatus', 'setupMotion']) {
  if (!home.includes(`id="${id}"`)) errors.push(`index.html: missing essential driving control ${id}`);
}
for (const movedSection of ['capability-grid', 'settingsHeading', 'safetyHeading']) {
  if (home.includes(movedSection)) errors.push(`index.html: explanatory section must stay off the driving screen: ${movedSection}`);
}

const info = fs.readFileSync(path.join(root, 'info.html'), 'utf8');
for (const id of ['settingsHeading', 'speedLimit', 'confidence', 'enableLane', 'enableAudio', 'enableNotifications', 'enableMotion']) {
  if (!info.includes(`id="${id}"`)) errors.push(`info.html: missing setting ${id}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Static validation passed: ${htmlFiles.length} pages, ${manifest.icons.length} manifest icons.`);
}
