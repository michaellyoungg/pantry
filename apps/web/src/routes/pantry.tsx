import { createFileRoute } from "@tanstack/react-router";
import { Card } from "../components/ui/Card";

function PantryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Pantry</h2>
      <Card title="Coming soon">
        <p className="text-sm text-muted">
          Track staples you always have and cook from what's on hand — so you don't rebuy things you
          already own. This is on the way.
        </p>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/pantry")({ component: PantryPage });
