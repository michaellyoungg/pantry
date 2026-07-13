import { createFileRoute } from "@tanstack/react-router";
import { Planner } from "../components/planner/Planner";

export const Route = createFileRoute("/plan")({ component: Planner });
