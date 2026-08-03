import type { PrepMeal, PrepTask, PrepTasksResponse } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock, mutationMock, states } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  mutationMock: vi.fn(),
  states: { rows: [] as Array<{ taskKey: string; cookDate: string; done: boolean }> },
}));

// Mocked at the convex/react boundary, like the other card tests: what is under
// test is which tasks reach the screen and what ticking one sends, not the
// transport or the derivation (that is covered in Go).
vi.mock("convex/react", () => ({
  useAction: () => actionMock,
  useMutation: () => mutationMock,
  useQuery: () => states.rows,
}));

import { BeforeYouCook } from "./BeforeYouCook";

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

function meal(over: Partial<PrepMeal> = {}): PrepMeal {
  return {
    recipeId: "r1",
    title: "Roast turkey",
    cookDate: "2026-08-06",
    tasks: [task()],
    ...over,
  };
}

function reply(meals: PrepMeal[]): PrepTasksResponse {
  return { rulesVersion: "test.1", meals };
}

describe("BeforeYouCook", () => {
  // Block body, not a concise arrow: returning the mock from beforeEach makes
  // Vitest treat it as a teardown callback and *call* it after every test.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 5, 9, 0)); // Wed 5 Aug 2026, local
    actionMock.mockReset();
    mutationMock.mockReset();
    mutationMock.mockResolvedValue(undefined);
    states.rows = [];
  });

  it("lists what is due today, named against its meal", async () => {
    actionMock.mockResolvedValue(reply([meal()]));
    render(<BeforeYouCook />);

    // getBy* throws when absent, which is the assertion — this repo does not
    // load jest-dom matchers.
    await screen.findByText(/1 thing to do before you cook/);
    screen.getByText(/Move the turkey to the fridge/);
    screen.getByText(/for Roast turkey/);
  });

  // The planner stores only a weekday, so the card has to resolve it against
  // the week it is showing before anything can be "due".
  it("asks for this week and this local date", async () => {
    actionMock.mockResolvedValue(reply([]));
    render(<BeforeYouCook />);

    await waitFor(() => expect(actionMock).toHaveBeenCalled());
    expect(actionMock.mock.calls[0][0]).toMatchObject({
      weekStart: "2026-08-03",
      today: "2026-08-05",
    });
  });

  it("renders nothing when nothing is due", async () => {
    actionMock.mockResolvedValue(reply([meal({ tasks: [task({ dueOn: "2026-08-09" })] })]));
    const { container } = render(<BeforeYouCook />);

    await waitFor(() => expect(actionMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  // The whole reason the feature exists: a passed window is called out, not
  // quietly dropped.
  it("shows a missed task as overdue", async () => {
    actionMock.mockResolvedValue(
      reply([meal({ tasks: [task({ dueOn: "2026-08-02", missed: true })] })]),
    );
    render(<BeforeYouCook />);

    await screen.findByText(/was due /);
  });

  it("ticking a task records it against the meal's cook date", async () => {
    actionMock.mockResolvedValue(reply([meal()]));
    render(<BeforeYouCook />);

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Move the turkey to the fridge to thaw for Roast turkey",
      }),
    );

    expect(mutationMock).toHaveBeenCalledWith({
      taskKey: "thaw_frozen_protein:turkey",
      cookDate: "2026-08-06",
      done: true,
    });
  });

  // Hiding the card the instant the last box is ticked would take the undo away
  // with it — and the list is what the user just interacted with. It stays,
  // reporting closure, and disappears tomorrow when nothing is due any more.
  it("stays visible with everything ticked, so a mis-tick can be undone", async () => {
    states.rows = [{ taskKey: "thaw_frozen_protein:turkey", cookDate: "2026-08-06", done: true }];
    actionMock.mockResolvedValue(reply([meal()]));
    render(<BeforeYouCook />);

    await screen.findByText(/Prep for today is done/);
    const box = (await screen.findByRole("checkbox", {
      name: "Move the turkey to the fridge to thaw for Roast turkey",
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(mutationMock).toHaveBeenCalledWith({
      taskKey: "thaw_frozen_protein:turkey",
      cookDate: "2026-08-06",
      done: false,
    });
  });

  it("a tick for a different week does not check this week's box", async () => {
    states.rows = [{ taskKey: "thaw_frozen_protein:turkey", cookDate: "2026-08-13", done: true }];
    actionMock.mockResolvedValue(reply([meal()]));
    render(<BeforeYouCook />);

    const box = (await screen.findByRole("checkbox", {
      name: "Move the turkey to the fridge to thaw for Roast turkey",
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });
});
