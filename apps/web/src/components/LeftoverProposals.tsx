import { api } from "@pantry/convex/api";
import { formatQuantity, purchaseText, residueText } from "@pantry/core";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";

/**
 * "You probably have these left over" — the inferred-leftover prompt (BL-0032).
 *
 * Every row here is a GUESS: we know the typical pack and what the recipes
 * wanted, not what the shop stocked or how heavy the cook's hand was. So each
 * one is answered individually and nothing is written until it is. Auto-adding
 * would corrupt the don't-rebuy signal — the list would quietly stop asking for
 * things the user does not actually have.
 *
 * There is deliberately no "keep all": one tap for the whole set would be the
 * frictionless-but-wrong path, and it is the per-item tap that carries the
 * information. It is also the outflow signal, collected at the one moment the
 * user is already thinking about that ingredient.
 */
export function LeftoverProposals() {
  const proposals = useQuery(api.groceryList.leftoverProposals) ?? [];
  const resolve = useMutation(api.groceryList.resolveLeftover);
  const { run, error } = useAsyncAction();

  if (proposals.length === 0) return null;

  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        You probably have these left over
      </h3>
      <p className="mt-1 text-xs text-muted">
        Packs are bigger than recipes. Confirm what actually made it home and we will suggest
        recipes that use it up.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {proposals.map((row) => {
          const { buy, need } = purchaseText(row, formatQuantity);
          return (
            <li key={row._id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-sm text-text">
                <span className="font-medium">{row.item}</span>{" "}
                <span className="text-xs text-muted">
                  — {residueText(row.purchase, formatQuantity)} of the {buy} you bought
                  {need && `, after the ${need} your recipes wanted`}
                </span>
              </span>
              <Button
                size="sm"
                aria-label={`Keep ${row.item}`}
                onClick={() => run(() => resolve({ id: row._id, keep: true }))}
              >
                Still have it
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Dismiss ${row.item}`}
                onClick={() => run(() => resolve({ id: row._id, keep: false }))}
              >
                All used
              </Button>
            </li>
          );
        })}
      </ul>
      <ErrorText message={error} />
    </section>
  );
}
