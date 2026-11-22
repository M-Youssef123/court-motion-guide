import { comparisonSeries } from "./session-progress.js";
import { tripodName } from "./labels.js";

export const PROMPTS = [
  "Why is my serve hitting the net?",
  "How can I improve my pronation?",
  "Am I rushing my trophy pose?",
  "How fast is my wrist moving?",
];

export function coachTopic(question) {
  const text = question.toLowerCase();
  if (/\b(net|clearance|low serve)\b/.test(text)) return "net";
  if (/pronat|forearm|wrist snap/.test(text)) return "pronation";
  if (/\btoss\b/.test(text)) return "toss";
  if (/\bwrist\b|hand speed/.test(text)) return "wrist";
  if (/trophy|rush|rhythm|tempo/.test(text)) return "trophy";
  if (/consisten|variat|repeat/.test(text)) return "consistency";
  if (/last time|progress|\b(?:compare|improved|changed|better)\b/.test(text)) return "improvement";
  if (/practi|drill|train/.test(text)) return "drill";
  if (/technique|elbow|extension|reach/.test(text)) return "technique";
  return null;
}

export function coachEvidence(data, clip, completionCount) {
  if (!clip) return "Save a clip with clear body tracking to get recording-specific feedback.";
  const session = data.sessions.find((s) => s.id === clip.sessionId);
  const arm = clip.servingArm || clip.dominantHand || session?.dominantHand || session?.playerHand;
  const setup = `Serving arm ${["L", "left"].includes(arm) ? "left" : ["R", "right"].includes(arm) ? "right" : "unknown"} · ${tripodName(clip.tripodPosition)} camera`;
  const series = comparisonSeries(data, clip.id).slice(-4);
  const history = series.length
    ? series
        .map(
          ({ session, mean, spread, count }) =>
            `${new Date(session.createdAt).toLocaleDateString()}: mean overhead elbow angle ${mean.toFixed(1)}° across ${count} clip${count === 1 ? "" : "s"}${spread === null ? "" : `, variation (SD) ${spread.toFixed(1)}°`}`,
        )
        .join(". ")
    : "Insufficient comparable clips for recent angle averages and variation.";
  return `${setup}. ${history} Recent matched drill completions: ${completionCount}.`;
}

export function topicAdvice(topic, feedback, trophyHold, metrics, toss) {
  if (topic === "wrist") {
    const peak = metrics?.wrist?.peak;
    return {
      evidence: Number.isFinite(peak?.speed)
        ? `Peak tracked wrist speed in this clip was ${peak.speed.toFixed(1)}% of the image diagonal per second.`
        : "This clip needs a visible serving wrist across consecutive frames.",
      advice:
        "Use Peak wrist speed in Replay. Compare the same serving motion from the same tripod position and distance.",
    };
  }
  if (topic === "toss")
    return {
      evidence:
        "Body tracking can't see the ball, so toss height and drift aren't measured. Use the Toss tab to compare your tossing-arm position with the reference.",
      advice:
        "Film three tosses from the same marked position. Leave room above your head for the apex, then compare them in Replay at 0.25× speed.",
    };

  if (topic === "net")
    return {
      evidence:
        feedback?.improvement?.text ||
        "The recording analysis cannot establish why the ball hit the net.",
      advice:
        "Try two sets of six comfortable overhead shadow serves. Then aim a series of easy serves with extra clearance over the middle of the net and record from the same position to compare reach.",
    };
  if (topic === "pronation")
    return {
      evidence:
        "MoveNet tracks the elbow and wrist, so forearm rotation and racket-face angle are unavailable.",
      advice:
        "Try a relaxed abbreviated service motion at half speed. Let the forearm turn naturally through the finish and ask a coach to check the grip and racket face. Avoid forcing a wrist snap.",
    };
  if (topic === "trophy")
    return {
      evidence: Number.isFinite(trophyHold)
        ? `The tracked trophy posture lasted about ${trophyHold.toFixed(2)} s in this clip. One 2D estimate cannot establish whether your tempo was rushed.`
        : "There is insufficient continuous tracking to measure a trophy hold here.",
      advice:
        "Try the bent-arm-to-overhead-reach drill. Pause briefly on shadow repetitions to feel the setup, then film several fluid serves from the same camera position and compare the transition.",
    };
  return null;
}
