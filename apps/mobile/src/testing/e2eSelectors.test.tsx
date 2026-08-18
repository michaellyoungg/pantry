/**
 * The half of the e2e selector loop that watches the app rather than the flows:
 * `maestroFlows.test.ts` proves a flow only uses declared ids, but both files
 * could agree perfectly about an id no screen renders any more.
 *
 * Every selector in `E2E_SELECTORS` is asserted here, on the real screen, in
 * the state the flow drives it into — the flows themselves run nightly at best
 * (BL-0073), so this is what turns a renamed `testID` into a failed pull
 * request rather than a red run six hours later.
 *
 * It is deliberately not a second suite of screen tests. Each screen already
 * has one asserting what it does with real data; these assertions only ask
 * whether the handful of elements a flow reaches for still exist. Where a state
 * needs setting up — a checked line, a proposal, a due prep task — the setup is
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
 * Shapeless mocks cannot reach the states a flow actually drives — an empty
 * list has no row to check off and an empty basket has nothing to schedule — so
 * this serves real rows, and each test sets only the ones its screen reads.
 */
const mockState = {
  basket: [] as unknown[],
  list: [] as unknown[],
  pantry: [] as unknown[],
  /** What `recipes.list` answers "My recipes" with. */
  mine: [] as unknown[],
  /** What `recipes.listCatalog` answers the catalog browser with. */
  catalog: [] as unknown[],
  /** What `recommendations.pantry` answers the use-it-up card with. */
  suggestions: { results: [] as unknown[], generated: [] as unknown[] },
  /** What `recommendations.weekCandidates` answers the suggester with. */
  candidates: [] as unknown[],
  /** What `prepTasks.forPlan` derives for the week. */
  prep: { rulesVersion: "t.1", meals: [] as unknown[] },
};

/**
 * Every action is ONE stable function, built out here rather than inside the
 * factory. `useAction` returning a fresh closure per render churns the identity
 * `useAsyncData`'s effect is keyed on, and the screens that fetch on mount then
 * re-render forever — which presents as a suite that hangs rather than as a
 * mock that is wrong.
 */
const mockMine = jest.fn(async (): Promise<unknown> => mockState.mine);
const mockCatalog = jest.fn(async (): Promise<unknown> => mockState.catalog);
const mockRecommend = jest.fn(async (): Promise<unknown> => mockState.suggestions);
const mockCandidates = jest.fn(async (): Promise<unknown> => mockState.candidates);
const mockPrep = jest.fn(async (): Promise<unknown> => mockState.prep);
const mockEquipment = jest.fn(async (): Promise<unknown> => []);
const mockMakeability = jest.fn(async (): Promise<unknown> => ({ fits: {}, counts: {} }));
const mockWrite = jest.fn(async (): Promise<unknown> => ({ count: 1 }));
/** The plan rollup (BL-0065), landed after this table: a week with nothing in it. */
const mockNutrition = jest.fn(async (): Promise<unknown> => ({ days: [], week: null }));
/** One array for every query with nothing to say, for the same identity reason. */
const mockEmpty: unknown[] = [];
const mockPreferences = { householdSize: undefined };

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
      if (name.includes("leftoverProposals")) return mockEmpty;
      if (name.includes("recentItems")) return mockEmpty;
      if (name.startsWith("preferences")) return mockPreferences;
      if (name.startsWith("basket")) return mockState.basket;
      if (name.startsWith("pantry")) return mockState.pantry;
      if (name.startsWith("groceryList")) return mockState.list;
      return mockEmpty;
    },
    useAction: (ref: never) => {
      const name = getFunctionName(ref);
      if (name === "recipes:list") return mockMine;
      if (name === "recipes:listCatalog") return mockCatalog;
      if (name === "recipes:listEquipment") return mockEquipment;
      if (name === "equipment:makeability") return mockMakeability;
      if (name.includes("weekCandidates")) return mockCandidates;
      if (name.startsWith("recommendations")) return mockRecommend;
      if (name.startsWith("prepTasks")) return mockPrep;
      if (name.startsWith("nutrition")) return mockNutrition;
      return mockWrite;
    },
    useMutation: () => mutation,
  };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: jest.fn(), back: jest.fn() }),
  // The recipes tab picks its segment from the route (BL-0066): Settings links
  // to the kitchen by passing one. No params here means the default segment.
  useLocalSearchParams: () => ({}),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import { weekdayOf } from "@pantry/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import HomeRoute from "../../app/(tabs)/index";
import ListRoute from "../../app/(tabs)/list";
import PantryRoute from "../../app/(tabs)/pantry";
import PlanRoute from "../../app/(tabs)/plan";
import RecipesRoute from "../../app/(tabs)/recipes";
import SettingsRoute from "../../app/(tabs)/settings";
import NewRecipeRoute from "../../app/recipes/new";
import { AuthForm } from "../auth/AuthForm";
import { NAV_ITEMS, tabTestID } from "../navigation/navItems";
import { E2E_MANUAL_ITEM, E2E_RECIPES, E2E_SELECTORS } from "./e2eSelectors";

