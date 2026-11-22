import { describe, it, expect, vi } from "vitest";
// @ts-expect-error plain JS module
import { uploadProblem } from "../../public/serve-coach/js/upload.js";
// @ts-expect-error plain JS module
import { openUploadVideo, seekUploadVideo } from "../../public/serve-coach/js/upload-media.js";
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
  play = vi.fn(() => Promise.reject(new Error("Playback denied")));
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

  it("rejects decoder errors without waiting for a timeout", async () => {
    const video = new MediaStub();
    const opening = openUploadVideo(video, "blob:test");
    video.error = { code: 4 };
    video.dispatchEvent(new Event("error"));
    await expect(opening).rejects.toThrow("H.264 MP4");
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
