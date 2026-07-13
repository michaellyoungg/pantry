import { api } from "@pantry/convex/api";
import type { Recipe } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

// Client-side search over the loaded catalog. Fine while the seed set is small;
// server-side search + filter chips (cook time / diet / cuisine) are deferred
// until the recipe schema carries those fields (BL-0020, coordinated w/ BL-0002).
function matches(recipe: Recipe, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (recipe.title.toLowerCase().includes(q)) return true;
  return recipe.ingredients.some((ing) => ing.item.toLowerCase().includes(q));
}

export function Catalog() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const listCatalog = useAction(api.recipes.listCatalog);
  const addToBasket = useMutation(api.basket.add);
  const { run, error } = useAsyncAction();

  useEffect(() => {
    let active = true;
    listCatalog()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [listCatalog]);

  const filtered = useMemo(() => recipes.filter((r) => matches(r, query)), [recipes, query]);

  return (
    <Card title="Catalog">
      {recipes.length > 0 && (
        <Input
          type="search"
          placeholder="Search recipes or ingredients…"
          className="mb-3 w-full"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search catalog"
        />
      )}
      {recipes.length === 0 && <p className="text-sm text-muted">No catalog recipes yet.</p>}
      {recipes.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted">No recipes match “{query.trim()}”.</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {filtered.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
            >
              Add to basket
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