const { authored, catalog } = E2E_RECIPES;

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
    canonicalItem: E2E_MANUAL_ITEM,
    unit: "",
    quantity: 1,
    aisle: "produce",
    checked: false,
    manual: true,
    sources: [
      { recipeId: "r1", title: authored.garlicBread.title, quantity: 1 },
      { recipeId: "r2", title: authored.garlicToast.title, quantity: 1 },
    ],
    ...over,
  };
}

/** The line only the catalog's copy of a recipe produces. */
function baguetteLine() {
  return groceryLine({
    _id: "g2",
    item: "Baguette",
    canonicalItem: catalog.garlicBread.catalogOnlyIngredient,
    aisle: "bakery",
    manual: false,
    sources: [{ recipeId: "r3", title: catalog.garlicBread.title, quantity: 1 }],
  });
}

function pantryItem() {
  return {
    _id: "p1",
    _creationTime: 0,
    userId: "u1",
    canonicalItem: E2E_MANUAL_ITEM,
    display: "Garlic",
    aisle: "produce",
    state: "have",
    source: "auto",
    updatedAt: 0,
  };
}

function basketRow(title: string, over: Record<string, unknown> = {}) {
  return {
    _id: `b-${title}`,
    _creationTime: 0,
    userId: "u1",
    recipeId: `r-${title}`,
    title,
    ...over,
  };
}

function recipe(title: string) {
  return {
    id: `r-${title}`,
    userId: "u1",
    title,
    ingredients: [{ item: E2E_MANUAL_ITEM, quantity: 1, unit: "" }],
    steps: [],
    equipment: [],
    methods: [],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
  };
}

/** One ranked suggestion, the shape `recommendations.pantry` answers with. */
function suggestion(title: string) {
  return {
    recipeId: `r-${title}`,
    title,
    score: 0.9,
    reasons: ["Uses up: garlic"],
    have: [E2E_MANUAL_ITEM],
    missing: [],
  };
}

/**
 * A prep task that is due whenever this suite runs. `dueByToday` compares ISO
 * dates, so a date in the past is due today and every other day.
 */
function duePrepMeal(title: string) {
  return {
    recipeId: `r-${title}`,
    title,
    cookDate: "2020-01-02",
    tasks: [
      {
        key: "thaw_frozen_protein:chicken breast",
        ruleId: "thaw_frozen_protein",
        subject: "chicken breast",
        window: "night_before",
        text: "Move the chicken breast to the fridge to thaw",
        source: "rule",
        dueOn: "2020-01-01",
      },
    ],
  };
}

/**
 * Renders and lets the mount-time async work settle.
 *
 * These screens all start something on mount — the grocery cache read
 * (BL-0058), the recipe list, the use-it-up request, the prep derivation — and
 * each resolves a microtask after `render`'s own `act` has closed. Without this
 * the state update leaks out of `act` and warns in front of every real failure.
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
  mockState.mine = [];
  mockState.catalog = [];
  mockState.suggestions = { results: [], generated: [] };
  mockState.candidates = [];
  mockState.prep = { rulesVersion: "t.1", meals: [] };
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
    mockState.basket = [basketRow(authored.garlicBread.title, { weekday: TODAY })];
    await renderScreen(<HomeRoute />);

    expectOnScreen(home.buildList);
  });

  it("offer the shopping handoff once a list exists", async () => {
    mockState.basket = [basketRow(authored.garlicBread.title, { weekday: TODAY })];
    mockState.list = [groceryLine()];
    await renderScreen(<HomeRoute />);

    expectOnScreen(home.shop);
  });

  it("surface prep that is due, and nothing when none is", async () => {
    // The card renders nothing at all unless something is due, which is what
    // `flows/prep-tasks.yml` asserts on — so the empty case is asserted too,
    // or its presence would say nothing.
    await renderScreen(<HomeRoute />);
    expect(screen.queryByTestId(home.beforeYouCook)).toBeNull();

    mockState.basket = [basketRow(authored.thawTest.title, { weekday: TODAY })];
    mockState.prep = { rulesVersion: "t.1", meals: [duePrepMeal(authored.thawTest.title)] };
    await renderScreen(<HomeRoute />);

    expectOnScreen(home.beforeYouCook);
  });
});

/** Every recipe the planner's keyed selectors are named after. */
const SCHEDULABLE = [
  authored.garlicBread.title,
  authored.garlicToast.title,
  authored.thawTest.title,
  catalog.garlicBread.title,
];

