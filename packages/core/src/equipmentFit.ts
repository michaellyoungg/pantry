/**
 * Reading an equipment fit (BL-0043) into something a screen can say.
 *
 * Lived in `apps/web/src/lib` until BL-0063 needed the same answers on native.
 * What moved is everything that is a judgement about the data — how the catalog
 * sections, what a status means in words, and what a filter is hiding. What
 * stayed behind is styling: `FIT_LABELS` carries the copy, and each client maps
 * a status to its own colours.
 */
import type {
  EquipmentCategory,
  EquipmentDef,
  EquipmentFit,
  EquipmentFitStatus,
} from "@pantry/types";

/** Catalog order for the My Kitchen sections: big things first. */
const CATEGORY_ORDER: EquipmentCategory[] = ["appliance", "cookware", "tool"];

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  appliance: "Appliances",
  cookware: "Cookware",
  tool: "Tools",
};

export interface EquipmentGroup {
  category: EquipmentCategory;
  label: string;
  items: EquipmentDef[];
}

/** Splits the catalog into the sections My Kitchen renders, dropping empty ones. */
export function groupByCategory(catalog: EquipmentDef[]): EquipmentGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: catalog.filter((e) => e.category === category),
  })).filter((g) => g.items.length > 0);
}

/**
 * Resolves an equipment slug to its display name, falling back to the slug so a
 * tag whose catalog entry is missing (or whose catalog request failed) still
 * renders as something rather than disappearing.
 */
export function equipmentName(catalog: EquipmentDef[], id: string): string {
  return catalog.find((e) => e.id === id)?.name ?? id;
}

/** "Smoker, Stand mixer" — names, not slugs. */
export function missingLabel(catalog: EquipmentDef[], missing: string[]): string {
  return missing.map((id) => equipmentName(catalog, id)).join(", ");
}

export interface FitLabel {
  label: string;
  /** Longer explanation — a web tooltip, a native accessibility hint. */
  description: string;
}

/**
 * What each status says.
 *
 * `unknown` is deliberately worded as ignorance, not encouragement. Recipes
 * reach it because nothing about their equipment was ever recorded, and a
 * hopeful "probably fine" there would be the exact dishonesty BL-0043 set out
 * to avoid.
 */
export const FIT_LABELS: Record<EquipmentFitStatus, FitLabel> = {
  makeable: {
    label: "You can make this",
    description: "You own everything this recipe needs",
  },
  blocked: {
    label: "Missing equipment",
    description: "This recipe needs equipment that isn't in your kitchen yet",
  },
  unknown: {
    label: "Equipment unknown",
    description: "No equipment was ever recorded for this recipe, so we can't tell",
  },
};

export interface FitTally {
  makeable: number;
  blocked: number;
  unknown: number;
}

/**
 * Bucket totals for the recipes actually on screen.
 *
 * Computed here rather than taken from the server's `counts`, which spans the
 * user's own recipes as well as the catalog: a "3 hidden" line has to count the
 * same list the user is looking at. A recipe with no fit at all — the server
 * didn't classify it — is counted as unknown, since that is precisely what it is.
 */
export function tallyFits(ids: string[], fits: Record<string, EquipmentFit>): FitTally {
  const tally: FitTally = { makeable: 0, blocked: 0, unknown: 0 };
  for (const id of ids) tally[fits[id]?.status ?? "unknown"]++;
  return tally;
}

/**
 * What the "only what I can make" filter is hiding, in words.
 *
 * Blocked and unknown are named separately on purpose. They are different
 * problems with different fixes — buy a thing, versus we never knew — and
 * collapsing them into one number would let missing data hide behind a count
 * that reads like a shopping list.
 */
export function hiddenSummary(tally: FitTally): string | null {
  const parts: string[] = [];
  if (tally.blocked > 0) parts.push(`${tally.blocked} you're missing equipment for`);
  if (tally.unknown > 0) parts.push(`${tally.unknown} we have no equipment details for`);
  if (parts.length === 0) return null;
  return `Hiding ${parts.join(" and ")}.`;
}
