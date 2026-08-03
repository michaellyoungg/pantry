import type { CookingMethod, EquipmentDef, RecipeEquipment } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EquipmentEditor } from "./EquipmentEditor";

const CATALOG: EquipmentDef[] = [
  { id: "oven", name: "Oven", category: "appliance", aliases: ["oven"] },
  { id: "smoker", name: "Smoker", category: "appliance", aliases: ["smoker"] },
  { id: "sheet_pan", name: "Sheet pan", category: "cookware", aliases: ["sheet pan"] },
];

function setup(equipment: RecipeEquipment[] = [], methods: CookingMethod[] = []) {
  const onEquipmentChange = vi.fn();
  const onMethodsChange = vi.fn();
  render(
    <EquipmentEditor
      catalog={CATALOG}
      equipment={equipment}
      methods={methods}
      onEquipmentChange={onEquipmentChange}
      onMethodsChange={onMethodsChange}
    />,
  );
  return { onEquipmentChange, onMethodsChange };
}

describe("EquipmentEditor", () => {
  it("adds equipment as required by default", () => {
    const { onEquipmentChange } = setup();
    fireEvent.change(screen.getByLabelText("Add equipment"), { target: { value: "smoker" } });
    expect(onEquipmentChange).toHaveBeenCalledWith([{ id: "smoker", required: true }]);
  });

  it("toggles a tag between required and optional", () => {
    const { onEquipmentChange } = setup([{ id: "oven", required: true }]);
    fireEvent.click(screen.getByRole("button", { name: /mark oven as optional/i }));
    expect(onEquipmentChange).toHaveBeenCalledWith([{ id: "oven", required: false }]);
  });

  it("removes a tag", () => {
    const { onEquipmentChange } = setup([
      { id: "oven", required: true },
      { id: "smoker", required: true },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /remove oven/i }));
    expect(onEquipmentChange).toHaveBeenCalledWith([{ id: "smoker", required: true }]);
  });

  it("does not offer equipment that is already tagged", () => {
    setup([{ id: "oven", required: true }]);
    const options = Array.from(screen.getByLabelText("Add equipment").querySelectorAll("option"));
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["", "smoker", "sheet_pan"]);
  });

  it("toggles a cooking method on and off", () => {
    const { onMethodsChange } = setup([], ["bake"]);
    expect((screen.getByLabelText("Bake") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Smoke"));
    expect(onMethodsChange).toHaveBeenCalledWith(["bake", "smoke"]);
    fireEvent.click(screen.getByLabelText("Bake"));
    expect(onMethodsChange).toHaveBeenCalledWith([]);
  });

  it("falls back to the slug when the catalog has no entry for a tag", () => {
    // A tag whose catalog entry is missing (or whose catalog load failed) must
    // still render, so the user can see and remove it.
    setup([{ id: "waffle_iron", required: true }]);
    expect(screen.getByText("waffle_iron")).toBeTruthy();
  });
});
