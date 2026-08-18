import { fireEvent, render, screen } from "@testing-library/react-native";

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles.

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockSignOut = jest.fn(() => Promise.resolve());
const mockNavigate = jest.fn();

// Deliberately shapeless: each section has its own test asserting what it does
// with real data, and this one asks only what the screen is composed of.
jest.mock("convex/react", () => {
  const mutation = Object.assign(async () => undefined, { withOptimisticUpdate: () => mutation });
  return {
    useQuery: () => ({ avoidItems: [], avoidResolutions: [], cuisines: [] }),
    useAction: () => async () => undefined,
    useMutation: () => mutation,
  };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mockSignOut }),
}));

// The tab navigator renders no header, so the screen reads the top inset
// itself. There is no native safe-area module in a Node test process.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Not colocated with the route on purpose — see appRouteTree.test.ts.
import SettingsRoute from "../../app/(tabs)/settings";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the settings route", () => {
  it("is a real screen now, not the placeholder", async () => {
    await render(<SettingsRoute />);

    expect(screen.getByTestId("settings.screen")).toBeOnTheScreen();
    expect(screen.getByTestId("settings.title")).toHaveTextContent("Settings");
    expect(screen.queryByTestId("settings.placeholder")).toBeNull();
  });

  it("carries every setting the recommender reads", async () => {
    await render(<SettingsRoute />);

    for (const section of [
      "settings.section.household",
      "settings.section.my-kitchen",
      "settings.section.ingredients-to-avoid",
      "settings.section.tastes",
    ]) {
      expect(screen.getByTestId(section)).toBeOnTheScreen();
    }
  });

  // A pointer rather than a second copy of the inventory, so the two surfaces
  // cannot come to disagree about what a tick means. The kitchen is a segment
  // of the recipes tab rather than a route, so the link carries which segment.
  it("points at the equipment inventory rather than drawing it again", async () => {
    await render(<SettingsRoute />);

    await fireEvent.press(screen.getByTestId("settings.open-kitchen"));

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: "/recipes",
      params: { section: "kitchen" },
    });
    expect(screen.queryByTestId("recipes.equipment.whisk")).toBeNull();
  });

  // BL-0065 put this entry point on the settings route while this port was in
  // flight, and the port replaces that file wholesale. Nothing else links to
  // the goal editor, so losing it here strands the screen entirely.
  it("keeps the way in to the nutrition goal editor", async () => {
    await render(<SettingsRoute />);

    await fireEvent.press(screen.getByTestId("settings.nutrition-goals"));

    expect(mockNavigate).toHaveBeenCalledWith("/nutrition/goals");
  });

  // Both shipped before the rest of Settings existed — sign-out because a
  // device otherwise cannot leave a session, deletion because App Store
  // guideline 5.1.1(v) requires it in-app. Neither may be lost to the port.
  it("keeps sign-out and account deletion", async () => {
    await render(<SettingsRoute />);

    expect(screen.getByTestId("settings.sign-out")).toBeOnTheScreen();
    expect(screen.getByTestId("settings.delete-account")).toBeOnTheScreen();
  });

  // Everything above the line is something you came here to change; deletion is
  // the one thing you cannot change back, so it does not sit where a mis-tap
  // while scrolling lands.
  it("puts deletion last, below every setting", async () => {
    await render(<SettingsRoute />);

    // Read off the rendered tree rather than the source: what matters is where
    // the control ends up on screen, and a section reordered in JSX would slip
    // past an assertion that only checked both were present.
    const rendered = JSON.stringify(screen.toJSON());

    expect(rendered.indexOf("settings.delete-account")).toBeGreaterThan(
      rendered.indexOf("settings.section.tastes"),
    );
  });
});
