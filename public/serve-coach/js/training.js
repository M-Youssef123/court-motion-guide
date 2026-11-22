import * as store from "./store.js";
import { COACH_TOPICS, topicAnswer } from "./coach-qa.js";
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
    </article><h3 class="sub-h">Coach topics</h3><p class="kicker">General serve tips and drills. Open a recording under You and your coach to review your own frames.</p>
    <div class="qs" role="group" aria-label="Coach topics"></div><div class="answer" role="status" hidden></div>`;
  host.append(section);
  const article = section.querySelector("article");
  const done = section.querySelector("#doneBtn");
  const output = section.querySelector(".answer");
  const status = article.querySelector('[role="status"]');
  let current = null;
  function answer(key) {
    const t = topicAnswer(key);
    output.hidden = false;
    if (!t) {
      output.textContent = "Pick one of the topics above.";
      return;
    }
    const block = (heading, items) => {
      const wrap = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = heading;
      const list = document.createElement("ul");
      for (const item of items) {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      }
      wrap.append(label, list);
      return wrap;
    };
    output.replaceChildren(
      block("Key causes", t.causes),
      block("Technique fix", t.fix),
      block("Drill to try", [t.drill]),
    );
  }
  const questionControls = [];
  for (const { key, question } of COACH_TOPICS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-quiet";
    button.textContent = question;
    questionControls.push(button);
    section.querySelector(".qs").append(button);
    button.addEventListener("click", () => {
      for (const other of questionControls)
        other.setAttribute("aria-pressed", String(other === button));
      answer(key);
    });
  }

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
