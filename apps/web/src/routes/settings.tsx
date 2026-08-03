import { createFileRoute } from "@tanstack/react-router";
import { Preferences } from "../components/Preferences";

function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Settings</h2>
      <Preferences />
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsPage });
