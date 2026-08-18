import { api } from "@pantry/convex/api";
import { COOK_TIME_BUCKETS, humanizeSlug, slugifyFacet } from "@pantry/core";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * What the cook likes, as opposed to what they refuse (BL-0030).
 *
 * It sits beside the avoid list but is a different KIND of setting, and the copy
 * says so: an avoid entry removes recipes, while a taste only reorders them.
 * Conflating the two is how a "preference" quietly becomes a filter and a cook
 * stops being shown food they would have enjoyed.
 *
 * These are the inputs to the ranker's `cuisineMatch` and `timeFit`. Both
 * degrade to "no signal" when unset, so an empty section here leaves
 * recommendations exactly as they were before it existed.
 */
export function TastePreferences() {
  const prefs = useQuery(api.preferences.get);
  const save = useMutation(api.preferences.set);
  const { run, error } = useAsyncAction();
  const [draft, setDraft] = useState("");
  const cuisineFieldId = useId();
  const timeFieldId = useId();

  // Nothing may be written against the `[]` fallback: until the stored list is
  // known, adding one cuisine would submit a list that silently drops every
  // taste the user already had.
  if (prefs === undefined) return null;

  const cuisines = prefs.cuisines ?? [];

  const addCuisine = () => {
    // Slugified here, not on the way out, so the stored value is the same string
    // a recipe carries. An entry with no usable characters is not a taste.
    const slug = slugifyFacet(draft);
    setDraft("");
    if (slug === "") return;
    const next = cuisines.includes(slug) ? cuisines : [...cuisines, slug];
    void run(() => save({ cuisines: next }));
  };

  const removeCuisine = (slug: string) =>
    void run(() => save({ cuisines: cuisines.filter((c) => c !== slug) }));

  return (
    <Card title="Tastes">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text">Cuisines you like</h3>
          <p className="mt-0.5 text-xs text-muted">
            These <strong>rank recipes higher</strong> — nothing is removed. A recipe with no
            cuisine on it is left where it was rather than pushed down, so this never buries the
            recipes you added yourself.
          </p>

          <div className="mt-2 flex gap-2">
            <Input
              id={cuisineFieldId}
              aria-label="Cuisine you like"
              placeholder="Thai, Italian, South Indian…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCuisine();
                }
              }}
            />
            <Button variant="secondary" size="sm" onClick={addCuisine}>
              Add
            </Button>
          </div>

          <ul aria-label="Cuisines you like" className="mt-2 flex flex-wrap gap-1.5">
            {cuisines.map((slug) => (
              <li
                key={slug}
                className="flex items-center gap-1 rounded-full bg-border px-2 py-0.5 text-xs text-text"
              >
                <span>{humanizeSlug(slug)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${humanizeSlug(slug)}`}
                  className="text-muted hover:text-text"
                  onClick={() => removeCuisine(slug)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label className="text-sm font-semibold text-text" htmlFor={timeFieldId}>
            The most time you want to spend
          </label>
          <p className="mt-0.5 text-xs text-muted">
            Recipes that fit rank higher, and ones a little over still rank. A recipe with no cook
            time recorded is <strong>not</strong> treated as a quick one.
          </p>
          <select
            id={timeFieldId}
            className="mt-2 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
            value={String(prefs.maxMinutes ?? 0)}
            // Saved on change rather than behind a Save button: it is a single
            // choice from a short list, and there is nothing to review.
            onChange={(e) => void run(() => save({ maxMinutes: Number(e.target.value) }))}
          >
            {/* 0 is the wire value for "no opinion" — see preferences.set. */}
            <option value="0">No preference</option>
            {COOK_TIME_BUCKETS.map((bucket) => (
              <option key={bucket.id} value={bucket.maxMinutes}>
                {bucket.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorText message={error} />
    </Card>
  );
}
