import { createFileRoute } from "@tanstack/react-router";
import { Pantry } from "../components/Pantry";
import { UseItUpSuggestions } from "../components/pantry/UseItUpSuggestions";

function PantryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Pantry</h2>
      <Pantry />
      <UseItUpSuggestions />
    </div>
  );
}

export const Route = createFileRoute("/pantry")({ component: PantryPage });
