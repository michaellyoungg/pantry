import { COOK_TIME_BUCKETS, type CookTimeBucketId, DIET_TAGS, humanizeSlug } from "@pantry/core";
import type { Recipe } from "@pantry/types";

/** The active filter selection. Empty/undefined everywhere means "show all". */
export interface CatalogFilter {
  query: string;
  /** Upper bound on cook time; recipes with no stated time never match. */
  cookTime?: CookTimeBucketId;
  diets: string[];
  cuisines: string[];
}

export const emptyFilter: CatalogFilter = { query: "", diets: [], cuisines: [] };

export function isFilterActive(filter: CatalogFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.cookTime !== undefined ||
    filter.diets.length > 0 ||
    filter.cuisines.length > 0
  );
}

/**
 * Free-text search across everything a cook might type: the title, the
 * ingredients, the cuisine and the tags. Searching tags is what keeps the open
 * vocabulary useful — a tag with no chip of its own is still findable.
 */
function matchesQuery(recipe: Recipe, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (recipe.title.toLowerCase().includes(q)) return true;
  if ((recipe.cuisine ?? "").includes(q)) return true;
  if ((recipe.tags ?? []).some((tag) => tag.includes(q))) return true;
  return recipe.ingredients.some((ing) => ing.item.toLowerCase().includes(q));
}

/**
 * Apply the whole filter. Groups are ANDed (a 20-minute vegan recipe), values
 * within a group are ORed (vegan OR vegetarian) — the behaviour every filter
 * chip UI has trained people to expect.
 */
export function applyCatalogFilter(recipes: Recipe[], filter: CatalogFilter): Recipe[] {
  return recipes.filter((recipe) => {
    if (!matchesQuery(recipe, filter.query)) return false;

    if (filter.cookTime !== undefined) {
      const bucket = COOK_TIME_BUCKETS.find((b) => b.id === filter.cookTime);
      // An unknown cook time matches no bucket. Treating it as fast would turn
      // missing data into a wrong answer on the one filter people rely on most.
      if (!bucket || recipe.totalMinutes === undefined) return false;
      if (recipe.totalMinutes > bucket.maxMinutes) return false;
    }

    const tags = recipe.tags ?? [];
    if (filter.diets.length > 0 && !filter.diets.some((d) => tags.includes(d))) return false;

    if (filter.cuisines.length > 0 && !filter.cuisines.includes(recipe.cuisine ?? "")) return false;

    return true;
  });
}

/**
 * The cuisines actually present in the catalog, sorted. Derived from the data
 * rather than from a hard-coded list, so a new seed recipe brings its own chip
 * and no chip is ever offered that would match nothing.
 */
function cuisinesIn(recipes: Recipe[]): string[] {
  const found = new Set<string>();
  for (const r of recipes) {
    if (r.cuisine) found.add(r.cuisine);
  }
  return [...found].sort();
}

/** Same idea for diets: only offer a diet chip the catalog can satisfy. */
function dietsIn(recipes: Recipe[]): string[] {
  const present = new Set(recipes.flatMap((r) => r.tags ?? []));
  return DIET_TAGS.filter((d) => present.has(d));
}

function Chip({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
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
 * Filtering is client-side over the loaded catalog, which is honest while the
 * seed set is small; the shape here (a serializable CatalogFilter) is what a
 * server-side query would take, so moving it later is not a rewrite.
 */
export function CatalogFilters({
  recipes,
  filter,
  onChange,
}: {
  recipes: Recipe[];
  filter: CatalogFilter;
  onChange: (next: CatalogFilter) => void;
}) {
  const cuisines = cuisinesIn(recipes);
  const diets = dietsIn(recipes);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <div className="mb-3 flex flex-col gap-2">
      <ChipRow legend="Cook time">
        {COOK_TIME_BUCKETS.map((bucket) => (
          <Chip
            key={bucket.id}
            label={bucket.label}
            pressed={filter.cookTime === bucket.id}
            onClick={() =>
              onChange({
                ...filter,
                cookTime: filter.cookTime === bucket.id ? undefined : bucket.id,
              })
            }
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
              onClick={() => onChange({ ...filter, diets: toggle(filter.diets, diet) })}
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
              onClick={() => onChange({ ...filter, cuisines: toggle(filter.cuisines, cuisine) })}
            />
          ))}
        </ChipRow>
      )}
    </div>
  );
}
