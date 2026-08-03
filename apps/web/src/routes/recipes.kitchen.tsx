import { createFileRoute } from "@tanstack/react-router";
import { MyKitchen } from "../components/MyKitchen";

function KitchenPage() {
  return <MyKitchen />;
}

export const Route = createFileRoute("/recipes/kitchen")({ component: KitchenPage });
