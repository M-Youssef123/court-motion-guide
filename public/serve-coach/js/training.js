import * as store from "./store.js";
import { PROMPTS, coachTopic, coachEvidence, topicAdvice } from "./coach-qa.js";
import { comparisonSeries, comparisonText } from "./session-progress.js";

export const DRILLS = Object.freeze({
  "comfortable-reach": Object.freeze({
    title: "Comfortable overhead reach",
    sets: 2,
    reps: 6,
    instructions:
      "Use slow shadow serves without a ball. Reach upward comfortably and let the arm relax through the finish. Film the last set from the same position.",
  }),
  "bend-to-reach": Object.freeze({
    title: "Bent arm to overhead reach",
    sets: 2,
    reps: 8,
    instructions:
      "Use relaxed shadow serves without a ball. Pause briefly in bent-arm preparation, then move smoothly into overhead reach. Review the same phase in the last repetition.",
  }),
});

export function recommendedDrill(feedback) {
  if (feedback?.status !== "supported") return null;
  const id = feedback.improvement ? "comfortable-reach" : "bend-to-reach";
  return { id, ...DRILLS[id] };
}

export const QUESTIONS = Object.freeze({
  technique: "What do you see in my technique?",
  consistency: "How consistent am I?",
  improvement: "How have I changed since last time?",
  drill: "What should I practise next?",
});

/** A replaceable answer function with evidence supplied by the caller. */
export function answerCoach(question, { feedback, comparisons, sessionId }) {
  if (question === "consistency" || question === "improvement") {
    if (question === "improvement") return comparisonText(comparisons, "last", sessionId);
    const row = comparisons.find(({ session }) => session.id === sessionId);
    return row?.spread != null
      ? `Across ${row.count} clips from this practice with matching camera setup, the standard deviation of estimated 2D elbow angle at overhead reach was ${row.spread.toFixed(1)}°. This describes variation in the tracked clips.`
      : "At least two reliably tracked clips with matching camera setup are needed to estimate consistency within this practice.";
  }
  if (feedback?.status !== "supported")
    return "This recording has insufficient tracking evidence for a technique or drill recommendation.";
  const evidence = feedback.positive.evidence;
  const at = Number.isFinite(evidence.timestampMs)
    ? ` Review the moment around ${(evidence.timestampMs / 1000).toFixed(2)} s.`
    : "";
  if (question === "technique")
    return [feedback.positive.text, feedback.improvement?.text].filter(Boolean).join(" ") + at;
  const drill = recommendedDrill(feedback);
  return `${drill.title}. ${drill.sets} sets of ${drill.reps} repetitions. ${drill.instructions}${at}`;
}

export function initTraining(host) {
  const section = document.createElement("section");
  section.className = "ask";
  section.innerHTML = `<article class="drill" hidden>
    <span class="lbl">Your drill</span><h3 class="sub-h"></h3><p class="dose"></p><p class="instructions"></p>
    <button class="btn btn-ball" id="doneBtn" type="button">Mark done</button>
    <p class="empty" role="status"></p>
    </article><h3 class="sub-h">Coach topics</h3><p class="kicker">Pick a topic. Answers use your saved measurements and built-in coaching rules.</p>
    <div class="qs" role="group" aria-label="Coach topics"></div><div class="answer" role="status" hidden></div>`;
  host.append(section);
  const article = section.querySelector("article");
  const done = section.querySelector("#doneBtn");
  const output = section.querySelector(".answer");
  const status = article.querySelector('[role="status"]');
  let current = null,
    questionToken = 0;
  async function answer(question, key = coachTopic(question)) {
    const request = ++questionToken,
      context = current;
    output.hidden = false;
    output.textContent = "Reading saved practice data…";
    try {
      const data = await store.getJournalData();
      const recent = new Set(
        data.sessions
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 4)
          .map((s) => s.id),
      );
      const recentClips = new Set(
        data.clips.filter((c) => recent.has(c.sessionId)).map((c) => c.id),
      );
      const completions = await store.listDrillCompletions();
      if (request !== questionToken) return;
      const topic = topicAdvice(
        key,
        context?.feedback,
        context?.analysis?.metrics?.serve?.trophyHoldSeconds,
        context?.analysis?.metrics,
        null,
      );
      const lines = [
        [
          "Your practice",
          coachEvidence(
            data,
            context?.clip,
            completions.filter((c) => recentClips.has(c.clipId)).length,
          ),
        ],
        ...(topic
          ? [
              ["What the tracking shows", topic.evidence],
              ["Try next", topic.advice],
            ]
          : [
              [
                "Coach response",
                key
                  ? answerCoach(key, {
                      feedback: context?.feedback,
                      comparisons: comparisonSeries(data, context?.clip.id),
                      sessionId: context?.clip.sessionId,
                    })
                  : "Pick one of the topics above.",
              ],
            ]),
      ];
      output.replaceChildren(
        ...lines.map(([heading, message]) => {
          const p = document.createElement("p"),
            label = document.createElement("strong");
          label.textContent = heading;
          p.append(label, document.createElement("br"), message);
          return p;
        }),
      );
    } catch {
      if (request === questionToken)
        output.textContent = "Saved evidence could not be read. Try again.";
    }
  }
  const questionControls = [];
  for (const [key, text] of [
    ...Object.entries(QUESTIONS),
    ...PROMPTS.map((prompt) => [coachTopic(prompt), prompt]),
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-quiet";
    button.textContent = text;
    questionControls.push(button);
    section.querySelector(".qs").append(button);
    button.addEventListener("click", () => {
      for (const other of questionControls) other.setAttribute("aria-pressed", String(other === button));
      answer(text, key);
    });
  }

  for (const control of questionControls) control.disabled = true;

  done.addEventListener("click", async () => {
    const context = current;
    if (!context?.drill) return;
    done.disabled = true;
    try {
      await store.completeDrill(context.drill.id, context.clip.id);
      if (current === context) {
        done.textContent = "Completed";
        status.textContent = "Completion saved on this device.";
      }
    } catch {
      if (current === context) {
        done.disabled = false;
        status.textContent = "Couldn’t save completion. Try again.";
      }
    }
  });

  return async function render(clip, feedback, analysis, loading = false) {
    questionToken++;
    for (const control of questionControls) control.disabled = loading;
    output.hidden = true;
    const drill = recommendedDrill(feedback);
    const context = clip ? { clip, feedback, drill, analysis } : null;
    current = context;
    article.hidden = !drill;
    if (!drill) return;
    article.querySelector("h3").textContent = drill.title;
    article.querySelector(".dose").textContent = `${drill.sets} sets × ${drill.reps} reps`;
    article.querySelector(".instructions").textContent = drill.instructions;
    done.disabled = true;
    done.textContent = "Mark done";
    status.textContent = "";
    try {
      const completion = await store.getDrillCompletion(JSON.stringify([drill.id, clip.id]));
      if (current !== context) return;
      done.disabled = Boolean(completion);
      if (completion) done.textContent = "Completed";
    } catch {
      if (current === context)
        status.textContent = "Couldn’t read saved completions. Reopen Progress to retry.";
    }
  };
}
