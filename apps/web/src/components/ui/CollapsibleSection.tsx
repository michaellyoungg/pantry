import type { TestID } from "@pantry/core/testing";
import { type ReactNode, useId, useState } from "react";

/**
 * A titled section of a list that can be folded away, with a count of what is
 * inside it (BL-0019).
 *
 * Built for a phone held in one hand in a shop: the whole header is the hit
 * target, it is ≥44px tall, and the count is on the header rather than inside
 * the section so a folded aisle still tells you how much of it is left.
 *
 * The heading stays a real `<h3>` with the button inside it, rather than a bare
 * button — the sections are the document outline of the list, and a shopper
 * navigating by headings on a screen reader needs them to survive being
 * collapsible.
 */
export function CollapsibleSection({
  title,
  count,
  countLabel,
  defaultOpen = true,
  description,
  testId,
  children,
}: {
  title: string;
  count: number;
  /** Pluralized noun for the count, e.g. "to buy" — read out, never drawn. */
  countLabel: string;
  defaultOpen?: boolean;
  description?: ReactNode;
  /** See `Button`'s `testId` — one contract, both clients (BL-0071). */
  testId?: TestID;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const headingId = useId();

  return (
    // Named by its own heading, which makes it a landmark a screen-reader user
    // can jump between — and the only way to address one section of the list
    // unambiguously, since the card wrapping them all is a <section> too.
    <section aria-labelledby={headingId} data-testid={testId}>
      <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          // Spelled out, because "Produce 3" read aloud is a riddle.
          aria-label={`${title}, ${count} ${countLabel}`}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left uppercase tracking-wide hover:bg-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span
            aria-hidden
            className={`text-[0.65rem] transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          <span>{title}</span>
          <span className="ml-auto rounded-full bg-border px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-muted">
            {count}
          </span>
        </button>
      </h3>
      {/* Always rendered so `aria-controls` never dangles; the contents come and
          go with the fold. */}
      <div id={contentId}>
        {open && (
          <>
            {description && <p className="px-1 pb-1 text-xs text-muted">{description}</p>}
            {children}
          </>
        )}
      </div>
    </section>
  );
}
