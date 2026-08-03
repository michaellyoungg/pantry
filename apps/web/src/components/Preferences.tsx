import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useAsyncAction } from "../lib/useAsyncAction";
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
// It lives here and nowhere else: the Convex `set` mutation stores whatever
// avoid list it is handed and never consults this table.
const MEAT = ["beef", "chicken", "pork", "bacon", "lamb"];
const SEAFOOD = ["fish", "shrimp", "anchovy"];
const ANIMAL_PRODUCTS = [
  "butter",
  "milk",
  "cream",
  "cheese",
  "parmesan",
  "mozzarella",
  "egg",
  "honey",
];

const DIET_SEEDS: Record<string, string[]> = {
  vegetarian: [...MEAT, ...SEAFOOD],
  vegan: [...MEAT, ...SEAFOOD, ...ANIMAL_PRODUCTS],
  pescatarian: [...MEAT],
};

export function Preferences() {
  const prefs = useQuery(api.preferences.get);
  const setPreferences = useMutation(api.preferences.set);
  const { run, error } = useAsyncAction();
  const [draft, setDraft] = useState("");

  const avoidItems = prefs?.avoidItems ?? [];

  const save = (next: string[]) =>
    run(() => setPreferences({ avoidItems: Array.from(new Set(next)) }));

  const add = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    setDraft("");
    save([...avoidItems, value]);
  };

  return (
    <Card title="Preferences">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text">Ingredients to avoid</h3>
          <p className="mt-0.5 text-xs text-muted">
            Recipes containing these are <strong>never suggested</strong> — they're removed, not
            just ranked lower.
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
            <Button variant="secondary" size="sm" onClick={add}>
              Add
            </Button>
          </div>

          <ul className="mt-2 flex flex-wrap gap-1.5">
            {avoidItems.map((item) => (
              <li
                key={item}
                className="flex items-center gap-1 rounded-full bg-border px-2 py-0.5 text-xs text-text"
              >
                <span>{item}</span>
                <button
                  type="button"
                  aria-label={`Remove ${item}`}
                  className="text-muted hover:text-text"
                  onClick={() => save(avoidItems.filter((i) => i !== item))}
                >
                  ×
                </button>
              </li>
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
                onClick={() => save([...avoidItems, ...DIET_SEEDS[diet]])}
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
