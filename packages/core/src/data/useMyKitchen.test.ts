// @vitest-environment jsdom
import type { EquipmentDef } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listEquipment: vi.fn(async () => [] as unknown),
  setOwned: vi.fn(async () => undefined as unknown),
  owned: undefined as Array<{ equipmentId: string }> | undefined,
}));

vi.mock("convex/react", () => {
  const mutation = () => {
    const fn = ((...args: unknown[]) => state.setOwned(...(args as []))) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  };
  return {
    useAction: () => state.listEquipment,
    useMutation: mutation,
    useQuery: () => state.owned,
  };
});

const { useMyKitchen } = await import("./useMyKitchen");

const def = (id: string, name: string, category: EquipmentDef["category"]): EquipmentDef => ({
  id,
  name,
  category,
  aliases: [],
});

const CATALOG = [
  def("whisk", "Whisk", "tool"),
  def("oven", "Oven", "appliance"),
  def("skillet", "Skillet", "cookware"),
];

beforeEach(() => {
  vi.clearAllMocks();
  state.owned = [];
  state.listEquipment.mockResolvedValue(CATALOG);
  state.setOwned.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function mounted() {
  const view = renderHook(() => useMyKitchen());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("the inventory", () => {
  it("sections the catalog appliances-first", async () => {
    const { result } = await mounted();

    expect(result.current.groups.map((g) => g.label)).toEqual(["Appliances", "Cookware", "Tools"]);
  });

  it("tells 'still loading the inventory' apart from 'you own nothing'", async () => {
    state.owned = undefined;

    const { result } = await mounted();

    expect(result.current.inventoryLoading).toBe(true);
    expect(result.current.ownedCount).toBe(0);
  });

  it("reports what is ticked", async () => {
    state.owned = [{ equipmentId: "oven" }];

    const { result } = await mounted();

    expect(result.current.isOwned("oven")).toBe(true);
    expect(result.current.isOwned("whisk")).toBe(false);
    expect(result.current.ownedCount).toBe(1);
  });

  it("keeps the checkbox list usable when the catalog request fails", async () => {
    state.listEquipment.mockRejectedValueOnce(new Error("service down"));

    const { result } = renderHook(() => useMyKitchen());

    await waitFor(() => expect(result.current.catalogError).toBe("service down"));
    expect(result.current.groups).toEqual([]);
  });
});

describe("ticking a device", () => {
  it("writes the new state", async () => {
    const { result } = await mounted();
    act(() => result.current.setOwned("oven", true));

    await waitFor(() =>
      expect(state.setOwned).toHaveBeenCalledWith({ equipmentId: "oven", owned: true }),
    );
  });

  it("says so when the write fails, rather than silently reverting", async () => {
    state.setOwned.mockRejectedValueOnce(new Error("offline"));

    const { result } = await mounted();
    act(() => result.current.setOwned("oven", true));

    await waitFor(() => expect(result.current.error).toBe("offline"));
  });
});
