import { COOK_TIME_BUCKETS, type CatalogFilter, humanizeSlug } from "@pantry/core";
import { TEST_IDS } from "@pantry/core/testing";

function Chip({
  label,
  pressed,
  testId,
  onClick,
}: {
  label: string;
  pressed: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        pressed
          ? "border-transparent bg-text text-surface"
          : "border-border text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function ChipRow({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{legend}</legend>
      <span aria-hidden className="mr-1 text-xs font-medium text-muted">
        {legend}
      </span>
      {children}
    </fieldset>
  );
}

/**
 * The catalog's filter chips (BL-0020). Cook time leads because it is the #1
 * weeknight filter — the question is "what can I make tonight", and everything
 * else is a refinement of that.
 *
 * Which recipes a selection matches, and which chips are worth offering, moved
 * to `@pantry/core` with BL-0063; this component is the chip row and nothing
 * else, so the native catalog can answer the same questions differently drawn.
 */
export function CatalogFilters({
  filter,
  cuisines,
  diets,
  onToggleCookTime,
  onToggleDiet,
  onToggleCuisine,
}: {
  filter: CatalogFilter;
  /** The cuisines the loaded catalog actually holds. */
  cuisines: string[];
  /** The diet tags the loaded catalog can satisfy. */
  diets: string[];
  onToggleCookTime: (id: NonNullable<CatalogFilter["cookTime"]>) => void;
  onToggleDiet: (diet: string) => void;
  onToggleCuisine: (cuisine: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2">
      <ChipRow legend="Cook time">
        {COOK_TIME_BUCKETS.map((bucket) => (
          <Chip
            key={bucket.id}
            label={bucket.label}
            pressed={filter.cookTime === bucket.id}
            testId={TEST_IDS.recipes.catalogChip("time", bucket.id)}
            onClick={() => onToggleCookTime(bucket.id)}
          />
        ))}
      </ChipRow>

      {diets.length > 0 && (
        <ChipRow legend="Diet">
          {diets.map((diet) => (
            <Chip
              key={diet}
              label={humanizeSlug(diet)}
              pressed={filter.diets.includes(diet)}
              testId={TEST_IDS.recipes.catalogChip("diet", diet)}
              onClick={() => onToggleDiet(diet)}
            />
          ))}
        </ChipRow>
      )}

      {cuisines.length > 0 && (
        <ChipRow legend="Cuisine">
          {cuisines.map((cuisine) => (
            <Chip
              key={cuisine}
              label={humanizeSlug(cuisine)}
              pressed={filter.cuisines.includes(cuisine)}
              testId={TEST_IDS.recipes.catalogChip("cuisine", cuisine)}
              onClick={() => onToggleCuisine(cuisine)}
            />
          ))}
        </ChipRow>
      )}
    </div>
  );
}
