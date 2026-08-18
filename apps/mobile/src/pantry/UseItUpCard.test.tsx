import type { GeneratedRecipeDraft, Recommendation } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const DAY = 86_400_000;

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = { pantry: [] as unknown[] };
const mockRecommend = jest.fn(async () => ({ results: [], generated: [] }) as unknown);
const mockAccept = jest.fn(async () => ({ id: "saved-1", title: "Saved" }) as unknown);
const mockAddToBasket = jest.fn(async () => undefined);

// The card drives TWO actions, so the mock has to tell them apart by name;
// anyApi references are fresh proxies on every access.
jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: () => mockState.pantry,
    useAction: (ref: unknown) =>
      getFunctionName(ref as never) === "recommendations:acceptGenerated"
        ? mockAccept
        : mockRecommend,
    useMutation: () => mockAddToBasket,
  };
});

import { UseItUpCard } from "./UseItUpCard";

function row(over: Record<string, unknown> = {}) {
  return {
    _id: `p-${(over.canonicalItem as string) ?? "spinach"}`,
    display: "Spinach",
    canonicalItem: "spinach",
    state: "have",
    useBy: Date.now() + 2.5 * DAY,
    ...over,
  };
}

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    recipeId: "r1",
    title: "Creamed Spinach",
    source: "catalog",
    score: 0.9,
    reasons: ["Uses 2 things you have"],
    have: ["spinach"],
    missing: [],
    nutritionFit: null,
    nutritionUnverified: [],
    ...over,
  };
}

function ranked(results: Recommendation[] = [], generated: GeneratedRecipeDraft[] = []) {
  return async () => ({ results, generated });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.pantry = [];
  mockRecommend.mockImplementation(ranked());
  mockAccept.mockImplementation(async () => ({ id: "saved-1", title: "Saved" }));
  mockAddToBasket.mockImplementation(async () => undefined);
});

describe("the deadline half of the card", () => {
  it("counts what has to be used this week", async () => {
    mockState.pantry = [
      row({ canonicalItem: "spinach", display: "Spinach" }),
      row({ canonicalItem: "milk", display: "Milk" }),
    ];

    await render(<UseItUpCard variant="page" />);

    expect(screen.getByTestId("pantry.use-it-up-heading")).toHaveTextContent(
      /2 items to use this week/,
    );
    // Regex, not a string: RNTL's matcher compares a string EXACTLY, so a
    // literal here would assert on the whole chip rather than the date in it.
    expect(screen.getByTestId("pantry.expiring.spinach")).toHaveTextContent(/~2 days/);
    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
  });

  it("renders before the ranker has answered, because it needs no network", async () => {
    mockState.pantry = [row()];
    mockRecommend.mockImplementation(() => new Promise(() => {}));

    await render(<UseItUpCard variant="page" />);

    expect(screen.getByTestId("pantry.expiring.spinach")).toBeOnTheScreen();
    expect(screen.getByTestId("pantry.suggestions-loading")).toBeOnTheScreen();
  });

  it("survives the ranker being down, which on a phone is often", async () => {
    mockState.pantry = [row()];
    mockRecommend.mockRejectedValue(new Error("ranker down"));

    await render(<UseItUpCard variant="page" />);

    await waitFor(() => expect(screen.getByTestId("pantry.suggestions-error")).toBeOnTheScreen());
    // The deadline half came from local state and is still useful on its own.
    expect(screen.getByTestId("pantry.expiring.spinach")).toBeOnTheScreen();
  });

  it("marks the dates as estimates, never as printed labels", async () => {
    mockState.pantry = [row()];

    await render(<UseItUpCard variant="page" />);

    expect(screen.getByTestId("pantry.estimate-note")).toHaveTextContent(/estimates/i);
    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
  });
});

describe("on the pantry screen the card is the feature's home", () => {
  it("still asks for suggestions when nothing is expiring", async () => {
    mockState.pantry = [row({ useBy: Date.now() + 300 * DAY })];

    await render(<UseItUpCard variant="page" />);

    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
    expect(screen.getByTestId("pantry.nothing-expiring")).toBeOnTheScreen();
  });

  it("renders nothing at all as a Home nudge when nothing is expiring", async () => {
    mockState.pantry = [row({ useBy: Date.now() + 300 * DAY })];

    await render(<UseItUpCard variant="nudge" />);

    expect(screen.queryByTestId("pantry.use-it-up")).toBeNull();
    // And it costs no request: the common case is silent AND free.
    await waitFor(() => expect(mockRecommend).not.toHaveBeenCalled());
  });
});

