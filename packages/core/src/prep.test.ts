import type { PrepMeal, PrepTask } from "@pantry/types";
import { describe, expect, it } from "vitest";
import {
  doneSet,
  dueByToday,
  formatDueOn,
  hasLeadTime,
  PREP_WINDOW_LABELS,
  prepPlanSignature,
  stateKey,
} from "./prep";

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

function meal(over: Partial<PrepMeal> = {}): PrepMeal {
  return {
    recipeId: "r1",
    title: "Roast turkey",
    cookDate: "2026-08-05",
    tasks: [task()],
    ...over,
  };
}

describe("dueByToday", () => {
  it("includes today and everything overdue", () => {
    const meals = [
      meal({ tasks: [task({ key: "a", dueOn: "2026-08-05" })] }),
      meal({ recipeId: "r2", tasks: [task({ key: "b", dueOn: "2026-08-03", missed: true })] }),
    ];
    expect(dueByToday(meals, "2026-08-05").map((d) => d.task.key)).toEqual(["b", "a"]);
  });

  it("excludes prep that is not actionable yet", () => {
    const meals = [meal({ tasks: [task({ dueOn: "2026-08-09" })] })];
    expect(dueByToday(meals, "2026-08-05")).toEqual([]);
  });

  // The core promise of the feature. A window that has passed must surface as
  // late, never disappear — finding out at dinner time is the failure mode.
  it("never drops a missed task", () => {
    const meals = [meal({ tasks: [task({ dueOn: "2026-07-01", missed: true })] })];
    const got = dueByToday(meals, "2026-08-05");
    expect(got).toHaveLength(1);
    expect(got[0].task.missed).toBe(true);
  });

  it("carries the meal a task belongs to", () => {
    const got = dueByToday([meal({ tasks: [task({ dueOn: "2026-08-05" })] })], "2026-08-05");
    expect(got[0]).toMatchObject({ recipeId: "r1", title: "Roast turkey", cookDate: "2026-08-05" });
  });
});

describe("hasLeadTime", () => {
  it("excludes at_start, which is cooking rather than planning", () => {
    expect(hasLeadTime(task({ window: "at_start" }))).toBe(false);
  });

  it.each(["three_days_before", "night_before", "hour_before"] as const)(
    "includes %s",
    (window) => {
      expect(hasLeadTime(task({ window }))).toBe(true);
    },
  );
});

describe("doneSet", () => {
  it("scopes a tick to its cook date", () => {
    const done = doneSet([
      { taskKey: "a", cookDate: "2026-08-05", done: true },
      { taskKey: "a", cookDate: "2026-08-12", done: false },
    ]);
    expect(done.has(stateKey("a", "2026-08-05"))).toBe(true);
    expect(done.has(stateKey("a", "2026-08-12"))).toBe(false);
  });
});

describe("formatDueOn", () => {
  it("says today for today", () => {
    expect(formatDueOn("2026-08-05", "2026-08-05")).toBe("today");
  });

  it("marks a past date as overdue", () => {
    expect(formatDueOn("2026-08-03", "2026-08-05")).toMatch(/^was due /);
  });

  it("names an upcoming date without the overdue prefix", () => {
    expect(formatDueOn("2026-08-07", "2026-08-05")).not.toMatch(/was due/);
  });
});

describe("PREP_WINDOW_LABELS", () => {
  // A missing label renders the raw enum value at the user; every window the
  // service can emit must have one.
  it("labels every window", () => {
    for (const window of [
      "three_days_before",
      "two_days_before",
      "night_before",
      "morning_of",
      "hour_before",
      "at_start",
    ] as const) {
      expect(PREP_WINDOW_LABELS[window]).toBeTruthy();
    }
  });
});

describe("prepPlanSignature", () => {
  // Without this the surfaces derive once on mount and then lie: scheduling a
  // frozen roast would show no lead time until a reload, which is exactly the
  // moment the user needed telling.
  it("changes when a meal is scheduled", () => {
    const before = prepPlanSignature([{ recipeId: "r1" }]);
    const after = prepPlanSignature([{ recipeId: "r1", weekday: 3 }]);
    expect(before).not.toBe(after);
  });

  it("changes when a meal moves to another day", () => {
    expect(prepPlanSignature([{ recipeId: "r1", weekday: 3 }])).not.toBe(
      prepPlanSignature([{ recipeId: "r1", weekday: 4 }]),
    );
  });

  it("changes when a meal becomes leftovers, which are not derived", () => {
    expect(prepPlanSignature([{ recipeId: "r1", weekday: 3 }])).not.toBe(
      prepPlanSignature([{ recipeId: "r1", weekday: 3, type: "leftover" }]),
    );
  });

  // A double batch thaws the same chicken — re-deriving for it would be a
  // network round trip that cannot change the answer.
  it("is stable across re-renders and row order", () => {
    const a = prepPlanSignature([
      { recipeId: "r1", weekday: 3 },
      { recipeId: "r2", weekday: 0 },
    ]);
    const b = prepPlanSignature([
      { recipeId: "r2", weekday: 0 },
      { recipeId: "r1", weekday: 3 },
    ]);
    expect(a).toBe(b);
  });
});
