/**
 * Coach topics: fixed, pre-written serve advice based on widely taught
 * coaching fundamentals. Answers do not depend on tracking quality.
 */
export const COACH_TOPICS = Object.freeze([
  {
    key: "net",
    question: "Why is my serve hitting the net?",
    causes: [
      "Looking down too early, before the ball has left the strings.",
      "Dropping the tossing arm and front shoulder too soon, which pulls the contact point down.",
      "Hitting the ball too low or with the toss drifting too far in front.",
    ],
    fix: [
      "Keep the tossing arm reaching up until the hitting arm starts swinging up to the ball.",
      "Hit up and out at full reach, not down at the ball.",
      "Aim for clear height over the net, roughly 2 to 3 feet above the tape on a practice serve.",
    ],
    drill:
      "Head-still serves: after contact, keep your eyes on the contact spot for a count of one before looking at the target.",
  },
  {
    key: "pronation",
    question: "How can I improve my pronation?",
    causes: [
      "Serving with a forehand-style grip, which blocks the forearm from turning.",
      "Trying to snap the wrist instead of letting the arm rotate.",
      "Squeezing the handle too tightly.",
    ],
    fix: [
      "Use a continental grip, the same grip you would use to hammer a nail.",
      "Keep grip pressure light, about 3 or 4 out of 10.",
      "Swing up with the edge of the racket leading, then let the forearm turn naturally so the strings face the ball at contact. Don't force a wrist snap.",
    ],
    drill:
      "Edge-up swings: shadow swing leading with the racket edge and finish with the palm of your hitting hand turned outward.",
  },
  {
    key: "trophy",
    question: "Am I rushing my trophy pose?",
    causes: [
      "Starting the swing before the legs and shoulders are set.",
      "Tossing too low, which leaves no time to load.",
      "Arms moving out of sync, so the hitting arm is late and has to rush.",
    ],
    fix: [
      "Use the rhythm \u201cdown together, up together\u201d: both arms drop and rise at the same time.",
      "At the trophy position, the tossing arm points up, knees are bent and the racket is up behind you with the hitting elbow around shoulder height.",
      "Toss just high enough that you can load your legs and swing smoothly without waiting.",
    ],
    drill:
      "Trophy freeze: shadow serve, hold the trophy position for one second to check balance and knee bend, then drive up and swing.",
  },
  {
    key: "wrist",
    question: "How fast is my wrist moving?",
    causes: [
      "Believing speed comes from a wrist flick. Forcing it often causes errors and wrist strain.",
    ],
    fix: [
      "Serve speed comes from the whole body working in order: legs push, hips and trunk rotate, shoulder and arm swing up, and the forearm turns.",
      "Keep the wrist and grip relaxed so the racket head can accelerate on its own, like the end of a whip.",
      "The app's replay shows a tracked wrist estimate, but it is not a measure of racket or ball speed.",
    ],
    drill:
      "Loose-arm serves: hit easy serves at half pace with a very light grip, focusing on a smooth, relaxed swing rather than effort.",
  },
  {
    key: "toss",
    question: "How do I make my toss more consistent?",
    causes: [
      "Bending the elbow or flicking the wrist when releasing the ball.",
      "Letting go of the ball too early, low down.",
    ],
    fix: [
      "Hold the ball in your fingertips, not deep in the palm.",
      "Lift with a straight arm from the shoulder.",
      "Release around head height and keep the arm reaching up after the ball leaves your hand.",
    ],
    drill:
      "Target toss: lay a racket on the ground just inside the baseline in front of you and toss without swinging. The ball should land on the strings.",
  },
]);

export const PROMPTS = COACH_TOPICS.map((t) => t.question);

export function coachTopic(question) {
  const text = String(question).toLowerCase();
  const match = COACH_TOPICS.find((t) => t.question.toLowerCase() === text);
  if (match) return match.key;
  if (/\b(net|clearance)\b/.test(text)) return "net";
  if (/pronat|forearm|wrist snap/.test(text)) return "pronation";
  if (/\btoss\b/.test(text)) return "toss";
  if (/\bwrist\b|hand speed/.test(text)) return "wrist";
  if (/trophy|rush|rhythm|tempo/.test(text)) return "trophy";
  return null;
}

export function topicAnswer(key) {
  return COACH_TOPICS.find((t) => t.key === key) || null;
}

/** Plain sentence version for speech or sharing. */
export function topicAnswerText(key) {
  const t = topicAnswer(key);
  if (!t) return "";
  return [`Key causes: ${t.causes.join(" ")}`, `Technique fix: ${t.fix.join(" ")}`, `Drill to try: ${t.drill}`].join(" ");
}
