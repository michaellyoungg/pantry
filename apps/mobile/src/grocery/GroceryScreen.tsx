/**
 * The grocery list, natively (BL-0057).
 *
 * Presentation over `useGroceryList()` and nothing else. Both subscriptions,
 * the mutations and their optimistic updates, the cart and dropped-line
 * partitions, the aisle grouping, the transient-highlight windows and the undo
 * offer all live in `@pantry/core/data`, and every string on screen that is
 * derived from a line — what to buy, what the recipes needed, what is left over
 * — comes from `@pantry/core`. If a rule about groceries appears in this file,
 * it is in the wrong file: the web screen would need the same rule and the two
 * would drift.
 *
 * What *is* native, and what this file is actually for:
 *
 * 1. **A `SectionList` with sticky aisle headers.** The aisle you are standing
 *    in stays pinned to the top of the screen while you scroll the rest of it.
 *    A shopper looking up from a shelf needs to know which section they are in
 *    without scrolling back, and a header that scrolls away answers that
 *    question only when it is not being asked.
 * 2. **A thumb-sized check-off, and mis-aims that land on it.** See
 *    `GroceryRow` and `hitTargets.ts`.
 * 3. **A bottom bar, outside the scroll view.** What is global to the trip —
 *    how much is left, adding something, ending the trip, undoing a delete — is
 *    pinned within thumb reach and never scrolls away, because in a shop the
 *    alternative is scrolling to the end of a list to finish.
 * 4. **Bottom sheets, never centred dialogs.** See `Sheet`.
 *
 * Offline is explicitly *not* here: this screen assumes connectivity and is
 * expected to be replaced in place by BL-0058.
 */
import { titleCase } from "@pantry/core";
import { type GroceryLine, useGroceryList } from "@pantry/core/data";
import { useState } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { AddItemField } from "./AddItemField";
import { DoneShoppingSheet } from "./DoneShoppingSheet";
import { GroceryRow } from "./GroceryRow";
import { CONTROL_TARGET_HEIGHT } from "./hitTargets";
import { LeftoverPrompts } from "./LeftoverPrompts";
import { ProvenanceSheet } from "./ProvenanceSheet";
import { Sheet, SheetButton } from "./Sheet";

const id = surfaceTestIDs("list");

/** A heading over one part of the list that is not an aisle. */
function GroupHeading({
  title,
  description,
  testID,
  children,
}: {
  title: string;
  description?: string;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-4 rounded-lg border border-border bg-surface p-3" testID={testID}>
      <Text className="text-xs font-semibold uppercase text-muted">{title}</Text>
      {description !== undefined && <Text className="mt-1 text-xs text-muted">{description}</Text>}
      <View className="mt-2">{children}</View>
    </View>
  );
}

