# Contributing to DriveAssist

Thanks for your interest in DriveAssist. It is a privacy-first, zero-dependency browser driving companion, and contributions are welcome.

Please read the safety and scope sections before opening a pull request. This project has a narrower scope than most web apps, and the constraints below are deliberate rather than incidental.

## Safety comes first

DriveAssist is **experimental software, not an advanced driver-assistance system.** People may use it in a moving vehicle. That shapes what we accept:

- **Never overstate what the app knows.** The app reports relative proximity as far, mid-range, or near. It deliberately does not claim an uncalibrated distance in meters, identify traffic-light state, or promise collision avoidance. Do not add features or wording that imply a precision the sensors cannot support.
- **Keep the driving screen minimal.** `index.html` is a one-tap driving view: camera, essential live overlays, and a large Start control. Settings, explanations, and safety copy live in `info.html`. This separation is enforced by an automated check.
- **Do not add anything requiring interaction while moving.** New controls belong on the setup page.
- **Respect alert rate limiting.** Warnings are throttled to avoid alert flooding. Changes that increase alert frequency need a clear justification.
- **Document honest limitations.** If a feature degrades in rain, glare, curves, or poor GPS, say so in the README's limitations list.

## Privacy is a hard constraint

The app processes camera frames and location locally and has no backend. Pull requests that introduce any of the following will be declined:

- An application server, user account, or cloud database
- Analytics, telemetry, tracking, or advertising SDKs
- Uploading, recording, or transmitting camera frames or coordinates
- New third-party runtime origins beyond the pinned TensorFlow.js and COCO-SSD assets

If you believe a feature genuinely requires a network call, open an issue to discuss it before writing code.

## Getting started

You need **Node.js 20 or newer**. There are no npm runtime or development dependencies, so there is nothing to install.

```bash
git clone https://github.com/naveenalavilli/driveassist.git
cd driveassist
```

Serve the directory with any static server. Camera and geolocation APIs require HTTPS or `localhost`:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

To exercise the camera and GPS paths you need a real device. Set up the app **only while parked.**

## Before you open a pull request

Run all three checks. They are fast and have no dependencies:

```bash
npm test                        # unit tests for the deterministic core
npm run check                   # syntax check of every shipped JS file
node scripts/validate-static.js # link, ID, manifest, and service-worker validation
```

All three must pass.

## Where code goes

| File | Responsibility |
| --- | --- |
| `drive-core.js` | Deterministic risk, speed, proximity, and lane logic |
| `script.js` | Camera, model, GPS, warning, and PWA orchestration |
| `settings.js` | Setup-page preferences |
| `index.html` | One-tap driving screen |
| `info.html` | Setup, settings, capabilities, safety |
| `sw.js` | App-shell and model runtime caching |
| `style.css` | Responsive dashboard design |
| `tests/` | Unit coverage for the deterministic core |

**Put pure logic in `drive-core.js`.** It is written as a UMD module, so it loads in the browser and is `require`-able from Node. That is what makes it testable without a browser or a DOM. Any new calculation — speed, proximity, risk scoring, lane estimation — belongs there with a matching test in `tests/drive-core.test.js`, not inline in `script.js`.

Tests use the built-in `node:test` runner and `node:assert/strict`. No test framework is used or wanted.

## What the static validator enforces

`scripts/validate-static.js` encodes architectural rules. If it fails, the fix is usually to respect the rule rather than to change the validator:

- No duplicate `id` attributes in any of the five HTML pages.
- Every local `href`/`src` must resolve to a file that exists and sits inside the repository.
- Every icon listed in `manifest.webmanifest` must exist.
- Every `'./…'` path cached by `sw.js` must exist. **Add new shipped files to the service worker's cache list.**
- `index.html` must keep the essential driving controls: `startButton`, `stopButton`, `roadCamera`, `speedValue`, `latestAlert`.
- `index.html` must **not** contain `capability-grid`, `settingsHeading`, or `safetyHeading`. Explanatory sections stay off the driving screen.
- `info.html` must keep its settings: `settingsHeading`, `speedLimit`, `confidence`, `enableLane`, `enableAudio`, `enableNotifications`.

## Security-sensitive details

- **Content Security Policy.** `index.html` carries a restrictive CSP. TensorFlow.js needs `unsafe-eval` for its generated kernels; that is the only such allowance. Do not widen the policy to make a library work — find another approach or open an issue.
- **Pinned CDN assets with integrity hashes.** TensorFlow.js and COCO-SSD are pinned to explicit versions with SRI `integrity` attributes. When bumping a version, update the `integrity` hash in the same change and verify it loads.
- **Service worker cache version.** `sw.js` defines `const VERSION = 'driveassist-v5'`. Bump it whenever you change the app shell, or returning users will be served stale assets.
- **Never commit credentials.** Firebase deployment reads a project ID and service account from repository settings. No secrets belong in this repository.

## Pull request process

1. Open an issue first for anything beyond a small fix, so scope and safety can be discussed before you invest time.
2. Branch from `main`.
3. Keep the change focused. Unrelated reformatting makes review harder.
4. Match the surrounding style: `'use strict';`, two-space indentation, and descriptive names. There is no linter or formatter; follow the existing code.
5. Run the three checks above.
6. In the PR description, explain the user-facing effect and note any new limitation.
7. If behavior changes, update `README.md` — particularly the capabilities and limitations lists.

`main` is deployed to GitHub Pages, so merged changes go live. Please make sure your branch is genuinely ready.

## Reporting bugs

Useful reports include the browser and version, the device and OS, whether the camera and GPS permissions were granted, what you expected, what happened, and any console output.

For anything that could expose user data or device permissions, **do not open a public issue.** Follow [SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting.

## Conduct

Be respectful and constructive. Assume good faith, keep discussion focused on technical merit, and remember that reviewers are volunteers. Harassment of any kind is not acceptable.

## License

DriveAssist is licensed under [Apache-2.0](LICENSE). By submitting a contribution, you agree it is licensed under the same terms, per section 5 of the license. Preserve the attribution in [NOTICE](NOTICE).
