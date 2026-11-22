/* Media readiness for on-device uploads. Never sample an undecoded or unseeked frame. */
const OPEN_ERROR =
  "This phone couldn’t open the video. Try selecting it from Files or choose another clip.";
const START_TIMEOUT =
  "The browser didn’t load the video in time. Try again with a copy saved on this device.";

function waitForMedia(
  video,
  ready,
  events,
  { signal, timeoutMs = 30000, message = OPEN_ERROR, timeoutMessage = message } = {},
) {
  return new Promise((resolve, reject) => {
    let timer, poll;
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const event of events) video.removeEventListener(event, check);
      video.removeEventListener("error", fail);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (error) => {
      cleanup();
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error("cancelled"));
    const fail = () => {
      const code = video.error?.code;
      const detail =
        code === 2 ? "The video could not be read from this device. Try a local copy." : message;
      finish(Object.assign(new Error(detail), { mediaCode: code }));
    };
    const check = () => {
      if (signal?.aborted) abort();
      else if (video.error) fail();
      else if (ready()) finish();
    };
    for (const event of events) video.addEventListener(event, check);
    video.addEventListener("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    poll = setInterval(check, 100);
    check();
  });
}

export async function openUploadVideo(video, url, options = {}) {
  if (options.signal?.aborted) throw new Error("cancelled");
  let prompt;
  try {
    video.src = url;
    video.load();
    const decoded = waitForMedia(
      video,
      () => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0,
      ["loadedmetadata", "loadeddata", "canplay", "playing"],
      { timeoutMessage: START_TIMEOUT, ...options },
    );
    // The picker callback may arrive after the browser's user activation expires.
    // If muted autoplay cannot wake the decoder, offer a fresh tap on the video.
    if (options.onPlaybackNeeded) {
      prompt = setTimeout(
        () => options.onPlaybackNeeded(() => video.play()),
        options.promptDelayMs ?? 1200,
      );
    }
    const kick = () => {
      try {
        video.play()?.catch(() => {});
      } catch {
        // Readiness and the separate playback button still work.
      }
    };
    kick();
    // iOS may ignore the first play() while the picked file is still staging;
    // nudge the decoder again once metadata exists.
    video.addEventListener("loadedmetadata", kick, { once: true });
    try {
      await decoded;
    } finally {
      video.removeEventListener("loadedmetadata", kick);
    }
  } finally {
    clearTimeout(prompt);
    video.pause();
  }
}

/** Try alternate container labels without altering the recorded bytes. */
export async function openUploadFile(video, file, mime, options = {}) {
  const types =
    mime === "video/quicktime"
      ? [mime, "video/mp4", ""]
      : mime === "video/mp4"
        ? [mime, ""]
        : [mime];
  // First-pick stalls are common on iPhone while Photos stages the file; one quiet
  // retry of the same bytes usually succeeds, matching a manual second upload.
  const attempts = types.map((type) => ({ type, stallRetry: true }));
  for (let i = 0; i < attempts.length; i++) {
    const { type } = attempts[i];
    const source = file.type === type ? file : file.slice(0, file.size, type);
    const url = URL.createObjectURL(source);
    const first = attempts[i].stallRetry;
    try {
      await openUploadVideo(video, url, {
        ...options,
        timeoutMs: first ? (options.firstTimeoutMs ?? 12000) : options.timeoutMs,
      });
      return { url, playbackMime: type };
    } catch (error) {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (options.signal?.aborted) throw error;
      if (first && error.mediaCode == null) {
        attempts.splice(i + 1, 0, { type, stallRetry: false });
        options.onRetry?.();
        continue;
      }
      if (![3, 4].includes(error.mediaCode) || i === attempts.length - 1) throw error;
      options.onRetry?.();
    }
  }
}

/** Also succeeds when metadata arrived before listeners were attached. */
export function waitForVideoMetadata(video, { signal, timeoutMs = 8000 } = {}) {
  return waitForMedia(
    video,
    () => video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0,
    ["loadedmetadata", "loadeddata", "canplay"],
    { signal, timeoutMs, message: "This recording couldn’t be opened." },
  );
}

export async function seekUploadVideo(video, time, options = {}) {
  if (options.signal?.aborted) throw new Error("cancelled");
  if (Math.abs(video.currentTime - time) > 0.001) video.currentTime = time;
  await waitForMedia(
    video,
    () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.02,
    ["seeked", "loadeddata", "canplay"],
    {
      ...options,
      timeoutMs: options.timeoutMs ?? 10000,
      message: options.message ?? "The browser could not read this frame.",
      timeoutMessage:
        options.timeoutMessage ?? "The browser stopped decoding frames during analysis.",
    },
  );
}
