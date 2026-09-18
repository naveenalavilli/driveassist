# DriveAssist Privacy

Effective September 12, 2026.

DriveAssist processes camera frames and location data locally in the browser. It does not operate an application backend, upload or record camera frames, store coordinates, or sell personal information.

- Camera frames are used in memory for object and experimental lane estimates.
- Location is used while driving mode is active to calculate speed.
- Preferences are stored in browser local storage.
- Recent alerts remain in memory and disappear when the page reloads.
- TensorFlow.js and COCO-SSD assets are downloaded from jsDelivr and Google-hosted model storage. These providers may receive normal web request metadata.
- The browser controls camera, location, and notification permissions.

Send privacy questions through the issue tracker at <https://github.com/naveenalavilli/driveassist/issues>.
