# 0019: Haptics and sound cues

- **Date:** 2026-11-15
- **Status:** Accepted

## Decision

- `apps/web/src/lib/feedback.ts` plays three cues: **turn** (short buzz and beep when it becomes
  your turn), **win** (rising four-note arpeggio) and **lose** (two falling notes).
  - Vibration uses `navigator.vibrate` (Android; iOS ignores it).
  - Tones are synthesised with Web Audio, so there are no sound files to download. Audio
    unlocks on the first tap, as browsers require.
- Cues fire in real matches (GameStage, Result) and in practice. A result cues once, and only if
  it happened in the last 2 minutes, so opening an old match stays quiet. Draws are silent.
- **On by default.** Settings → "Sounds and vibration" turns it off on this device (localStorage).
