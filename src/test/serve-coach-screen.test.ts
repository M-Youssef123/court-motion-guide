import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
// @ts-expect-error static JS module
import * as store from "../../public/serve-coach/js/store.js";

it("routes the actual static app to Progress and wires coach and backup controls", async () => {
  const html = readFileSync("public/serve-coach/index.html", "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform() {},
    clearRect() {},
  } as unknown as CanvasRenderingContext2D);
  const session = await store.createSession();
  await store.createClip(session.id, { status: "saved" });
  await store.endSession(session.id);
  history.replaceState(null, "", "#progress");
  // @ts-expect-error static JS module
  await import("../../public/serve-coach/js/app.js");
  await vi.waitFor(() =>
    expect(document.querySelector("#progress")?.hasAttribute("hidden")).toBe(false),
  );
  expect(document.querySelector("#sessions")).toBeNull();
  expect(document.querySelector("#backupImport")?.textContent).toBe("Restore JSON backup");
  const question = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "What do you see in my technique?",
  );
  await vi.waitFor(() => expect(question?.disabled).toBe(false));
  question?.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#coach .answer")?.textContent).toMatch(/insufficient/),
  );
  expect(document.querySelector('#coach input[name="question"]')).toBeNull();
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent === "Am I rushing my trophy pose?")
    ?.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#coach .answer")?.textContent).toContain("trophy hold"),
  );
  const historical = document.querySelector<HTMLDetailsElement>(".historical");
  historical!.open = true;
  await vi.waitFor(() => expect(historical?.textContent).toContain("Save two clips"));
  expect(document.querySelector("#coach")?.textContent).not.toContain("Toss consistency");
  expect(document.querySelector("#progress")?.textContent).not.toContain("Your toss stayed put");
});
