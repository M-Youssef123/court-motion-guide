/*
 * store.js — persistence. Everything stays on this device.
 *
 * LocalStorage: small preferences (KEYS / prefs).
 * IndexedDB ("serve-coach"): sessions, clips, video chunks, movement, analyses and notes.
 *
 * Data model (schemaVersion 3; analysis records have their own schema/algorithm version)
 *   sessions  { id, createdAt, endedAt, status: 'active'|'ended', plan, clipCount, ... }
 *   clips     { id, sessionId, seq, createdAt, endedAt, status: 'recording'|'saved'|'interrupted',
 *               side, camera{facing,label}, video{mime,width,height,bitrateRequested,bytes,chunks,durationMs},
 *               poses{frames,format,model,backend,inputMode,fps}, sync{offsetMs,method,measuredAt}, stopReason }
 *   chunks    { clipId, seq, blob }        video in ~2 s pieces, written while recording
 *   poses     { clipId, seq, frames:[{t, kp}] }  t = ms since clip start; kp = 17 × [x/width, y/height, score] or null
 *   analyses  { clipId, sessionId, schemaVersion, algorithmVersion, timebase, frames:[{t, trackingConfidence, jointAngles}], metrics }
 *
 * Cloud-ready choices (see MVP1 feasibility): random UUIDs, schemaVersion on every record,
 * video stored as ordered chunks, keypoints normalised to the recorded frame, soft-delete
 * marker (deletedAt), and owner/sync placeholders. UI code uses only the functions below.
 */

import { buildBackup, validateBackup } from "./practice-backup.js";
import { buildClipAnalysis, ANALYSIS_VERSION } from "./practice-data.js";
import { servingArm } from "./contact-analysis.js";
import { COACHING_VERSION } from "./coaching-insights.js";

export const KEYS = {
  cfg: "sc-cfg", // { hand: 'R'|'L', side: 'deuce'|'ad' }
  spot: "sc-spot", // legacy (v1.4 camera wizard); no longer used
  profile: "sc-profile", // { hand: 'R'|'L', handSetAt }
  notes: "sc-notes", // legacy string[]; migrated to IndexedDB on upgrade
  camera: "sc-camera", // 'environment' | 'user'
};

export const prefs = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage full or blocked */
    }
  },
};

/* ------------------------------------------------------------------ IndexedDB basics */
const DB_NAME = "serve-coach";
const DB_VERSION = 4;
export const SCHEMA_VERSION = 3; // 3: session/clip stroke, hand and duration; linked analyses
const BASE = () => ({
  schemaVersion: SCHEMA_VERSION,
  ownerId: "local",
  syncState: "local-only",
  deletedAt: null,
});

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("sessions")) {
          const s = d.createObjectStore("sessions", { keyPath: "id" });
          s.createIndex("createdAt", "createdAt");
          const c = d.createObjectStore("clips", { keyPath: "id" });
          c.createIndex("sessionId", "sessionId");
          c.createIndex("status", "status");
          d.createObjectStore("chunks", { keyPath: ["clipId", "seq"] });
          d.createObjectStore("poses", { keyPath: ["clipId", "seq"] });
        }
        if (!d.objectStoreNames.contains("notes")) {
          const notes = d.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("sessionId", "sessionId");
          const legacy = prefs.get(KEYS.notes);
          if (Array.isArray(legacy))
            legacy.forEach((text, i) => {
              if (typeof text === "string" && text.trim())
                notes.put({
                  ...BASE(),
                  id: `legacy-note-${i}`,
                  sessionId: null,
                  text: text.trim(),
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
                  source: "legacy",
                });
            });
        }
        if (!d.objectStoreNames.contains("drills"))
          d.createObjectStore("drills", { keyPath: "id" });
        if (!d.objectStoreNames.contains("analyses")) {
          const analyses = d.createObjectStore("analyses", { keyPath: "clipId" });
          analyses.createIndex("sessionId", "sessionId");
          const transaction = req.transaction;
          if (transaction) {
            transaction.objectStore("sessions").openCursor().onsuccess = (e) => {
              const cursor = e.target.result;
              if (!cursor) return;
              const session = sessionRecord(cursor.value);
              transaction.objectStore("clips").index("sessionId").getAll(session.id).onsuccess = (
                event,
              ) => {
                const clips = event.target.result;
                transaction
                  .objectStore("sessions")
                  .put({ ...session, recordingDurationMs: totalDuration(clips) });
                clips.forEach((clip) =>
                  transaction.objectStore("clips").put(clipRecord(clip, session)),
                );
              };
              cursor.continue();
            };
          }
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
        };
        try {
          localStorage.removeItem(KEYS.notes);
        } catch (e) {
          /* migration already committed */
        }
        resolve(d);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      req.onblocked = () =>
        reject(
          new Error("Storage is busy in another tab. Close other Ace.Tennis tabs and try again."),
        );
    });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(stores, mode);
        let result;
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("Transaction aborted"));
        result = fn(t);
      }),
  );
}
function req2p(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function getAll(store, query, index) {
  const d = await db();
  const os = d.transaction(store).objectStore(store);
  return req2p((index ? os.index(index) : os).getAll(query));
}
async function get(store, key) {
  const d = await db();
  return req2p(d.transaction(store).objectStore(store).get(key));
}
const range = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const nowIso = () => new Date().toISOString();
const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {
    return "";
  }
};

