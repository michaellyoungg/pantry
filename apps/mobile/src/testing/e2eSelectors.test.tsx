/**
 * The half of the e2e selector loop that watches the app rather than the flows:
 * `maestroFlows.test.ts` proves a flow only uses declared ids, but both files
 * could agree perfectly about an id no screen renders any more.
 *
 * Every selector in `E2E_SELECTORS` is asserted here, on the real screen, in
 * the state the flow drives it into — the flows themselves run nightly at best
 * (BL-0073), so this is the check that turns a renamed `testID` into a failed
 * pull request rather than a red run six hours later.
 *
 * It is deliberately not a second suite of screen tests. Each screen already
 * has one asserting what it does with real data; these assertions only ask
 * whether the handful of elements a flow reaches for still exist. Where a state
 * needs setting up (a checked line, a proposal, a planned week) the setup is
 * the shortest one that reaches it.
 *
 * The tab bar is the exception — `expo-router`'s `<Tabs>` wants a navigation
 * container this suite has no reason to stand up — so its ids are checked
 * against the real tab list instead.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// `jest.mock` is hoisted above this file's imports, so the factories may only
// close over names prefixed `mock`.
const mockNoop = jest.fn(() => Promise.resolve());
jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockNoop, signOut: mockNoop }),
}));

/**
 * One backend for every screen below, dispatched by Convex function name.
 *
 * Shapeless mocks are what the other tests in this file used to use, and they
 * cannot reach any of the states a flow actually drives — an empty list has no
 * row to check off and an empty basket has nothing to propose. So this serves
 * real rows, and each test sets only the ones its screen reads.
 */
const mockState = {
  basket: [] as unknown[],
  list: [] as unknown[],
  pantry: [] as unknown[],
  leftovers: [] as unknown[],
  recent: [] as unknown[],
  /** What `recommendations.weekCandidates` answers the suggester with. */
  candidates: [] as unknown[],
  /** What `recommendations.pantry` answers the use-it-up card with. */
  suggestions: { results: [] as unknown[], generated: [] as unknown[] },
  /** Set to leave the card's request in flight, which is its loading state. */
  suggestionsPending: false,
};

/**
 * Every action is ONE stable function, built out here rather than inside the
 * factory. `useAction` returning a fresh closure per render churns the identity
 * `useAsyncData`'s effect is keyed on, and the screens that fetch on mount then
 * re-render forever — which presents as a suite that hangs rather than as a
 * mock that is wrong.
 */
const mockRecommend = jest.fn(async (): Promise<unknown> =>
  mockState.suggestionsPending ? new Promise(() => {}) : mockState.suggestions,
);
const mockCandidates = jest.fn(async (): Promise<unknown> => mockState.candidates);
const mockPrep = jest.fn(async () => ({ rulesVersion: "t.1", meals: [] }));
const mockGenerate = jest.fn(async () => ({ count: 1 }));
/** The plan rollup (BL-0065), landed after this table: a week with nothing in it. */
const mockNutrition = jest.fn(async () => ({ days: [], week: null }));
/** One array for every query with nothing to say, for the same reason. */
const mockEmpty: unknown[] = [];

jest.mock("convex/react", () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = require("convex/server");
  const noop = () => Promise.resolve();
  const mutation = Object.assign(noop, { withOptimisticUpdate: () => noop });
  return {
    useConvexConnectionState: () => ({ isWebSocketConnected: true }),
    useQuery: (ref: never, args?: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(ref);
      if (name.includes("leftoverProposals")) return mockState.leftovers;
      if (name.includes("recentItems")) return mockState.recent;
      if (name.startsWith("basket")) return mockState.basket;
      if (name.startsWith("pantry")) return mockState.pantry;
      if (name.startsWith("groceryList")) return mockState.list;
      return mockEmpty;
    },
    useAction: (ref: never) => {
      const name = getFunctionName(ref);
      if (name.includes("weekCandidates")) return mockCandidates;
      if (name.startsWith("recommendations")) return mockRecommend;
      if (name.startsWith("prepTasks")) return mockPrep;
      if (name.startsWith("nutrition")) return mockNutrition;
      return mockGenerate;
    },
    useMutation: () => mutation,
  };
});

jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn() }) }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import { weekdayOf } from "@pantry/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import HomeRoute from "../../app/(tabs)/index";
import ListRoute from "../../app/(tabs)/list";
import PantryRoute from "../../app/(tabs)/pantry";
import PlanRoute from "../../app/(tabs)/plan";
import SettingsRoute from "../../app/(tabs)/settings";
import { AuthForm } from "../auth/AuthForm";
import { NAV_ITEMS, tabTestID } from "../navigation/navItems";
import { E2E_MANUAL_ITEM, E2E_SELECTORS } from "./e2eSelectors";

/** The item every grocery and pantry selector is keyed to. */
const ITEM = E2E_MANUAL_ITEM;

/** The day the planner opens on, so nothing here depends on when it runs. */
const TODAY = weekdayOf(new Date());

function groceryLine(over: Record<string, unknown> = {}) {
  return {
    _id: "g1",
    _creationTime: 0,
    userId: "u1",
    // The display form the server hands back, not the typed text — the id is
    // slugged from this, which is the round trip the flows depend on.
    item: "Garlic",
    canonicalItem: ITEM,
    unit: "",
    quantity: 1,
    aisle: "produce",
    checked: false,
    manual: true,
    ...over,
  };
}

function pantryItem(over: Record<string, unknown> = {}) {
  return {
    _id: "p1",
    _creationTime: 0,
    userId: "u1",
    canonicalItem: ITEM,
    display: "Garlic",
    aisle: "produce",
    state: "have",
    source: "auto",
    updatedAt: 0,
    ...over,
  };
}

function basketRow(over: Record<string, unknown> = {}) {
  return { _id: "b1", _creationTime: 0, userId: "u1", recipeId: "r1", title: "Roast", ...over };
}

/** One ranked candidate, the shape `recommendations.weekCandidates` answers with. */
function candidate() {
  return { recipeId: "c1", title: "Aglio e Olio", score: 0.9, reasons: [], have: [], missing: [] };
}

/**
 * Renders and lets the mount-time async work settle.
 *
 * These screens all start something on mount — the grocery cache read
 * (BL-0058), the use-it-up request, the prep derivation — and each resolves a
 * microtask after `render`'s own `act` has closed. Without this the state
 * update leaks out of `act` and warns in front of every real failure.
 */
async function renderScreen(element: React.ReactElement) {
  await render(element);
  await act(async () => {});
}

async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await act(async () => {});
}

function expectOnScreen(...ids: string[]) {
  for (const id of ids) expect(screen.getByTestId(id)).toBeOnTheScreen();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.basket = [];
  mockState.list = [];
  mockState.pantry = [];
  mockState.leftovers = [];
  mockState.recent = [];
  mockState.candidates = [];
  mockState.suggestions = { results: [], generated: [] };
  mockState.suggestionsPending = false;
  return AsyncStorage.clear();
});

describe("the selectors apps/mobile/e2e drives", () => {
  it("are all rendered by the sign-in screen", async () => {
    await render(<AuthForm />);

    expectOnScreen(...Object.values(E2E_SELECTORS.auth));
  });

  it("name tabs the tab bar actually has", async () => {
    const tabs = NAV_ITEMS.map((item) => tabTestID(item.name));

    for (const id of Object.values(E2E_SELECTORS.nav)) {
      expect(tabs).toContain(id);
    }
  });

  it("are all rendered by the settings route", async () => {
    await renderScreen(<SettingsRoute />);

    expectOnScreen(E2E_SELECTORS.settings.signOut);
  });
});

