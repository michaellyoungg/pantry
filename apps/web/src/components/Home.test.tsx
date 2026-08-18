import type { PlannedItem } from "@pantry/core";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A list row as the server stores it; Home reads only `checked`/`removed`. */
type GroceryRow = { _id: string; item: string; checked: boolean; removed?: boolean };

// Home reads two queries, so the mock dispatches on which query ref was asked for.
// `basket`/`list` are mutable so each test can stage a different point in the loop.
const state = vi.hoisted(() => ({
  basket: undefined as PlannedItem[] | undefined,
  list: undefined as GroceryRow[] | undefined,
  pantry: [] as unknown[],
  generate: vi.fn(async () => ({ count: 3 })),
  recommend: vi.fn(async () => [] as unknown[]),
  addToBasket: vi.fn(async () => undefined),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name.startsWith("basket")) return state.basket;
      if (name.startsWith("pantry")) return state.pantry;
      return state.list;
    },
    useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref).startsWith("recommendations") ? state.recommend : state.generate,
    // UseItUp offers "Add to plan" on each suggestion (BL-0050), so Home now
    // pulls a mutation in through it.
    useMutation: () => state.addToBasket,
  };
});

// Derived prep (BL-0042) is a Convex action plus a mutation of its own and has
// its own test; stubbed here so its load doesn't land on this file's action
// dispatcher. This file is about the weekly-loop state machine.
vi.mock("./BeforeYouCook", () => ({ BeforeYouCook: () => null }));

const { Home } = await import("./Home");

async function renderHome() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Home />
        <Outlet />
      </>
    ),
  });
  const routes = ["/", "/plan", "/recipes", "/recipes/catalog", "/list", "/pantry"].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: /welcome to pantry/i });
  return router;
}

function meal(id: string, over: Partial<PlannedItem> = {}): PlannedItem {
  return { _id: id, recipeId: `r-${id}`, title: `Recipe ${id}`, ...over };
}

function line(id: string, checked: boolean): GroceryRow {
  return { _id: id, item: `item-${id}`, checked };
}

beforeEach(() => {
  state.basket = [];
  state.list = [];
  state.generate = vi.fn(async () => ({ count: 3 }));
  state.pantry = [];
  state.recommend = vi.fn(async () => []);
  state.addToBasket = vi.fn(async () => undefined);
});

