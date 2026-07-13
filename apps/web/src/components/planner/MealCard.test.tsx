import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MealCard } from "./MealCard";

const entry = {
  _id: "e1",
  recipeId: "r1",
  title: "Tacos",
  plannedDate: "2026-07-14",
  servingsMultiplier: 1,
  type: "meal" as const,
};

describe("MealCard", () => {
  it("increments servings via the + control", () => {
    const onServings = vi.fn();
    render(
      <MealCard entry={entry} onServings={onServings} onToggleLeftover={vi.fn()} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /increase servings/i }));
    expect(onServings).toHaveBeenCalledWith("e1", 1.5);
  });

  it("does not go below 0.25 servings", () => {
    const onServings = vi.fn();
    render(
      <MealCard
        entry={{ ...entry, servingsMultiplier: 0.25 }}
        onServings={onServings}
        onToggleLeftover={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /decrease servings/i }));
    expect(onServings).toHaveBeenCalledWith("e1", 0.25);
  });

  it("toggles to leftover", () => {
    const onToggleLeftover = vi.fn();
    render(
      <MealCard entry={entry} onServings={vi.fn()} onToggleLeftover={onToggleLeftover} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /as leftover/i }));
    expect(onToggleLeftover).toHaveBeenCalledWith("e1", "leftover");
  });
});
