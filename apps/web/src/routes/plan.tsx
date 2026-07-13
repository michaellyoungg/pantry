import { createFileRoute } from "@tanstack/react-router";
import { Basket } from "../components/Basket";

function PlanPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Plan</h2>
      <Basket />
    </div>
  );
}

export const Route = createFileRoute("/plan")({ component: PlanPage });
