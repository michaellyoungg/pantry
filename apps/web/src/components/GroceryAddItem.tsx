import type { RecentItem } from "@pantry/core/data";
import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/**
 * Adding something the plan did not ask for (BL-0019).
 *
 * A grocery list that only holds what the meal planner derived is not a grocery
 * list — foil, coffee and dish soap never come from a recipe. One field, not
 * three: in an aisle you type "2 lb butter", and the data layer's
 * `parseManualEntry` splits it back apart. The aisle is resolved server-side
 * from the same normalization table the aggregator uses, so a typed
 * "scallions" files itself next to a recipe's "green onion" instead of landing
 * in a catch-all.
 *
 * The chips are the pantry's most recently touched items — the things this
 * household actually buys — which makes the common case one tap and no typing.
 *
 * Pure presentation since BL-0057: the subscription, the action and the parse
 * all live in `useGroceryList()`, so the native add field drives the same code
 * rather than a second copy of it. Failures surface through the list's own
 * error line, because they are the same `useAsyncAction` now.
 */
export function GroceryAddItem({
  recent,
  onAdd,
}: {
  recent: readonly RecentItem[];
  /** Takes the raw text. Parsing it is the data layer's job, not the field's. */
  onAdd: (typed: string) => void;
}) {
  const [text, setText] = useState("");

  function add(raw: string) {
    // Clear optimistically: the field is the fastest thing on screen and waiting
    // for a round trip to empty it makes double-adds feel likely.
    setText("");
    onAdd(raw);
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(text);
        }}
      >
        <Input
          className="min-h-11 flex-1"
          value={text}
          aria-label="Add an item"
          placeholder="Add an item — e.g. 2 lb butter"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" className="min-h-11" disabled={text.trim() === ""}>
          Add
        </Button>
      </form>
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recent.map((suggestion) => (
            <Button
              key={suggestion.canonicalItem}
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => add(suggestion.display)}
            >
              {suggestion.display}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
