import type { PrepMeal, PrepTask, PrepTasksResponse } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * `convex/react` is mocked; `usePlanPrep()` is not — the card is presentation
 * over the shared hook, and what is worth proving here is that the real
 * derivation reaches the screen and that a tap records the right tick.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockState = {
  plan: [] as unknown[],
  states: [] as Array<{ taskKey: string; cookDate: string; done: boolean }>,
};
const mockDerive = jest.fn(async () => ({ rulesVersion: "test.1", meals: [] }) as unknown);
const mockSetDone = jest.fn(async () => undefined);

jest.mock("convex/react", () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: (ref: never) =>
      getFunctionName(ref).startsWith("basket") ? mockState.plan : mockState.states,
    useAction: () => mockDerive,
    // The tick is optimistic, so the mock must be callable AND carry
    // .withOptimisticUpdate or the hook throws on render.
    useMutation: () => Object.assign(mockSetDone, { withOptimisticUpdate: () => mockSetDone }),
  };
});

import { stateKey } from "@pantry/core";
import { BeforeYouCook } from "./BeforeYouCook";

function task(over: Partial<PrepTask> = {}): PrepTask {
  return {
    key: "thaw_frozen_protein:turkey",
    ruleId: "thaw_frozen_protein",
    subject: "turkey",
    window: "night_before",
    text: "Move the turkey to the fridge to thaw",
    source: "rule",
    dueOn: today(),
    ...over,
  };
}

function meal(over: Partial<PrepMeal> = {}): PrepMeal {
  return {
    recipeId: "r1",
    title: "Roast turkey",
    cookDate: tomorrow(),
    tasks: [task()],
    ...over,
  };
}

function reply(meals: PrepMeal[]): () => Promise<PrepTasksResponse> {
  return async () => ({ rulesVersion: "test.1", meals });
}

/**
 * Dates are computed from the real clock rather than frozen. The hook reads the
 * user's local today itself — that is the whole point of it doing the date
 * arithmetic client-side — so a fixed date here would only be due for one day.
 */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const today = () => isoDaysFromNow(0);
const tomorrow = () => isoDaysFromNow(1);

/** The testID key the card slugs a task's identity into. */
const SLUG = "thaw-frozen-protein-turkey";

beforeEach(() => {
  jest.clearAllMocks();
  mockState.plan = [];
  mockState.states = [];
  mockDerive.mockImplementation(reply([meal()]));
});

describe("the before-you-cook card", () => {
  it("lists what is due today, named against the meal it is for", async () => {
    await render(<BeforeYouCook />);

    expect(await screen.findByTestId("home.before-you-cook-heading")).toHaveTextContent(
      "1 thing to do before you cook",
    );
    expect(screen.getByTestId(`home.prep-task-text.${SLUG}-${tomorrow()}`)).toHaveTextContent(
      "Move the turkey to the fridge to thaw",
    );
    // Regex, not a string: RNTL compares a string EXACTLY, so a literal would
    // assert on the whole row rather than on the meal it names.
    expect(screen.getByTestId(`home.prep-task.${SLUG}-${tomorrow()}`)).toHaveTextContent(
      /for Roast turkey/,
    );
  });

  // Home offers one next action; an empty prep card would compete with it for
  // no reason.
  it("renders nothing at all when nothing is due yet", async () => {
    mockDerive.mockImplementation(reply([meal({ tasks: [task({ dueOn: isoDaysFromNow(4) })] })]));

    await render(<BeforeYouCook />);

    await waitFor(() => expect(mockDerive).toHaveBeenCalled());
    expect(screen.queryByTestId("home.before-you-cook")).toBeNull();
  });

  // The core promise of the feature: a window that has passed is called out,
  // never quietly dropped. Finding out at dinner time is the failure it exists
  // to prevent.
  it("calls out a missed task rather than hiding it", async () => {
    mockDerive.mockImplementation(
      reply([meal({ tasks: [task({ dueOn: isoDaysFromNow(-2), missed: true })] })]),
    );

    await render(<BeforeYouCook />);

    const due = await screen.findByTestId(`home.prep-due.${SLUG}-${tomorrow()}`);
    expect(due).toHaveTextContent(/was due/);
    expect(due.props.className).toContain("text-danger");
  });

  it("records a tick against the meal's cook date, not against today", async () => {
    await render(<BeforeYouCook />);

    await fireEvent.press(await screen.findByTestId(`home.prep-task.${SLUG}-${tomorrow()}`));

    await waitFor(() =>
      expect(mockSetDone).toHaveBeenCalledWith({
        taskKey: "thaw_frozen_protein:turkey",
        cookDate: tomorrow(),
        done: true,
      }),
    );
  });

  // Hiding the card the instant the last box is ticked would take the undo away
  // with it — and the list is what the user just interacted with.
  it("stays visible with everything ticked, so a mis-tick can be undone", async () => {
    mockState.states = [
      { taskKey: "thaw_frozen_protein:turkey", cookDate: tomorrow(), done: true },
    ];

    await render(<BeforeYouCook />);

    expect(await screen.findByTestId("home.before-you-cook-heading")).toHaveTextContent(
      "Prep for today is done",
    );
    const row = screen.getByTestId(`home.prep-task.${SLUG}-${tomorrow()}`);
    expect(row.props.accessibilityState).toMatchObject({ checked: true });

    await fireEvent.press(row);

    await waitFor(() =>
      expect(mockSetDone).toHaveBeenCalledWith({
        taskKey: "thaw_frozen_protein:turkey",
        cookDate: tomorrow(),
        done: false,
      }),
    );
  });

  it("does not tick this week's box from another week's state", async () => {
    mockState.states = [
      { taskKey: "thaw_frozen_protein:turkey", cookDate: isoDaysFromNow(8), done: true },
    ];

    await render(<BeforeYouCook />);

    const row = await screen.findByTestId(`home.prep-task.${SLUG}-${tomorrow()}`);
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
  });

  // BL-0044: a rule's guess and a task the cook wrote are trusted differently,
  // and only the labelled one reads as something you are invited to override.
  it("labels where a task came from", async () => {
    await render(<BeforeYouCook />);

    expect(await screen.findByTestId(`home.prep-source.${SLUG}-${tomorrow()}`)).toHaveTextContent(
      "auto",
    );
  });

  it("surfaces a failed tick instead of silently reverting the row", async () => {
    mockSetDone.mockRejectedValueOnce(new Error("offline") as never);

    await render(<BeforeYouCook />);
    await fireEvent.press(await screen.findByTestId(`home.prep-task.${SLUG}-${tomorrow()}`));

    expect(await screen.findByTestId("home.prep-error")).toHaveTextContent("offline");
  });

  it("keys a tick on the task AND the date it is for", async () => {
    // Guards the id scheme the assertions above lean on: the same task for next
    // week's dinner is a different tick and must not share a row.
    expect(stateKey("a", "2026-08-06")).not.toBe(stateKey("a", "2026-08-13"));
    await render(<BeforeYouCook />);
    await waitFor(() => expect(mockDerive).toHaveBeenCalled());
  });
});
