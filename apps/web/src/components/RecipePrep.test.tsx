import type { PrepMeal, PrepTask } from "@pantry/types";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock("convex/react", () => ({ useAction: () => actionMock }));

import { RecipePrep } from "./RecipePrep";

function task(over: Partial<PrepTask> = {}): PrepTask {
  return {
    key: "thaw_frozen_protein:turkey",
    ruleId: "thaw_frozen_protein",
    subject: "turkey",
    window: "night_before",
    text: "Move the turkey to the fridge to thaw",
    source: "rule",
    dueOn: "2026-08-04",
    ...over,
  };
}

function meal(tasks: PrepTask[]): PrepMeal {
  return { recipeId: "r1", title: "Roast turkey", cookDate: "2026-08-05", tasks };
}

describe("RecipePrep", () => {
  // Block body, not a concise arrow: returning the mock from beforeEach makes
  // Vitest treat it as a teardown callback and *call* it after every test.
  beforeEach(() => {
    actionMock.mockReset();
  });

  // A recipe you are reading has no cook date, so the window is the only true
  // statement available — and a date here would be a fiction.
  it("shows the window rather than a date", async () => {
    actionMock.mockResolvedValue(meal([task()]));
    render(<RecipePrep recipeId="r1" />);

    await screen.findByText(/Move the turkey to the fridge/);
    screen.getByText(/The night before/);
    expect(screen.queryByText(/2026-08-04/)).toBeNull();
  });

  it("renders nothing when the recipe needs no prep", async () => {
    actionMock.mockResolvedValue(meal([]));
    const { container } = render(<RecipePrep recipeId="r1" />);

    await waitFor(() => expect(actionMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the recipe could not be read", async () => {
    actionMock.mockResolvedValue(null);
    const { container } = render(<RecipePrep recipeId="r1" />);

    await waitFor(() => expect(actionMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
