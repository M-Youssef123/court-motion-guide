/* Media readiness for on-device uploads. Never sample an undecoded or unseeked frame. */
const OPEN_ERROR =
  "This video couldn’t be decoded by this browser. Try exporting it as an H.264 MP4, then upload it again.";

function waitForMedia(
  video,
  ready,
  events,
  { signal, timeoutMs = 30000, message = OPEN_ERROR } = {},
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
    const fail = () => finish(new Error(message));
    const check = () => {
      if (signal?.aborted) abort();
      else if (video.error) fail();
      else if (ready()) finish();
    };
    for (const event of events) video.addEventListener(event, check);
    video.addEventListener("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(fail, timeoutMs);
    poll = setInterval(check, 100);
    check();
  });
}

export async function openUploadVideo(video, url, options = {}) {
  // Register before load(): cached metadata may arrive immediately.
  const metadata = waitForMedia(
    video,
    () => video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0,
    ["loadedmetadata", "loadeddata", "canplay"],
    options,
  );
  try {
    video.src = url;
    video.load();
    // Called in the file-picker gesture; muted inline playback can wake iOS decoding.
    // Playback denial is not fatal if the decoder can otherwise supply a frame.
    try {
      const playing = video.play();
      playing?.catch(() => {});
    } catch {
      /* readiness decides */
    }
    await metadata;
    await waitForMedia(
      video,
      () => video.readyState >= 2,
      ["loadeddata", "canplay", "playing"],
      options,
    );
  } finally {
    video.pause();
  }
}

export async function seekUploadVideo(video, time, options = {}) {
  if (options.signal?.aborted) throw new Error("cancelled");
  video.currentTime = time;
  await waitForMedia(
    video,
    () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.02,
    ["seeked", "loadeddata", "canplay"],
    {
      ...options,
      timeoutMs: options.timeoutMs ?? 10000,
      message:
        "This video stopped decoding during processing. Try an H.264 MP4 copy and upload it again.",
    },
  );
}
