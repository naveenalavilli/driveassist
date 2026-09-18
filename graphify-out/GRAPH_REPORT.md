# Graph Report - /home/alavilli/.graphify/repos/naveenalavilli/driveassist  (2026-09-13)

## Corpus Check
- 4 files · ~9,120 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 158 nodes · 231 edges · 12 communities (10 shown, 2 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.82)
- Token cost: 1,215 input · 4,974 output

## Community Hubs (Navigation)
- script.js
- DriveAssist
- drive-core.js
- DriveAssist Privacy Policy
- DriveAssist
- package.json
- DriveAssist App Icon
- DriveAssist Social Card
- Static Validation
- settings.js
- sw.js
- Return to DriveAssist Home

## God Nodes (most connected - your core abstractions)
1. `DriveAssist` - 25 edges
2. `startDrive()` - 12 edges
3. `addAlert()` - 9 edges
4. `DriveAssist Social Card` - 9 edges
5. `initialize()` - 8 edges
6. `detectFrame()` - 7 edges
7. `One-tap driving screen` - 7 edges
8. `getSettings()` - 6 edges
9. `loadModel()` - 6 edges
10. `DriveAssist Privacy Policy` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Privacy by Architecture` --semantically_similar_to--> `DriveAssist Privacy Policy`  [INFERRED] [semantically similar]
  privacy.html → PRIVACY.md
- `Local Camera Analysis` --semantically_similar_to--> `Local Camera and Location Processing`  [INFERRED] [semantically similar]
  privacy.html → PRIVACY.md
- `External Model Request Metadata` --semantically_similar_to--> `Third-Party Model Asset Delivery`  [INFERRED] [semantically similar]
  privacy.html → PRIVACY.md
- `Revocable Browser Permissions` --semantically_similar_to--> `Browser-Controlled Permissions`  [INFERRED] [semantically similar]
  privacy.html → PRIVACY.md
- `Experimental Lane Guidance` --conceptually_related_to--> `Local Road Awareness in the Browser`  [INFERRED]
  README.md → icons/social-card.svg

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Safety Brand Message** — icons_social_card_privacy_first_driver_assistance, icons_social_card_second_set_of_eyes, icons_social_card_shielded_road_emblem [INFERRED 0.85]

## Communities (12 total, 2 thin omitted)

### Community 0 - "script.js"
Cohesion: 0.17
Nodes (29): addAlert(), analyzeCurrentLane(), announceAlert(), cleanUpDrive(), clearError(), detectFrame(), drawLane(), drawPrediction() (+21 more)

### Community 1 - "DriveAssist"
Cohesion: 0.12
Nodes (26): Naveen Alavilli, Accessible Interface, Apache License 2.0, COCO-SSD, DriveAssist, Experimental Safety Boundary, Firebase Hosting, Firebase Safe-Skip Deployment (+18 more)

### Community 2 - "drive-core.js"
Cohesion: 0.16
Nodes (13): analyzeLane(), clamp(), haversineMeters(), luminance(), median(), relativeProximity(), roadRisk(), speedMphFromPosition() (+5 more)

### Community 3 - "DriveAssist Privacy Policy"
Cohesion: 0.15
Nodes (17): Browser Local Storage Preferences, Browser-Controlled Permissions, DriveAssist Privacy Policy, External Model Request Metadata, Local Camera Analysis, Local Camera and Location Processing, Local Location-Based Speed Calculation, Local Settings and Alerts (+9 more)

### Community 4 - "DriveAssist"
Cohesion: 0.14
Nodes (15): Accessible live status announcements, COCO-SSD 2.2.3, Restricted browser content security policy, One-tap driving screen, Local road assistance interface, Rear-camera detection stage, Speed and alert heads-up display, TensorFlow.js 4.22.0 (+7 more)

### Community 5 - "package.json"
Cohesion: 0.18
Nodes (10): description, engines, node, license, name, private, scripts, check (+2 more)

### Community 6 - "DriveAssist App Icon"
Cohesion: 0.31
Nodes (10): DriveAssist App Icon, DriveAssist App Icon, High-Visibility Palette, Lane Assistance, Lane Markings, Perspective Roadway, DriveAssist Road Shield, Driving Safety (+2 more)

### Community 7 - "DriveAssist Social Card"
Cohesion: 0.33
Nodes (10): DriveAssist Brand, DriveAssist Social Card, GPS Speed Alerts, High-Contrast Safety Palette, Local Road Awareness in the Browser, On-Device Camera Analysis, Privacy-First Driver Assistance, A Second Set of Eyes for the Road (+2 more)

### Community 8 - "Static Validation"
Cohesion: 0.20
Nodes (9): errors, fs, home, htmlFiles, info, manifest, path, root (+1 more)

### Community 9 - "settings.js"
Cohesion: 0.47
Nodes (5): loadSetting(), restoreSettings(), saveSetting(), settingsElements, updateNotifications()

## Knowledge Gaps
- **44 isolated node(s):** `name`, `version`, `private`, `description`, `test` (+39 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DriveAssist` connect `DriveAssist` to `DriveAssist Social Card`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `Experimental Lane Guidance` connect `DriveAssist Social Card` to `DriveAssist`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `startDrive()` (e.g. with `initialize()` and `frameLoop()`) actually correct?**
  _`startDrive()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `initialize()` (e.g. with `handleViewportChange()` and `startDrive()`) actually correct?**
  _`initialize()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _44 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `DriveAssist` be split into smaller, more focused modules?**
  _Cohesion score 0.11692307692307692 - nodes in this community are weakly interconnected._
- **Should `DriveAssist` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._