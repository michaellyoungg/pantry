import { Link } from "@tanstack/react-router";
import { Card } from "./ui/Card";

const ACTIONS = [
  { to: "/plan", label: "Plan this week", desc: "Choose recipes and lay out your week." },
  { to: "/recipes", label: "Add recipes", desc: "Import or browse recipes to cook." },
  { to: "/list", label: "Grocery list", desc: "Your one aggregated shopping list." },
  { to: "/pantry", label: "Pantry", desc: "Track what you already have on hand." },
] as const;

export function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-text">Welcome to Pantry</h2>
        <p className="mt-1 text-muted">Plan meals, build one grocery list, shop, and cook.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="block rounded-xl">
            <Card title={a.label}>
              <p className="text-sm text-muted">{a.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
