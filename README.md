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
- **Overspeed alerts:** Compares the GPS estimate with a driver-selected road limit.
- **Experimental lane guidance:** Looks for high-contrast lane markings in the lower camera frame and warns after repeated drift estimates.
- **Visual, audio, and optional browser notifications:** Warnings are rate-limited to avoid alert flooding.
- **Installable PWA:** The application shell and fetched model assets are cached after the first successful online load.
- **On-device processing:** Camera frames and coordinates are not sent to a DriveAssist backend.
- **One-tap driving screen:** The launch screen contains only the camera view, essential live overlays, and a large Start Assistance control.
- **Orientation-adaptive layout:** The PWA follows the device orientation and reflows continuously across portrait, landscape, phone, tablet, and desktop viewports without restarting assistance.
- **Separate setup page:** Settings, capabilities, safety guidance, privacy, and technical context stay away from the driving view.
- **Accessible interface:** Responsive layout, keyboard focus states, live status announcements, and reduced-motion support.

## Honest limitations

- COCO-SSD does not recognize all traffic signs or traffic-light state.
- Relative proximity is not calibrated physical distance.
- Lane estimates are sensitive to curves, faded markings, shadows, weather, glare, and camera placement.
- GPS speed can lag or be inaccurate, especially indoors or around tall buildings.
- Browser throttling and thermal limits affect detection performance.
- The initial AI model download needs internet access. Offline behavior begins after assets have been fetched and cached.

## Architecture

- `index.html` — focused one-tap driving screen
- `info.html` / `settings.js` — setup, safety, capabilities, and persistent preferences
- `script.js` — camera, model, GPS, warning, and PWA orchestration
- `drive-core.js` — deterministic risk, speed, proximity, and lane-analysis logic
- `sw.js` — application-shell and model runtime caching
- `style.css` — responsive dashboard design
- `tests/` — unit coverage for the deterministic core
- `scripts/validate-static.js` — local-link, ID, manifest, and service-worker validation
- `firebase.json` — optional hardened Firebase Hosting configuration

TensorFlow.js and COCO-SSD are pinned to explicit CDN versions. There is no application server, account, analytics SDK, or cloud database.

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

Pushing `main` publishes the current GitHub Pages site through the repository's Pages configuration. For Firebase Hosting:

```bash
firebase use <your-project-id>
firebase deploy --only hosting
```

The included `firebase.json` excludes repository-only files and adds browser security headers. The Firebase workflow creates pull-request preview channels and deploys `main` to production after these repository settings are configured:

- Variable: `FIREBASE_PROJECT_ID`
- Secret: `FIREBASE_SERVICE_ACCOUNT_DRIVEASSIST`

Until both are present, the workflow reports a safe skip instead of failing or exposing credentials. Do not place credentials in this repository.

## Privacy and security

See [PRIVACY.md](PRIVACY.md), the in-app [privacy page](privacy.html), and [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

[Made by Naveen Alavilli](https://github.com/naveenalavilli)
