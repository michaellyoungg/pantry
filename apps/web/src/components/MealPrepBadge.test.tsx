import type { PrepMeal, PrepTask } from "@pantry/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stateKey } from "../lib/prep";
import { MealPrepBadge } from "./MealPrepBadge";

function task(over: Partial<PrepTask> = {}): PrepTask {
  return {
    key: "thaw_frozen_protein:turkey",
    ruleId: "thaw_frozen_protein",
    subject: "turkey",
    window: "night_before",
    text: "Move the turkey to the fridge to thaw",
    source: "rule",
    dueOn: "2026-08-05",
    ...over,
  };
}

function meal(tasks: PrepTask[]): PrepMeal {
  return { recipeId: "r1", title: "Roast turkey", cookDate: "2026-08-06", tasks };
}

describe("MealPrepBadge", () => {
  it("names the earliest window so scheduling can account for it", () => {
    render(<MealPrepBadge meal={meal([task({ window: "three_days_before" })])} done={new Set()} />);
    screen.getByText(/three days before/i);
  });

  it("counts outstanding prep", () => {
    render(
      <MealPrepBadge
        meal={meal([task({ key: "a" }), task({ key: "b", window: "hour_before" })])}
        done={new Set()}
      />,
    );
    screen.getByText(/2 prep/);
  });

  // Preheating the oven is cooking, not planning. Badging every baked dish
  // would make the badge mean nothing.
  it("ignores at_start tasks", () => {
    const { container } = render(
      <MealPrepBadge meal={meal([task({ window: "at_start" })])} done={new Set()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a meal with no prep at all", () => {
    const { container } = render(<MealPrepBadge meal={meal([])} done={new Set()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing before the prep data has loaded", () => {
    const { container } = render(<MealPrepBadge done={new Set()} />);
    expect(container.innerHTML).toBe("");
  });

  it("reports done once every lead-time task is ticked", () => {
    const m = meal([task()]);
    render(<MealPrepBadge meal={m} done={new Set([stateKey(m.tasks[0].key, m.cookDate)])} />);
    screen.getByText(/prep done/);
  });

  // A tick belongs to one cook date; the same meal next week is still pending.
  it("ignores a tick recorded against another date", () => {
    const m = meal([task()]);
    render(<MealPrepBadge meal={m} done={new Set([stateKey(m.tasks[0].key, "2026-08-13")])} />);
    screen.getByText(/prep:/);
  });
});
