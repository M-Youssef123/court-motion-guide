import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { describe, it, expect, vi } from "vitest";
// @ts-expect-error plain JS module
import { initUpload, uploadMime, uploadProblem } from "../../public/serve-coach/js/upload.js";
import {
  openUploadFile,
  openUploadVideo,
  seekUploadVideo,
  // @ts-expect-error plain JS module
} from "../../public/serve-coach/js/upload-media.js";
// @ts-expect-error plain JS module
import * as store from "../../public/serve-coach/js/store.js";
describe("uploadProblem", () => {
  it("rejects non-video files", () =>
    expect(uploadProblem({ type: "image/png", size: 10 })).toMatch(/isn’t a video/));
  it("rejects files over 500 MB", () =>
    expect(uploadProblem({ type: "video/mp4", size: 501 * 1024 * 1024 })).toMatch(/too large/));
  it("accepts a normal video", () =>
    expect(uploadProblem({ type: "video/quicktime", size: 1000 })).toBeNull());
});

class MediaStub extends EventTarget {
  src = "";
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  currentTime = 0;
  seeking = false;
  error: object | null = null;
  load = vi.fn();
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  play = vi.fn<() => Promise<void>>(() => Promise.reject(new Error("Playback denied")));
  pause = vi.fn();
  metadata() {
    this.readyState = 1;
    this.videoWidth = 720;
    this.videoHeight = 1280;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
}

describe("upload media readiness", () => {
  it("loads and kicks playback immediately, but waits for decoded data after metadata", async () => {
    const video = new MediaStub();
    let finished = false;
    const opening = openUploadVideo(video, "blob:test").then(() => {
      finished = true;
    });
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
    video.metadata();
    await Promise.resolve();
    expect(finished).toBe(false);
    video.readyState = 2;
    video.dispatchEvent(new Event("canplay"));
    await opening;
    expect(finished).toBe(true);
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it("accepts readiness reached synchronously in load without loadeddata", async () => {
    const video = new MediaStub();
    video.load.mockImplementation(() => {
      video.metadata();
      video.readyState = 2;
    });
    await openUploadVideo(video, "blob:cached");
    expect(video.src).toBe("blob:cached");
  });

  it("cancels while metadata is pending and pauses playback", async () => {
    const video = new MediaStub(),
      controller = new AbortController();
    const opening = openUploadVideo(video, "blob:test", { signal: controller.signal });
    controller.abort();
    await expect(opening).rejects.toThrow("cancelled");
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it("waits for a fresh tap if muted autoplay leaves the decoder waiting", async () => {
    const video = new MediaStub();
    let requestPlay: (() => Promise<void>) | undefined;
    const opening = openUploadVideo(video, "blob:phone", {
      promptDelayMs: 0,
      onPlaybackNeeded: (play: () => Promise<void>) => {
        requestPlay = play;
      },
    });
    video.metadata();
    await vi.waitFor(() => expect(requestPlay).toBeTypeOf("function"));
    video.play.mockImplementationOnce(async () => {
      video.readyState = 2;
      video.dispatchEvent(new Event("playing"));
    });
    await requestPlay!();
    await opening;
    expect(video.play).toHaveBeenCalledTimes(3);
  });

  it("reports startup stalls separately from unsupported formats", async () => {
    const video = new MediaStub();
    await expect(openUploadVideo(video, "blob:slow", { timeoutMs: 5 })).rejects.toThrow(
      "didn’t load the video in time",
    );
  });

  it("rejects decoder errors without waiting for a timeout", async () => {
    const video = new MediaStub();
    const opening = openUploadVideo(video, "blob:test");
    video.error = { code: 4 };
    video.dispatchEvent(new Event("error"));
    await expect(opening).rejects.toMatchObject({
      mediaCode: 4,
      message: expect.stringContaining("Try selecting it from Files"),
    });
  });

  it("does not sample a frame while the seek or decoding is incomplete", async () => {
    const video = new MediaStub();
    video.readyState = 1;
    video.seeking = true;
    let finished = false;
    const seek = seekUploadVideo(video, 0.2).then(() => {
      finished = true;
    });
    video.dispatchEvent(new Event("seeked"));
    await Promise.resolve();
    expect(finished).toBe(false);
    video.seeking = false;
    video.readyState = 2;
    video.dispatchEvent(new Event("canplay"));
    await seek;
    expect(finished).toBe(true);
    expect(video.currentTime).toBe(0.2);
  });

  it("does not wait for seeked when an already decoded frame is at the target", async () => {
    const video = new MediaStub();
    video.readyState = 2;
    await seekUploadVideo(video, 0);
    expect(video.currentTime).toBe(0);
  });

  it("rejects a stalled seek instead of silently analysing the previous frame", async () => {
    const video = new MediaStub();
    video.seeking = true;
    await expect(seekUploadVideo(video, 0.4, { timeoutMs: 5 })).rejects.toThrow("stopped decoding");
  });
});

it("accepts a generic MIME type for a camera MOV but rejects an unrelated file", () => {
  expect(
    uploadProblem({ type: "application/octet-stream", name: "Serve.MOV", size: 100 }),
  ).toBeNull();
  expect(uploadProblem({ type: "", name: "notes.txt", size: 100 })).toMatch(/isn’t a video/);
});

it("normalizes MP4 and MOV types reported by file pickers", () => {
  expect(uploadMime({ type: "application/mp4" })).toBe("video/mp4");
  expect(uploadMime({ type: "video/x-m4v" })).toBe("video/mp4");
  expect(uploadMime({ type: "video/mov" })).toBe("video/quicktime");
});

it("retries QuickTime with an MP4 hint and keeps the original file bytes", async () => {
  const video = new MediaStub();
  const original = new File([Uint8Array.of(12, 34, 56)], "test.mov", { type: "video/quicktime" });
  const create = vi.fn((blob: Blob) => `blob:${blob.type}`);
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }),
  );
  try {
    video.load.mockImplementation(() => {
      video.readyState = 0;
      video.error = null;
      if (video.src === "blob:video/quicktime") video.error = { code: 4 };
      if (video.src === "blob:video/mp4") {
        video.metadata();
        video.readyState = 2;
      }
    });
    await expect(openUploadFile(video, original, original.type)).resolves.toEqual({
      url: "blob:video/mp4",
      playbackMime: "video/mp4",
    });
    expect(create.mock.calls.map(([blob]) => [blob.type, blob.size])).toEqual([
      ["video/quicktime", 3],
      ["video/mp4", 3],
    ]);
    expect(revoke.mock.calls).toEqual([["blob:video/quicktime"]]);
    expect(original.name).toBe("test.mov");
    expect(original.type).toBe("video/quicktime");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("lets the browser inspect a MOV when both explicit playback hints are rejected", async () => {
  const video = new MediaStub();
  const file = new File([Uint8Array.of(1, 2, 3)], "serve.mov", { type: "video/quicktime" });
  const create = vi.fn((blob: Blob) => `blob:${blob.type}`);
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }),
  );
  try {
    video.load.mockImplementation(() => {
      video.readyState = 0;
      video.error = null;
      if (video.src === "blob:") {
        video.metadata();
        video.readyState = 2;
      } else if (video.src) video.error = { code: 4 };
    });
    await expect(openUploadFile(video, file, file.type)).resolves.toEqual({
      url: "blob:",
      playbackMime: "",
    });
    expect(create.mock.calls.map(([blob]) => blob.type)).toEqual([
      "video/quicktime",
      "video/mp4",
      "",
    ]);
    expect(revoke).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("saves the original playable upload when movement processing is unavailable", async () => {
  document.body.innerHTML = `<input type="file" id="upInput"><button id="upBtn"></button>
    <div id="upBox"><div id="upBar"></div><p id="upPct"></p><button id="upCancel"></button></div>
    <p id="upMsg"></p>`;
  const input = document.querySelector<HTMLInputElement>("#upInput")!;
  const file = new NodeFile([Uint8Array.of(1, 2, 3, 4)], "serve.mov", { type: "video/quicktime" });
  Object.defineProperty(input, "files", { value: [file] });
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => "blob:serve-test"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(2);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  try {
    const openClip = vi.fn();
    initUpload({ openClip });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(openClip).toHaveBeenCalledOnce());
    const clip = await store.getClip(openClip.mock.calls[0]?.[0]);
    expect(clip).toMatchObject({
      uploadAnalysisIncomplete: true,
      status: "saved",
      video: { mime: file.type },
    });
    expect((await store.getClipVideo(clip)).blob.size).toBe(file.size);
    expect(document.querySelector("#upMsg")?.textContent).toContain("Video saved");
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("quietly retries a first-pick startup stall before reporting a timeout", async () => {
  const video = new MediaStub();
  let srcSets = 0;
  Object.defineProperty(video, "src", {
    get: () => "",
    set: (v: string) => {
      if (!v) return;
      srcSets++;
      if (srcSets === 2)
        setTimeout(() => {
          video.metadata();
          video.readyState = 2;
          video.dispatchEvent(new Event("canplay"));
        }, 1);
    },
  });
  const file = new NodeFile([new Uint8Array([1, 2, 3])], "serve.mp4", { type: "video/mp4" });
  const result = await openUploadFile(video, file, "video/mp4", { firstTimeoutMs: 5 });
  expect(srcSets).toBe(2);
  expect(result.playbackMime).toBe("video/mp4");
});
