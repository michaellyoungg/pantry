import { formatQuantity, purchaseText } from "@pantry/core";
import { TEST_IDS } from "@pantry/core/testing";
import { ProvenanceButton, type ProvenanceSource } from "./GroceryProvenance";
import { SwipeAwayRow } from "./SwipeAwayRow";
import { Button } from "./ui/Button";

/** Only what the row draws — deliberately not the Convex document type. */
export type GroceryRowLine = {
  _id: string;
  item: string;
  unit: string;
  quantity: number;
  checked: boolean;
  alreadyHave?: boolean;
  manual?: boolean;
  purchase?: { quantity: number; unit: string; residue?: number; residueUnit?: string };
  sources?: ProvenanceSource[];
};

/**
 * One line of the grocery list.
 *
 * Tap-to-check is the primary interaction and stays a plain checkbox: it is the
 * one action a shopper performs dozens of times a trip, one-handed, without
 * looking away from a shelf. The whole label is the target and it is ≥44px
 * tall. Everything else on the row is secondary and may wrap beneath it rather
 * than squeeze the thing being tapped.
 */
export function GroceryRow({
  line,
  onToggle,
  onOpenSources,
  onRemove,
  onNeedItAnyway,
  leaving = false,
  highlighted = false,
}: {
  line: GroceryRowLine;
  onToggle: (checked: boolean) => void;
  onOpenSources: () => void;
  /** Absent when this line cannot be removed — which also disables the swipe. */
  onRemove?: () => void;
  onNeedItAnyway?: () => void;
  leaving?: boolean;
  highlighted?: boolean;
}) {
  // What the shop sells comes first — it is what the shopper has to find and
  // put in the basket. The recipes' measure is kept beside it, quieter: it is
  // why the line exists, and dropping it would make the list unverifiable
  // against the plan.
  const { buy, need } = purchaseText(line, formatQuantity);

  return (
    // Keyed by the ingredient, not by position: the walk reorders as lines are
    // checked off, and a positional selector would follow the slot rather than
    // the line. The native row carries the same id (BL-0071).
    <SwipeAwayRow
      testId={TEST_IDS.list.item(line.item)}
      onRemove={onRemove}
      leaving={leaving}
      highlighted={highlighted}
    >
      <label
        className={`flex min-h-11 flex-1 items-center gap-3 text-sm ${
          line.checked ? "text-muted line-through" : line.alreadyHave ? "text-muted" : "text-text"
        }`}
      >
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0 accent-[var(--color-primary)]"
          checked={line.checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>
          {buy} {line.item}
          {need && <span className="ml-1 text-xs text-muted">needs {need}</span>}
        </span>
      </label>
      <ProvenanceButton sources={line.sources} onOpen={onOpenSources} />
      {/* Only manual lines can be removed — a generated one comes back on the
          next generation, so "remove" would be a lie. */}
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          aria-label={`Remove ${line.item}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      )}
      {line.alreadyHave && (
        <>
          <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
            already have
          </span>
          {onNeedItAnyway && (
            <Button variant="ghost" size="sm" className="min-h-11" onClick={onNeedItAnyway}>
              Need it anyway
            </Button>
          )}
        </>
      )}
    </SwipeAwayRow>
  );
}
