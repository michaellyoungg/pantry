# App IA + Responsive Navigation Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single-page web app into five file-based routes (Home · Plan · Recipes · List · Pantry) behind a responsive navigation shell (sidebar on desktop, bottom tab bar on phone).

**Architecture:** TanStack Router file-based routes under `apps/web/src/routes/`. A new `Nav` component renders the same five destinations twice — a labelled sidebar (`≥sm`, labels at `≥lg`) and a fixed bottom tab bar (`<sm`) — visibility controlled purely by Tailwind responsive classes (no JS breakpoint hook). The existing feature components move into route wrappers unchanged; a new presentational `Home` landing replaces the old grid. The rich state-aware Home dashboard is a separate item (BL-0017) and is out of scope here.

**Tech Stack:** React 19, TanStack Router (`autoCodeSplitting`), Tailwind CSS v4 (`@theme` tokens in `src/index.css`), Vitest + @testing-library/react (jsdom). No jest-dom. Emoji icons (no new dependency).

## Global Constraints

- **No new dependencies.** Icons are emoji, consistent with the existing 🥕 brand mark.
- **Five destinations, exact routes:** `/` (Home), `/plan` (Plan), `/recipes` + `/recipes/` + `/recipes/catalog` (Recipes), `/list` (List), `/pantry` (Pantry). Settings/account actions stay in the header (Sign out), **never** a tab; no `/settings` route in this plan.
- **Regenerate the route tree** after adding/removing any route file: `pnpm --filter @pantry/web exec tsr generate` (local, no backend needed). Commit the updated `src/routeTree.gen.ts`.
- **Test command:** `pnpm --filter @pantry/web test` (all) or `pnpm --filter @pantry/web exec vitest run <file>` (one). Tests mock `convex/react`; they do **not** need the Convex backend.
- **Styling tokens** (from `src/index.css`): `bg`, `surface`, `border`, `primary`, `primary-hover`, `danger`, `danger-hover`, `text`, `muted`. Use `text-muted`, `text-text`, `bg-surface`, `border-border`, `text-primary`, `bg-primary/10`, etc. Do not hard-code hex.
- **Assertions:** jest-dom is NOT installed. Use `el.getAttribute(...)`, `el.textContent`, `toBeNull()`, `toHaveLength()` — never `toBeInTheDocument`/`toHaveAttribute`.
- **Existing component contracts (unchanged):** `RecipeForm({ onCreated: () => void })`, `RecipeList({ refreshKey: number })`, `Catalog()`, `Basket()`, `GroceryList()`.

---

### Task 1: `Nav` responsive navigation component

**Files:**
- Create: `apps/web/src/components/Nav.tsx`
- Test: `apps/web/src/components/Nav.test.tsx`

**Interfaces:**
- Consumes: `Link` from `@tanstack/react-router`.
- Produces: `export const NAV_ITEMS: { to: string; label: string; icon: string }[]` and `export function Nav(): JSX.Element` — renders two `<nav>` landmarks: `aria-label="Main"` (sidebar) and `aria-label="Mobile"` (bottom bar), each containing a `<Link>` per NAV_ITEM. Active link gets `aria-current="page"` and `data-active="true"`; the Home (`/`) link matches exactly, the others match by prefix (so `/recipes` stays active on `/recipes/catalog`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/Nav.test.tsx
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
  const routes = ["/", "/plan", "/recipes", "/recipes/catalog", "/list", "/pantry"].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null }),
  );
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
    expect(NAV_ITEMS).toHaveLength(5);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pantry/web exec vitest run src/components/Nav.test.tsx`
Expected: FAIL — cannot resolve `./Nav` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

```tsx
// apps/web/src/components/Nav.tsx
import { Link } from "@tanstack/react-router";

type NavItem = { to: string; label: string; icon: string };

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: "🏠" },
  { to: "/plan", label: "Plan", icon: "🗓️" },
  { to: "/recipes", label: "Recipes", icon: "📖" },
  { to: "/list", label: "List", icon: "🛒" },
  { to: "/pantry", label: "Pantry", icon: "🥫" },
];

function NavLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const base =
    variant === "sidebar"
      ? "flex items-center gap-3 rounded-lg px-3 py-2 text-muted hover:bg-border/40 hover:text-text data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
      : "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted data-[active=true]:text-primary";
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.to === "/" }}
          activeProps={{ "aria-current": "page", "data-active": "true" }}
          className={base}
        >
          <span className="text-xl" aria-hidden>
            {item.icon}
          </span>
          <span className={variant === "sidebar" ? "hidden lg:inline" : ""}>{item.label}</span>
        </Link>
      ))}
    </>
  );
}

export function Nav() {
  return (
    <>
      <nav
        aria-label="Main"
        className="hidden shrink-0 flex-col gap-1 border-r border-border bg-surface p-2 sm:flex sm:w-16 lg:w-56"
      >
        <NavLinks variant="sidebar" />
      </nav>
      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface sm:hidden"
      >
        <NavLinks variant="bottom" />
      </nav>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pantry/web exec vitest run src/components/Nav.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Nav.tsx apps/web/src/components/Nav.test.tsx
git commit -m "feat(web): responsive Nav shell component (sidebar + bottom tabs)"
```

---

### Task 2: `Home` landing component

**Files:**
- Create: `apps/web/src/components/Home.tsx`
- Test: `apps/web/src/components/Home.test.tsx`

**Interfaces:**
- Consumes: `Link` from `@tanstack/react-router`, `Card` from `./ui/Card`.
- Produces: `export function Home(): JSX.Element` — a heading plus one linked `Card` quick-action per destination (`/plan`, `/recipes`, `/list`, `/pantry`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/Home.test.tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pantry/web exec vitest run src/components/Home.test.tsx`
Expected: FAIL — cannot resolve `./Home`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// apps/web/src/components/Home.tsx
import { Link } from "@tanstack/react-router";
import { Card } from "./ui/Card";

const ACTIONS = [
  { to: "/plan", label: "Plan this week", desc: "Choose recipes and lay out your week." },
  { to: "/recipes", label: "Add recipes", desc: "Import or browse recipes to cook." },
  { to: "/list", label: "Grocery list", desc: "Your one aggregated shopping list." },
  { to: "/pantry", label: "Pantry", desc: "Track what you already have on hand." },
] as const;

export function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-text">Welcome to Pantry</h2>
        <p className="mt-1 text-muted">Plan meals, build one grocery list, shop, and cook.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="block rounded-xl">
            <Card title={a.label}>
              <p className="text-sm text-muted">{a.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pantry/web exec vitest run src/components/Home.test.tsx`
Expected: PASS (1 test). (The `/pantry` name regex also matches nothing else here; the four links are distinct.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Home.tsx apps/web/src/components/Home.test.tsx
git commit -m "feat(web): Home landing with quick-action links"
```

---

### Task 3: Section routes + regenerate route tree + coverage config

**Files:**
- Modify: `apps/web/src/routes/index.tsx` (replace the old grid with `<Home />`)
- Create: `apps/web/src/routes/plan.tsx`
- Create: `apps/web/src/routes/list.tsx`
- Create: `apps/web/src/routes/pantry.tsx`
- Create: `apps/web/src/routes/recipes.tsx` (layout with sub-nav + `<Outlet />`)
- Create: `apps/web/src/routes/recipes.index.tsx` (RecipeForm + RecipeList)
- Create: `apps/web/src/routes/recipes.catalog.tsx` (Catalog)
- Modify: `apps/web/vite.config.ts` (add `src/routes/**` to coverage `exclude`)
- Regenerate: `apps/web/src/routeTree.gen.ts` (via `tsr generate`)

**Interfaces:**
- Consumes: `Home` (Task 2); existing `Basket`, `GroceryList`, `Catalog`, `RecipeForm`, `RecipeList`, `Card`.
- Produces: the five route modules, each exporting `Route = createFileRoute("<path>")({ component })`. Route wrappers are thin composition (excluded from coverage), so their behavior is covered by the child components' existing tests plus `tsr generate` + the dev smoke in Task 5.

- [ ] **Step 1: Replace the Home route**

```tsx
// apps/web/src/routes/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { Home } from "../components/Home";

export const Route = createFileRoute("/")({ component: Home });
```

- [ ] **Step 2: Create the Plan route**

```tsx
// apps/web/src/routes/plan.tsx
import { createFileRoute } from "@tanstack/react-router";
import { Basket } from "../components/Basket";

function PlanPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Plan</h2>
      <Basket />
    </div>
  );
}

export const Route = createFileRoute("/plan")({ component: PlanPage });
```

- [ ] **Step 3: Create the List route**

```tsx
// apps/web/src/routes/list.tsx
import { createFileRoute } from "@tanstack/react-router";
import { GroceryList } from "../components/GroceryList";

function ListPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Grocery list</h2>
      <GroceryList />
    </div>
  );
}

export const Route = createFileRoute("/list")({ component: ListPage });
```

- [ ] **Step 4: Create the Pantry placeholder route**

```tsx
// apps/web/src/routes/pantry.tsx
import { createFileRoute } from "@tanstack/react-router";
import { Card } from "../components/ui/Card";

function PantryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Pantry</h2>
      <Card title="Coming soon">
        <p className="text-sm text-muted">
          Track staples you always have and cook from what's on hand — so you don't rebuy things
          you already own. This is on the way.
        </p>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/pantry")({ component: PantryPage });
```

- [ ] **Step 5: Create the Recipes layout (sub-nav + Outlet)**

```tsx
// apps/web/src/routes/recipes.tsx
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

const tab =
  "rounded-lg px-3 py-1.5 text-sm text-muted hover:text-text data-[active=true]:bg-primary/10 data-[active=true]:text-primary";

function RecipesLayout() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Recipes</h2>
      <nav aria-label="Recipes" className="flex gap-2">
        <Link to="/recipes" activeOptions={{ exact: true }} activeProps={{ "data-active": "true" }} className={tab}>
          My recipes
        </Link>
        <Link to="/recipes/catalog" activeProps={{ "data-active": "true" }} className={tab}>
          Browse catalog
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute("/recipes")({ component: RecipesLayout });
```

- [ ] **Step 6: Create the Recipes index (my recipes)**

```tsx
// apps/web/src/routes/recipes.index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RecipeForm } from "../components/RecipeForm";
import { RecipeList } from "../components/RecipeList";

function MyRecipes() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
      <RecipeList refreshKey={refreshKey} />
    </div>
  );
}

export const Route = createFileRoute("/recipes/")({ component: MyRecipes });
```

- [ ] **Step 7: Create the Catalog route**

```tsx
// apps/web/src/routes/recipes.catalog.tsx
import { createFileRoute } from "@tanstack/react-router";
import { Catalog } from "../components/Catalog";

function CatalogPage() {
  return <Catalog />;
}

export const Route = createFileRoute("/recipes/catalog")({ component: CatalogPage });
```

- [ ] **Step 8: Exclude route wrappers from coverage**

In `apps/web/vite.config.ts`, add `"src/routes/**"` to the `test.coverage.exclude` array (alongside `src/main.tsx` and `src/routeTree.gen.ts`):

```ts
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/routes/**",
        "src/routeTree.gen.ts",
      ],
```

- [ ] **Step 9: Regenerate the route tree**

Run: `pnpm --filter @pantry/web exec tsr generate`
Expected: exits 0 and updates `apps/web/src/routeTree.gen.ts` to include `/`, `/plan`, `/list`, `/pantry`, `/recipes`, `/recipes/`, `/recipes/catalog`.

- [ ] **Step 10: Run the full web test suite**

Run: `pnpm --filter @pantry/web test`
Expected: PASS — all pre-existing component/lib tests plus Nav and Home. (Route wrappers have no tests but are excluded from coverage, so thresholds hold.)

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/routes apps/web/src/routeTree.gen.ts apps/web/vite.config.ts
git commit -m "feat(web): split app into Home/Plan/Recipes/List/Pantry routes"
```

---

### Task 4: Wire `Nav` + responsive layout into the root

**Files:**
- Modify: `apps/web/src/routes/__root.tsx`

**Interfaces:**
- Consumes: `Nav` (Task 1); existing `Authenticated`/`Unauthenticated` (`convex/react`), `AuthForm`, `useAuthActions`.
- Produces: the authenticated layout — header (brand + Sign out) above a flex row of the `Nav` sidebar and a scrollable `<main>` with bottom padding on phone (`pb-24 sm:pb-8`) so content clears the fixed bottom tab bar. Unauthenticated view (AuthForm) unchanged.

- [ ] **Step 1: Replace the root layout**

```tsx
// apps/web/src/routes/__root.tsx
import { useAuthActions } from "@convex-dev/auth/react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Authenticated, Unauthenticated } from "convex/react";
import { AuthForm } from "../components/AuthForm";
import { Nav } from "../components/Nav";
import { Button } from "../components/ui/Button";

function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <Button variant="ghost" size="sm" onClick={() => signOut()} className="ml-auto">
      Sign out
    </Button>
  );
}

function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4">
          <span className="text-2xl" aria-hidden>
            🥕
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-text">Pantry</h1>
          <Authenticated>
            <SignOutButton />
          </Authenticated>
        </div>
      </header>
      <Unauthenticated>
        <main className="mx-auto max-w-5xl px-6 py-8">
          <div className="mx-auto max-w-sm">
            <AuthForm />
          </div>
        </main>
      </Unauthenticated>
      <Authenticated>
        <div className="mx-auto flex max-w-6xl">
          <Nav />
          <main className="min-w-0 flex-1 px-6 py-8 pb-24 sm:pb-8">
            <Outlet />
          </main>
        </div>
      </Authenticated>
      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
```

- [ ] **Step 2: Run the full web test suite (no regressions)**

Run: `pnpm --filter @pantry/web test`
Expected: PASS — unchanged from Task 3. (`__root.tsx` is a route wrapper, excluded from coverage; no unit test.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/__root.tsx
git commit -m "feat(web): render responsive nav shell in root layout"
```

---

### Task 5: End-to-end verification + final commit

**Files:** none (verification only).

- [ ] **Step 1: Regenerate + full test + lint**

Run: `pnpm --filter @pantry/web exec tsr generate && pnpm --filter @pantry/web test`
Expected: route tree regenerates cleanly (no diff if Task 3 committed it) and all tests pass.

Run (repo lint, if the biome task is wired): `pnpm biome check apps/web/src` (or `pnpm lint`).
Expected: no errors on the new files.

- [ ] **Step 2: Drive the app (verify skill)**

Use the `verify` skill (or `run` skill) to launch the web app against the running stack and click through: Home → Plan → Recipes → Browse catalog → List → Pantry. Confirm:
- The sidebar shows on a wide viewport with labels; narrowing to a phone width swaps to the bottom tab bar.
- The active destination is highlighted (`aria-current="page"`), and `/recipes/catalog` keeps **Recipes** highlighted.
- Each page renders its moved component (Basket on Plan, GroceryList on List, RecipeForm+RecipeList on Recipes, Catalog on Browse catalog) and Sign out still works.

If the Convex backend is not running, note that the pages render but data is empty; the routing/nav behavior is still verifiable.

- [ ] **Step 3: Final commit (only if verification prompted fixes)**

```bash
git add -A
git commit -m "test(web): verify IA + responsive nav end-to-end"
```

---

## Self-Review

**Spec coverage (BL-0016):**
- Split `index.tsx` into five file-based routes — Tasks 1–4 (routes in Task 3; Home in Task 2).
- Responsive nav shell (sidebar ≥sm/labels ≥lg ↔ bottom tab bar <sm) in the root — Task 1 (`Nav`) + Task 4 (wiring). Pure Tailwind responsive classes replace the "single breakpoint hook" phrasing — simpler and more robust; documented in Architecture.
- Settings/account not a tab — Sign out stays in the header (Global Constraints); no `/settings` route.
- Pantry a first-class tab with an honest placeholder — Task 3, Step 4.
- Basic per-section empty states — child components already render their own empty states ("Basket is empty.", "No recipes yet.", grocery empty); Pantry placeholder copy covers its empty state; Home is a landing.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type/name consistency:** `NAV_ITEMS`/`Nav` used identically in Task 1 and its test; `Home` in Task 2 and Task 3 Step 1; route paths (`/`, `/plan`, `/list`, `/pantry`, `/recipes`, `/recipes/`, `/recipes/catalog`) consistent across Task 3, the Nav test harness, and Task 5; component props (`onCreated`, `refreshKey`) match the existing signatures read from source.

**Out of scope (deliberate):** state-aware Home dashboard + shopping-day handoff (BL-0017); planner/list/pantry feature work (BL-0018–0021); a `/settings` route and a richer profile menu.
