/**
 * Every selector `apps/mobile/e2e` taps or asserts on, in TypeScript.
 *
 * The flows are YAML: nothing typechecks them, so `tapOn: {id: "auth.sumbit"}`
 * is a valid flow file that fails at 3am with "element not found". This module
 * is what makes that checkable. `maestroFlows.test.ts` refuses an id in a flow
 * that is not listed here; `e2eSelectors.test.tsx` renders the surfaces and
 * refuses an id listed here that the app no longer emits.
 *
 * Not a copy of `TEST_IDS` — that names what both clients render, this names
 * the smaller set the flows drive — but it draws from it wherever an entry
 * exists, so a flow and the Playwright spec for the same journey reach the same
 * element by construction (BL-0071).
 */

import { TEST_IDS } from "@pantry/core/testing";
import { tabTestID } from "../navigation/navItems";
import { type TestID, testID, testIDKey } from "./testIDs";

/**
 * The one grocery line the flows may name.
 *
 * An aggregated line is named by whichever dinners the ranker proposed for the
 * week, so its id is decided by the catalog rather than by the flow. A line the
 * shopper typed is the exception, and this is the word they type — see
 * `e2e/subflows/add-manual-item.yml`, whose text `maestroFlows.test.ts` pins to
 * this constant so the two cannot drift.
 *
 * "garlic" because it round-trips: it is a canonical item in the normalization
 * dictionary, so the server hands back the display form "Garlic", which slugs
 * to the same key. An unrecognised word would keep whatever was typed.
 */
export const E2E_MANUAL_ITEM = "garlic";

const manual = testIDKey(E2E_MANUAL_ITEM);

export const E2E_SELECTORS = {
  auth: {
    form: TEST_IDS.auth.form,
    email: TEST_IDS.auth.email,
    password: TEST_IDS.auth.password,
    submit: TEST_IDS.auth.submit,
    toggleFlow: TEST_IDS.auth.toggleFlow,
  },

  /**
   * Tab bar buttons — also the only "we are signed in" signal a flow has, since
   * the bar is inside `<Authenticated>`.
   */
  nav: {
    homeTab: tabTestID("index"),
    planTab: tabTestID("plan"),
    listTab: tabTestID("list"),
    pantryTab: tabTestID("pantry"),
    settingsTab: tabTestID("settings"),
  },

  /** Home's state machine: three of its states have their own CTA (BL-0062). */
  home: {
    gettingStarted: testID("home", "getting-started"),
    /** "empty" and "shopped" both offer it; the flows only reach the first. */
    planWeek: testID("home", "plan-week"),
    buildList: testID("home", "build-list"),
    shop: testID("home", "shop"),
  },

  /**
   * The planner. `screen` is the navigation assertion and stops at the root:
   * what it proves is that the tab routes, not what the planner draws.
   */
  plan: {
    screen: testID("plan", "screen"),
    /**
     * The heading. Not asserted on for its own sake — it is the anchor a flow
     * scrolls back UP to, because it is the one element on this screen that is
     * always present and always at the top.
     */
    title: testID("plan", "title"),
    /** The selected day with nothing on it — the "was anything written" signal. */
    dayEmpty: testID("plan", "day-empty"),
    suggest: TEST_IDS.plan.suggest,
    /** "nothing is saved until you add it" — a proposal exists. */
    suggestPreamble: testID("plan", "suggest-preamble"),
    suggestAccept: TEST_IDS.plan.suggestAccept,
    /** Every day already planned, so there is nothing left to propose. */
    suggestEmpty: testID("plan", "suggest-empty"),
    generate: TEST_IDS.plan.generate,
  },

  /** The grocery list, and the one line a flow is allowed to name. */
  list: {
    emptyState: TEST_IDS.list.emptyState,
    item: TEST_IDS.list.item(E2E_MANUAL_ITEM),
    toggle: testID("list", "toggle", manual),
    remove: testID("list", "remove", manual),
    inCartSection: TEST_IDS.list.inCartSection,
    progress: TEST_IDS.list.progress,
    addToggle: TEST_IDS.list.addToggle,
    addField: testID("list", "add-field"),
    addSubmit: testID("list", "add-submit"),
    doneShopping: TEST_IDS.list.doneShopping,
    finishSheet: testID("list", "finish-sheet"),
    finishKeep: testID("list", "finish-keep"),
    undo: TEST_IDS.list.undo,
    undoButton: testID("list", "undo-button"),
  },

  /** The pantry: the inflow's destination, and the "use it up" surface. */
  pantry: {
    item: TEST_IDS.pantry.item(E2E_MANUAL_ITEM),
    markUseUp: TEST_IDS.pantry.markUseUp(E2E_MANUAL_ITEM),
    useItUp: testID("pantry", "use-it-up"),
    suggestionsLoading: testID("pantry", "suggestions-loading"),
    suggestionsEmpty: testID("pantry", "suggestions-empty"),
  },

  /** Sign-out lives on Settings ahead of the rest of that screen (BL-0066). */
  settings: { signOut: testID("settings", "sign-out") },
} as const;

/** Flattened, for the flow-parity assertions. */
export const E2E_SELECTOR_IDS: readonly TestID[] = Object.values(E2E_SELECTORS).flatMap(
  (surface) => Object.values(surface) as TestID[],
);
