# DriveAssist Privacy

Effective September 12, 2026.

DriveAssist processes camera frames and location data locally in the browser. It does not operate an application backend, upload or record camera frames, store coordinates, or sell personal information.

- Camera frames and cropped sign images are used in memory for object, experimental lane, and text-sign estimates. OCR runs in an on-device worker; images are not uploaded.
- Location is used while driving mode is active to calculate speed.
- Optional gyroscope and accelerometer readings provide local motion cues when GPS is unavailable. They remain in memory, are never uploaded or saved, and are cleared when assistance stops. Permission denial does not prevent camera/GPS use.
- Preferences are stored in browser local storage.
- Recent alerts remain in memory and disappear when the page reloads.
- TensorFlow.js, COCO-SSD, Tesseract.js, its WebAssembly core, and English OCR language data are downloaded from jsDelivr and Google-hosted model storage. These providers may receive normal web request metadata. Model and language assets may be cached on the device for offline use.
- The browser controls camera, location, and notification permissions.

Send privacy questions through the issue tracker at <https://github.com/naveenalavilli/driveassist/issues>.
