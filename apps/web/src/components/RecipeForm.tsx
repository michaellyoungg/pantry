import { api } from "@pantry/convex/api";
import { formatTags, formatTotalMinutes, parseTags, parseTotalMinutes } from "@pantry/core";
import { useAsyncAction, useRecipeDraft } from "@pantry/core/react";
import type { PrepTaskInput, Recipe } from "@pantry/types";
import { formatServings, parseServings } from "../lib/servings";
import { useEquipmentCatalog } from "../lib/useEquipmentCatalog";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeFields, type RecipeFieldsValue } from "./RecipeFields";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  // The import-review draft and its transitions live in @pantry/core (BL-0024);
  // this component only renders them. `servings`, `totalMinutes` and the tag
  // list stay raw field text in the draft and are parsed on the way out, so the
  // draft needs no notion of the input widgets or of the wire format.
  const {
    draft,
    setTitle,
    setUrl,
    setServings,
    setIngredients,
    setSteps,
    setEquipment,
    setMethods,
    setCuisine,
    setTotalMinutes,
    setTags,
    setPrepTasks,
    applyImported,
    reset,
    submission,
    importUrl,
  } = useRecipeDraft();
  const { catalog } = useEquipmentCatalog();
  const createRecipe = useTracedAction(api.recipes.create, "recipes.create");
  const importFromUrl = useTracedAction(api.recipes.importFromUrl, "recipes.importFromUrl");
  const { run, error, pending } = useAsyncAction();
  const importAction = useAsyncAction();

  // The draft keeps tags as a list; the shared editor edits them as one comma
  // separated field. Translating at this boundary keeps the list canonical.
  const fields: RecipeFieldsValue = {
    title: draft.title,
    servings: draft.servings,
    ingredients: draft.ingredients,
    steps: draft.steps,
    equipment: draft.equipment,
    methods: draft.methods,
    cuisine: draft.cuisine,
    totalMinutes: draft.totalMinutes,
    tags: formatTags(draft.tags),
    prepTasks: draft.prepTasks,
  };

  // Routed through the draft's individual pure transitions rather than a
  // blanket setState, so every edit still goes through @pantry/core.
  function applyFields(patch: Partial<RecipeFieldsValue>) {
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.servings !== undefined) setServings(patch.servings);
    if (patch.steps !== undefined) setSteps(patch.steps);
    if (patch.equipment !== undefined) setEquipment(patch.equipment);
    if (patch.methods !== undefined) setMethods(patch.methods);
    if (patch.cuisine !== undefined) setCuisine(patch.cuisine);
    if (patch.totalMinutes !== undefined) setTotalMinutes(patch.totalMinutes);
    if (patch.tags !== undefined) setTags(parseTags(patch.tags));
    if (patch.ingredients !== undefined) setIngredients(patch.ingredients);
    if (patch.prepTasks !== undefined) setPrepTasks(patch.prepTasks);
  }

  async function importRecipe() {
    if (!importUrl) return;
    const preview = (await importAction.run(() => importFromUrl({ url: importUrl }))) as
      | Recipe
      | undefined;
    // The import fills in whatever the page stated and leaves the rest blank
    // for the user to supply. Equipment, methods, cuisine and cook time arrive
    // already guessed; the editor below is where a wrong guess gets corrected
    // before saving — never saved silently. Prep tasks arrive only when the
    // importer's model tagging is configured, and carry source "llm" so they
    // stay distinguishable from anything typed here.
    if (preview) {
      applyImported({
        ...preview,
        servings: formatServings(preview.servings),
        totalMinutes: formatTotalMinutes(preview.totalMinutes),
        tags: preview.tags ?? [],
        cuisine: preview.cuisine ?? "",
        sourceUrl: preview.sourceUrl ?? "",
        // A preview can only carry storable prep — the importer's model tagging
        // produces `llm` tasks. Rule-derived prep is computed on read and never
        // stored, so anything claiming to be one is dropped rather than saved
        // back as a frozen copy of a rule that may since have changed.
        prepTasks: (preview.prepTasks ?? []).flatMap<PrepTaskInput>((task) =>
          task.source === "rule"
            ? []
            : [{ key: task.key, window: task.window, text: task.text, source: task.source }],
        ),
      });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!submission) return;
    const created = await run(() =>
      createRecipe({
        title: submission.title,
        servings: parseServings(submission.servings),
        ingredients: submission.ingredients,
        steps: submission.steps,
        equipment: submission.equipment,
        methods: submission.methods,
        cuisine: submission.cuisine,
        totalMinutes: parseTotalMinutes(submission.totalMinutes),
        tags: submission.tags,
        // Attribution survives the review step, so an imported recipe keeps a
        // link back to where it came from and can be re-imported later.
        sourceUrl: submission.sourceUrl || undefined,
        prepTasks: submission.prepTasks,
      }),
    );
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
        <RecipeFields value={fields} onChange={applyFields} catalog={catalog} />
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? "Saving…" : "Create recipe"}
        </Button>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
