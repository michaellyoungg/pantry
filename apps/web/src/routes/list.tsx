import { createFileRoute } from "@tanstack/react-router";
import { GroceryList } from "../components/GroceryList";

function ListPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Grocery list</h2>
      <GroceryList />
    </div>
  );
}

export const Route = createFileRoute("/list")({ component: ListPage });
