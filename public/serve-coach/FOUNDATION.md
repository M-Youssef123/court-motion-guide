# Serve Coach foundation

## Changes against the existing app

| Priority | Before this branch | This branch |
| --- | --- | --- |
| Mobile uploads | File picker, decoded-frame and seek checks, staged progress, original video storage | Recognises common camera files reported with generic MIME types. Samples decoded frames through one reusable, aspect-preserving canvas with a 640 px long edge. Cancellation covers chunk writes. A saved clip is published after all video and pose data is written. |
| Analysis engine | MoveNet tracking, normalized timestamped frames, serving-arm contact heuristics | Version 2 analysis adds confidence-gated, time-weighted landmark smoothing for movement and wrist summaries. Raw poses and the existing serve-specific contact path are preserved. Other strokes can use the shared image-plane metrics. |
| Body measurements | Frame-level elbow, shoulder, hip and knee angles saved in IndexedDB | Adds shoulder tilt and torso lean. Replay shows supported 2D knee, elbow, shoulder tilt and lean readings with a toggle and reports elbow extension at estimated overhead reach. |
| Swing movement | Contact-local wrist estimate with a fixed racket multiplier | Replay and journal present tracked dominant-wrist peak and elapsed-time-weighted average speed in percent of image diagonal per second. Replay adds a short trajectory trail, a peak marker and a jump to the peak. |
| Coaching | Deterministic, timestamped feedback and working voice controls | Named, configurable provisional thresholds. The existing evidence checks and voice controls remain in use. User-facing analysis uses camera-plane measurements. |
| Phase comparison | Toss, Trophy and Finish frame extraction, manual override and original coach diagrams | Existing phase tools and manual choices are retained. Restored clips without media explain why frame comparison is unavailable. |
| Drills | Example drill in static markup | Two reusable shadow-serve drills selected from supported extension observations. IndexedDB stores completion per drill and evidence clip. |
| Progress | Real recordings and recent session metadata mixed with illustrative comparisons and serve counts | Saved session history, Home coaching from the recent practice, first and previous comparable session comparisons, and graphs of elbow angle and within-practice variation. Example results and accuracy figures were removed. |
| Backup | Readable journal with separate original video downloads | Adds versioned JSON backup and additive, transactional restoration. Notes, pose data, session details, manual selections and drill completions come across. Derived measurements and coaching are rebuilt from validated poses. Existing IDs are kept. |
| Ask your coach | Placeholder questions and answer markup | Technique, consistency, change and drills use a replaceable deterministic answer function with saved evidence and explicit insufficient-data responses. |

## Verification and limitations

- Run `npm test`, `npx --no-install tsc --noEmit` and `npm run build`. The static-app smoke test runs its entry module against the actual screen markup in jsdom with mocked media and canvas. Media mocks do not exercise a phone decoder.
- The physical-device upload failure has not been reproduced on this branch. Use the same failing file and URL from the original report, then compare Safari on iPhone, Chrome on Android and desktop. Check a camera MOV, an H.264 MP4, a high-resolution clip, picker cancellation and retry, storage pressure, and unsupported-codec guidance. Verify saved replay and live recording separately. Canvas downscaling limits inference memory. The browser must still decode the original footage and support its codec.
- Wrist speed is an image-plane estimate across reliable intervals in the recording. A clip can contain multiple serves or other movements. Camera motion, distance, angle and pose confidence affect readings. The period of highest tracked wrist motion is not labelled as ball contact.
- History compares only supported overhead-reach observations with matching recorded stroke, serving hand, side, tripod category, camera facing and orientation. Matching fields cannot establish identical camera placement. Unknown setups are excluded. Within-practice variation needs at least two clips. Serve phase rules and coaching thresholds still need validation on annotated footage.
- JSON backup version 1 includes up to 32 MB of practice data. Original videos are downloaded separately. Restoring a backup does not attach separate video files. Restoring over existing data preserves existing entries and media.
- Pose inference and storage remain on-device. The existing MoveNet assets still need to load. Technique rules and drills are currently serve-specific. No paid API or LLM integration is required.
