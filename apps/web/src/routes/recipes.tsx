import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

const tab =
  "rounded-lg px-3 py-1.5 text-sm text-muted hover:text-text data-[active=true]:bg-primary/10 data-[active=true]:text-primary";

function RecipesLayout() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Recipes</h2>
      <nav aria-label="Recipes" className="flex gap-2">
        <Link
          to="/recipes"
          activeOptions={{ exact: true }}
          activeProps={{ "data-active": "true" }}
          className={tab}
        >
          My recipes
        </Link>
        <Link to="/recipes/catalog" activeProps={{ "data-active": "true" }} className={tab}>
          Browse catalog
        </Link>
        {/* Equipment inventory sits with the recipes it filters rather than in a
            settings screen: the only reason to record what you own is to change
            what browsing shows you, and the two are one tab apart here. */}
        <Link to="/recipes/kitchen" activeProps={{ "data-active": "true" }} className={tab}>
          My kitchen
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute("/recipes")({ component: RecipesLayout });