function sessionRecord(session) {
  return {
    ...session,
    schemaVersion: SCHEMA_VERSION,
    date: session.date || session.createdAt || null,
    dominantHand: servingArm(session.dominantHand || session.playerHand || session.hand),
    strokeType: session.strokeType || "serve",
    recordingDurationMs: session.recordingDurationMs ?? 0,
  };
}
function clipRecord(clip, session) {
  return {
    ...clip,
    schemaVersion: SCHEMA_VERSION,
    strokeType: clip.strokeType || session?.strokeType || "serve",
    dominantHand: servingArm(clip.dominantHand || clip.servingArm || session?.dominantHand),
    recordingDurationMs: clip.video?.durationMs ?? clip.recordingDurationMs ?? 0,
  };
}
function totalDuration(clips) {
  return clips
    .filter((c) => !c.deletedAt)
    .reduce(
      (sum, c) =>
        sum + (Number.isFinite(c.video?.durationMs) ? Math.max(0, c.video.durationMs) : 0),
      0,
    );
}
function refreshSessionTotals(t, sessionId) {
  t.objectStore("clips").index("sessionId").getAll(sessionId).onsuccess = (e) => {
    const clips = e.target.result.filter((c) => !c.deletedAt);
    const sessions = t.objectStore("sessions");
    sessions.get(sessionId).onsuccess = (event) => {
      const session = event.target.result;
      if (session)
        sessions.put({
          ...sessionRecord(session),
          recordingDurationMs: totalDuration(clips),
          clipCount: clips.length,
        });
    };
  };
}

/* ------------------------------------------------------------------ sessions */
export async function createSession(plan = null, extra = {}) {
  const s = sessionRecord({
    ...BASE(),
    id: uuid(),
    createdAt: nowIso(),
    timeZone: tz(),
    endedAt: null,
    status: "active",
    plan,
    clipCount: 0,
    dominantHand: servingArm(
      extra.dominantHand || extra.playerHand || extra.hand || prefs.get(KEYS.profile)?.hand,
    ),
    ...extra,
  });
  await tx("sessions", "readwrite", (t) => t.objectStore("sessions").put(s));
  return s;
}
export async function getSession(id) {
  return get("sessions", id);
}
export async function updateSession(id, changes) {
  return tx("sessions", "readwrite", (t) => {
    const os = t.objectStore("sessions");
    os.get(id).onsuccess = (e) => {
      const s = e.target.result;
      if (s) os.put({ ...s, ...changes });
    };
  });
}
export async function endSession(id) {
  return updateSession(id, { status: "ended", endedAt: nowIso() });
}
/** Most recent session that hasn't been ended (and isn't deleted), or null. */
export async function getActiveSession() {
  const all = (await getAll("sessions")).filter((s) => s.status === "active" && !s.deletedAt);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all[0] || null;
}
/** All sessions, newest first, each with its (non-deleted) clips in order. */
export async function listSessions() {
  const [sessions, clips] = await Promise.all([getAll("sessions"), getAll("clips")]);
  const bySession = {};
  clips
    .filter((c) => !c.deletedAt)
    .forEach((c) => {
      (bySession[c.sessionId] = bySession[c.sessionId] || []).push(c);
    });
  return sessions
    .filter((s) => !s.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({ ...s, clips: (bySession[s.id] || []).sort((a, b) => a.seq - b.seq) }));
}
export async function getSessionClips(sessionId) {
  return (await getAll("clips", sessionId, "sessionId"))
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.seq - b.seq);
}

