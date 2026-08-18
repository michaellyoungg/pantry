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
 * the smaller set one flow drives — but it draws from it wherever an entry
 * exists, so a flow and the Playwright spec for the same journey reach the same
 * element by construction (BL-0071). Growing it is BL-0073.
 */

import { TEST_IDS } from "@pantry/core/testing";
import { tabTestID } from "../navigation/navItems";
import { type TestID, testID } from "./testIDs";

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
    settingsTab: tabTestID("settings"),
  },

  /**
   * The plan screen's root. The flow asserts the container rather than anything
   * inside it: what is under test is that the tab routes, not what it renders —
   * which is also why a `PlaceholderScreen` (BL-0064) is a fine target.
   */
  plan: { screen: testID("plan", "screen") },

  /** Sign-out lives on Settings ahead of the rest of that screen (BL-0066). */
  settings: { signOut: testID("settings", "sign-out") },
} as const;

/** Flattened, for the flow-parity assertions. */
export const E2E_SELECTOR_IDS: readonly TestID[] = Object.values(E2E_SELECTORS).flatMap(
  (surface) => Object.values(surface) as TestID[],
);
