/**
 * The ONE "use it up" surface (BL-0050), native (BL-0059).
 *
 * There is exactly one of these per client and it is not a second surface: the
 * wiring — the expiring batch, the nudge-vs-page gate, the refetch key, and the
 * save-then-plan dance a generated suggestion needs — is `useUseItUp()` in
 * `@pantry/core/data`, shared verbatim with `apps/web/src/components/UseItUp.tsx`.
 *
 * The card expresses TWO signals and keeps them visibly apart:
 *
 *  - **"Use this soon"** — a fact about the fridge with a deadline, shown as the
 *    amber items strip and, per recipe, as the amber urgency line. It is derived
 *    from local Convex state, so it still renders when the ranker is slow or
 *    down — which on a phone is often.
 *  - **"You'd like this"** — a prediction about taste, muted beneath.
 *
 * Nothing here navigates. The recipes route is still a placeholder (BL-0061),
 * so a title that looked like a link would go nowhere; web's version links to
 * `/recipes` and this one deliberately does not, rather than sharing a
 * navigation concern the parity plan keeps out of the shared layer.
 */
import { formatUseBy, isOverdue } from "@pantry/core";
import { type UseItUpVariant, useUseItUp } from "@pantry/core/data";
import type { Recommendation } from "@pantry/types";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("pantry");

export function UseItUpCard({ variant = "page" }: { variant?: UseItUpVariant }) {
  const { batch, suggestions, loading, error, addError, silent, now, addToPlan } =
    useUseItUp(variant);

  if (silent) return null;

  return (
    <View
      className="gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
      testID={id("use-it-up")}
    >
      <Text className="text-lg font-semibold text-text" testID={id("use-it-up-heading")}>
        {batch.length === 0
          ? "Use it up"
          : batch.length === 1
            ? "1 item to use this week"
            : `${batch.length} items to use this week`}
      </Text>

      {batch.length > 0 && (
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          {batch.map((row) => (
            <Text
              key={row._id}
              className="text-sm text-text"
              testID={id("expiring", testIDKey(row.canonicalItem))}
            >
              {row.display}{" "}
              <Text
                className={
                  row.useBy !== undefined && isOverdue(row.useBy, now)
                    ? "text-danger"
                    : "text-amber-700"
                }
              >
                ({row.useBy === undefined ? "" : formatUseBy(row.useBy, now)})
              </Text>
            </Text>
          ))}
        </View>
      )}

      {batch.length === 0 && (
        <Text className="text-sm text-muted" testID={id("nothing-expiring")}>
          Nothing is about to go off. Here's what you could cook from what you have — mark items
          below to use up and they'll be prioritized.
        </Text>
      )}

      {loading && (
        <Text className="text-sm text-muted" testID={id("suggestions-loading")}>
          Looking for recipes…
        </Text>
      )}

      {!loading && suggestions !== undefined && suggestions.length > 0 && (
        <View className="gap-1">
          <Text className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Cook these
          </Text>
          {suggestions.map((r) => (
            <SuggestionRow key={r.recipeId} recommendation={r} now={now} onAdd={addToPlan} />
          ))}
        </View>
      )}

      {/* Empty is a first-class state, distinct from failure. */}
      {!loading && error === null && suggestions !== undefined && suggestions.length === 0 && (
        <Text className="text-sm text-muted" testID={id("suggestions-empty")}>
          {batch.length > 0
            ? "No recipe uses these yet — browse the catalog on the web app."
            : "Nothing close yet — mark a few more items you have."}
        </Text>
      )}

      {/* Recommendations are additive and must never take the card down with
          them: the items strip above came from local state and is still useful
          on its own. */}
      {!loading && error !== null && (
        <Text className="text-sm text-danger" testID={id("suggestions-error")}>
          Couldn't load suggestions just now.
        </Text>
      )}

      {addError === null ? null : (
        <Text className="text-sm text-danger" testID={id("add-error")}>
          {addError}
        </Text>
      )}

      {batch.length > 0 && (
        <Text className="text-xs text-muted" testID={id("estimate-note")}>
          Dates are estimates from typical shelf life, not printed labels.
        </Text>
      )}
    </View>
  );
}

function SuggestionRow({
  recommendation: r,
  now,
  onAdd,
}: {
  recommendation: Recommendation;
  now: number;
  onAdd: (recommendation: Recommendation) => void;
}) {
  // Keyed on the title rather than `recipeId`: a recipe id is an opaque server
  // string that may be wholly numeric, and `testID()` rejects a numeric segment
  // as positional. The title is the identity the user is looking at anyway.
  const key = testIDKey(r.title);
  const generated = r.source === "generated";

  return (
    <View
      className="flex-row items-start gap-3 border-t border-border py-3"
      testID={id("suggestion", key)}
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium text-text">{r.title}</Text>

        {/* Said plainly, not just as a badge: this is the one row on the card
            that nobody has cooked or checked. */}
        {generated && (
          <>
            <Text
              className="self-start rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted"
              testID={id("ai-idea", key)}
            >
              AI idea
            </Text>
            <Text className="text-xs text-muted">
              Suggested by AI from your pantry — not a tested recipe. Check it before you cook.
            </Text>
          </>
        )}

        {/* Urgency reads as its own amber line, never mixed into the muted fit
            reasons below: "this spoils in two days" is a deadline, and "uses 4
            things you have" is a preference. */}
        {r.urgency !== undefined && (
          <Text
            className={`text-xs font-medium ${
              isOverdue(r.urgency.useBy, now) ? "text-danger" : "text-amber-700"
            }`}
            testID={id("urgency", key)}
          >
            Use soon — {r.urgency.display} ({formatUseBy(r.urgency.useBy, now)})
          </Text>
        )}

        {r.reasons.length > 0 && (
          <Text className="text-xs text-muted">{r.reasons.slice(0, 3).join(" · ")}</Text>
        )}

        {/* Defence in depth: a producer bug can serialize `missing` as null (a
            nil Go slice encodes that way) even though the type says it never
            can. Guard here so a bad payload degrades to "no missing line"
            instead of crashing. */}
        {(r.missing?.length ?? 0) > 0 && (
          <Text className="text-xs text-muted">
            Need: {r.missing.map((m) => m.display).join(", ")}
          </Text>
        )}
      </View>

      <Pressable
        className="rounded-full border border-primary/40 bg-primary/10 px-4 py-2.5"
        accessibilityRole="button"
        accessibilityLabel={`Add ${r.title} to plan`}
        onPress={() => onAdd(r)}
        testID={id("add-to-plan", key)}
      >
        <Text className="text-sm font-semibold text-primary">
          {generated ? "Save & plan" : "Add"}
        </Text>
      </Pressable>
    </View>
  );
}
