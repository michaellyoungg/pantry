import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Home } from "./Home";

async function renderHome() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Home />
        <Outlet />
      </>
    ),
  });
  const routes = ["/", "/plan", "/recipes", "/list", "/pantry"].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: /welcome to pantry/i });
}

describe("Home", () => {
  it("links to each core section", async () => {
    await renderHome();
    const expected: Array<[RegExp, string]> = [
      [/plan this week/i, "/plan"],
      [/add recipes/i, "/recipes"],
      [/grocery list/i, "/list"],
      [/pantry/i, "/pantry"],
    ];
    for (const [name, href] of expected) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
    }
  });
});
