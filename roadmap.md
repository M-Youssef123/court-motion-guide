# Replay movement cleanup
- [x] Replace the full-swing selector with a 300 ms wrist-trail toggle.
- [x] Show qualified hand estimates or clip-relative movement without percentage speed labels.
- [x] Run all tests and verify replay controls, playback and scrubbing on desktop/mobile.

# Swing-speed analysis
- [x] Extract estimated hand/racket speeds from stored pose frames with confidence checks and smoothing.
- [x] Show estimates and peak-video seek on replay without changing recording or playback rates.
- [x] Test calculations, invalid tracking, and replay on desktop/mobile.

# Hitting-moment correction
- [x] Identify overhead hitting extension after a bent-arm preparation and before follow-through, rejecting toss-only motion.
- [x] Seek to that estimated hitting moment, withholding the shortcut when the sequence is unclear.
- [x] Test phase selection and verify replay seeking without changing playback speed or downloads.

# Selected serving-arm contact analysis
- [x] Save serving-arm selection on new clips and resolve it for older recordings.
- [x] Estimate contact from trophy, wrist apex and arm reach; calculate local speed and extension coaching.
- [x] Update replay and test both arms, thresholds, timing, recording storage and mobile controls.

# Personal practice notes
- [x] Add local, session-linked note storage and preserve existing notes.
- [x] Enable saving, editing and deleting notes in My notes.
- [x] Test persistence and session associations; verify the full notes workflow.

# Versioned practice data
- [x] Store session identity, date, recorded hand, duration and stroke type with safe legacy upgrades.
- [x] Persist timestamped tracking confidence, joint angles and available swing estimates linked to original clips.
- [x] Finalize live, uploaded and recovered recordings; test reload persistence and replay compatibility.

# Practice journal export
- [x] Export all saved sessions, notes and available analysis feedback as plain readable Markdown, without videos.
- [x] Add a mobile-safe export/download control in Progress and verify saved file contents.

# Recording-based coaching insights
- [x] Derive conservative positive, improvement and recommendation observations with saved-frame evidence and insufficient-data gates.
- [x] Replace example coaching cards and speech with recording selection, linked replay moments and dynamic readings.
- [x] Test evidence rules, persistence and the complete Progress/replay/audio flow on mobile and desktop.

# You and your coach phase comparisons
- [x] Identify reliable Toss, Trophy and Finish frames from saved poses without ball-outcome claims.
- [x] Show extracted video frames with skeletons, original reference diagrams and supported differences.
- [x] Add persistent manual frame selection and verify automatic/manual flows and mobile layouts.

# iPhone video uploads
- [x] Make loading and frame seeking readiness-aware and cancellable, with explicit load and inline muted playback for iPhone.
- [x] Test media readiness failures and verify an original-file upload through replay and download; physical iPhone confirmation remains a device retest.