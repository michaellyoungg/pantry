import { api } from "@pantry/convex/api";
import { useAsyncAction } from "@pantry/core/react";
import type { AvoidResolution } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

// The single source of truth for diet seeds. Selecting a diet PRE-FILLS the
// avoid list so the user can see and edit exactly what gets excluded.
//
// This is deliberate: filtering by INFERRING which ingredients are meat would
// produce false negatives under partial dictionary coverage — a beef recipe
// shown to someone who declared vegetarian — which destroys trust in the whole
// feature. Nothing is ever excluded invisibly.
//
// It lives here and nowhere else: Convex stores what it is handed and never
// consults this table.
//
// Every entry below MUST be a real canonical item key from
// apps/recipe-service/internal/recipe/normalization.json.
// Preferences.dietSeeds.test.ts asserts every entry here still exists in that
// file, so the two cannot drift without a failing test. Seeds go through the
// same resolver as free-typed entries (BL-0052), which would now catch a drifted
// key and report it as unmatched — but a seed list that has to be reported is
// already a bug, so the test stays the primary guard.
const MEAT = [
  "chicken",
  "chicken breast",
  "chicken thigh",
  "ground beef",
  "ground turkey",
  "ground pork",
  "ground lamb",
  "steak",
  "pork chop",
  "pork tenderloin",
  "bacon",
  "sausage",
  "ham",
  "prosciutto",
];
const SEAFOOD = ["salmon", "shrimp", "cod", "tilapia"];
const ANIMAL_PRODUCTS = [
  "milk",
  "butter",
  "egg",
  "heavy cream",
  "half and half",
  "buttermilk",
  "sour cream",
  "yogurt",
  "greek yogurt",
  "cream cheese",
  "cottage cheese",
  "cheddar cheese",
  "parmesan",
  "mozzarella",
  "feta",
  "ricotta",
  "honey",
];

export const DIET_SEEDS: Record<string, string[]> = {
  vegetarian: [...MEAT, ...SEAFOOD],
  vegan: [...MEAT, ...SEAFOOD, ...ANIMAL_PRODUCTS],
  pescatarian: [...MEAT],
};

/** What a stored avoid entry is known to be, or nothing if it predates BL-0052. */
type StoredResolution = {
  canonicalItem: string;
  input: string;
  display: string;
  kind: "item" | "allergen" | "unknown";
  members?: string[];
};

/**
 * The line under the input that says what just happened to each entry.
 *
 * It exists because the silent case is the bug: an entry that matched nothing
 * used to look exactly like one that matched, and for an allergen that is the
 * failure that matters. So an add reports what matched nothing, what a family
 * covers, and what the dictionary renamed.
 *
 * An entry that resolved to exactly what was typed says nothing — its chip
 * appearing is the whole story, and a note per entry would bury the ones that
 * matter under thirty lines the moment a diet seed list is applied.
 */
