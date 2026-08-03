import { api } from "@pantry/convex/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import { useAsyncData } from "@pantry/core/react";
import { ErrorText } from "./ErrorText";

/**
 * The estimated bill for the current grocery list (BL-0023 increment 1).
 *
 * Prices are national monthly averages for generic items from the BLS CPI
 * program — not the user's store. The component's job is to be honest about
 * that: it always shows the basis and vintage, always says how many items the
 * total does not cover, and warns when the underlying data has gone stale.
 *
 * Pricing is decoration. Every failure here degrades to a single quiet line;
 * none of it can stop the grocery list rendering.
 */

/** Only the fields that change an estimate — deliberately not the Convex doc type. */
type PricedRow = {
  canonicalItem?: string;
  item: string;
  unit: string;
  quantity: number;
  alreadyHave?: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06" -> "Jun 2026". Falls back to the raw stamp rather than showing nothing. */
export function formatObservationMonth(month: string): string {
  const [year, m] = month.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && year ? `${name} ${year}` : month;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PricingSummary({ lines }: { lines: PricedRow[] }) {
  const estimateCost = useAction(api.pricing.estimateGroceryList);
  const load = useCallback(() => estimateCost({}), [estimateCost]);

  // Re-estimate whenever anything that changes the bill changes. Quantities and
  // "already have" both move the total, so both belong in the signature.
  const signature = lines
    .map((l) => `${l.canonicalItem ?? l.item}:${l.quantity}${l.unit}:${l.alreadyHave ? 1 : 0}`)
    .join("|");

  const { data, loading, error } = useAsyncData(load, [signature]);

  // Hooks must run unconditionally, so this bails out after them.
  if (lines.length === 0) return null;

  if (error) {
    return (
      <div className="mt-3 border-t border-border pt-2" data-testid="pricing-summary">
        <ErrorText message={`Could not estimate a cost: ${error}`} />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div
        className="mt-3 border-t border-border pt-2 text-sm text-muted"
        data-testid="pricing-summary"
      >
        Estimating cost…
      </div>
    );
  }

  const total = formatCents(data.totalCents);
  const when = formatObservationMonth(data.basis.observationMonth);
  const totalItems = data.pricedCount + data.unpricedCount;

  return (
    <div className="mt-3 border-t border-border pt-2" data-testid="pricing-summary">
      <p className="text-sm text-text">
        <span className="font-semibold">≈{total}</span>{" "}
        <span className="text-muted">estimated</span>
      </p>
      <p className="text-xs text-muted">
        {data.basis.area} averages, {when}
        {/* Never let a total quietly stand in for a list it only partly covers. */}
        {data.unpricedCount > 0 && ` · ${data.unpricedCount} of ${totalItems} items not estimated`}
      </p>
      {data.basis.staleness === "stale" && (
        <p className="text-xs text-muted">These prices may be out of date.</p>
      )}
    </div>
  );
}
