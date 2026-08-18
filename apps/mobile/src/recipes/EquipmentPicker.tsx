/**
 * A recipe's equipment tags and cooking methods, native (BL-0041).
 *
 * Import guesses both from the step text, so the job here is correcting a
 * guess: drop a tag, demote it to optional, or add one the scan missed. The web
 * counterpart (`EquipmentEditor.tsx`) uses a `<select>` for the catalog because
 * it can be 50+ entries; a phone gets the same list as chips grouped by
 * category, which is the same information without a picker inside a form inside
 * a scroll view.
 *
 * Getting this right is what makes the catalog's "only what I can make" filter
 * mean anything — an untagged recipe is `unknown` forever.
 */
import { COOKING_METHOD_LABELS, COOKING_METHODS, groupByCategory } from "@pantry/core";
import type { CookingMethod, EquipmentDef, RecipeEquipment } from "@pantry/types";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("recipes");

export function EquipmentPicker({
  catalog,
  equipment,
  methods,
  onChangeEquipment,
  onChangeMethods,
}: {
  catalog: EquipmentDef[];
  equipment: RecipeEquipment[];
  methods: CookingMethod[];
  onChangeEquipment: (equipment: RecipeEquipment[]) => void;
  onChangeMethods: (methods: CookingMethod[]) => void;
}) {
  const selected = new Map(equipment.map((e) => [e.id, e]));

  /**
   * One tap adds it as required, the next demotes it to optional, the third
   * drops it. A three-state cycle rather than a chip plus a switch: "optional"
   * is a rare answer, and giving it its own control would double the number of
   * targets in the densest part of the form.
   */
  function cycle(equipmentId: string) {
    const current = selected.get(equipmentId);
    if (current === undefined) {
      onChangeEquipment([...equipment, { id: equipmentId, required: true }]);
      return;
    }
    onChangeEquipment(
      current.required
        ? equipment.map((e) => (e.id === equipmentId ? { ...e, required: false } : e))
        : equipment.filter((e) => e.id !== equipmentId),
    );
  }

  function toggleMethod(method: CookingMethod) {
    onChangeMethods(
      methods.includes(method) ? methods.filter((m) => m !== method) : [...methods, method],
    );
  }

  return (
    <View className="gap-3" testID={id("equipment-picker")}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Equipment</Text>
      {catalog.length === 0 && (
        <Text className="text-sm text-muted" testID={id("equipment-picker-empty")}>
          The equipment catalog isn't available right now — you can still save the recipe.
        </Text>
      )}
      {groupByCategory(catalog).map((group) => (
        <View className="gap-2" key={group.category}>
          <Text className="text-xs text-muted">{group.label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {group.items.map((item) => {
              const chosen = selected.get(item.id);
              const state =
                chosen === undefined ? "none" : chosen.required ? "required" : "optional";
              return (
                <Pressable
                  accessibilityLabel={
                    state === "none"
                      ? `Add ${item.name}`
                      : state === "required"
                        ? `${item.name} is required. Make it optional.`
                        : `${item.name} is optional. Remove it.`
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: state !== "none" }}
                  className={`items-center justify-center rounded-full border px-3 ${
                    state === "required"
                      ? "border-transparent bg-primary"
                      : state === "optional"
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-surface"
                  }`}
                  key={item.id}
                  onPress={() => cycle(item.id)}
                  style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                  testID={id("equipment-tag", testIDKey(item.id))}
                >
                  <Text
                    className={`text-sm font-medium ${
                      state === "required"
                        ? "text-surface"
                        : state === "optional"
                          ? "text-primary"
                          : "text-muted"
                    }`}
                  >
                    {item.name}
                    {state === "optional" ? " (optional)" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Methods</Text>
      <View className="flex-row flex-wrap gap-2">
        {COOKING_METHODS.map((method) => {
          const chosen = methods.includes(method);
          return (
            <Pressable
              accessibilityLabel={COOKING_METHOD_LABELS[method]}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              className={`items-center justify-center rounded-full border px-3 ${
                chosen ? "border-transparent bg-text" : "border-border bg-surface"
              }`}
              key={method}
              onPress={() => toggleMethod(method)}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("method", testIDKey(method))}
            >
              <Text className={`text-sm font-medium ${chosen ? "text-surface" : "text-muted"}`}>
                {COOKING_METHOD_LABELS[method]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
