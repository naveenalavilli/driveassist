# Security Policy

## Supported version

Only the current `main` branch is supported.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub private vulnerability reporting at <https://github.com/naveenalavilli/driveassist/security/advisories/new>. Do not open a public issue for a vulnerability that could expose user data or device permissions.

## Security design

- Camera and location processing occurs locally in the browser.
- There is no DriveAssist application backend or user account.
- External runtime assets are pinned to explicit TensorFlow.js and COCO-SSD versions.
- A restrictive Content Security Policy limits network and script sources. TensorFlow.js requires `unsafe-eval` for its generated kernels, so the policy permits that execution mode while still restricting script origins.
- The app requests permissions only after a user action and releases camera/GPS access when driving mode stops.
