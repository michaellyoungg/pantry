import { createFileRoute } from "@tanstack/react-router";
import { Catalog } from "../components/Catalog";

function CatalogPage() {
  return <Catalog />;
}

export const Route = createFileRoute("/recipes/catalog")({ component: CatalogPage });
