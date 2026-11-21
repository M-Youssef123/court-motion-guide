# Swing-speed analysis
- [x] Extract estimated hand/racket speeds from stored pose frames with confidence checks and smoothing.
- [x] Show estimates and peak-video seek on replay without changing recording or playback rates.
- [x] Test calculations, invalid tracking, and replay on desktop/mobile.

# Hitting-moment correction
- [x] Identify overhead hitting extension after a bent-arm preparation and before follow-through, rejecting toss-only motion.
- [x] Seek to that estimated hitting moment, withholding the shortcut when the sequence is unclear.
- [x] Test phase selection and verify replay seeking without changing playback speed or downloads.