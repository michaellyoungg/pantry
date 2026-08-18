import { formatUseBy, isOverdue } from "@pantry/core";
import { type UseItUpVariant, useUseItUp } from "@pantry/core/data";
import { Link } from "@tanstack/react-router";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";

/**
 * The ONE "use it up" surface (BL-0050), rendered for web.
 *
 * All of the wiring — the expiring batch, the nudge gate, the refetch key, and
 * the save-then-plan dance a generated suggestion needs — lives in
 * `useUseItUp()` (`@pantry/core/data`), so the native pantry screen renders the
 * same surface rather than re-wiring it. See that hook for why each of those
 * pieces is shaped the way it is.
 *
 * What is left here is presentation, and the presentation has one job: keep the
 * card's two signals visibly apart.
 *
 *  - **"Use this soon"** — a fact about the fridge with a deadline. It appears
 *    as the amber items strip and, per recipe, as the amber urgency line. This
 *    half needs no network call, so it still renders when the ranker is down.
 *  - **"You'd like this"** — a prediction about taste, rendered muted beneath.
 *
 * A third kind of row can appear here: a GENERATED suggestion (BL-0034), which
 * the server adds only when the corpus came up thin. It is an idea a model
 * invented, not a curated and tested recipe, so it is labelled as such.
 */
export function UseItUp({ variant = "nudge" }: { variant?: UseItUpVariant }) {
  const { batch, suggestions, loading, error, addError, silent, now, addToPlan } =
    useUseItUp(variant);

  if (silent) return null;

  return (
    <section
      aria-label="Use it up"
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-text">
        {batch.length === 0
          ? "Use it up"
          : batch.length === 1
            ? "1 item to use this week"
            : `${batch.length} items to use this week`}
      </h2>

      {batch.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {batch.map((row) => (
            <li key={row._id} className="text-sm text-text">
              {row.display}{" "}
              <span
                className={
                  row.useBy !== undefined && isOverdue(row.useBy, now)
                    ? "text-red-600"
                    : "text-amber-700"
                }
              >
                ({row.useBy === undefined ? "" : formatUseBy(row.useBy, now)})
              </span>
            </li>
          ))}
        </ul>
      )}

      {batch.length === 0 && (
        <p className="mt-1 text-sm text-muted">
          Nothing is about to go off. Here's what you could cook from what you have — mark items
          below to use up and they'll be prioritized.
        </p>
      )}

      <div className="mt-4">
        {loading && <p className="text-sm text-muted">Looking for recipes…</p>}

        {!loading && suggestions !== undefined && suggestions.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cook these</h3>
            <ul
              aria-label="Recipes that use these"
              className="mt-1 flex flex-col divide-y divide-border"
            >
              {suggestions.map((r) => (
                <li key={r.recipeId} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    {/* A generated idea has no recipe page to link to — it does
                        not exist yet — so it renders as plain text with the
                        badge instead of as a link that would 404. */}
                    {r.source === "generated" ? (
                      <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                        {r.title}
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          AI idea
                        </span>
                      </p>
                    ) : (
                      <Link
                        to="/recipes"
                        className="font-medium text-primary hover:underline"
                        aria-label={r.title}
                      >
                        {r.title}
                      </Link>
                    )}

                    {/* Said plainly, not just as a badge: this is the one row on
                        the card that nobody has cooked or checked. */}
                    {r.source === "generated" && (
                      <p className="text-xs text-muted">
                        Suggested by AI from your pantry — not a tested recipe. Check it before you
                        cook.
                      </p>
                    )}

                    {/* Urgency reads as its own amber line, never mixed into the
                        muted fit reasons below: "this spoils in two days" is a
                        deadline, and "uses 4 things you have" is a preference. */}
                    {r.urgency !== undefined && (
                      <p
                        className={`text-xs font-medium ${
                          isOverdue(r.urgency.useBy, now) ? "text-red-600" : "text-amber-700"
                        }`}
                      >
                        Use soon — {r.urgency.display} ({formatUseBy(r.urgency.useBy, now)})
                      </p>
                    )}

                    {r.reasons.length > 0 && (
                      <p className="text-xs text-muted">{r.reasons.slice(0, 3).join(" · ")}</p>
                    )}

                    {/* Defence in depth: a producer bug can serialize `missing`
                        as null (a nil Go slice encodes that way) even though the
                        type says it never can. Guard here so a bad payload
                        degrades to "no missing line" instead of crashing. */}
                    {(r.missing?.length ?? 0) > 0 && (
                      <p className="text-xs text-muted">
                        Need: {r.missing.map((m) => m.display).join(", ")}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Add ${r.title} to plan`}
                    onClick={() => addToPlan(r)}
                  >
                    {r.source === "generated" ? "Save & plan" : "Add to plan"}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Empty is a first-class state, distinct from failure. The wording
            differs by variant because the question differs: on Home the user is
            looking at food about to spoil, on /pantry they are browsing. */}
        {!loading && error === null && suggestions !== undefined && suggestions.length === 0 && (
          <p className="text-sm text-muted">
            {batch.length > 0 ? (
              <>
                No recipe uses these yet —{" "}
                <Link to="/recipes/catalog" className="text-primary hover:underline">
                  browse the catalog
                </Link>
                .
              </>
            ) : (
              "Nothing close yet — mark a few more items you have."
            )}
          </p>
        )}

        {/* Recommendations are additive and must never break the page. A failed
            lookup collapses to this line; the items strip above came from local
            state and is still useful on its own. */}
        {!loading && error !== null && <ErrorText message="Couldn't load suggestions just now." />}

        {/* A failed ADD is a different failure and was previously silent: the
            card looked fine and the recipe simply never reached the plan. */}
        <ErrorText message={addError} />
      </div>

      {batch.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Dates are estimates from typical shelf life, not printed labels.
        </p>
      )}
    </section>
  );
}
