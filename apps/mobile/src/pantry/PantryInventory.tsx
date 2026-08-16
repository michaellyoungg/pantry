/**
 * The pantry inventory, native (BL-0059).
 *
 * The web counterpart is `apps/web/src/components/Pantry.tsx`. Both are
 * presentation over `usePantry()` from `@pantry/core/data`; the subscription,
 * the three mutations and their optimistic updates, the aisle grouping and the
 * have → low → out → have cycle are shared, and no view code crosses between
 * the clients.
 *
 * The interaction design diverges from web on purpose. This screen is used
 * standing in front of a fridge, one-handed, so the controls that get used —
 * the state cycle and the use-up flag — are full-height targets rather than the
 * 20px pills the desktop layout can afford, and the destructive one asks first
 * rather than firing on a mis-tap.
 */
import { formatUseBy, isOverdue, titleCase } from "@pantry/core";
import { type PantryItem, usePantry } from "@pantry/core/data";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("pantry");

/** Capitalised for a control the user reads as a word, not as a data value. */
const STATE_LABEL = { have: "Have", low: "Low", out: "Out" } as const;

/**
 * Only `low` reaches outside the token palette. `have` and `out` are the
 * product's own primary/border colours, but "running low" is a warning, and
 * `danger` is already spoken for by overdue and by destructive actions — using
 * it here would make three different meanings share one colour.
 */
const STATE_STYLE = {
  have: "border-primary/40 bg-primary/10",
  low: "border-amber-500/50 bg-amber-500/10",
  out: "border-border bg-border",
} as const;

const STATE_TEXT = {
  have: "text-primary",
  low: "text-amber-700",
  out: "text-muted",
} as const;

export function PantryInventory() {
  const { items, groups, loading, error, cycleState, toggleUseItUp, remove } = usePantry();

  // Which row is mid-confirmation, keyed by document id. One at a time: tapping
  // a second Remove moves the prompt rather than opening two.
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <View className="gap-3" testID={id("inventory")}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Inventory</Text>

      {/* "Still loading" and "genuinely empty" are different answers to "what do
          I own?", and the web screen conflates them — it renders the empty copy
          during the first round trip. The hook distinguishes them, so this
          screen does too. */}
      {loading && (
        <Text className="text-sm text-muted" testID={id("loading")}>
          Loading your pantry…
        </Text>
      )}

      {!loading && items.length === 0 && (
        <Text className="text-sm text-muted" testID={id("empty-state")}>
          Nothing here yet — check items off your grocery list and they'll show up, so you don't
          rebuy things you already own.
        </Text>
      )}

      {groups.map((group) => (
        <View key={group.aisle} className="gap-1">
          <Text
            className="text-xs font-semibold uppercase tracking-wide text-muted"
            testID={id("aisle", testIDKey(group.aisle))}
          >
            {titleCase(group.aisle)}
          </Text>
          {group.lines.map((item) => (
            <PantryRow
              key={item._id}
              item={item}
              confirmingRemove={confirming === item._id}
              onCycleState={() => cycleState(item)}
              onToggleUseItUp={() => toggleUseItUp(item)}
              onAskRemove={() => setConfirming(item._id)}
              onCancelRemove={() => setConfirming(null)}
              onConfirmRemove={() => {
                setConfirming(null);
                remove(item);
              }}
            />
          ))}
        </View>
      ))}

      {/* The don't-rebuy signal stated plainly (BL-0021). The state pills above
          are the control; this is what they mean, and without it "Have" reads as
          a note to self rather than as something that changes the next list. */}
      {items.length > 0 && (
        <Text className="text-xs text-muted" testID={id("rebuy-note")}>
          Only items marked Have are skipped when building your grocery list.
        </Text>
      )}

      {error === null ? null : (
        <Text className="text-sm text-danger" testID={id("error")}>
          {error}
        </Text>
      )}
    </View>
  );
}

function PantryRow({
  item,
  confirmingRemove,
  onCycleState,
  onToggleUseItUp,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  item: PantryItem;
  confirmingRemove: boolean;
  onCycleState: () => void;
  onToggleUseItUp: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const key = testIDKey(item.canonicalItem);
  const now = Date.now();
  const overdue = item.useBy !== undefined && isOverdue(item.useBy, now);

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3" testID={id("item", key)}>
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-base text-text" testID={id("item-name", key)}>
            {item.display}
          </Text>
          {/* Relative and tilde-marked on purpose: this date came from a
              shelf-life table when the item entered the pantry, not off a
              carton, and an absolute date would imply a precision we don't
              have. Items we don't recognize get no date at all. */}
          {item.useBy !== undefined && (
            <Text
              className={`text-xs ${overdue ? "text-danger" : "text-muted"}`}
              testID={id("use-by", key)}
            >
              {formatUseBy(item.useBy, now)}
              {overdue ? " · past its date" : ""}
            </Text>
          )}
        </View>

        <Pressable
          className={`min-w-20 items-center rounded-full border px-4 py-2.5 ${STATE_STYLE[item.state]}`}
          accessibilityRole="button"
          accessibilityLabel={`${item.display} is: ${item.state}. Change.`}
          onPress={onCycleState}
          testID={id("state", key)}
        >
          <Text className={`text-sm font-semibold ${STATE_TEXT[item.state]}`}>
            {STATE_LABEL[item.state]}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-center gap-2">
        <Pressable
          className={`rounded-full border px-3 py-2 ${
            item.useItUp ? "border-amber-500/50 bg-amber-500/20" : "border-border"
          }`}
          accessibilityRole="button"
          accessibilityState={{ selected: item.useItUp === true }}
          accessibilityLabel={
            item.useItUp ? `Stop using up ${item.display}` : `Mark ${item.display} to use up`
          }
          onPress={onToggleUseItUp}
          testID={id("use-up", key)}
        >
          <Text className={`text-sm font-medium ${item.useItUp ? "text-amber-700" : "text-muted"}`}>
            Use up
          </Text>
        </Pressable>

        <View className="flex-1" />

        {/* Removing asks first. Web can afford a bare × next to a mouse cursor;
            a phone held in a kitchen cannot, and this row may be the only record
            that the user owns the thing. */}
        {confirmingRemove ? (
          <View className="flex-row items-center gap-2">
            <Pressable
              className="rounded-full border border-border px-3 py-2"
              accessibilityRole="button"
              accessibilityLabel={`Keep ${item.display}`}
              onPress={onCancelRemove}
              testID={id("cancel-remove", key)}
            >
              <Text className="text-sm text-muted">Keep</Text>
            </Pressable>
            <Pressable
              className="rounded-full border border-danger bg-danger px-3 py-2"
              accessibilityRole="button"
              accessibilityLabel={`Confirm removing ${item.display}`}
              onPress={onConfirmRemove}
              testID={id("confirm-remove", key)}
            >
              <Text className="text-sm font-semibold text-surface">Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            className="rounded-full px-3 py-2"
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.display}`}
            onPress={onAskRemove}
            testID={id("remove", key)}
          >
            <Text className="text-sm text-muted">Remove</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
