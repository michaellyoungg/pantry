import { api } from "@pantry/convex/api";
import type { Recipe } from "@pantry/types";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { listCatalog } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function Catalog() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
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
  }, []);

  return (
    <Card title="Catalog">
      {recipes.length === 0 && <p className="text-sm text-muted">No catalog recipes yet.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
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
