import { api } from "@pantry/convex/api";
import { useAsyncAction } from "@pantry/core/react";
import type { Recommendation } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { hardConstraintCount, unverifiedLabel } from "../../lib/nutritionGoals";
import { ErrorText } from "../ErrorText";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function UseItUpSuggestions() {
  const recommend = useAction(api.recommendations.pantry);
  const addToBasket = useMutation(api.basket.add);
  // Read the goals directly rather than having the action report back what it
  // filtered on: a list that silently shrank is indistinguishable from having
  // nothing to suggest, and the user should be told before they press the button
  // rather than left to wonder afterwards.
  const goals = useQuery(api.nutritionTargets.list) ?? [];
  const required = hardConstraintCount(goals);
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
      {required > 0 && (
        <p className="mt-1 text-xs text-muted">
          Hiding recipes that break{" "}
          {required === 1 ? "your required goal" : `your ${required} required goals`}. Your other
          goals only change the order.
        </p>
      )}

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
                {/* Defence in depth: a producer bug can serialize `missing` as
                    null (a nil Go slice encodes that way) even though the type
                    says it never can. Guard here so a bad payload degrades to
                    "no missing line" instead of crashing the whole app. */}
                {(r.missing?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted">
                    Need: {r.missing.map((m) => m.display).join(", ")}
                  </p>
                )}
                {/* A recipe we could not measure is still suggested — being
                    unmapped is a data gap, not a nutritional verdict — but it
                    must never look like it cleared a limit it was never
                    checked against. */}
                {(r.nutritionUnverified?.length ?? 0) > 0 && (
                  <p className="text-xs text-text">
                    Not checked against:{" "}
                    {(r.nutritionUnverified ?? []).map(unverifiedLabel).join(", ")}
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