describe("suggestions", () => {
  it("keeps urgency apart from fit, because they are different claims", async () => {
    mockState.pantry = [row()];
    mockRecommend.mockImplementation(
      ranked([
        rec({
          urgency: { canonicalItem: "spinach", display: "Spinach", useBy: Date.now() + 2.5 * DAY },
          reasons: ["Uses 2 things you have"],
        }),
      ]),
    );

    await render(<UseItUpCard variant="page" />);

    const urgency = await screen.findByTestId("pantry.urgency.creamed-spinach");
    expect(urgency).toHaveTextContent(/Use soon — Spinach \(~2 days\)/);
    // The deadline is its own line; the preference reasons are not mixed in.
    expect(urgency).not.toHaveTextContent(/Uses 2 things you have/);
  });

  it("puts a catalog suggestion straight on the plan", async () => {
    mockState.pantry = [row()];
    mockRecommend.mockImplementation(ranked([rec()]));

    await render(<UseItUpCard variant="page" />);
    await fireEvent.press(await screen.findByTestId("pantry.add-to-plan.creamed-spinach"));

    await waitFor(() =>
      expect(mockAddToBasket).toHaveBeenCalledWith({
        recipeId: "r1",
        title: "Creamed Spinach",
      }),
    );
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it("labels a generated idea as one, and saves it before planning it", async () => {
    const draft: GeneratedRecipeDraft = {
      recipeId: "gen-1",
      title: "Spinach Skillet",
      servings: 2,
      ingredients: [{ item: "spinach", quantity: 1, unit: "bunch" }],
      steps: ["Wilt it."],
    };
    mockState.pantry = [row()];
    mockRecommend.mockImplementation(
      ranked([rec({ recipeId: "gen-1", title: "Spinach Skillet", source: "generated" })], [draft]),
    );

    await render(<UseItUpCard variant="page" />);

    // Said in words, not only as a badge: this is the one row nobody has cooked.
    expect(await screen.findByTestId("pantry.ai-idea.spinach-skillet")).toHaveTextContent(
      /AI idea/,
    );
    expect(screen.getByTestId("pantry.suggestion.spinach-skillet")).toHaveTextContent(
      /not a tested recipe/i,
    );

    await fireEvent.press(screen.getByTestId("pantry.add-to-plan.spinach-skillet"));

    await waitFor(() => expect(mockAccept).toHaveBeenCalled());
    // The SAVED id, never the synthetic `gen-` one, which names no stored recipe.
    expect(mockAddToBasket).toHaveBeenCalledWith({ recipeId: "saved-1", title: "Saved" });
  });

  it("surfaces a failed add rather than silently not planning the recipe", async () => {
    mockState.pantry = [row()];
    mockRecommend.mockImplementation(ranked([rec()]));
    mockAddToBasket.mockRejectedValueOnce(new Error("offline"));

    await render(<UseItUpCard variant="page" />);
    await fireEvent.press(await screen.findByTestId("pantry.add-to-plan.creamed-spinach"));

    expect(await screen.findByTestId("pantry.add-error")).toHaveTextContent(/offline/);
    // A failed add is not a failed load; the card itself is fine.
    expect(screen.queryByTestId("pantry.suggestions-error")).toBeNull();
  });

  it("says what a recipe still needs, so it is not a dead end at the fridge", async () => {
    mockState.pantry = [row()];
    mockRecommend.mockImplementation(
      ranked([rec({ missing: [{ canonicalItem: "cream", display: "Cream", staple: false }] })]),
    );

    await render(<UseItUpCard variant="page" />);

    expect(await screen.findByTestId("pantry.suggestion.creamed-spinach")).toHaveTextContent(
      /Need: Cream/,
    );
  });

  it("treats 'nothing matched' as its own answer, not as a failure", async () => {
    mockState.pantry = [row()];

    await render(<UseItUpCard variant="page" />);

    expect(await screen.findByTestId("pantry.suggestions-empty")).toHaveTextContent(
      /no recipe uses these yet/i,
    );
    expect(screen.queryByTestId("pantry.suggestions-error")).toBeNull();
  });
});
