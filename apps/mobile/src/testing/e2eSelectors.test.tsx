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

// Deliberately shapeless: each screen has its own test asserting what it does
// with real data, and this one only asks whether the selectors render at all.
// One object stands in for every action's empty answer — the prep derivation's
// and the nutrition rollup's alike — rather than a dispatch table this file has
// no reason to maintain.
jest.mock("convex/react", () => {
  const empty = async () => ({ meals: [], days: [], week: null });
  const mutation = Object.assign(async () => undefined, { withOptimisticUpdate: () => mutation });
  return { useQuery: () => [], useAction: () => empty, useMutation: () => mutation };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

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
    // The route module, not the component under it: whatever the route renders
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