function ResolutionNotes({
  resolutions,
  onAvoidFamily,
}: {
  resolutions: AvoidResolution[];
  onAvoidFamily: (family: string) => void;
}) {
  const notable = resolutions.filter(
    (r) =>
      r.kind !== "item" || r.families?.length || r.display.toLowerCase() !== r.input.toLowerCase(),
  );
  if (notable.length === 0) return null;
  return (
    // One live region for the whole report rather than one per line: adding a
    // diet seed list can produce several notes at once, and a screen reader
    // should hear them as a single answer to "what did that do?".
    <ul
      aria-label="What your last entry matched"
      className="mt-2 flex flex-col gap-1 text-xs"
      role="status"
    >
      {notable.map((r) => {
        if (r.kind === "unknown") {
          return (
            <li key={r.canonicalItem} className="text-danger">
              “{r.input}” doesn’t match any ingredient we know, so it won’t remove any recipes.
              Check the spelling, or try a more common name for it.
            </li>
          );
        }
        if (r.kind === "allergen") {
          return (
            <li key={r.canonicalItem} className="text-muted">
              Avoiding <strong className="text-text">{r.display}</strong> — this also removes
              recipes with {(r.members ?? []).join(", ")}.
            </li>
          );
        }
        return (
          <li key={r.canonicalItem} className="text-muted">
            Avoiding <strong className="text-text">{r.display}</strong>
            {r.display.toLowerCase() !== r.input.toLowerCase() ? ` (you typed “${r.input}”)` : ""}.
            {r.families?.length ? (
              <>
                {" "}
                It’s a {r.families.join(" and ")} ingredient —{" "}
                <button
                  type="button"
                  className="underline hover:text-text"
                  onClick={() => onAvoidFamily(r.families?.[0] ?? "")}
                >
                  avoid all {r.families[0]}
                </button>{" "}
                to cover the whole family.
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The chip for one stored entry, labelled with whatever is known about it. */
function AvoidChip({
  item,
  resolution,
  onRemove,
}: {
  item: string;
  resolution: StoredResolution | undefined;
  onRemove: () => void;
}) {
  const unmatched = resolution?.kind === "unknown";
  const family = resolution?.kind === "allergen";
  return (
    <li
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        unmatched ? "bg-danger/10 text-danger" : "bg-border text-text"
      }`}
      // The members list is long enough to swamp the chip row, so it lives in
      // the tooltip — but it is never withheld: the chip says a family is in
      // play, and hovering says exactly which ingredients that covers.
      title={
        family && resolution?.members?.length
          ? `Also removes: ${resolution.members.join(", ")}`
          : undefined
      }
    >
      <span>{resolution?.display ?? item}</span>
      {family ? <span className="text-muted">· allergen group</span> : null}
      {unmatched ? <span>· matches nothing</span> : null}
      <button
        type="button"
        aria-label={`Remove ${resolution?.display ?? item}`}
        className="text-muted hover:text-text"
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

export function Preferences() {
  const prefs = useQuery(api.preferences.get);
  // Adding is an ACTION, not a mutation: entries are canonicalized against the
  // ingredient dictionary before they are stored, and that needs a network call
  // Convex mutations cannot make (BL-0052).
  const addAvoidItems = useAction(api.preferences.addAvoidItems);
  const removeAvoidItem = useMutation(api.preferences.removeAvoidItem);
  const { run, error } = useAsyncAction();
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<AvoidResolution[]>([]);

  const avoidItems = prefs?.avoidItems ?? [];
  const byItem = new Map<string, StoredResolution>(
    (prefs?.avoidResolutions ?? []).map((r) => [r.canonicalItem, r]),
  );
  // The query has not resolved yet, so nothing that writes may run: until the
  // stored list is known, a control acting on the `[]` fallback above would be
  // acting on the wrong list.
  const loading = prefs === undefined;

  const addEntries = async (entries: string[]) => {
    const resolved = await run(() => addAvoidItems({ entries }));
    // `run` swallows the error into `error` and returns undefined; leaving the
    // previous notes up beside a failure would read as if the add had worked.
    setNotes(resolved ?? []);
  };

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    void addEntries([value]);
  };

  return (
    <Card title="Preferences">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text">Ingredients to avoid</h3>
          <p className="mt-0.5 text-xs text-muted">
            Recipes with a matching ingredient are <strong>removed</strong>, not just ranked lower.
            Each entry is matched to a known ingredient as you add it, so "scallion" becomes green
            onion — and common allergens like "peanut" or "dairy" cover their whole group. Anything
            we don’t recognise is flagged, because an entry that matches nothing filters nothing.
          </p>

          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Ingredient to avoid"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="secondary" size="sm" onClick={add} disabled={loading}>
              Add
            </Button>
          </div>

          <ResolutionNotes
            resolutions={notes}
            onAvoidFamily={(family) => void addEntries([family])}
          />

          <ul aria-label="Ingredients you avoid" className="mt-2 flex flex-wrap gap-1.5">
            {avoidItems.map((item) => (
              <AvoidChip
                key={item}
                item={item}
                resolution={byItem.get(item)}
                onRemove={() => {
                  setNotes([]);
                  void run(() => removeAvoidItem({ canonicalItem: item }));
                }}
              />
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text">Diet</h3>
          <p className="mt-0.5 text-xs text-muted">
            Picking one fills in the avoid list above, which you can then edit.
          </p>
          <div className="mt-2 flex gap-2">
            {Object.keys(DIET_SEEDS).map((diet) => (
              <Button
                key={diet}
                variant="secondary"
                size="sm"
                disabled={loading}
                // Seeds are resolved by the same path as anything typed, so a
                // seed key that no longer exists is reported rather than stored
                // as a filter that matches nothing.
                onClick={() => void addEntries(DIET_SEEDS[diet])}
              >
                {diet}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <ErrorText message={error} />
    </Card>
  );
}
