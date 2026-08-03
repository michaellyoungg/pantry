import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, Nav } from "./Nav";

async function renderNavAt(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Nav />
        <Outlet />
      </>
    ),
  });
  const routes = [
    "/",
    "/plan",
    "/recipes",
    "/recipes/catalog",
    "/list",
    "/pantry",
    "/history",
    "/settings",
  ].map((p) => createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null }));
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  // Sidebar landmark is present once the router resolves.
  return await screen.findByRole("navigation", { name: "Main" });
}

describe("Nav", () => {
  it("renders a sidebar link to every destination with the right href", async () => {
    const sidebar = await renderNavAt("/");
    for (const item of NAV_ITEMS) {
      const link = within(sidebar).getByRole("link", { name: item.label });
      expect(link.getAttribute("href")).toBe(item.to);
    }
    // Home · Plan · Recipes · List · Pantry · History (BL-0039) · Settings (BL-0038).
    expect(NAV_ITEMS).toHaveLength(7);
  });

  // Regression (BL-0005): /settings existed but nothing linked to it, so the
  // avoid list — the only "never suggest this" control — was reachable only by
  // typing the URL. BL-0038 since promoted Settings to a primary tab, which
  // satisfies this just as well; the assertion is on reachability, deliberately
  // not on which nav slot provides it.
  it("links to Settings from the sidebar", async () => {
    const sidebar = await renderNavAt("/");
    const settingsLink = within(sidebar).getByRole("link", { name: "Settings" });
    expect(settingsLink.getAttribute("href")).toBe("/settings");
  });

  it("marks only the Home link active on '/'", async () => {
    const sidebar = await renderNavAt("/");
    expect(within(sidebar).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      within(sidebar).getByRole("link", { name: "Plan" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("keeps Recipes active on a nested recipes route, not Home", async () => {
    const sidebar = await renderNavAt("/recipes/catalog");
    expect(
      within(sidebar).getByRole("link", { name: "Recipes" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(sidebar).getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBeNull();
  });
});
