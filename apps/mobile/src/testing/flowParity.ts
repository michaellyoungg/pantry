/**
 * What the Maestro flows cover, measured against the browser suite (BL-0073).
 *
 * The eight-and-then-some specs in `apps/web/e2e` describe journeys, not pages,
 * and the journeys are the same on a phone. Written independently, a native
 * flow set drifts into covering a different, accidental subset — and nobody can
 * say which client is under-tested, because there is no file whose absence says
 * so. So each flow is NAMED AFTER ITS WEB SPEC, and this is the file that
 * insists on it: `flowParity.test.ts` reads both directories and fails when a
 * journey has neither a flow nor an entry here.
 *
 * Three states, because "covered" and "not covered" are not enough for a client
 * that is still being ported:
 *
 *   covered  the flow drives what the spec drives.
 *   partial  the flow exists and drives part of it. `missing` says which part,
 *            in the spec's own terms.
 *   gap      there is no flow. `missing` says why.
 *
 * `partial` and `gap` both name the backlog item that would close them, and the
 * test checks that item exists — a waiver pointing at nothing is how a known
 * gap turns into an unknown one.
 *
 * The honest summary today: everything downstream of a recipe is covered, and
 * nothing that starts by writing one is, because the Recipes tab is still a
 * placeholder. Four of the ten journeys are blocked on that single screen.
 */

export type FlowParity =
  | { state: "covered" }
  | { state: "partial"; missing: string; blockedBy: string }
  | { state: "gap"; missing: string; blockedBy: string };

/**
 * One entry per spec in `apps/web/e2e`, keyed by its basename — which is also
 * the flow's basename in `apps/mobile/e2e/flows`.
 */
export const FLOW_PARITY: Readonly<Record<string, FlowParity>> = {
  "core-loop": { state: "covered" },
  "grocery-list-ux": { state: "covered" },
  "suggest-week": { state: "covered" },

  "home-dashboard": {
    state: "partial",
    missing:
      "the 'shopped' state, which needs every line on a generated list ticked off — " +
      "and an aggregated line is named by whichever dinners the ranker proposed, so no " +
      "flow can select one by id",
    blockedBy: "BL-0063",
  },
  recommendations: {
    state: "partial",
    missing:
      "asserting WHICH recipe is suggested and that its reason names the use-up item; " +
      "the web spec authors the recipe it then expects, and this client cannot author one",
    blockedBy: "BL-0063",
  },
  "aggregation-and-isolation": {
    state: "partial",
    missing:
      "the aggregation half — two recipes calling for garlic collapsing into one line — " +
      "which needs two authored recipes. The isolation half is covered",
    blockedBy: "BL-0063",
  },

  catalog: {
    state: "gap",
    missing: "browsing the shared catalog and adding one of its recipes to the basket",
    blockedBy: "BL-0063",
  },
  discover: {
    state: "gap",
    missing:
      "the 'For you' card — dismissals, adding a suggestion to the plan, avoid-list filtering",
    blockedBy: "BL-0063",
  },
  "prep-tasks": {
    state: "gap",
    missing:
      "a thaw task surviving check-off. Both surfaces exist natively (BL-0061), but deriving " +
      "a task needs a recipe with a known frozen protein on a known day, and the only dinners " +
      "this client can plan are whichever ones the ranker proposes",
    blockedBy: "BL-0063",
  },
  "nutrition-facts": {
    state: "gap",
    missing: "the Nutrition Facts panel, which the native client does not render at all yet",
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
