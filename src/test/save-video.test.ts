import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module from the static app
import { clipFilename, extensionForMime } from "../../public/serve-coach/js/save-video.js";

describe("saved clip filename", () => {
  it("uses serve-coach-YYYYMMDD-HHmmss with the recording's local time", () => {
    expect(clipFilename(new Date(2026, 10, 21, 9, 5, 7), "video/mp4")).toBe(
      "serve-coach-20261121-090507.mp4",
    );
  });
  it("matches the extension to the recorded MIME type", () => {
    expect(extensionForMime("video/webm;codecs=vp9")).toBe("webm");
    expect(extensionForMime("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionForMime("video/quicktime")).toBe("mov");
  });
});
