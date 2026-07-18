import { Link } from "@tanstack/react-router";

const ACTIONS = [
  { to: "/recipes", label: "Import a recipe" },
  { to: "/recipes/catalog", label: "Browse catalog" },
  { to: "/list", label: "Open grocery list" },
] as const;

export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
      {ACTIONS.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:border-primary"
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