/* ------------------------------------------------------------------ personal notes
 * Shared read API for future on-device coaching. Text remains personal user input,
 * not coaching instructions. New notes require a real session; legacy notes stay unassigned
 * until the user explicitly associates them. Writes resolve only after persistence.
 */
export async function listNotes(sessionId) {
  const notes =
    sessionId === undefined ? await getAll("notes") : await getAll("notes", sessionId, "sessionId");
  return notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export async function saveNote({ id, sessionId, text }) {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) throw new Error("Write a note before saving.");
  const previous = id ? await get("notes", id) : null;
  if (id && !previous) throw new Error("This note no longer exists.");
  if (!sessionId && !(previous && previous.source === "legacy"))
    throw new Error("Choose a practice session.");
  const note = {
    ...BASE(),
    ...(previous || {}),
    id: id || uuid(),
    sessionId: sessionId || null,
    text: clean,
    createdAt: previous ? previous.createdAt : nowIso(),
    updatedAt: nowIso(),
  };
  await tx(["notes", "sessions"], "readwrite", (t) => {
    const write = () => t.objectStore("notes").put(note);
    if (!sessionId) write();
    else
      t.objectStore("sessions").get(sessionId).onsuccess = (e) => {
        const session = e.target.result;
        if (!session || session.deletedAt) t.abort();
        else write();
      };
  });
  return note;
}
export async function deleteNote(id) {
  await tx("notes", "readwrite", (t) => t.objectStore("notes").delete(id));
}

/* ------------------------------------------------------------------ clips */
export async function createClip(sessionId, fields) {
  const session = await getSession(sessionId);
  if (!session || session.deletedAt) throw new Error("Practice session no longer exists.");
  const existing = await getAll("clips", sessionId, "sessionId");
  const seq = existing.reduce((m, c) => Math.max(m, c.seq || 0), 0) + 1;
  const clip = clipRecord(
    {
      ...BASE(),
      id: uuid(),
      sessionId,
      seq,
      createdAt: nowIso(),
      endedAt: null,
      status: "recording",
      uploadConsent: false,
      sync: { offsetMs: null, method: null, measuredAt: null },
      ...fields,
    },
    session,
  );
  await tx(["clips", "sessions"], "readwrite", (t) => {
    t.objectStore("clips").put(clip);
    refreshSessionTotals(t, sessionId);
  });
  return clip;
}
export async function getClip(id) {
  return get("clips", id);
}
export async function updateClip(id, changes) {
  return tx(["clips", "sessions"], "readwrite", (t) => {
    const os = t.objectStore("clips");
    os.get(id).onsuccess = (e) => {
      const c = e.target.result;
      if (c && !c.deletedAt) {
        os.put(clipRecord({ ...c, ...changes }));
        refreshSessionTotals(t, c.sessionId);
      }
    };
  });
}
export function putChunk(clipId, seq, blob) {
  return tx("chunks", "readwrite", (t) => t.objectStore("chunks").put({ clipId, seq, blob }));
}
export function putPoses(clipId, seq, frames) {
  return tx("poses", "readwrite", (t) => t.objectStore("poses").put({ clipId, seq, frames }));
}
/** The clip's video as one Blob (chunks joined in order). */
export async function getClipVideo(clip, { playback = false } = {}) {
  const chunks = (await getAll("chunks", range(clip.id))).sort((a, b) => a.seq - b.seq);
  return {
    blob: new Blob(
      chunks.map((c) => c.blob),
      {
        type:
          (playback ? clip.video?.playbackMime : undefined) ?? (clip.video?.mime || "video/mp4"),
      },
    ),
    chunks: chunks.length,
  };
}
/** All pose frames for a clip, sorted by time. */
export async function getClipPoses(clipId) {
  const batches = (await getAll("poses", range(clipId))).sort((a, b) => a.seq - b.seq);
  return batches
    .flatMap((b) => b.frames)
    .filter((frame) => Number.isFinite(frame?.t))
    .sort((a, b) => a.t - b.t);
}