describe("the selectors on the planner", () => {
  const { plan } = E2E_SELECTORS;

  it("are all rendered by an empty week", async () => {
    await renderScreen(<PlanRoute />);

    expectOnScreen(plan.screen, plan.title, plan.dayEmpty, plan.suggest, plan.generate);
  });

  it("offer a day to every basket row that has none", async () => {
    mockState.basket = SCHEDULABLE.map((title) => basketRow(title));
    await renderScreen(<PlanRoute />);

    expectOnScreen(...Object.values(plan.schedule));
  });

  it("name every meal once it is sitting on a day", async () => {
    mockState.basket = SCHEDULABLE.map((title) => basketRow(title, { weekday: TODAY }));
    await renderScreen(<PlanRoute />);

    expectOnScreen(...Object.values(plan.meal));
  });

  it("badge a planned meal with its lead time", async () => {
    mockState.basket = [basketRow(authored.thawTest.title, { weekday: TODAY })];
    mockState.prep = { rulesVersion: "t.1", meals: [duePrepMeal(authored.thawTest.title)] };
    await renderScreen(<PlanRoute />);

    expectOnScreen(plan.prep);
  });

  it("are all rendered by a proposal", async () => {
    mockState.candidates = [
      {
        recipeId: "c1",
        title: catalog.aglioEOlio.title,
        score: 0.9,
        reasons: [],
        have: [],
        missing: [],
      },
    ];
    await renderScreen(<PlanRoute />);

    await press(plan.suggest);

    expectOnScreen(plan.suggestPreamble, plan.suggestAccept);
  });

  it("say so when every day is already planned", async () => {
    // The second half of `flows/suggest-week.yml`: a week with no open day is
    // how that flow proves the suggester leaves planned days alone.
    mockState.basket = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
      basketRow(`Dinner ${weekday}`, { weekday }),
    );
    mockState.candidates = [
      {
        recipeId: "c1",
        title: catalog.aglioEOlio.title,
        score: 0.9,
        reasons: [],
        have: [],
        missing: [],
      },
    ];
    await renderScreen(<PlanRoute />);

    await press(plan.suggest);

    expectOnScreen(plan.suggestEmpty);
  });
});

describe("the selectors on the recipes tab", () => {
  const { recipes } = E2E_SELECTORS;

  it("are all rendered by the collection", async () => {
    mockState.mine = [
      recipe(authored.garlicBread.title),
      recipe(authored.garlicToast.title),
      recipe(authored.thawTest.title),
    ];
    await renderScreen(<RecipesRoute />);

    expectOnScreen(recipes.add, recipes.mine, ...Object.values(recipes.basket));
  });

  it("are all rendered by the catalog view", async () => {
    mockState.catalog = [recipe(catalog.garlicBread.title)];
    await renderScreen(<RecipesRoute />);

    await press(recipes.catalogSection);

    expectOnScreen(recipes.catalogSearch, recipes.catalogItem, recipes.catalogAdd);
  });

  it("are all rendered by the add funnel", async () => {
    await renderScreen(<NewRecipeRoute />);

    expectOnScreen(recipes.editor, recipes.fieldTitle, recipes.fieldIngredient, recipes.save);
  });
});

describe("the selectors on the grocery list", () => {
  const { list } = E2E_SELECTORS;

  it("say a new account's list is empty", async () => {
    await renderScreen(<ListRoute />);

    expectOnScreen(list.emptyState);
  });

  it("are all rendered by a line to buy", async () => {
    mockState.list = [groceryLine(), baguetteLine()];
    await renderScreen(<ListRoute />);

    expectOnScreen(
      list.garlic,
      list.garlicToggle,
      list.garlicRemove,
      list.garlicProvenance,
      list.baguette,
      list.baguetteProvenance,
      list.progress,
      list.addToggle,
      list.doneShopping,
    );
  });

  it("name every recipe an aggregated line came from", async () => {
    mockState.list = [groceryLine()];
    await renderScreen(<ListRoute />);

    await press(list.garlicProvenance);

    expectOnScreen(
      list.provenanceSheet,
      list.source.garlicBread,
      list.source.garlicToast,
      list.provenanceClose,
    );
  });

  it("name the catalog recipe a catalog-only line came from", async () => {
    mockState.list = [baguetteLine()];
    await renderScreen(<ListRoute />);

    await press(list.baguetteProvenance);

    expectOnScreen(list.source.catalogBread);
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

    await press(list.garlicRemove);

    expectOnScreen(list.undo, list.undoButton);
  });
});

describe("the selectors on the pantry", () => {
  const { pantry } = E2E_SELECTORS;

  it("are all rendered by an inventory row", async () => {
    mockState.pantry = [pantryItem()];
    await renderScreen(<PantryRoute />);

    expectOnScreen(pantry.garlic, pantry.markUseUp, pantry.useItUp);
  });

  it("name both halves of the candidate pool the ranker answers with", async () => {
    mockState.pantry = [pantryItem()];
    mockState.suggestions = {
      results: [suggestion(authored.garlicToast.title), suggestion(catalog.aglioEOlio.title)],
      generated: [],
    };
    await renderScreen(<PantryRoute />);

    expectOnScreen(...Object.values(pantry.suggestion));
  });
});