describe("Home next action", () => {
  it("offers planning when nothing is planned", async () => {
    await renderHome();
    const cta = screen.getByRole("link", { name: /plan this week/i });
    expect(cta.getAttribute("href")).toBe("/plan");
  });

  it("offers building the list once the week has meals", async () => {
    state.basket = [meal("a"), meal("b")];
    await renderHome();
    expect(screen.getByRole("button", { name: /build grocery list \(2 meals\)/i })).toBeTruthy();
  });

  it("excludes leftovers from the meal count", async () => {
    state.basket = [meal("a"), meal("b", { type: "leftover" })];
    await renderHome();
    expect(screen.getByRole("button", { name: /build grocery list \(1 meal\)/i })).toBeTruthy();
  });

  it("hands off to shopping when a list exists", async () => {
    state.list = [line("1", true), line("2", false), line("3", false)];
    await renderHome();
    expect(screen.getByRole("heading", { name: /shopping day/i })).toBeTruthy();
    const cta = screen.getByRole("link", { name: /shop 2 items/i });
    expect(cta.getAttribute("href")).toBe("/list");
  });

  it("closes the loop once everything is checked off", async () => {
    state.list = [line("1", true)];
    await renderHome();
    const cta = screen.getByRole("link", { name: /plan next week/i });
    expect(cta.getAttribute("href")).toBe("/plan");
  });

  // Regression: nothing clears a fully-checked list, so "shopped" persists into the
  // next week's planning. If it only offered "Plan next week", the build action would
  // be unreachable from Home for the rest of the week.
  it("still offers to build a list while shopped with a planned week", async () => {
    state.basket = [meal("a"), meal("b")];
    state.list = [line("1", true)];
    const router = await renderHome();

    expect(screen.getByRole("heading", { name: /shopping done/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /rebuild grocery list \(2 meals\)/i }));

    expect(state.generate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/list"));
  });

  it("omits the rebuild action when shopped with nothing planned", async () => {
    state.basket = [];
    state.list = [line("1", true)];
    await renderHome();
    expect(screen.queryByRole("button", { name: /rebuild grocery list/i })).toBeNull();
  });

  it("shows a skeleton until the queries resolve", async () => {
    state.basket = undefined;
    state.list = undefined;
    await renderHome();
    const next = screen.getByLabelText("Next step");
    expect(next.getAttribute("aria-busy")).toBe("true");
  });
});

describe("Home build-list action", () => {
  it("generates the list and navigates to it", async () => {
    state.basket = [meal("a")];
    const router = await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /build grocery list/i }));
    expect(state.generate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/list"));
  });

  it("surfaces the error and stays put when generating fails", async () => {
    state.basket = [meal("a")];
    state.generate = vi.fn(async () => {
      throw new Error("recipe-service unreachable");
    });
    const router = await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /build grocery list/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("recipe-service unreachable");
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("Home week strip", () => {
  it("shows planned dinners on their day and an add affordance elsewhere", async () => {
    state.basket = [meal("a", { weekday: 0, title: "Chili" })];
    await renderHome();
    const monday = screen.getByRole("link", { name: /monday — chili/i });
    expect(monday.getAttribute("href")).toBe("/plan");
    expect(screen.getByRole("link", { name: /tuesday — nothing planned/i })).toBeTruthy();
  });

  it("marks leftover days as leftovers", async () => {
    state.basket = [meal("a", { weekday: 2, title: "Chili", type: "leftover" })];
    await renderHome();
    expect(screen.getByText(/chili \(leftovers\)/i)).toBeTruthy();
    // The aria-label replaces the cell's whole accessible name, so it has to carry
    // the leftover marker too — otherwise the day is indistinguishable by screen reader.
    expect(screen.getByRole("link", { name: /wednesday — chili \(leftovers\)/i })).toBeTruthy();
  });

  // Unscheduled rows appear in no day cell but still count toward "N meals ready",
  // so the strip has to account for them or the two contradict each other.
  it("accounts for meals that are not on a day yet", async () => {
    state.basket = [meal("a", { weekday: 0 }), meal("b"), meal("c")];
    await renderHome();
    const link = screen.getByRole("link", { name: /2 meals not on a day yet/i });
    expect(link.getAttribute("href")).toBe("/plan");
  });

  it("says nothing about unscheduled meals when every meal has a day", async () => {
    state.basket = [meal("a", { weekday: 0 })];
    await renderHome();
    expect(screen.queryByText(/not on a day yet/i)).toBeNull();
  });
});

describe("Home quick actions and onboarding", () => {
  it("links to the recipe, catalog and list surfaces", async () => {
    await renderHome();
    const expected: Array<[RegExp, string]> = [
      [/import a recipe/i, "/recipes"],
      [/browse catalog/i, "/recipes/catalog"],
      [/open grocery list/i, "/list"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });

  it("checks off the first step once the week is planned", async () => {
    state.basket = [meal("a")];
    await renderHome();
    expect(screen.getByText(/add meals to your week/i).className).toContain("line-through");
  });

  it("hides onboarding once shopping has started", async () => {
    state.list = [line("1", false)];
    await renderHome();
    expect(screen.queryByRole("heading", { name: /getting started/i })).toBeNull();
  });
});

describe("Home use-it-up nudge (BL-0029)", () => {
  it("surfaces the batch on the surface that answers 'what do I do now'", async () => {
    state.pantry = [
      {
        _id: "p1",
        display: "Spinach",
        canonicalItem: "spinach",
        state: "have",
        useBy: Date.now() + 2 * 86_400_000,
      },
    ];
    await renderHome();
    expect(screen.getByText(/1 item to use this week/i)).toBeTruthy();
  });

  it("stays out of the way when nothing is expiring", async () => {
    await renderHome();
    expect(screen.queryByText(/to use this week/i)).toBeNull();
  });
});
