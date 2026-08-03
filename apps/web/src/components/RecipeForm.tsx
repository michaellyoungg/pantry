import { api } from "@pantry/convex/api";
import { useAsyncAction, useRecipeDraft } from "@pantry/core/react";
import type { Recipe } from "@pantry/types";
import { useAction } from "convex/react";
import { ErrorText } from "./ErrorText";
import { StepsEditor } from "./StepsEditor";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  // The import-review draft and its transitions live in @pantry/core (BL-0024);
  // this component only renders them.
  const {
    draft,
    setTitle,
    setUrl,
    updateIngredient,
    addIngredient,
    setSteps,
    applyImported,
    reset,
    submission,
    importUrl,
  } = useRecipeDraft();
  const createRecipe = useAction(api.recipes.create);
  const importFromUrl = useAction(api.recipes.importFromUrl);
  const { run, error, pending } = useAsyncAction();
  const importAction = useAsyncAction();

  async function importRecipe() {
    if (!importUrl) return;
    const preview = (await importAction.run(() => importFromUrl({ url: importUrl }))) as
      | Recipe
      | undefined;
    if (preview) applyImported(preview);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!submission) return;
    const created = await run(() => createRecipe(submission));
    if (created) {
      reset();
      onCreated();
    }
  }

  return (
    <Card title="New recipe">
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Paste a recipe URL to import…"
          className="flex-1"
          value={draft.url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button variant="ghost" size="sm" onClick={importRecipe} disabled={importAction.pending}>
          {importAction.pending ? "Importing…" : "Import"}
        </Button>
      </div>
      <ErrorText message={importAction.error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input placeholder="Title" value={draft.title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-col gap-2">
          {draft.ingredients.map((ing, i) => (
            <div key={i} className="flex gap-2">
              <Input
                type="number"
                className="w-16"
                value={ing.quantity}
                onChange={(e) => updateIngredient(i, { quantity: Number(e.target.value) })}
              />
              <Input
                placeholder="unit"
                className="w-24"
                value={ing.unit}
                onChange={(e) => updateIngredient(i, { unit: e.target.value })}
              />
              <Input
                placeholder="item"
                className="flex-1"
                value={ing.item}
                onChange={(e) => updateIngredient(i, { item: e.target.value })}
              />
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="self-start" onClick={addIngredient}>
          + ingredient
        </Button>
        <StepsEditor steps={draft.steps} onChange={setSteps} />
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? "Saving…" : "Create recipe"}
        </Button>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
