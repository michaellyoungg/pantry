import { type AvoidEntry, useAvoidList } from "@pantry/core/data";
import type { AvoidResolution } from "@pantry/types";
import { useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * The line under the input that says what just happened to each entry.
 *
 * It exists because the silent case is the bug: an entry that matched nothing
 * used to look exactly like one that matched, and for an allergen that is the
 * failure that matters. `useAvoidList` hands back only the entries worth
 * reporting — one that resolved to exactly what was typed says nothing, since
 * its chip appearing is the whole story.
 */
function ResolutionNotes({
  resolutions,
  onAvoidFamily,
}: {
  resolutions: AvoidResolution[];
  onAvoidFamily: (family: string) => void;
}) {
  if (resolutions.length === 0) return null;
  return (
    // One live region for the whole report rather than one per line: adding a
    // diet seed list can produce several notes at once, and a screen reader
    // should hear them as a single answer to "what did that do?".
    <ul
      aria-label="What your last entry matched"
      className="mt-2 flex flex-col gap-1 text-xs"
      role="status"
    >
      {resolutions.map((r) => {
        if (r.kind === "unknown") {
          return (
            <li key={r.canonicalItem} className="text-danger">
              “{r.input}” doesn’t match any ingredient we know, so it won’t remove any recipes.
              Check the spelling, or try a more common name for it.
            </li>
          );
        }
        if (r.kind === "allergen") {
          return (
            <li key={r.canonicalItem} className="text-muted">
              Avoiding <strong className="text-text">{r.display}</strong> — this also removes
              recipes with {(r.members ?? []).join(", ")}.
            </li>
          );
        }
        return (
          <li key={r.canonicalItem} className="text-muted">
            Avoiding <strong className="text-text">{r.display}</strong>
            {r.display.toLowerCase() !== r.input.toLowerCase() ? ` (you typed “${r.input}”)` : ""}.
            {r.families?.length ? (
              <>
                {" "}
                It’s a {r.families.join(" and ")} ingredient —{" "}
                <button
                  type="button"
                  className="underline hover:text-text"
                  onClick={() => onAvoidFamily(r.families?.[0] ?? "")}
                >
                  avoid all {r.families[0]}
                </button>{" "}
                to cover the whole family.
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The chip for one stored entry, labelled with whatever is known about it. */
function AvoidChip({ entry, onRemove }: { entry: AvoidEntry; onRemove: () => void }) {
  const unmatched = entry.kind === "unknown";
  const family = entry.kind === "allergen";
  return (
    <li
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        unmatched ? "bg-danger/10 text-danger" : "bg-border text-text"
      }`}
      // The members list is long enough to swamp the chip row, so it lives in
      // the tooltip — but it is never withheld: the chip says a family is in
      // play, and hovering says exactly which ingredients that covers.
      title={
        family && entry.members.length ? `Also removes: ${entry.members.join(", ")}` : undefined
      }
    >
      <span>{entry.display}</span>
      {family ? <span className="text-muted">· allergen group</span> : null}
      {unmatched ? <span>· matches nothing</span> : null}
      <button
        type="button"
        aria-label={`Remove ${entry.display}`}
        className="text-muted hover:text-text"
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

/**
 * What the cook refuses (BL-0005, BL-0052): presentation over `useAvoidList()`.
 *
 * The subscription, the canonicalization round trip, the diet seed table and
 * the rule for which resolutions are worth reporting all live in
 * `@pantry/core/data`, so the native settings screen (BL-0066) says the same
 * things about the same list.
 */
export function Preferences() {
  const { entries, notes, diets, loading, error, add, applyDiet, remove } = useAvoidList();
  const [draft, setDraft] = useState("");

  const addDraft = () => {
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    add([value]);
  };

  return (
    <Card title="Preferences">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text">Ingredients to avoid</h3>
          <p className="mt-0.5 text-xs text-muted">
            Recipes with a matching ingredient are <strong>removed</strong>, not just ranked lower.
            Each entry is matched to a known ingredient as you add it, so "scallion" becomes green
            onion — and common allergens like "peanut" or "dairy" cover their whole group. Anything
            we don’t recognise is flagged, because an entry that matches nothing filters nothing.
          </p>

          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Ingredient to avoid"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
            />
            <Button variant="secondary" size="sm" onClick={addDraft} disabled={loading}>
              Add
            </Button>
          </div>

          <ResolutionNotes resolutions={notes} onAvoidFamily={(family) => add([family])} />

          <ul aria-label="Ingredients you avoid" className="mt-2 flex flex-wrap gap-1.5">
            {entries.map((entry) => (
              <AvoidChip
                key={entry.canonicalItem}
                entry={entry}
                onRemove={() => remove(entry.canonicalItem)}
              />
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text">Diet</h3>
          <p className="mt-0.5 text-xs text-muted">
            Picking one fills in the avoid list above, which you can then edit.
          </p>
          <div className="mt-2 flex gap-2">
            {diets.map((diet) => (
              <Button
                key={diet}
                variant="secondary"
                size="sm"
                disabled={loading}
                // Seeds are resolved by the same path as anything typed, so a
                // seed key that no longer exists is reported rather than stored
                // as a filter that matches nothing.
                onClick={() => applyDiet(diet)}
              >
                {diet}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <ErrorText message={error} />
    </Card>
  );
}
