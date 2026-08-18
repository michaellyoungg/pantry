import { render, screen } from "@testing-library/react-native";
import { OfflineBanner } from "./OfflineBanner";

const NOW = 1_000 * 60 * 60 * 24;

describe("OfflineBanner", () => {
  it("offers the list's age while there is nothing queued", async () => {
    await render(<OfflineBanner queued={0} syncedAt={null} />);

    expect(screen.getByTestId("list.offline-detail")).toHaveTextContent(/not synced yet/);
  });

  it("counts what is waiting once the shopper has ticked something", async () => {
    // What is on the phone and not yet at the server is the only number that
    // matters here; the list's age stops being the point.
    await render(<OfflineBanner queued={1} syncedAt={NOW} />);
    expect(screen.getByTestId("list.offline-detail")).toHaveTextContent(/1 tick is saved/);

    await screen.rerender(<OfflineBanner queued={4} syncedAt={NOW} />);
    expect(screen.getByTestId("list.offline-detail")).toHaveTextContent(/4 ticks are saved/);
  });
});
