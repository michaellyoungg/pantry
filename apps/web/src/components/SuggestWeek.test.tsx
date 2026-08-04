import type { PlannedItem } from "@pantry/core";
import type { Recommendation } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestWeek } from "./SuggestWeek";

const fetchCandidates = vi.fn();
const addToBasket = vi.fn();
const schedule = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => fetchCandidates,
  useMutation: (ref: string) => (ref === "add" ? addToBasket : schedule),
}));
vi.mock("@pantry/convex/api", () => ({
  api: {
    recommendations: { weekCandidates: "week" },
    basket: { add: "add", schedule: "schedule" },
  },
}));

function candidate(
  recipeId: string,
  score: number,
  missing: string[] = [],
  have: string[] = [],
): Recommendation {
  return {
    recipeId,
    title: `Recipe ${recipeId}`,
    source: "catalog",
    score,
    reasons: [],
    have,
    missing: missing.map((canonicalItem) => ({ canonicalItem, display: canonicalItem })),
  };
}

const suggestButton = () => screen.getByRole("button", { name: "Suggest my week" });

describe("SuggestWeek", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addToBasket.mockResolvedValue(undefined);
    schedule.mockResolvedValue(undefined);
  });

  it("proposes a week with a day for each pick", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());

    expect(await screen.findByText(/Monday/)).toBeTruthy();
    expect(screen.getByText(/Recipe a/)).toBeTruthy();
  });

  // The whole point of the feature: the set-level account, not five per-recipe
  // scores that happen to be on the same screen.
  it("explains the set, not just each recipe", async () => {
    fetchCandidates.mockResolvedValue([
      candidate("a", 0.9, ["chicken", "rice"]),
      candidate("b", 0.8, ["chicken", "salsa"]),
      candidate("c", 0.7, ["chicken", "lemon"]),
    ]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());

    expect(await screen.findByText("3 dinners share chicken")).toBeTruthy();
    expect(screen.getByText(/One shopping list: 4 things to buy, not 6/)).toBeTruthy();
  });

  // Anti-friction: a suggestion the user has to undo is worse than none.
  it("writes nothing until the proposal is accepted", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());
    await screen.findByText(/Recipe a/);

    expect(addToBasket).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing is saved until you add it/i)).toBeTruthy();
  });

  it("baskets and schedules every pick when accepted", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());
    await screen.findByText(/Recipe a/);
    fireEvent.click(screen.getByRole("button", { name: "Add to my week" }));

    await waitFor(() => expect(schedule).toHaveBeenCalledWith({ recipeId: "a", weekday: 0 }));
    expect(addToBasket).toHaveBeenCalledWith({ recipeId: "a", title: "Recipe a" });
  });

  it("clears the proposal once it has been accepted", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());
    await screen.findByText(/Recipe a/);
    fireEvent.click(screen.getByRole("button", { name: "Add to my week" }));

    await waitFor(() => expect(screen.queryByText(/Recipe a/)).toBeNull());
  });

  // BL-0033's fourth requirement: regenerating must not cost someone the
  // Wednesday they already planned.
  it("leaves already-planned days alone and says so", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);
    const planned: PlannedItem[] = [
      { _id: "1", recipeId: "already", title: "Already planned", weekday: 2 },
    ];

    render(<SuggestWeek items={planned} />);
    fireEvent.click(suggestButton());

    expect(await screen.findByText(/Left alone: Wednesday/)).toBeTruthy();
    // The proposal itself must not offer anything for the locked day.
    const proposed = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(proposed.some((t) => t.startsWith("Wednesday"))).toBe(false);
    expect(proposed.some((t) => t.startsWith("Monday"))).toBe(true);
  });

  it("never re-proposes a recipe that is already on a day", async () => {
    fetchCandidates.mockResolvedValue([candidate("already", 0.99, ["chicken"])]);
    const planned: PlannedItem[] = [
      { _id: "1", recipeId: "already", title: "Recipe already", weekday: 2 },
    ];

    render(<SuggestWeek items={planned} />);
    fireEvent.click(suggestButton());

    expect(await screen.findByText(/No recipes to suggest yet/)).toBeTruthy();
  });

  it("drops a turned-down dinner and refills its day", async () => {
    fetchCandidates.mockResolvedValue([
      candidate("a", 0.9, ["chicken"]),
      candidate("b", 0.5, ["tofu"]),
    ]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());
    await screen.findByText(/Recipe a/);

    fireEvent.click(screen.getByRole("button", { name: "Not Recipe a" }));

    await waitFor(() => expect(screen.queryByText(/Recipe a/)).toBeNull());
    expect(screen.getByText(/Recipe b/)).toBeTruthy();
  });

  // Selection is deterministic, so "Try again" has to turn the current picks
  // down — otherwise it hands back the identical week.
  it("shows a different week on Try again", async () => {
    fetchCandidates.mockResolvedValue([
      candidate("a", 0.9, ["chicken"]),
      candidate("b", 0.5, ["tofu"]),
    ]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());
    await screen.findByText(/Recipe a/);
    // Only one day's worth is proposed at a time here because the pool is small;
    // both recipes fit, so turn the whole set down and expect neither back.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByText(/Recipe a/)).toBeNull());
    expect(screen.queryByText(/Recipe b/)).toBeNull();
  });

  it("discards the proposal without writing anything", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());
    await screen.findByText(/Recipe a/);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByText(/Recipe a/)).toBeNull());
    expect(addToBasket).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("tells the user when the week is already full rather than looking broken", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"])]);
    const planned: PlannedItem[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      _id: `${d}`,
      recipeId: `p${d}`,
      title: `P${d}`,
      weekday: d,
    }));

    render(<SuggestWeek items={planned} />);
    fireEvent.click(suggestButton());

    expect(await screen.findByText(/Every day is already planned/)).toBeTruthy();
  });

  it("surfaces a failed fetch instead of an empty proposal", async () => {
    fetchCandidates.mockRejectedValue(new Error("recipe-service unreachable"));

    render(<SuggestWeek items={[]} />);
    fireEvent.click(suggestButton());

    expect(await screen.findByText(/recipe-service unreachable/)).toBeTruthy();
  });
});
