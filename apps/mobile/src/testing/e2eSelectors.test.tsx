/**
 * The half of the e2e selector loop that watches the app rather than the flows:
 * `maestroFlows.test.ts` proves a flow only uses declared ids, but both files
 * could agree perfectly about an id no screen renders any more.
 *
 * The tab bar is the exception — `expo-router`'s `<Tabs>` wants a navigation
 * container this suite has no reason to stand up — so its ids are checked
 * against the real tab list instead.
 */
import { render, screen } from "@testing-library/react-native";

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockNoop = jest.fn(() => Promise.resolve());
jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockNoop, signOut: mockNoop }),
}));
jest.mock("convex/react", () => ({ useAction: () => mockNoop }));

import PlanRoute from "../../app/(tabs)/plan";
import SettingsRoute from "../../app/(tabs)/settings";
import { AuthForm } from "../auth/AuthForm";
import { NAV_ITEMS, tabTestID } from "../navigation/navItems";
import { E2E_SELECTORS } from "./e2eSelectors";

describe("the selectors apps/mobile/e2e drives", () => {
  it("are all rendered by the sign-in screen", async () => {
    await render(<AuthForm />);

    for (const id of Object.values(E2E_SELECTORS.auth)) {
      expect(screen.getByTestId(id)).toBeOnTheScreen();
    }
  });

  it("are all rendered by the plan route", async () => {
    // The route module, not the component under it: whatever BL-0064 puts here
    // has to keep emitting `plan.screen`, or the flow's navigation assertion
    // has nothing to land on.
    await render(<PlanRoute />);

    expect(screen.getByTestId(E2E_SELECTORS.plan.screen)).toBeOnTheScreen();
  });

  it("are all rendered by the settings route", async () => {
    await render(<SettingsRoute />);

    expect(screen.getByTestId(E2E_SELECTORS.settings.signOut)).toBeOnTheScreen();
  });

  it("name tabs the tab bar actually has", async () => {
    const tabs = NAV_ITEMS.map((item) => tabTestID(item.name));

    for (const id of Object.values(E2E_SELECTORS.nav)) {
      expect(tabs).toContain(id);
    }
  });
});
