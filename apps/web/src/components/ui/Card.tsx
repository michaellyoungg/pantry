import type { TestID } from "@pantry/core/testing";
import type { ReactNode } from "react";

export function Card({
  title,
  label,
  busy,
  testId,
  children,
  className = "",
}: {
  title?: string;
  /**
   * Accessible name for the card's <section>. Opt-in rather than derived from
   * `title`, because naming every card at once would turn each one into a
   * landmark region and change the a11y tree app-wide.
   */
  label?: string;
  /** Marks the card as settling while a write is in flight (aria-busy). */
  busy?: boolean;
  /** See `Button`'s `testId` — one contract, both clients (BL-0071). */
  testId?: TestID;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      aria-busy={busy}
      data-testid={testId}
      className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}
    >
      {title && <h2 className="mb-3 text-lg font-semibold text-text">{title}</h2>}
      {children}
    </section>
  );
}
