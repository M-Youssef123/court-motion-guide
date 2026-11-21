import { describe, it, expect } from "vitest";
// @ts-expect-error plain JS module
import { uploadProblem } from "../../public/serve-coach/js/upload.js";
describe("uploadProblem", () => {
  it("rejects non-video files", () => expect(uploadProblem({ type: "image/png", size: 10 })).toMatch(/isn’t a video/));
  it("rejects files over 500 MB", () => expect(uploadProblem({ type: "video/mp4", size: 501 * 1024 * 1024 })).toMatch(/too large/));
  it("accepts a normal video", () => expect(uploadProblem({ type: "video/quicktime", size: 1000 })).toBeNull());
});
