import { Button } from "../ui/Button";

export type PlanEntry = {
  _id: string;
  recipeId: string;
  title: string;
  plannedDate?: string;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
};

export function MealCard({
  entry,
  onServings,
  onToggleLeftover,
  onRemove,
}: {
  entry: PlanEntry;
  onServings: (id: string, mult: number) => void;
  onToggleLeftover: (id: string, type: "meal" | "leftover") => void;
  onRemove: (id: string) => void;
}) {
  const mult = entry.servingsMultiplier ?? 1;
  const isLeftover = entry.type === "leftover";
  return (
    <div
      className={`rounded-lg border border-border p-2 text-sm ${
        isLeftover ? "bg-border/20 text-muted" : "bg-surface text-text"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{entry.title}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove ${entry.title}`}
          onClick={() => onRemove(entry._id)}
        >
          ✕
        </Button>
      </div>
      {isLeftover ? (
        <p className="mt-1 text-xs">leftovers — not on list</p>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Decrease servings"
            onClick={() => onServings(entry._id, Math.max(0.25, mult - 0.5))}
          >
            −
          </Button>
          <span className="tabular-nums">×{mult}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Increase servings"
            onClick={() => onServings(entry._id, mult + 0.5)}
          >
            +
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-1"
        aria-label={isLeftover ? `Mark ${entry.title} as meal` : `Mark ${entry.title} as leftover`}
        onClick={() => onToggleLeftover(entry._id, isLeftover ? "meal" : "leftover")}
      >
        {isLeftover ? "↩ meal" : "♻ leftover"}
      </Button>
    </div>
  );
}
