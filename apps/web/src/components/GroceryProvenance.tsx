import { formatQuantity } from "@pantry/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef } from "react";
import { Button } from "./ui/Button";

/**
 * Where an aggregated grocery line came from (BL-0019).
 *
 * A merged line is otherwise opaque: "¾ cup butter" gives no way to tell which
 * of the week's recipes wanted it, so the shopper cannot judge what happens if
 * they skip it or buy less. The sheet answers exactly that — which recipes, how
 * much each, and a way through to the recipe itself.
 */

/** Only the fields the sheet needs — deliberately not the Convex doc type. */
export type ProvenanceSource = { recipeId: string; title: string; quantity: number };

/** Amounts are in the parent line's unit, so they add up to its quantity. */
function amount(quantity: number, unit: string): string {
  return [formatQuantity(quantity), unit].filter(Boolean).join(" ");
}

/**
 * The affordance on the line itself: how many recipes wanted this. Rendered as
 * a button rather than an icon so it is legible at a glance and hittable with a
 * thumb; a line with no traceable source shows nothing at all.
 */
export function ProvenanceButton({
  sources,
  onOpen,
}: {
  sources: ProvenanceSource[] | undefined;
  onOpen: () => void;
}) {
  if (!sources || sources.length === 0) return null;
  const label = `${sources.length} ${sources.length === 1 ? "recipe" : "recipes"}`;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="min-h-11 shrink-0 whitespace-nowrap"
      aria-label={`Show the ${label} this line came from`}
      onClick={onOpen}
    >
      {label}
    </Button>
  );
}

/**
 * The sheet itself. An explicit overlay rather than `<dialog>.showModal()`, for
 * the reason ConfirmDialog spells out: jsdom does not implement `showModal`, so
 * a native modal cannot be exercised in a unit test.
 *
 * Anchored to the bottom of the screen on a phone and centred from `sm` up —
 * in-store this is reached one-handed, and the top of a phone screen is not.
 */
export function ProvenanceSheet({
  item,
  unit,
  sources,
  onClose,
}: {
  item: string;
  unit: string;
  sources: ProvenanceSource[];
  onClose: () => void;
}) {
  const titleId = useId();
  const restoreFocusTo = useRef<Element | null>(null);

  // Hand focus back where it came from, so a keyboard user resumes on the line
  // they were reading rather than at <body>.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    return () => {
      const previous = restoreFocusTo.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="w-full max-w-sm rounded-t-xl border border-border bg-surface p-5 text-text shadow-lg sm:rounded-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {item}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {sources.length === 1 ? "From this recipe:" : "Added up from these recipes:"}
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {sources.map((source) => (
            <li key={source.recipeId} className="flex items-center justify-between gap-3">
              {/* Through to the recipe: the recipes page, opened on this one. */}
              <Link
                to="/recipes"
                search={{ recipe: source.recipeId }}
                onClick={onClose}
                className="flex min-h-11 flex-1 items-center text-sm text-primary underline-offset-2 hover:underline"
              >
                {source.title}
              </Link>
              <span className="shrink-0 text-sm text-muted">{amount(source.quantity, unit)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          {/* Focus belongs in the sheet the moment it opens. */}
          <Button variant="secondary" autoFocus className="min-h-11" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