describe("the selectors on Home", () => {
  const { home } = E2E_SELECTORS;

  it("offer the first step to an account with nothing in it", async () => {
    await renderScreen(<HomeRoute />);

    expectOnScreen(home.planWeek, home.gettingStarted);
  });

  it("offer the build action once the week is planned", async () => {
    mockState.basket = [basketRow({ weekday: TODAY })];
    await renderScreen(<HomeRoute />);

    expectOnScreen(home.buildList);
  });

  it("offer the shopping handoff once a list exists", async () => {
    mockState.basket = [basketRow({ weekday: TODAY })];
    mockState.list = [groceryLine()];
    await renderScreen(<HomeRoute />);

    expectOnScreen(home.shop);
  });
});

describe("the selectors on the planner", () => {
  const { plan } = E2E_SELECTORS;

  it("are all rendered by an empty week", async () => {
    await renderScreen(<PlanRoute />);

    expectOnScreen(plan.screen, plan.title, plan.dayEmpty, plan.suggest, plan.generate);
  });

  it("are all rendered by a proposal", async () => {
    mockState.candidates = [candidate()];
    await renderScreen(<PlanRoute />);

    await press(plan.suggest);

    expectOnScreen(plan.suggestPreamble, plan.suggestAccept);
  });

  it("say so when every day is already planned", async () => {
    // The second half of `flows/suggest-week.yml`: a week with no open day is
    // how that flow proves the suggester leaves planned days alone.
    mockState.basket = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      basketRow({ _id: `b${weekday}`, recipeId: `r${weekday}`, weekday }),
    );
    mockState.candidates = [candidate()];
    await renderScreen(<PlanRoute />);

    await press(plan.suggest);

    expectOnScreen(plan.suggestEmpty);
  });
});

describe("the selectors on the grocery list", () => {
  const { list } = E2E_SELECTORS;

  it("say a new account's list is empty", async () => {
    await renderScreen(<ListRoute />);

    expectOnScreen(list.emptyState);
  });

  it("are all rendered by a line to buy", async () => {
    mockState.list = [groceryLine()];
    await renderScreen(<ListRoute />);

    expectOnScreen(list.item, list.toggle, list.remove, list.progress, list.addToggle);
  });

  it("are all rendered by a line in the cart", async () => {
    mockState.list = [groceryLine({ checked: true })];
    await renderScreen(<ListRoute />);

    expectOnScreen(list.inCartSection);
  });

  it("are all rendered by the add field", async () => {
    await renderScreen(<ListRoute />);

    await press(list.addToggle);

    expectOnScreen(list.addField, list.addSubmit);
  });

  it("are all rendered by the done-shopping sheet", async () => {
    mockState.list = [groceryLine()];
    await renderScreen(<ListRoute />);

    await press(list.doneShopping);

    expectOnScreen(list.finishSheet, list.finishKeep);
  });

  it("are all rendered by the undo offer", async () => {
    mockState.list = [groceryLine()];
    await renderScreen(<ListRoute />);

    await press(list.remove);

    expectOnScreen(list.undo, list.undoButton);
  });
});

describe("the selectors on the pantry", () => {
  const { pantry } = E2E_SELECTORS;

  it("are all rendered by an inventory row", async () => {
    mockState.pantry = [pantryItem()];
    await renderScreen(<PantryRoute />);

    expectOnScreen(pantry.item, pantry.markUseUp, pantry.useItUp);
  });

  it("say when the suggestion request is still in flight", async () => {
    mockState.pantry = [pantryItem()];
    mockState.suggestionsPending = true;
    await renderScreen(<PantryRoute />);

    expectOnScreen(pantry.suggestionsLoading);
  });

  it("say when the ranker came back with nothing", async () => {
    // `flows/recommendations.yml` asserts this element is ABSENT, which is only
    // an assertion at all while the app can still render it.
    mockState.pantry = [pantryItem()];
    await renderScreen(<PantryRoute />);

    expectOnScreen(pantry.suggestionsEmpty);
  });
});
