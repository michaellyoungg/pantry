import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockCandidates = jest.fn(async () => [] as unknown[]);
const mockAdd = jest.fn(async () => undefined);
const mockSchedule = jest.fn(async () => undefined);

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useAction: () => mockCandidates,
    useMutation: (ref: unknown) => (getFunctionName(ref).endsWith("add") ? mockAdd : mockSchedule),
  };
});

import { SuggestWeekCard } from "./SuggestWeekCard";

function candidate(recipeId: string, score: number, missing: string[] = []) {
  return {
    recipeId,
    title: `Recipe ${recipeId}`,
    source: "catalog",
    score,
    reasons: [],
    have: [],
    missing: missing.map((canonicalItem) => ({ canonicalItem, display: canonicalItem })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCandidates.mockResolvedValue([]);
});

describe("SuggestWeekCard", () => {
  it("proposes a whole week from one press", async () => {
    mockCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);
    await render(<SuggestWeekCard items={[]} />);

    await fireEvent.press(screen.getByTestId("plan.suggest"));

    await waitFor(() => expect(screen.getByTestId("plan.suggest-pick.recipe-a")).toBeOnTheScreen());
    expect(screen.getByTestId("plan.suggest-preamble")).toBeOnTheScreen();
  });

  it("writes nothing until the proposal is accepted", async () => {
    mockCandidates.mockResolvedValue([candidate("a", 0.9)]);
    await render(<SuggestWeekCard items={[]} />);
    await fireEvent.press(screen.getByTestId("plan.suggest"));
    await waitFor(() => expect(screen.getByTestId("plan.suggest-pick.recipe-a")).toBeOnTheScreen());

    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("baskets and schedules every pick when accepted", async () => {
    mockCandidates.mockResolvedValue([candidate("a", 0.9)]);
    await render(<SuggestWeekCard items={[]} />);
    await fireEvent.press(screen.getByTestId("plan.suggest"));
    await waitFor(() => expect(screen.getByTestId("plan.suggest-accept")).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId("plan.suggest-accept"));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ recipeId: "a", title: "Recipe a" }));
    expect(mockSchedule).toHaveBeenCalledWith({ recipeId: "a", weekday: 0 });
  });

  it("drops one dinner without asking the server again", async () => {
    mockCandidates.mockResolvedValue([candidate("a", 0.9), candidate("b", 0.8)]);
    await render(<SuggestWeekCard items={[]} />);
    await fireEvent.press(screen.getByTestId("plan.suggest"));
    await waitFor(() => expect(screen.getByTestId("plan.suggest-pick.recipe-a")).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId("plan.suggest-drop.recipe-a"));

    await waitFor(() => expect(screen.queryByTestId("plan.suggest-pick.recipe-a")).toBeNull());
    expect(screen.getByTestId("plan.suggest-pick.recipe-b")).toBeOnTheScreen();
    expect(mockCandidates).toHaveBeenCalledTimes(1);
  });

  it("throws the proposal away on discard", async () => {
    mockCandidates.mockResolvedValue([candidate("a", 0.9)]);
    await render(<SuggestWeekCard items={[]} />);
    await fireEvent.press(screen.getByTestId("plan.suggest"));
    await waitFor(() => expect(screen.getByTestId("plan.suggest-discard")).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId("plan.suggest-discard"));

    await waitFor(() => expect(screen.queryByTestId("plan.suggest-pick.recipe-a")).toBeNull());
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("distinguishes 'nothing to suggest' from 'every day is taken'", async () => {
    await render(<SuggestWeekCard items={[]} />);
    await fireEvent.press(screen.getByTestId("plan.suggest"));

    await waitFor(() =>
      expect(screen.getByTestId("plan.suggest-empty")).toHaveTextContent(/No recipes to suggest/),
    );
  });

  it("says the failure out loud rather than looking like a dead button", async () => {
    mockCandidates.mockRejectedValueOnce(new Error("recommender is down"));
    await render(<SuggestWeekCard items={[]} />);

    await fireEvent.press(screen.getByTestId("plan.suggest"));

    await waitFor(() =>
      expect(screen.getByTestId("plan.suggest-error")).toHaveTextContent("recommender is down"),
    );
  });
});
