/* Human-readable summary only: not a restorable backup; no media or per-frame arrays. */
import { servingArm } from "./contact-analysis.js";

const divider = "----------------------------------------";
const finite = (value) => Number.isFinite(value) && value >= 0;
const hand = (value) => servingArm(value) || "Unknown";
const dateText = (value) => {
  const d = new Date(value);
  return value && Number.isFinite(d.getTime())
    ? `${d.toLocaleString()} (${d.toISOString()})`
    : "Unknown";
};
const duration = (ms) => {
  if (!finite(ms)) return "Unavailable";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export function journalFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `serve-coach-journal-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}

export function buildJournal(data, exportedAt = new Date()) {
  const sessions = data.sessions
    .filter((s) => !s.deletedAt)
    .sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)));
  const ids = new Set(sessions.map((s) => s.id));
  const clips = data.clips.filter((c) => !c.deletedAt && ids.has(c.sessionId));
  const analyses = new Map(data.analyses.map((a) => [a.clipId, a]));
  const notes = data.notes.filter((n) => !n.deletedAt);
  const hands = [...new Set(sessions.map((s) => hand(s.dominantHand || s.playerHand || s.hand)))];
  const lines = [
    "Serve Coach Practice Journal",
    `Exported: ${dateText(exportedAt)}`,
    "",
    divider,
    "Lifetime Summary",
    `Practice sessions: ${sessions.length}`,
    `Video recordings: ${clips.length}`,
    `Serve recordings: ${clips.filter((c) => (c.strokeType || "serve") === "serve").length} (clips, not individual serves)`,
    `Personal notes: ${notes.length}`,
    `Recorded dominant hand: ${hands.join(", ") || "Unknown"}`,
    "",
    "Wrist speed and joint angles are measured in the 2D camera image. Framing and perspective affect them.",
    "Videos and per-frame landmark arrays are excluded. Use the separate practice backup for restoration.",
    "",
  ];
  function appendNotes(items) {
    if (!items.length) {
      lines.push("  No notes saved.");
      return;
    }
    for (const note of items.sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt)),
    )) {
      lines.push(`  Note: ${dateText(note.createdAt)}`);
      if (note.updatedAt && note.updatedAt !== note.createdAt)
        lines.push(`  Edited: ${dateText(note.updatedAt)}`);
      lines.push(
        ...String(note.text || "")
          .split(/\r?\n/)
          .map((line) => `    ${line}`),
        "",
      );
    }
  }
  for (const [index, session] of sessions.entries()) {
    const recordings = clips
      .filter((c) => c.sessionId === session.id)
      .sort((a, b) => a.seq - b.seq);
    const totalMs = recordings.reduce(
      (sum, c) => sum + (finite(c.video?.durationMs) ? c.video.durationMs : 0),
      0,
    );
    lines.push(
      divider,
      `Practice Session ${index + 1}`,
      `Session ID: ${session.id}`,
      `Date: ${dateText(session.date || session.createdAt)}`,
      `Dominant hand: ${hand(session.dominantHand || session.playerHand || session.hand)}`,
      `Stroke: ${session.strokeType || "serve"}`,
      `Status: ${session.status || "Unknown"}`,
      `Recording duration: ${duration(totalMs)}`,
      `Recordings: ${recordings.length}`,
    );
    if (session.plan)
      lines.push(
        "Practice plan:",
        ...Object.entries(session.plan).map(
          ([key, value]) =>
            `  - ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`,
        ),
      );
    lines.push("", "Practice Notes");
    appendNotes(notes.filter((n) => n.sessionId === session.id));
    lines.push("", "Recording Analysis");
    if (!recordings.length) lines.push("  No recordings saved.");
    for (const clip of recordings) {
      const analysis = analyses.get(clip.id),
        contact = analysis?.metrics?.contact,
        wrist = analysis?.metrics?.wrist;
      const angle = contact?.elbowAngleDegrees;
      lines.push(
        "",
        `  ${clip.strokeType || "Serve"} recording ${clip.seq}`,
        `  Clip ID: ${clip.id}`,
        `  Date: ${dateText(clip.createdAt)}`,
        `  Source: ${clip.source === "upload" ? "Uploaded footage" : "Camera recording"}`,
        `  Status: ${clip.status || "Unknown"}`,
        `  Duration: ${duration(clip.video?.durationMs)}${clip.video?.durationSource === "recovered-estimate" ? " (recovered estimate)" : ""}`,
        `  Serving hand: ${hand(clip.dominantHand || clip.servingArm)}`,
        `  Video file: ${clip.restoredWithoutVideo ? "Excluded from restored backup" : clip.video?.bytes ? "Stored separately" : "Unavailable"}`,
        `  Peak tracked wrist speed: ${finite(wrist?.peak?.speed) ? `${wrist.peak.speed.toFixed(1)}% of image diagonal per second` : "Unavailable"}`,
        `  Average tracked wrist speed: ${finite(wrist?.average) ? `${wrist.average.toFixed(1)}% of image diagonal per second` : "Unavailable"}`,
        `  Estimated overhead reach: ${finite(contact?.timestampMs) ? `${(contact.timestampMs / 1000).toFixed(3)}s into video` : "Unavailable"}`,
        `  2D elbow angle at overhead reach: ${finite(angle) ? `${angle.toFixed(1)} degrees (estimate)` : "Unavailable"}`,
      );
      if (analysis?.handSource === "replay-preference-fallback")
        lines.push(
          `  Analysis hand: ${hand(analysis.dominantHand)} (replay preference fallback, not captured hand)`,
        );
      if (analysis?.coaching) {
        lines.push("  Recording-based coaching:");
        if (analysis.coaching.status !== "supported")
          lines.push(`    Insufficient data: ${analysis.coaching.reason}`);
        for (const [key, label] of [
          ["positive", "What went well"],
          ["improvement", "Potential improvement"],
          ["recommendation", "Try next"],
        ]) {
          const item = analysis.coaching[key];
          if (item)
            lines.push(
              `    ${label}: ${item.text}`,
              `    Saved frame: ${item.evidence.frameIndex + 1}${finite(item.evidence.timestampMs) ? ` / ${(item.evidence.timestampMs / 1000).toFixed(3)}s (estimated video timing)` : ""}`,
            );
        }
      }
    }
    lines.push("");
  }
  const general = notes.filter((n) => !n.sessionId || !ids.has(n.sessionId));
  if (general.length) {
    lines.push(divider, "General / Unassigned Notes");
    appendNotes(general);
  }
  if (!sessions.length) lines.push("No practice sessions saved yet.");
  return lines.join("\n") + "\n";
}
