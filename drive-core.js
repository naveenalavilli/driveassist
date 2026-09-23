(function attachDriveAssistCore(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.DriveAssistCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDriveAssistCore() {
  'use strict';

  const MPH_PER_MPS = 2.2369362921;
  const ROAD_OBJECTS = new Set([
    'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'traffic light', 'stop sign',
  ]);
  const OBJECT_WEIGHTS = {
    person: 4,
    bicycle: 3,
    car: 3,
    motorcycle: 3,
    bus: 3,
    truck: 3,
    'traffic light': 1,
    'stop sign': 3,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  function haversineMeters(first, second) {
    if (!first || !second) return 0;
    const earthRadiusMeters = 6371000;
    const latitudeDelta = toRadians(second.latitude - first.latitude);
    const longitudeDelta = toRadians(second.longitude - first.longitude);
    const firstLatitude = toRadians(first.latitude);
    const secondLatitude = toRadians(second.latitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(firstLatitude) * Math.cos(secondLatitude)
      * Math.sin(longitudeDelta / 2) ** 2;
    const bounded = clamp(a, 0, 1);
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
  }

  function speedMphFromPosition(position, previousPosition) {
    if (!position) return null;
    if (Number.isFinite(position.speed) && position.speed >= 0) {
      return position.speed * MPH_PER_MPS;
    }
    if (!previousPosition || !Number.isFinite(position.timestamp)
      || !Number.isFinite(previousPosition.timestamp)) return null;
    const elapsedSeconds = (position.timestamp - previousPosition.timestamp) / 1000;
    if (elapsedSeconds < 1 || elapsedSeconds > 10) return null;
    if (position.accuracy > 80 || previousPosition.accuracy > 80) return null;
    const validCoordinates = (point) => Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
      && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
    if (!validCoordinates(position) || !validCoordinates(previousPosition)) return null;
    const distance = haversineMeters(previousPosition, position);
    const uncertainty = Math.max(0, position.accuracy || 0) + Math.max(0, previousPosition.accuracy || 0);
    // Displacement within the accuracy bounds may just be GPS jitter.
    if (distance <= uncertainty) return null;
    return (distance / elapsedSeconds) * MPH_PER_MPS;
  }

  function formatSpeed(speedMph) {
    if (!Number.isFinite(speedMph)) return '--';
    return String(Math.max(0, Math.round(speedMph)));
  }

  function relativeProximity(prediction, frameWidth, frameHeight) {
    if (!prediction || !prediction.bbox || !frameWidth || !frameHeight) {
      return { label: 'unknown', score: 0, areaRatio: 0 };
    }
    const [, , width, height] = prediction.bbox;
    const areaRatio = clamp((width * height) / (frameWidth * frameHeight), 0, 1);
    if (areaRatio >= 0.12) return { label: 'near', score: 3, areaRatio };
    if (areaRatio >= 0.035) return { label: 'mid-range', score: 2, areaRatio };
    return { label: 'far', score: 1, areaRatio };
  }

  function roadRisk(prediction, frameWidth, frameHeight) {
    const proximity = relativeProximity(prediction, frameWidth, frameHeight);
    const [x, y, width, height] = prediction.bbox || [0, 0, 0, 0];
    const centerX = x + (width / 2);
    const bottomY = y + height;
    const centered = centerX > frameWidth * 0.22 && centerX < frameWidth * 0.78;
    const lowerFrame = bottomY > frameHeight * 0.58;
    const classWeight = OBJECT_WEIGHTS[prediction.class] || 1;
    const riskScore = classWeight + proximity.score + (centered ? 2 : 0) + (lowerFrame ? 1 : 0);
    let severity = 'info';
    if (riskScore >= 9) severity = 'critical';
    else if (riskScore >= 6) severity = 'caution';
    return { severity, riskScore, centered, proximity: proximity.label, areaRatio: proximity.areaRatio };
  }

  function filterRoadObjects(predictions, minimumConfidence) {
    const threshold = Number.isFinite(minimumConfidence) ? minimumConfidence : 0.55;
    return (predictions || [])
      .filter((prediction) => ROAD_OBJECTS.has(prediction.class) && prediction.score >= threshold)
      .sort((first, second) => second.score - first.score);
  }

  const SEVERITY = { info: 0, caution: 1, critical: 2 };

  // Motion cues only: never integrate phone acceleration into vehicle speed.
  // DeviceMotionEvent.acceleration excludes gravity; rotationRate is degrees/s.
  function motionMagnitude(vector, axes) {
    if (!vector || !axes.every((axis) => Number.isFinite(vector[axis]))) return null;
    return Math.hypot(...axes.map((axis) => vector[axis]));
  }

  function analyzeMotion(previous, sample, now) {
    const acceleration = motionMagnitude(sample?.acceleration, ['x', 'y', 'z']);
    const rotation = motionMagnitude(sample?.rotationRate, ['alpha', 'beta', 'gamma']);
    const valid = acceleration !== null || rotation !== null;
    const continuous = previous?.lastSampleAt !== null && previous?.lastSampleAt !== undefined
      && now > previous.lastSampleAt && now - previous.lastSampleAt <= 500;
    const strongSince = acceleration !== null && acceleration >= 4.5
      ? (continuous && previous.strongSince !== null ? previous.strongSince : now) : null;
    const rotationSince = rotation !== null && rotation >= 25
      ? (continuous && previous.rotationSince !== null ? previous.rotationSince : now) : null;
    return {
      lastSampleAt: valid ? now : null,
      acceleration,
      rotation,
      strongSince,
      rotationSince,
      strong: strongSince !== null && now - strongSince >= 250,
      rotating: rotationSince !== null && now - rotationSince >= 250,
    };
  }

  function motionIsFresh(reading, now) {
    return reading?.lastSampleAt !== null && reading?.lastSampleAt !== undefined
      && now >= reading.lastSampleAt && now - reading.lastSampleAt <= 1500;
  }

  function currentAlerts(alerts, now) {
    const priority = (alert) => {
      if (['sign:wrong-way', 'sign:do-not-enter'].includes(alert.key)) return 4;
      if (alert.key.startsWith('object:')) return 3;
      if (alert.key === 'stop-sign' || alert.key.startsWith('sign:')) return 2;
      return 1;
    };
    return alerts.filter((alert) => alert.expiresAt > now)
      .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || priority(b) - priority(a) || b.updatedAt - a.updatedAt);
  }

  function validSpeedLimit(value) {
    return Number.isInteger(value) && value >= 5 && value <= 85 && value % 5 === 0;
  }

  // Deliberately reject ambiguous numbers, conditional limits and non-mph signs.
  function parseSignText(text, confidence) {
    if (!Number.isFinite(confidence) || confidence < 75) return null;
    const normalized = String(text).toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const speed = normalized.match(/^SPEED LIMIT (\d{1,2})(?: MPH)?$/);
    if (speed && validSpeedLimit(Number(speed[1]))) {
      return { type: 'speed-limit', limit: Number(speed[1]), label: `Speed limit ${Number(speed[1])} mph` };
    }
    const types = [
      [/^STOP$/, 'stop', 'Stop sign'],
      [/^YIELD$/, 'yield', 'Yield sign'],
      [/^DO NOT ENTER$/, 'do-not-enter', 'Do not enter sign'],
      [/^WRONG WAY$/, 'wrong-way', 'Wrong way sign'],
      [/^(?:SCHOOL|SCHOOL ZONE|SCHOOL CROSSING)$/, 'school', 'School sign'],
      [/^PEDESTRIAN (?:CROSSING|XING)$/, 'pedestrian', 'Pedestrian crossing sign'],
      [/^(?:ROAD WORK|ROAD WORK AHEAD|WORK ZONE|ROAD CLOSED|ROAD CLOSED AHEAD)$/, 'road-work', 'Road work / closure sign'],
    ];
    const match = types.find(([pattern]) => pattern.test(normalized));
    return match ? { type: match[1], label: match[2] } : null;
  }

  function signWarning(sign, speedMph, proximity = 'far') {
    if (sign.type === 'speed-limit') {
      const over = Number.isFinite(speedMph) ? speedMph - sign.limit : 0;
      return { severity: over > 10 ? 'critical' : over > 3 ? 'caution' : 'info', title: `Possible ${sign.limit} mph sign` };
    }
    const moving = Number.isFinite(speedMph) && speedMph > 3;
    const urgent = ['wrong-way', 'do-not-enter'].includes(sign.type)
      || (moving && proximity === 'near' && ['stop', 'yield', 'school', 'pedestrian', 'road-work'].includes(sign.type));
    return { severity: urgent ? 'critical' : 'caution', title: `Possible ${sign.label.toLowerCase()}` };
  }

  // Independent observations must agree and remain in the same image region.
  function confirmSign(previous, sign, bbox, now) {
    if (!sign) return null;
    const key = `${sign.type}:${sign.limit || ''}`;
    const nearby = previous && Math.abs(previous.bbox[0] - bbox[0]) < 0.18
      && Math.abs(previous.bbox[1] - bbox[1]) < 0.18;
    const count = previous?.key === key && nearby && now - previous.seenAt < 6000 ? previous.count + 1 : 1;
    return { key, sign, bbox, seenAt: now, count, confirmed: count >= 2 };
  }

  function luminance(data, index) {
    return (data[index] * 0.2126) + (data[index + 1] * 0.7152) + (data[index + 2] * 0.0722);
  }

  function strongestLanePoint(imageData, width, y, startX, endX) {
    const data = imageData.data || imageData;
    let bestX = null;
    let bestScore = 0;
    for (let x = Math.max(2, startX); x < Math.min(width - 2, endX); x += 1) {
      const index = ((y * width) + x) * 4;
      const current = luminance(data, index);
      const left = luminance(data, index - 8);
      const right = luminance(data, index + 8);
      const edgeStrength = Math.max(Math.abs(current - left), Math.abs(current - right));
      const score = current > 145 ? edgeStrength + ((current - 145) * 0.25) : 0;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
    return bestScore >= 34 ? { x: bestX, y, score: bestScore } : null;
  }

  function median(values) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function analyzeLane(imageData, width, height) {
    if (!imageData || !width || !height) {
      return { state: 'unavailable', confidence: 0, offset: 0, leftX: null, rightX: null };
    }
    const leftPoints = [];
    const rightPoints = [];
    const startY = Math.floor(height * 0.56);
    const endY = Math.floor(height * 0.94);
    for (let y = startY; y <= endY; y += 2) {
      const perspective = (y - startY) / Math.max(1, endY - startY);
      const left = strongestLanePoint(
        imageData,
        width,
        y,
        Math.floor(width * (0.12 - (perspective * 0.06))),
        Math.floor(width * (0.49 - (perspective * 0.04))),
      );
      const right = strongestLanePoint(
        imageData,
        width,
        y,
        Math.floor(width * (0.51 + (perspective * 0.04))),
        Math.floor(width * (0.88 + (perspective * 0.06))),
      );
      if (left) leftPoints.push(left);
      if (right) rightPoints.push(right);
    }
    const expectedRows = Math.max(1, Math.floor((endY - startY) / 2));
    const confidence = clamp(Math.min(leftPoints.length, rightPoints.length) / expectedRows, 0, 1);
    if (leftPoints.length < 5 || rightPoints.length < 5) {
      return { state: 'searching', confidence, offset: 0, leftX: null, rightX: null };
    }
    const lowerThreshold = Math.floor(height * 0.78);
    const leftX = median(leftPoints.filter((point) => point.y >= lowerThreshold).map((point) => point.x));
    const rightX = median(rightPoints.filter((point) => point.y >= lowerThreshold).map((point) => point.x));
    if (leftX === null || rightX === null || rightX <= leftX) {
      return { state: 'searching', confidence: 0, offset: 0, leftX: null, rightX: null };
    }
    const laneCenter = (leftX + rightX) / 2;
    const offset = clamp((laneCenter - (width / 2)) / (width / 2), -1, 1);
    let laneState = 'centered';
    if (confidence >= 0.3 && offset > 0.16) laneState = 'drifting-left';
    if (confidence >= 0.3 && offset < -0.16) laneState = 'drifting-right';
    return { state: laneState, confidence, offset, leftX, rightX };
  }

  return {
    MPH_PER_MPS,
    ROAD_OBJECTS,
    analyzeLane,
    analyzeMotion,
    motionIsFresh,
    currentAlerts,
    validSpeedLimit,
    parseSignText,
    signWarning,
    confirmSign,
    clamp,
    filterRoadObjects,
    formatSpeed,
    haversineMeters,
    relativeProximity,
    roadRisk,
    speedMphFromPosition,
  };
}));
