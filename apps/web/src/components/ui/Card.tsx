import type { ReactNode } from "react";

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-lg font-semibold text-text">{title}</h2>}
      {children}
    </section>
  );
}
