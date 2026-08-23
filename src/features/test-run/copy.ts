import type { TestDefinition } from "@/test-engine/contracts";

/**
 * English copy for the test surfaces.
 *
 * **A placeholder for the Phase 10 message catalogue, not a substitute for it.** Test
 * definitions carry i18n *keys* rather than literal strings precisely so the copy can be
 * translated later without touching the engine; this file is the single place those keys are
 * resolved today. When the catalogue arrives, this map is deleted and the lookup changes — no
 * definition changes.
 *
 * The instruction text is not decoration. doc 09 §9.0.8 requires a full-text description of the
 * task before pointer lock, readable by a screen reader: a player who does not understand the
 * task produces a measurement of their confusion.
 */

export interface TestCopy {
  readonly name: string;
  readonly summary: string;
  /** Step-by-step instructions, read before pointer lock is requested. */
  readonly steps: readonly string[];
  /** What the metric actually measures, in the player's terms. */
  readonly measures: string;
}

const COPY: Readonly<Record<string, TestCopy>> = {
  reaction: {
    name: "Reaction",
    summary: "How quickly you respond to something appearing. Your mouse does nothing here.",
    steps: [
      "Keep the crosshair where it is — moving the mouse has no effect in this test.",
      "A target will appear at the centre of the screen after an unpredictable delay.",
      "Click as soon as you see it.",
      "Clicking before it appears invalidates the trial, so wait rather than guess.",
    ],
    measures:
      "Your simple visual-motor floor. It is recorded for context and to separate reaction from " +
      "aim in the other tests — it never affects your recommended sensitivity.",
  },
  flick: {
    name: "Flick",
    summary: "Fast target acquisition across short, medium and long distances.",
    steps: [
      "Click the target under your crosshair to start each trial from a known position.",
      "A target appears somewhere around you, between 5° and 50° away.",
      "Move onto it and click. You may take more than one shot.",
      "Distances and directions are balanced, so every sensitivity faces the same mix.",
    ],
    measures: "How fast and how accurately your ballistic movement lands on a target.",
  },
  micro: {
    name: "Micro adjustment",
    summary: "Fine control at very small angles, with small targets.",
    steps: [
      "Click the target under your crosshair to start each trial.",
      "A small target appears very close by — under 4° away.",
      "Place the crosshair inside it and click. There is no click-through grace.",
      "There is a short cooldown between shots, so rapid clicking will not help.",
    ],
    measures:
      "Fine control. This is where a sensitivity that is too high for you shows up first, as " +
      "overshoot and repeated correction.",
  },
  tracking: {
    name: "Tracking",
    summary: "Following a moving target continuously.",
    steps: [
      "A target appears and immediately begins moving.",
      "Hold the left mouse button and keep the crosshair on it.",
      "Keep holding for the whole trial — time only counts while the button is down.",
      "Each trial lasts five seconds.",
    ],
    measures:
      "Continuous control. Your best tracking sensitivity is often different from your best " +
      "flicking sensitivity, which is exactly why both are measured.",
  },
  switching: {
    name: "Target switching",
    summary: "Repeatedly re-acquiring targets under time pressure.",
    steps: [
      "Five targets are visible at once.",
      "Destroy them in any order; each one you destroy is immediately replaced elsewhere.",
      "The sequence ends after eight kills, or after twelve seconds.",
    ],
    measures: "How quickly and reliably you move between targets, rather than onto just one.",
  },
  precision: {
    name: "Precision",
    summary: "Accuracy at small targets, with speed deliberately de-emphasised.",
    steps: [
      "Click the target under your crosshair to start each trial.",
      "A small, distant-looking target appears.",
      "You have **one shot**. Take your time and place it carefully.",
      "A second click before the trial resolves invalidates it.",
    ],
    measures:
      "Where your first shot actually lands. Speed is not scored here, so accuracy is worth " +
      "more than hurrying.",
  },
  comfort360: {
    name: "360 comfort",
    summary:
      "How far you can comfortably turn in one motion. This measures your desk and mousepad, " +
      "not your skill.",
    steps: [
      "There are no targets in this test.",
      "Swipe: turn as far right as you comfortably can in one motion, then click.",
      "Half turn: turn to face exactly behind you, then click.",
      "Return: turn back to the marked heading, then click.",
      "Comfortable means comfortable — do not strain or stretch for extra distance.",
    ],
    measures:
      "The physical room you have. It sets a limit on what can be recommended, so that you are " +
      "never given a sensitivity you cannot physically execute.",
  },

  /* ------------------------------------------------------------ advanced (Phase 6) */
  "wide-flick": {
    name: "Wide Flick",
    summary: "Large turns — 45°, 90°, 135° and 180° — balanced left and right.",
    steps: [
      "Click the target under your crosshair to start each trial facing forward.",
      "A target appears far to one side, sometimes behind you. Turn to it and click it.",
      "If you run out of pad and have to lift the mouse, that is fine — it is recorded, not penalised.",
      "The direction alternates exactly, so neither side is favoured.",
    ],
    measures:
      "Whether this sensitivity works for repositioning as well as for duels. A lift on a 180° " +
      "turn is a fact about the sensitivity and your desk, and it feeds the physical limit on " +
      "what can be recommended.",
  },
  "strafe-tracking": {
    name: "Strafe Tracking",
    summary: "Follow a target that reverses direction at unpredictable moments.",
    steps: [
      "Hold the fire button and keep the crosshair on the target for the whole trial.",
      "The target moves sideways and reverses without warning. The timing cannot be predicted — do not try.",
      "Release only when the trial ends.",
    ],
    measures:
      "How quickly you re-acquire after a reversal and how steadily you hold between them. " +
      "Reversal timing is drawn from a memoryless distribution, so anticipation is impossible by " +
      "construction.",
  },
  "slide-tracking": {
    name: "Slide Tracking",
    summary: "Follow a target that accelerates to high speed, holds it, and brakes.",
    steps: [
      "Hold the fire button and keep the crosshair on the target.",
      "The target slides a long way across your view, speeding up then slowing down, then comes back.",
      "Stay with it through the fastest part. Release only when the trial ends.",
    ],
    measures:
      "Whether this sensitivity supports fast, movement-heavy play. If the slide demands more " +
      "reach than your comfortable swipe, the trial is marked as truncated and kept as evidence " +
      "rather than scored.",
  },
  speed: {
    name: "Speed",
    summary: "Big targets, short timer. Go as fast as you can.",
    steps: [
      "Click the target under your crosshair to start each trial.",
      "A large target appears nearby. Hit it as fast as you possibly can.",
      "Accuracy barely matters here — that is deliberate. Be reckless.",
    ],
    measures:
      "Pure speed, with accuracy demands removed. Paired with the Precision test, it is what " +
      "makes your speed-versus-precision trade-off visible instead of blurred together.",
  },
  recoil: {
    name: "Recoil Control",
    summary: "Hold fire on a target while a generated recoil pattern pushes your aim.",
    steps: [
      "A target appears close to your crosshair. Press and hold the fire button on it.",
      "While you hold, the view is pushed along a recoil pattern. Pull against it to stay on target.",
      "The pattern is generated for each trial and is not any game's — you cannot memorise it, and you are not meant to.",
      "Keep holding until the trial ends.",
    ],
    measures:
      "How well you compensate for a sustained, unmemorised disturbance, and how steady that " +
      "compensation is. It is weighted for control, not treated as a skill benchmark.",
  },
  ads: {
    name: "ADS",
    summary: "Aim through a simulated scope, alternating with normal trials.",
    steps: [
      "Click the target under your crosshair to start each trial.",
      "On every second trial the view zooms in as you clear the start target, and your sensitivity changes with it.",
      "Acquire and click the target in whichever view you are in.",
    ],
    measures:
      "Scoped aiming performance and the cost of the transition into the scope. The scope is " +
      "SensLab's own simulation — a narrower field of view and a matched sensitivity — and makes " +
      "no claim about any particular game's zoom.",
  },
};

const FALLBACK: TestCopy = {
  name: "Aim test",
  summary: "An aim test.",
  steps: ["Follow the on-screen instructions."],
  measures: "Aim performance.",
};

export function copyFor(definition: Pick<TestDefinition, "key">): TestCopy {
  return COPY[definition.key] ?? FALLBACK;
}

export const TEST_COPY = COPY;
