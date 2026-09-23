# DriveAssist

DriveAssist is an installable, privacy-first browser driving companion. It uses the phone's rear camera and GPS to provide selected road-object awareness, relative-proximity cues, speed-limit warnings, and experimental lane guidance.

> **Safety:** DriveAssist is experimental software, not an advanced driver-assistance system. Set it up only while parked. Keep your eyes on the road, obey posted signs, and never rely on the app to avoid a collision or control a vehicle.

## Live app

<https://naveenalavilli.github.io/driveassist/>

Camera and geolocation APIs require HTTPS or localhost. For best results, use a current version of Chrome or Safari on a securely mounted phone with the rear camera facing the road.

## Current capabilities

- **Road-object awareness:** COCO-SSD detects people, bicycles, vehicles, traffic lights, and stop signs.
- **Relative proximity:** Bounding-box scale is reported as far, mid-range, or near. The app deliberately does not claim an uncalibrated distance in meters.
- **GPS speed:** Uses the device speed reading when available and a location/time fallback otherwise.
- **Motion fallback:** When GPS is missing or weak, available on-device gyroscope and accelerometer readings provide rotation and sustained strong-movement cues. Speed remains `--` and speed-dependent warnings pause. GPS automatically takes over when it recovers. Sensor access is requested from Start where required and can be disabled in setup/settings.
- **Overspeed alerts:** Compares the GPS estimate with a driver-selected road limit.
- **Experimental U.S. text-sign reading:** On-device Tesseract OCR reads selected speed-limit, stop, yield, do-not-enter, wrong-way, school, pedestrian-crossing, and road-work/closure text signs. A color-surface candidate filter and two matching, nearby reads reduce incidental-text alerts. COCO-SSD also supplies repeated stop-sign detections.
- **Sign-aware warnings:** Sign type, relative size, and available GPS speed determine warning urgency. A repeated speed-limit read can lower the selected alert threshold for 30 seconds, never raise it. The driving screen labels the active threshold as selected or a sign estimate.
- **Current warning state:** Critical warnings take priority over cautions. Warnings clear when observations resolve or expire; missing or stale GPS readings display `--` and disable speed alerts.
- **Experimental lane guidance:** Looks for high-contrast lane markings in the lower camera frame and warns after repeated drift estimates.
- **Visual and audio warnings:** Warnings are rate-limited to avoid alert flooding. Optional browser notifications report when assistance stops because the app is hidden.
- **Installable PWA:** The application shell and fetched model assets are cached after the first successful online load.
- **On-device processing:** Camera frames and coordinates are not sent to a DriveAssist backend.
- **Parked first-use setup:** The first start explains limitations and camera/location use, requires a road-limit selection and parked acknowledgment, and leaves lane guidance off unless enabled. Later starts use the saved preferences.
- **Focused driving screen:** Camera view, live status, selected/sign-estimated speed threshold, and a large Start Assistance control.
- **Orientation-adaptive layout:** The PWA follows the device orientation and reflows continuously across portrait, landscape, phone, tablet, and desktop viewports without restarting assistance.
- **Separate setup page:** Settings, capabilities, safety guidance, privacy, and technical context stay away from the driving view.
- **Accessible interface:** Responsive layout, keyboard focus states, live status announcements, and reduced-motion support.

## Limitations

- COCO-SSD does not recognize all traffic signs or traffic-light state.
- Sign reading is experimental and limited to the supported U.S. English text phrases. It is not a trained general traffic-sign classifier; symbol-only signs, non-English signs, conditional limits, and km/h signs are unsupported. Glare, motion, small text, clutter, and occlusion can cause missed or incorrect reads. Separate supplementary plaques can be missed, so a sign estimate is never proof of the applicable legal limit.
- The temporary sign threshold expires after 30 seconds without a matching read, then returns to the driver's selected threshold. It does not track road segments or infer where a speed zone ends. Set the selected limit while parked and obey actual signs.
- Assistance stops when the page is hidden. Keep the app visible; no background road monitoring is promised.
- Relative proximity is not calibrated physical distance.
- Lane estimates are sensitive to curves, faded markings, shadows, weather, glare, and camera placement.
- GPS speed can lag or be inaccurate, especially indoors or around tall buildings.
- Motion fallback does not estimate speed, position, braking direction, or lane departure. Phone movement can resemble vehicle movement; secure mounting is required. The browser must supply rotation rate or linear acceleration excluding gravity. Unsupported, denied, missing, or stale sensor data produces an explicit unavailable status. Motion readings stay in memory and are cleared on Stop or when the app is hidden.
- Browser throttling and thermal limits affect detection performance.
- The initial AI model download needs internet access. Offline behavior begins after assets have been fetched and cached.

## Architecture

- `index.html` — focused one-tap driving screen
- `info.html` / `settings.js` — setup, safety, capabilities, and persistent preferences
- `script.js` — camera, model, GPS, warning, and PWA orchestration
- `drive-core.js` — deterministic risk, speed, proximity, and lane-analysis logic
- `sign-reader.js` — local sign-surface candidates, OCR worker, and repeated-read confirmation
- `sw.js` — application-shell and model runtime caching
- `style.css` — responsive dashboard design
- `tests/` — unit coverage for the deterministic core
- `scripts/validate-static.js` — local-link, ID, manifest, and service-worker validation

TensorFlow.js, COCO-SSD, Tesseract.js, its WebAssembly core, and English language data use pinned CDN versions. There is no application server, account, analytics SDK, or cloud database. Text-sign reading loads when assistance starts and can fail independently of object detection. Its worker/core/language assets require a successful online initialization before offline use; a different device's WebAssembly variant may need its own download.

## Run locally

Use any static server; camera access works on `localhost`:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

## Validate

Node.js 20 or newer is required for the automated checks. There are no npm runtime or development dependencies.

```bash
npm test
npm run check
node scripts/validate-static.js
```

## Deployment

Pushing `main` publishes the site through the repository's GitHub Pages configuration. The app is a static site and requires no application server or deployment credentials in the source code.

## Privacy and security

See [PRIVACY.md](PRIVACY.md), the in-app [privacy page](privacy.html), and [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

[Made by Naveen Alavilli](https://github.com/naveenalavilli)
