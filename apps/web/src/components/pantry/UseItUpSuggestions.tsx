import { api } from "@pantry/convex/api";
import { useAsyncAction } from "@pantry/core/react";
import type { Recommendation } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { ErrorText } from "../ErrorText";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function UseItUpSuggestions() {
  const recommend = useAction(api.recommendations.pantry);
  const addToBasket = useMutation(api.basket.add);
  const { run, error, pending } = useAsyncAction();
  // null = not asked yet, so the empty state only appears after a real
  // attempt — never on first render, and never merely because the previous
  // attempt failed.
  const [results, setResults] = useState<Recommendation[] | null>(null);

  const ask = () =>
    run(async () => {
      const found = await recommend({});
      setResults(found);
      return found;
    });

  return (
    <Card title="Cook from what you have">
      <p className="text-sm text-muted">
        Mark things above to use up, then see what you could make with them.
      </p>

      <div className="mt-2">
        <Button variant="secondary" size="sm" onClick={ask} disabled={pending}>
          {pending ? "Looking…" : "What can I make?"}
        </Button>
      </div>

      {results !== null && results.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          Nothing close yet — mark a few more items you have.
        </p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {results.map((r) => (
            <li key={r.recipeId} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium text-text">{r.title}</p>
                {r.reasons.length > 0 && (
                  <p className="text-xs text-muted">{r.reasons.slice(0, 3).join(" · ")}</p>
                )}
                {r.missing.length > 0 && (
                  <p className="text-xs text-muted">
                    Need: {r.missing.map((m) => m.display).join(", ")}
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Add ${r.title} to plan`}
                onClick={() => run(() => addToBasket({ recipeId: r.recipeId, title: r.title }))}
              >
                Add to plan
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ErrorText message={error} />
    </Card>
  );
}
