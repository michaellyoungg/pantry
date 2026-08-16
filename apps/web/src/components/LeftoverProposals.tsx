import { formatQuantity, type PurchasedLine, purchaseText, residueText } from "@pantry/core";
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
 *
 * Pure presentation since BL-0057 — the subscription and the mutation live in
 * `useGroceryList()`, so the native prompt answers the same guesses.
 */

/** Only what the prompt draws — deliberately not the Convex document type. */
export type LeftoverRow = PurchasedLine & { _id: string; item: string };

export function LeftoverProposals<T extends LeftoverRow>({
  proposals,
  onResolve,
}: {
  proposals: readonly T[];
  onResolve: (proposal: T, keep: boolean) => void;
}) {
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
                onClick={() => onResolve(row, true)}
              >
                Still have it
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Dismiss ${row.item}`}
                onClick={() => onResolve(row, false)}
              >
                All used
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
