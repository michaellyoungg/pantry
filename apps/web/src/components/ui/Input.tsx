import type { TestID } from "@pantry/core/testing";
import type { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  testId,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  /** See `Button`'s `testId` — one contract, both clients (BL-0071). */
  testId?: TestID;
}) {
  return (
    <input
      data-testid={testId}
      className={`rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
      {...props}
    />
  );
}
