/* Experimental text-sign reader. Frames stay in memory on this device. */
'use strict';

(function attachSignReader(root) {
  async function withTimeout(operation, milliseconds) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Sign reader timed out')), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }

  // Find connected white, yellow, or red sign surfaces at low resolution.
  // This is a candidate filter, not a trained traffic-sign detector.
  function findCandidates(image) {
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i += 1) {
      const [r, g, b] = data.subarray(i * 4, i * 4 + 3);
      mask[i] = (r > 165 && g > 165 && b > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 55)
        || (r > 150 && g > 110 && b < g * 0.7)
        || (r > 120 && r > g * 1.6 && r > b * 1.6) ? 1 : 0;
    }
    const candidates = [];
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const queue = [i];
      mask[i] = 0;
      let minX = width; let minY = height; let maxX = 0; let maxY = 0;
      for (let head = 0; head < queue.length; head += 1) {
        const at = queue[head]; const x = at % width; const y = Math.floor(at / width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const next of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width]) {
          if (next >= 0 && next < mask.length && mask[next]) { mask[next] = 0; queue.push(next); }
        }
      }
      const w = maxX - minX + 1; const h = maxY - minY + 1;
      if (w < 8 || h < 10 || w / h < 0.35 || w / h > 3 || w * h > width * height * 0.3
        || queue.length / (w * h) < 0.35 || minY > height * 0.85) continue;
      candidates.push([minX / width, minY / height, w / width, h / height]);
    }
    return candidates.sort((a, b) => b[2] * b[3] - a[2] * a[3]).slice(0, 3);
  }

  class SignReader {
    constructor() {
      this.worker = null;
      this.closed = false;
      this.preview = document.createElement('canvas');
      this.snapshot = document.createElement('canvas');
      this.crop = document.createElement('canvas');
      this.previous = [];
    }

    async initialize() {
      if (!root.Tesseract) throw new Error('Sign reader could not load');
      let rejectInitialization;
      const failed = new Promise((resolve, reject) => { rejectInitialization = reject; });
      const loading = root.Tesseract.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
        // Tesseract's default handler throws outside the returned promise.
        errorHandler: (error) => rejectInitialization(new Error(String(error))),
      }).then(async (worker) => {
        if (this.closed) { await worker.terminate(); return null; }
        this.worker = worker;
        return worker;
      });
      const worker = await withTimeout(Promise.race([loading, failed]), 30000);
      if (!worker || this.closed) return;
      await withTimeout(worker.setParameters({ tessedit_pageseg_mode: '6' }), 5000);
    }

    async read(video) {
      if (!this.worker || this.closed || !video.videoWidth) return [];
      // Snapshot once so all crops and locations belong to the same frame.
      this.snapshot.width = video.videoWidth;
      this.snapshot.height = video.videoHeight;
      this.snapshot.getContext('2d').drawImage(video, 0, 0);
      this.preview.width = 320;
      this.preview.height = Math.round(320 * video.videoHeight / video.videoWidth);
      const context = this.preview.getContext('2d', { willReadFrequently: true });
      context.drawImage(this.snapshot, 0, 0, this.preview.width, this.preview.height);
      const candidates = findCandidates(context.getImageData(0, 0, this.preview.width, this.preview.height));
      const observations = [];
      for (const bbox of candidates) {
        if (this.closed) break;
        const [x, y, w, h] = bbox;
        const sx = Math.max(0, (x - 0.008) * video.videoWidth);
        const sy = Math.max(0, (y - 0.008) * video.videoHeight);
        const sw = Math.min(video.videoWidth - sx, (w + 0.016) * video.videoWidth);
        const sh = Math.min(video.videoHeight - sy, (h + 0.016) * video.videoHeight);
        this.crop.width = 400;
        this.crop.height = Math.round(400 * sh / sw);
        this.crop.getContext('2d').drawImage(this.snapshot, sx, sy, sw, sh, 0, 0, this.crop.width, this.crop.height);
        const { data } = await withTimeout(this.worker.recognize(this.crop), 8000);
        if (this.closed) break;
        const sign = root.DriveAssistCore.parseSignText(data.text, data.confidence);
        if (!sign) continue;
        const previous = this.previous.find((item) => item.sign.type === sign.type && item.sign.limit === sign.limit
          && Math.abs(item.bbox[0] - x) < 0.18 && Math.abs(item.bbox[1] - y) < 0.18);
        observations.push(root.DriveAssistCore.confirmSign(previous, sign, bbox, Date.now()));
      }
      this.previous = observations;
      return observations.filter((item) => item.confirmed);
    }

    close() {
      this.closed = true;
      if (this.worker) this.worker.terminate().catch(() => {});
      this.worker = null;
      this.previous = [];
    }
  }
  root.DriveAssistSignReader = SignReader;
  if (typeof module === 'object' && module.exports) module.exports = { findCandidates };
}(typeof window !== 'undefined' ? window : globalThis));
