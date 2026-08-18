/**
 * The recipe review-and-edit fields, native (BL-0020's one review surface).
 *
 * Fully controlled: the caller owns a `RecipeDraft`, so an import can pre-fill
 * it and an edit can seed it from what is stored. The web counterpart is
 * `apps/web/src/components/RecipeFields.tsx` and the field set is the same one,
 * because a field only one client renders is a field the other silently drops
 * on save.
 *
 * Ordered by how much a wrong value costs: title and yield first, then the
 * metadata the catalog filters on, then the long lists. Every list edits in
 * place with an explicit "+" — a phone has no room for a grid of inputs, and
 * reordering is deliberately not offered, which is what makes an index key
 * honest here.
 */
import { formatTags, MAX_TOTAL_MINUTES, parseTags, type RecipeDraft } from "@pantry/core";
import { colorTokens } from "@pantry/design-tokens";
import type {
  CookingMethod,
  EquipmentDef,
  Ingredient,
  PrepTask,
  PrepTaskInput,
  RecipeEquipment,
} from "@pantry/types";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { EquipmentPicker } from "./EquipmentPicker";
import { PrepTaskEditor } from "./PrepTaskEditor";

const id = surfaceTestIDs("recipes");

export function RecipeFields({
  draft,
  equipment,
  derivedPrep,
  onChangeCuisine,
  onChangeEquipment,
  onChangeIngredients,
  onChangeMethods,
  onChangePrepTasks,
  onChangeServings,
  onChangeSteps,
  onChangeTags,
  onChangeTitle,
  onChangeTotalMinutes,
}: {
  draft: RecipeDraft;
  /** The curated equipment catalog, for the picker. */
  equipment: EquipmentDef[];
  /** What this recipe derives, offered for override. Empty while creating. */
  derivedPrep: PrepTask[];
  onChangeCuisine: (cuisine: string) => void;
  onChangeEquipment: (equipment: RecipeEquipment[]) => void;
  onChangeIngredients: (ingredients: Ingredient[]) => void;
  onChangeMethods: (methods: CookingMethod[]) => void;
  onChangePrepTasks: (tasks: PrepTaskInput[]) => void;
  onChangeServings: (servings: string) => void;
  onChangeSteps: (steps: string[]) => void;
  onChangeTags: (tags: string[]) => void;
  onChangeTitle: (title: string) => void;
  onChangeTotalMinutes: (totalMinutes: string) => void;
}) {
  function updateIngredient(index: number, patch: Partial<Ingredient>) {
    onChangeIngredients(
      draft.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    );
  }

  return (
    <View className="gap-4" testID={id("fields")}>
      <Field label="Title">
        <Input
          onChangeText={onChangeTitle}
          placeholder="What is it called?"
          testID={id("field-title")}
          value={draft.title}
        />
      </Field>

      <View className="flex-row gap-3">
        <Field className="flex-1" hint="blank if unknown" label="Serves">
          <Input
            keyboardType="number-pad"
            onChangeText={onChangeServings}
            placeholder="—"
            testID={id("field-servings")}
            value={draft.servings}
          />
        </Field>
        <Field className="flex-1" hint={`minutes, up to ${MAX_TOTAL_MINUTES}`} label="Cook time">
          <Input
            keyboardType="number-pad"
            onChangeText={onChangeTotalMinutes}
            placeholder="—"
            testID={id("field-total-minutes")}
            value={draft.totalMinutes}
          />
        </Field>
      </View>

      <Field label="Cuisine">
        <Input
          onChangeText={onChangeCuisine}
          placeholder="e.g. Italian"
          testID={id("field-cuisine")}
          value={draft.cuisine}
        />
      </Field>

      {/* The draft keeps tags as a list; one comma-separated field edits them,
          the same trade the web form makes. Parsing at this boundary is what
          keeps the list canonical. */}
      <Field hint="comma separated" label="Tags">
        <Input
          autoCapitalize="none"
          onChangeText={(text) => onChangeTags(parseTags(text))}
          placeholder="vegan, weeknight"
          testID={id("field-tags")}
          value={formatTags(draft.tags)}
        />
      </Field>

      <Field label="Ingredients">
        {draft.ingredients.map((ing, index) => (
          <View
            className="flex-row gap-2"
            // Rows carry no stable id and are only appended to or edited in
            // place, never reordered.
            // oxlint-disable-next-line react/no-array-index-key -- position IS a row's identity here
            key={index}
          >
            <Input
              accessibilityLabel={`Quantity for ingredient ${index + 1}`}
              className="w-16"
              keyboardType="decimal-pad"
              onChangeText={(text) => updateIngredient(index, { quantity: Number(text) })}
              testID={id("field-ingredient-quantity", `row-${index + 1}`)}
              value={String(ing.quantity)}
            />
            <Input
              accessibilityLabel={`Unit for ingredient ${index + 1}`}
              className="w-20"
              onChangeText={(text) => updateIngredient(index, { unit: text })}
              placeholder="unit"
              testID={id("field-ingredient-unit", `row-${index + 1}`)}
              value={ing.unit}
            />
            <Input
              accessibilityLabel={`Ingredient ${index + 1}`}
              className="flex-1"
              onChangeText={(text) => updateIngredient(index, { item: text })}
              placeholder="item"
              testID={id("field-ingredient-item", `row-${index + 1}`)}
              value={ing.item}
            />
          </View>
        ))}
        <AddRow
          label="+ ingredient"
          onPress={() =>
            onChangeIngredients([...draft.ingredients, { quantity: 1, unit: "", item: "" }])
          }
          testID={id("add-ingredient")}
        />
      </Field>

      <Field label="Steps">
        {draft.steps.map((step, index) => (
          <View
            className="flex-row items-center gap-2"
            // oxlint-disable-next-line react/no-array-index-key -- position IS a step's identity
            key={index}
          >
            <Text className="w-5 text-base font-semibold text-muted">{index + 1}</Text>
            <Input
              accessibilityLabel={`Step ${index + 1}`}
              className="flex-1"
              multiline
              onChangeText={(text) =>
                onChangeSteps(draft.steps.map((s, i) => (i === index ? text : s)))
              }
              placeholder="What happens?"
              testID={id("field-step", `row-${index + 1}`)}
              value={step}
            />
            <Pressable
              accessibilityLabel={`Remove step ${index + 1}`}
              accessibilityRole="button"
              className="items-center justify-center rounded-full px-3"
              onPress={() => onChangeSteps(draft.steps.filter((_, i) => i !== index))}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("remove-step", `row-${index + 1}`)}
            >
              <Text className="text-sm text-muted">Remove</Text>
            </Pressable>
          </View>
        ))}
        <AddRow
          label="+ step"
          onPress={() => onChangeSteps([...draft.steps, ""])}
          testID={id("add-step")}
        />
      </Field>

      <PrepTaskEditor derived={derivedPrep} onChange={onChangePrepTasks} tasks={draft.prepTasks} />

      <EquipmentPicker
        catalog={equipment}
        equipment={draft.equipment}
        methods={draft.methods}
        onChangeEquipment={onChangeEquipment}
        onChangeMethods={onChangeMethods}
      />
    </View>
  );
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <View className={`gap-2 ${className}`} testID={id("field", testIDKey(label))}>
      <View className="flex-row items-baseline gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</Text>
        {hint !== undefined && <Text className="text-xs text-muted">{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

function Input({
  className = "",
  multiline = false,
  ...props
}: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      autoCorrect={false}
      className={`rounded-lg border border-border bg-surface px-3 py-2 text-base text-text ${className}`}
      multiline={multiline}
      placeholderTextColor={colorTokens.muted}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      {...props}
    />
  );
}

function AddRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="items-center justify-center self-start rounded-full border border-border px-4"
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className="text-sm font-medium text-text">{label}</Text>
    </Pressable>
  );
}