/** Save derived metrics separately from raw pose/video chunks; all records share clipId. */
export async function getClipAnalysis(clipId) {
  return get("analyses", clipId);
}
export async function finalizeClipData(clipId, options = {}) {
  const clip = await getClip(clipId);
  if (!clip || clip.deletedAt || clip.status === "recording") return null;
  const frames = await getClipPoses(clipId);
  if (clip.restoredWithoutVideo && !frames.length) return getClipAnalysis(clipId);
  const analysis = buildClipAnalysis(clip, frames, options);
  await tx(["clips", "analyses"], "readwrite", (t) => {
    t.objectStore("clips").get(clipId).onsuccess = (e) => {
      if (e.target.result && !e.target.result.deletedAt) t.objectStore("analyses").put(analysis);
    };
  });
  return analysis;
}
/** Legacy/recovered saved clips gain metrics from existing frames, never current camera/profile. */
export async function backfillPracticeData() {
  const clips = (await getAll("clips")).filter((c) => !c.deletedAt && c.status !== "recording");
  const failures = [];
  for (const clip of clips) {
    try {
      const analysis = await getClipAnalysis(clip.id);
      if (
        !analysis ||
        analysis.schemaVersion !== ANALYSIS_VERSION ||
        analysis.coaching?.version !== COACHING_VERSION
      )
        await finalizeClipData(clip.id);
    } catch (e) {
      failures.push({ clipId: clip.id, error: e.name || "StorageError" });
    }
  }
  return failures;
}
/** Extensible coaching/export input. Raw landmarks stay normalized; missing metrics stay null. */
export async function getPracticeData(sessionId) {
  const session = await getSession(sessionId);
  if (!session || session.deletedAt) return null;
  const clips = await getSessionClips(sessionId);
  const recordings = await Promise.all(
    clips.map(async (clip) => {
      const [poseFrames, analysis] = await Promise.all([
        getClipPoses(clip.id),
        getClipAnalysis(clip.id),
      ]);
      return {
        ...clip,
        poseFrames,
        analysis: analysis || null,
        videoReference: { clipId: clip.id, store: "chunks" },
      };
    }),
  );
  return { ...session, recordings, notes: await listNotes(sessionId) };
}
export function getDrillCompletion(id) {
  return get("drills", id);
}
export function listDrillCompletions() {
  return getAll("drills");
}

export function completeDrill(drillId, clipId) {
  const id = JSON.stringify([drillId, clipId]);
  return tx(["drills", "clips"], "readwrite", (t) => {
    const drills = t.objectStore("drills");
    t.objectStore("clips").get(clipId).onsuccess = ({ target }) => {
      if (!target.result || target.result.deletedAt) {
        t.abort();
        return;
      }
      drills.get(id).onsuccess = (event) => {
        if (!event.target.result)
          drills.add({ id, drillId, clipId, completedAt: nowIso(), schemaVersion: 1 });
      };
    };
  });
}

