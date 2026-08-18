/**
 * What the Maestro flows cover, measured against the browser suite (BL-0073).
 *
 * The ten specs in `apps/web/e2e` describe journeys, not pages, and the
 * journeys are the same on a phone. Written independently, a native flow set
 * drifts into covering a different, accidental subset — and nobody can say
 * which client is under-tested, because there is no file whose absence says so.
 * So each flow is NAMED AFTER ITS WEB SPEC, and this is the file that insists
 * on it: `flowParity.test.ts` reads both directories and fails when a journey
 * has neither a flow nor an entry here.
 *
 * Three states, because "covered" and "not covered" are not enough for a client
 * that is still being ported:
 *
 *   covered  the flow drives what the spec drives.
 *   partial  the flow exists and drives part of it. `missing` says which part,
 *            in the spec's own terms.
 *   gap      there is no flow. `missing` says why.
 *
 * `blockedBy` names the backlog item that would close it, and the test checks
 * that item exists — a waiver pointing at nothing is how a known gap turns back
 * into an unknown one. It is OPTIONAL, and an entry without one is the most
 * interesting row in the table: a gap nobody owns yet.
 */

export type FlowParity =
  | { state: "covered" }
  | { state: "partial"; missing: string; blockedBy?: string }
  | { state: "gap"; missing: string; blockedBy?: string };

/**
 * One entry per spec in `apps/web/e2e`, keyed by its basename — which is also
 * the flow's basename in `apps/mobile/e2e/flows`.
 */
export const FLOW_PARITY: Readonly<Record<string, FlowParity>> = {
  "core-loop": { state: "covered" },
  catalog: { state: "covered" },
  "grocery-list-ux": { state: "covered" },
  "home-dashboard": { state: "covered" },
  "suggest-week": { state: "covered" },

  "aggregation-and-isolation": {
    state: "covered",
  },

  "prep-tasks": {
    state: "partial",
    missing:
      "checking a derived task off and proving the tick survives a relaunch. The task's " +
      "testID is keyed on `stateKey(task.key, cookDate)`, which contains the date the run " +
      "happens on, so no flow can name it in advance. Closing this means giving the row a " +
      "second, date-free selector — nothing owns that today. The derivation itself, the " +
      "planner badge and the Home card are covered",
  },
  recommendations: {
    state: "partial",
    missing:
      'asserting the "Uses up:" reason specifically, rather than that the suggestion is ' +
      "offered at all. The reason is rendered as free text with no id of its own, and the " +
      "flows select by id and nothing else (see docs/mobile-testid-conventions.md). Both " +
      "halves of the candidate pool — the user's own recipe and a catalog row — are covered",
  },

  discover: {
    state: "gap",
    missing:
      'the whole journey. There is no native counterpart to web\'s "For you" card: ' +
      "BL-0063 ported browse, the catalog and the kitchen, and cold-start discovery was " +
      "not part of it. This is the only journey with no native surface at all AND no " +
      "backlog item that would give it one",
  },
  "nutrition-facts": {
    state: "gap",
    missing: "the Nutrition Facts panel, which the native client does not render yet",
    blockedBy: "BL-0065",
  },
};

/**
 * Flows with no web spec behind them, and why that is right rather than drift.
 *
 * The bar is deliberately high: a journey both clients have belongs in
 * `FLOW_PARITY` under the web spec's name, so a native-only entry has to be
 * something the browser suite genuinely cannot have.
 */
export const NATIVE_ONLY_FLOWS: Readonly<Record<string, string>> = {
  "sign-in":
    "Auth is a precondition of every web spec rather than a spec of its own — " +
    "`helpers.signUp()` does it inline. On a device it is its own journey: the session is " +
    "read back out of the iOS keychain on a cold start, which is the one thing `clearState` " +
    "does not clear and the browser has no equivalent of.",
};
