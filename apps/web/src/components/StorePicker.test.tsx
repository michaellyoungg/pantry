import { TEST_IDS } from "@pantry/core/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, providerMock, searchMock, selectMock, clearMock } = vi.hoisted(() => ({
  state: { store: null as Record<string, unknown> | null },
  providerMock: vi.fn(),
  searchMock: vi.fn(),
  selectMock: vi.fn(),
  clearMock: vi.fn(),
}));

vi.mock("convex/react", async () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => state.store,
    useAction: (fn: never) =>
      getFunctionName(fn).includes("searchStores") ? searchMock : providerMock,
    useMutation: (fn: never) =>
      getFunctionName(fn).includes("clearStore") ? clearMock : selectMock,
  };
});

import { StorePicker } from "./StorePicker";

const IDS = TEST_IDS.list.storePicker;
const CORRYVILLE = { locationId: "01400376", name: "Corryville", address: "1420 Vine St" };

beforeEach(() => {
  state.store = null;
  providerMock.mockReset().mockResolvedValue({ enabled: true, provider: "kroger" });
  searchMock.mockReset().mockResolvedValue({ provider: "kroger", stores: [CORRYVILLE] });
  selectMock.mockReset().mockResolvedValue(null);
  clearMock.mockReset().mockResolvedValue(null);
});

describe("StorePicker", () => {
  // The feature flag, as the user experiences it: no control at all, rather
  // than one that cannot work.
  it("renders nothing when the deployment has no price provider", async () => {
    providerMock.mockResolvedValue({ enabled: false, provider: "" });
    const { container } = render(<StorePicker />);
    await waitFor(() => expect(providerMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("renders nothing while the provider is still unknown", () => {
    providerMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<StorePicker />);
    expect(container.textContent).toBe("");
  });

  it("offers the opt-in when the feature is on and no store is chosen", async () => {
    render(<StorePicker />);
    await waitFor(() => expect(screen.getByTestId(IDS.open)).toBeTruthy());
    expect(screen.getByText(/Use my store's prices/)).toBeTruthy();
  });

  it("searches by zip and stores the chosen store", async () => {
    render(<StorePicker />);
    await waitFor(() => expect(screen.getByTestId(IDS.open)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.open));

    fireEvent.change(screen.getByTestId(IDS.zip), { target: { value: "45202" } });
    fireEvent.click(screen.getByTestId(IDS.search));
    await waitFor(() => expect(searchMock).toHaveBeenCalledWith({ zipCode: "45202" }));

    fireEvent.click(await screen.findByTestId(IDS.store("01400376")));
    await waitFor(() =>
      expect(selectMock).toHaveBeenCalledWith({
        provider: "kroger",
        locationId: "01400376",
        name: "Corryville",
        address: "1420 Vine St",
      }),
    );
  });

  it("cannot search without a zip", async () => {
    render(<StorePicker />);
    await waitFor(() => expect(screen.getByTestId(IDS.open)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.open));

    expect(screen.getByTestId<HTMLButtonElement>(IDS.search).disabled).toBe(true);
  });

  it("says so when no store is near, rather than looking broken", async () => {
    searchMock.mockResolvedValue({ provider: "kroger", stores: [] });
    render(<StorePicker />);
    await waitFor(() => expect(screen.getByTestId(IDS.open)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.open));

    fireEvent.change(screen.getByTestId(IDS.zip), { target: { value: "99999" } });
    fireEvent.click(screen.getByTestId(IDS.search));
    expect(await screen.findByText(/No stores found near that zip code/)).toBeTruthy();
  });

  // An unreachable store directory is contained to this control. The bill above
  // it still shows a total, from the national averages.
  it("surfaces a failed lookup without taking the bill down with it", async () => {
    searchMock.mockRejectedValue(new Error("upstream down"));
    render(<StorePicker />);
    await waitFor(() => expect(screen.getByTestId(IDS.open)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.open));

    fireEvent.change(screen.getByTestId(IDS.zip), { target: { value: "45202" } });
    fireEvent.click(screen.getByTestId(IDS.search));
    expect(await screen.findByText(/Could not look up stores/)).toBeTruthy();
  });

  it("names the chosen store and offers a way back to the averages", async () => {
    state.store = { provider: "kroger", locationId: "01400376", name: "Corryville" };
    render(<StorePicker />);

    await waitFor(() => expect(screen.getByText(/Priced at Corryville/)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.clear));
    await waitFor(() => expect(clearMock).toHaveBeenCalledWith({}));
  });

  it("can change an existing choice", async () => {
    state.store = { provider: "kroger", locationId: "01400376", name: "Corryville" };
    render(<StorePicker />);

    await waitFor(() => expect(screen.getByTestId(IDS.open)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.open));
    expect(screen.getByTestId(IDS.zip)).toBeTruthy();
  });
});