/** Consistent metadata-only journal snapshot. Never opens video/chunk or raw pose stores. */
export async function getJournalData() {
  const result = { sessions: [], clips: [], notes: [], analyses: [] };
  await tx(["sessions", "clips", "notes", "analyses"], "readonly", (t) => {
    for (const name of Object.keys(result)) {
      t.objectStore(name).openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const record = cursor.value;
        if (!record.deletedAt) {
          if (name === "analyses") {
            const { clipId, sessionId, metrics, generatedAt, handSource, dominantHand, coaching } =
              record;
            const wrist = metrics?.wrist;
            const summary = wrist
              ? {
                  ...metrics,
                  wrist: {
                    peak: wrist.peak,
                    average: wrist.average,
                    trackedSeconds: wrist.trackedSeconds,
                  },
                }
              : metrics;
            result.analyses.push({
              clipId,
              sessionId,
              metrics: summary,
              generatedAt,
              handSource,
              dominantHand,
              coaching,
            });
          } else result[name].push(record);
        }
        cursor.continue();
      };
    }
  });
  return result;
}
/** Capture a consistent archive of local practice data without reading video chunks. */
export async function exportPracticeBackup() {
  const data = { sessions: [], clips: [], poses: [], notes: [], analyses: [], drills: [] };
  await tx(Object.keys(data), "readonly", (t) => {
    for (const [name, rows] of Object.entries(data)) {
      t.objectStore(name).getAll().onsuccess = ({ target }) =>
        target.result.forEach((row) => {
          if (!row.deletedAt) rows.push(row);
        });
    }
  });
  const sessions = new Set(data.sessions.map((session) => session.id));
  data.clips = data.clips.filter(
    (clip) => sessions.has(clip.sessionId) && clip.status !== "recording",
  );
  const clips = new Set(data.clips.map((clip) => clip.id));
  data.notes = data.notes.filter((note) => note.sessionId == null || sessions.has(note.sessionId));
  for (const name of ["poses", "analyses", "drills"])
    data[name] = data[name].filter((row) => clips.has(row.clipId));
  return buildBackup(data);
}

/** Merge missing records in one transaction. Existing sessions, clips, notes and videos win. */
export async function importPracticeBackup(backup) {
  const data = validateBackup(backup);
  const result = { sessions: 0, clips: 0, notes: 0 };
  await tx(Object.keys(data), "readwrite", (t) => {
    const sessions = t.objectStore("sessions"),
      clips = t.objectStore("clips"),
      notes = t.objectStore("notes");
    const group = (rows, key) => {
      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row[key])) groups.set(row[key], []);
        groups.get(row[key]).push(row);
      }
      return groups;
    };
    const clipsBySession = group(data.clips, "sessionId");
    const notesBySession = group(data.notes, "sessionId");
    const related = Object.fromEntries(
      ["analyses", "poses", "drills"].map((name) => [name, group(data[name], "clipId")]),
    );
    const addNote = (note) => {
      notes.get(note.id).onsuccess = ({ target }) => {
        if (!target.result) {
          notes.add(note);
          result.notes++;
        }
      };
    };
    data.notes.filter((note) => note.sessionId == null).forEach(addNote);
    for (const session of data.sessions) {
      sessions.get(session.id).onsuccess = ({ target }) => {
        const existing = target.result;
        if (existing?.deletedAt || (existing && existing.createdAt !== session.createdAt)) return;
        if (!existing) {
          sessions.add(
            sessionRecord({
              ...session,
              status: "ended",
              endedAt: session.endedAt || backup.createdAt || session.createdAt,
              clipCount: 0,
              recordingDurationMs: 0,
            }),
          );
          result.sessions++;
        }
        (notesBySession.get(session.id) || []).forEach(addNote);
        for (const clip of clipsBySession.get(session.id) || []) {
          clips.get(clip.id).onsuccess = ({ target: request }) => {
            const local = request.result;
            if (
              local &&
              (local.deletedAt ||
                local.sessionId !== session.id ||
                local.createdAt !== clip.createdAt)
            )
              return;
            if (!local) {
              clips.add(
                clipRecord(
                  {
                    ...clip,
                    restoredWithoutVideo: true,
                    video: { ...clip.video, chunks: 0, bytes: 0 },
                  },
                  session,
                ),
              );
              result.clips++;
              for (const name of ["analyses", "poses"]) {
                for (const row of related[name].get(clip.id) || []) t.objectStore(name).add(row);
              }
              refreshSessionTotals(t, session.id);
            }
            for (const drill of related.drills.get(clip.id) || []) {
              const drills = t.objectStore("drills");
              drills.get(drill.id).onsuccess = (event) => {
                if (!event.target.result) drills.add(drill);
              };
            }
          };
        }
      };
    }
  });
  return result;
}

