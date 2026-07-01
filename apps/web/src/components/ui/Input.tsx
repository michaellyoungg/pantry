import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
      {...props}
    />
  );
}
