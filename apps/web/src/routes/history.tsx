import { createFileRoute } from "@tanstack/react-router";
import { HabitReview } from "../components/HabitReview";

function HistoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">History</h2>
      <p className="text-sm text-muted">
        How you've been eating over time — trends per nutrient, and which days had too little
        information to count.
      </p>
      <HabitReview />
    </div>
  );
}

export const Route = createFileRoute("/history")({ component: HistoryPage });
