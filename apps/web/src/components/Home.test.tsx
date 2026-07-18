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
import type { BasketRow, GroceryRow } from "../lib/homeState";

// Home reads two queries, so the mock dispatches on which query ref was asked for.
// `basket`/`list` are mutable so each test can stage a different point in the loop.
const state = vi.hoisted(() => ({
  basket: undefined as BasketRow[] | undefined,
  list: undefined as GroceryRow[] | undefined,
  generate: vi.fn(async () => ({ count: 3 })),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref).startsWith("basket") ? state.basket : state.list,
    useAction: () => state.generate,
  };
});

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

function meal(id: string, over: Partial<BasketRow> = {}): BasketRow {
  return { _id: id, recipeId: `r-${id}`, title: `Recipe ${id}`, ...over };
}

function line(id: string, checked: boolean): GroceryRow {
  return { _id: id, item: `item-${id}`, checked };
}

beforeEach(() => {
  state.basket = [];
  state.list = [];
  state.generate = vi.fn(async () => ({ count: 3 }));
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

  // A finished list is never cleared automatically, so without a rebuild affordance
  // Home would dead-end on "Shopping done" for every following week.
  it("still offers a rebuild when the plan holds meals after shopping", async () => {
    state.basket = [meal("a")];
    state.list = [line("1", true)];
    const router = await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /rebuild grocery list/i }));
    expect(state.generate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/list"));
  });

  it("omits the rebuild button when nothing is planned", async () => {
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

  it("surfaces meals that aren't on a day yet", async () => {
    state.basket = [meal("a", { title: "Chili" }), meal("b", { weekday: 0 })];
    await renderHome();
    expect(screen.getByRole("link", { name: /1 meal not on a day yet: chili/i })).toBeTruthy();
  });

  it("marks leftover days as leftovers", async () => {
    state.basket = [meal("a", { weekday: 2, title: "Chili", type: "leftover" })];
    await renderHome();
    expect(screen.getByText(/chili \(leftovers\)/i)).toBeTruthy();
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
