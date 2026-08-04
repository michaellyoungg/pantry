import type {
  EquipmentCategory,
  EquipmentDef,
  EquipmentFit,
  EquipmentFitStatus,
} from "@pantry/types";
import { equipmentName } from "./useEquipmentCatalog";

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

export interface FitBadge {
  label: string;
  /** Longer explanation, surfaced as a tooltip. */
  title: string;
  className: string;
}

/**
 * How each status is presented.
 *
 * `unknown` is deliberately grey and worded as ignorance, not encouragement.
 * Recipes reach it because nothing about their equipment was ever recorded, and
 * a hopeful green "probably fine" there would be the exact dishonesty BL-0043
 * set out to avoid.
 */
export const FIT_BADGES: Record<EquipmentFitStatus, FitBadge> = {
  makeable: {
    label: "You can make this",
    title: "You own everything this recipe needs",
    className: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  },
  blocked: {
    label: "Missing equipment",
    title: "This recipe needs equipment that isn't in your kitchen yet",
    className: "bg-amber-500/10 text-amber-600",
  },
  unknown: {
    label: "Equipment unknown",
    title: "No equipment was ever recorded for this recipe, so we can't tell",
    className: "bg-border text-muted",
  },
};

/** "Missing: Smoker, Stand mixer" — names, not slugs. */
export function missingLabel(catalog: EquipmentDef[], missing: string[]): string {
  return missing.map((id) => equipmentName(catalog, id)).join(", ");
}

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