function deleteClipDrills(t, clipIds) {
  t.objectStore("drills").openCursor().onsuccess = ({ target }) => {
    const cursor = target.result;
    if (!cursor) return;
    if (clipIds.has(cursor.value.clipId)) cursor.delete();
    cursor.continue();
  };
}
/** Permanently delete a clip with its video and movement data (manual deletion, MVP1). */
export async function deleteClip(clip) {
  await tx(["clips", "chunks", "poses", "sessions", "analyses", "drills"], "readwrite", (t) => {
    t.objectStore("clips").delete(clip.id);
    t.objectStore("chunks").delete(range(clip.id));
    t.objectStore("poses").delete(range(clip.id));
    t.objectStore("analyses").delete(clip.id);
    deleteClipDrills(t, new Set([clip.id]));
    refreshSessionTotals(t, clip.sessionId);
  });
}
/** Permanently delete a whole session and all its clips. */
export async function deleteSession(sessionId) {
  const clips = await getAll("clips", sessionId, "sessionId");
  await tx(
    ["clips", "chunks", "poses", "sessions", "notes", "analyses", "drills"],
    "readwrite",
    (t) => {
      clips.forEach((c) => {
        t.objectStore("clips").delete(c.id);
        t.objectStore("chunks").delete(range(c.id));
        t.objectStore("poses").delete(range(c.id));
        t.objectStore("analyses").delete(c.id);
      });
      deleteClipDrills(t, new Set(clips.map((c) => c.id)));
      t.objectStore("sessions").delete(sessionId);
      t.objectStore("notes").index("sessionId").openCursor(sessionId).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    },
  );
  window.dispatchEvent(new Event("practice-notes-changed"));
}

/**
 * After a crash or a closed tab, clips can be left in 'recording'. Keep everything that was
 * saved and mark them 'interrupted' (never delete). Returns the number recovered.
 */
export async function recoverUnfinishedClips(exceptClipId = null) {
  const open = (await getAll("clips", "recording", "status")).filter((c) => c.id !== exceptClipId);
  for (const c of open) {
    const chunks = await getAll("chunks", range(c.id));
    const frames = await getClipPoses(c.id);
    const bytes = chunks.reduce((n, x) => n + (x.blob ? x.blob.size : 0), 0);
    const lastT = frames.length ? frames[frames.length - 1].t : 0;
    await updateClip(c.id, {
      // A first chunk can be just the file header (Chrome MP4): treat tiny recoveries as empty.
      status: bytes > 10000 ? "interrupted" : "interrupted-empty",
      endedAt: c.endedAt || nowIso(),
      stopReason: "app closed or crashed while recording",
      video: {
        ...(c.video || {}),
        bytes,
        chunks: chunks.length,
        durationMs: Math.max(lastT, chunks.length * 2000),
        durationSource: "recovered-estimate",
      },
      poses: { ...(c.poses || {}), frames: frames.length },
    });
  }
  return open.length;
}

/**
 * Clips saved before tripod position existed (schema 1) get tripodPosition 'unknown' — never
 * a guess — and video.orientation from their saved size. Runs once per clip; safe to repeat.
 */
export async function markUnknownTripodPositions() {
  const old = (await getAll("clips")).filter((c) => !c.tripodPosition);
  for (const c of old) {
    const v = c.video || {};
    await updateClip(c.id, {
      tripodPosition: "unknown",
      video: {
        ...v,
        orientation:
          v.orientation ||
          (v.width && v.height ? (v.height > v.width ? "portrait" : "landscape") : "unknown"),
      },
    });
  }
  return old.length;
}

/* ------------------------------------------------------------------ storage status */
export async function requestPersistentStorage() {
  try {
    return navigator.storage && navigator.storage.persist
      ? await navigator.storage.persist()
      : false;
  } catch (e) {
    return false;
  }
}
/**
 * Free space as the browser reports it, plus our own total of saved video (Safari's usage
 * figure is unreliable, WP0). freeMB is null when the browser can't tell.
 */
export async function storageStatus() {
  const clips = (await getAll("clips")).filter((c) => !c.deletedAt);
  const ourMB = clips.reduce((n, c) => n + ((c.video && c.video.bytes) || 0), 0) / 1e6;
  let freeMB = null,
    persisted = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      freeMB = (e.quota - Math.max(e.usage, ourMB * 1e6)) / 1e6;
    }
    if (navigator.storage && navigator.storage.persisted)
      persisted = await navigator.storage.persisted();
  } catch (e) {
    /* unknown */
  }
  return { ourMB, freeMB, persisted };
}
