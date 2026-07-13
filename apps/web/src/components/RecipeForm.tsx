import { api } from "@pantry/convex/api";
import type { Ingredient, Recipe } from "@pantry/types";
import { useAction } from "convex/react";
import { useState } from "react";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { cleanIngredients, emptyIngredient, RecipeFields } from "./RecipeFields";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const [url, setUrl] = useState("");
  const createRecipe = useAction(api.recipes.create);
  const importFromUrl = useAction(api.recipes.importFromUrl);
  const { run, error, pending } = useAsyncAction();
  const importAction = useAsyncAction();

  async function importUrl() {
    if (!url.trim()) return;
    const preview = (await importAction.run(() => importFromUrl({ url: url.trim() }))) as
      | Recipe
      | undefined;
    if (preview) {
      setTitle(preview.title);
      setIngredients(preview.ingredients.length ? preview.ingredients : [emptyIngredient()]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await run(() =>
      createRecipe({
        title: title.trim(),
        ingredients: cleanIngredients(ingredients),
      }),
    );
    if (created) {
      setTitle("");
      setIngredients([emptyIngredient()]);
      setUrl("");
      onCreated();
    }
  }

  return (
    <Card title="New recipe">
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Paste a recipe URL to import…"
          className="flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button variant="ghost" size="sm" onClick={importUrl} disabled={importAction.pending}>
          {importAction.pending ? "Importing…" : "Import"}
        </Button>
      </div>
      <ErrorText message={importAction.error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <RecipeFields
          title={title}
          ingredients={ingredients}
          onTitleChange={setTitle}
          onIngredientsChange={setIngredients}
        />
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? "Saving…" : "Create recipe"}
        </Button>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
