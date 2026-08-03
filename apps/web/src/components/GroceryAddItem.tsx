import { api } from "@pantry/convex/api";
import { parseManualEntry } from "@pantry/core";
import { useAsyncAction } from "@pantry/core/react";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/**
 * Adding something the plan did not ask for (BL-0019).
 *
 * A grocery list that only holds what the meal planner derived is not a grocery
 * list — foil, coffee and dish soap never come from a recipe. One field, not
 * three: in an aisle you type "2 lb butter", and `parseManualEntry` splits it
 * back apart. The aisle is resolved server-side from the same normalization
 * table the aggregator uses, so a typed "scallions" files itself next to a
 * recipe's "green onion" instead of landing in a catch-all.
 *
 * The chips are the pantry's most recently touched items — the things this
 * household actually buys — which makes the common case one tap and no typing.
 */
export function GroceryAddItem() {
  const [text, setText] = useState("");
  const addItem = useAction(api.groceryList.addManualItem);
  const recent = useQuery(api.groceryList.recentItems) ?? [];
  const { run, error } = useAsyncAction();

  async function add(raw: string) {
    const entry = parseManualEntry(raw);
    if (entry.item === "") return;
    // Clear optimistically: the field is the fastest thing on screen and waiting
    // for a round trip to empty it makes double-adds feel likely.
    setText("");
    await run(() => addItem(entry));
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
      <ErrorText message={error} />
    </div>
  );
}