export function GroceryScreen() {
  const {
    lines,
    loading,
    active,
    removed,
    toBuy,
    inCart,
    groups,
    pendingLeftovers,
    recentItems,
    leaving,
    highlighted,
    undo,
    error,
    toggle,
    remove,
    undoRemove,
    needItAnyway,
    addManual,
    resolveLeftover,
    clear,
    finish,
  } = useGroceryList();

  // Which line's provenance sheet is open, by row id — not the row itself, so
  // the sheet keeps re-rendering from live data while it is open.
  const [showingSourcesFor, setShowingSourcesFor] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [adding, setAdding] = useState(false);

  const showingSources = lines.find((line) => line._id === showingSourcesFor);

  const footer = (
    <View>
      {inCart.length > 0 && (
        <GroupHeading
          description="Checked off, and already added to your pantry."
          testID={id("in-cart-section")}
          title={`In cart · ${inCart.length}`}
        >
          {inCart.map((line) => (
            <GroceryRow
              highlighted={highlighted.has(line._id)}
              key={line._id}
              line={line}
              onOpenSources={() => setShowingSourcesFor(line._id)}
              onRemove={line.manual ? () => remove(line) : undefined}
              onToggle={(checked) => toggle(line, checked)}
            />
          ))}
        </GroupHeading>
      )}

      {removed.length > 0 && (
        <GroupHeading
          description="You had already checked these off when the plan changed, so they were kept rather than deleted."
          testID={id("dropped-section")}
          title={`No longer in your plan · ${removed.length}`}
        >
          {removed.map((line) => (
            <View className="flex-row items-center gap-2" key={line._id}>
              <Text className="flex-1 text-sm text-muted line-through">{line.item}</Text>
              <Pressable
                accessibilityRole="button"
                className="items-center justify-center rounded-lg bg-border px-3"
                onPress={() => remove(line)}
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={id("dismiss", testIDKey(line.item))}
              >
                <Text className="text-sm text-text">Dismiss</Text>
              </Pressable>
            </View>
          ))}
        </GroupHeading>
      )}

      {/* Below the walk: it only has anything to say once lines have been
          checked off, which is the end of a shop. */}
      <LeftoverPrompts onResolve={resolveLeftover} proposals={pendingLeftovers} />

      {lines.length > 0 && (
        <Pressable
          accessibilityRole="button"
          className="mt-4 items-center justify-center self-end rounded-lg px-4"
          onPress={() => setConfirmingClear(true)}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("clear")}
        >
          <Text className="text-sm text-danger">Clear list</Text>
        </Pressable>
      )}

      {error !== null && (
        <Text className="mt-2 text-sm text-danger" testID={id("error")}>
          {error}
        </Text>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-bg" testID={id("screen")}>
      <SectionList
        contentContainerClassName="px-4 pb-6 pt-2"
        testID={id("aisle-walk")}
        keyExtractor={(line) => line._id}
        ListEmptyComponent={
          loading ? (
            <Text className="p-4 text-sm text-muted" testID={id("loading")}>
              Loading your list…
            </Text>
          ) : lines.length === 0 ? (
            <Text className="p-4 text-sm text-muted" testID={id("empty-state")}>
              Nothing yet — generate from your basket, or add something below.
            </Text>
          ) : null
        }
        ListFooterComponent={footer}
        renderItem={({ item: line }: { item: GroceryLine }) => (
          <GroceryRow
            highlighted={highlighted.has(line._id)}
            leaving={leaving.has(line._id)}
            line={line}
            onNeedItAnyway={() => needItAnyway(line)}
            onOpenSources={() => setShowingSourcesFor(line._id)}
            // Only manual lines can be removed — a generated one comes back on
            // the next generation, so "remove" would be a lie.
            onRemove={line.manual ? () => remove(line) : undefined}
            onToggle={(checked) => toggle(line, checked)}
          />
        )}
        renderSectionHeader={({ section }) => (
          // Opaque and bordered on purpose. A sticky header is drawn *over*
          // scrolling rows, so a transparent one turns into two overlapping
          // lines of text at exactly the moment it is being read.
          <View
            className="-mx-4 border-b border-border bg-bg px-4 py-2"
            testID={id("aisle-header", testIDKey(section.aisle))}
          >
            <Text className="text-sm font-semibold uppercase text-text">
              {titleCase(section.aisle)} · {section.data.length}
            </Text>
          </View>
        )}
        sections={groups.map((group) => ({ aisle: group.aisle, data: group.lines }))}
        stickySectionHeadersEnabled
      />

      {/* The thumb zone. Never scrolls, never more than a thumb's reach from
          the bottom of the screen, and sits above the tab bar. */}
      <View className="border-t border-border bg-surface px-4 py-3">
        {undo !== null && (
          <View className="mb-2 flex-row items-center gap-2 rounded-lg bg-border px-3 py-2">
            <Text className="flex-1 text-sm text-text" testID={id("undo")}>
              Removed {undo.item}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="items-center justify-center rounded-lg bg-surface px-3"
              onPress={undoRemove}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("undo-button")}
            >
              <Text className="text-sm font-medium text-text">Undo</Text>
            </Pressable>
          </View>
        )}
        {adding && (
          <View className="mb-2">
            <AddItemField onAdd={addManual} recent={recentItems} />
          </View>
        )}
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-xs text-muted" testID={id("progress")}>
            {active.length === 0
              ? "Nothing on the list"
              : `${inCart.length} of ${active.length} in cart`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: adding }}
            className="items-center justify-center rounded-lg bg-border px-4"
            onPress={() => setAdding((wasAdding) => !wasAdding)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("add-toggle")}
          >
            <Text className="text-base font-medium text-text">{adding ? "Close" : "Add item"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: lines.length === 0 }}
            className={`items-center justify-center rounded-lg px-4 ${
              lines.length === 0 ? "bg-border" : "bg-primary"
            }`}
            disabled={lines.length === 0}
            onPress={() => setFinishing(true)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("done-shopping")}
          >
            <Text
              className={`text-base font-medium ${
                lines.length === 0 ? "text-muted" : "text-surface"
              }`}
            >
              Done shopping
            </Text>
          </Pressable>
        </View>
      </View>

      {showingSources?.sources && (
        <ProvenanceSheet
          item={showingSources.item}
          onClose={() => setShowingSourcesFor(null)}
          sources={showingSources.sources}
          unit={showingSources.unit}
        />
      )}
      {finishing && (
        <DoneShoppingSheet
          inCart={inCart.length}
          onCancel={() => setFinishing(false)}
          onChoose={(choice) => {
            setFinishing(false);
            finish(choice);
          }}
          stillToBuy={toBuy.length}
          unansweredLeftovers={pendingLeftovers.length}
        />
      )}
      {confirmingClear && (
        // An in-tree sheet rather than `Alert.alert`, for the same reason web
        // uses an overlay rather than `showModal()`: a native alert is drawn by
        // the OS and cannot be exercised by a test, and this is a destructive
        // action that deserves one.
        <Sheet
          onClose={() => setConfirmingClear(false)}
          testID={id("confirm-sheet")}
          title="Clear the grocery list?"
        >
          <Text className="mt-2 text-sm text-muted">
            Every line goes, including the ones you have already checked off.
          </Text>
          <SheetButton
            label="Clear"
            onPress={() => {
              setConfirmingClear(false);
              clear();
            }}
            testID={id("confirm-clear")}
            tone="primary"
          />
          <SheetButton
            label="Keep the list"
            onPress={() => setConfirmingClear(false)}
            testID={id("confirm-cancel")}
            tone="quiet"
          />
        </Sheet>
      )}
    </View>
  );
}
