import { createFileRoute } from "@tanstack/react-router";
import { Pantry } from "../components/Pantry";
import { UseItUp } from "../components/UseItUp";

function PantryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Pantry</h2>
      {/* ONE suggestion card (BL-0050). This page used to render two — an
          expiry-driven one and a preference-driven one — with overlapping
          results and, more seriously, different filtering rules.
          `variant="page"` is what makes it show even when nothing is expiring:
          this page is the feature's home, whereas on Home it is an interrupt. */}
      <UseItUp variant="page" />
      <Pantry />
    </div>
  );
}

export const Route = createFileRoute("/pantry")({ component: PantryPage });
