import { describe, it, expect, vi } from "vitest";
// @ts-expect-error plain JS module
import { seekUploadVideo } from "../../public/serve-coach/js/upload-media.js";
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
describe("replay frame seeking", () => {
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

