import { render, screen } from "@testing-library/react-native";
import { PlaceholderScreen } from "./PlaceholderScreen";

describe("PlaceholderScreen", () => {
  it("is reachable by testID, which is the only selector Maestro and RNTL share", async () => {
    await render(<PlaceholderScreen surface="list" title="List" portedBy="BL-0057" />);

    expect(screen.getByTestId("list.screen")).toBeOnTheScreen();
    expect(screen.getByTestId("list.title")).toHaveTextContent("List");
    expect(screen.getByTestId("list.ported-by")).toHaveTextContent("BL-0057");
  });

  it("says which backlog item replaces it, so it cannot be mistaken for a broken screen", async () => {
    await render(<PlaceholderScreen surface="pantry" title="Pantry" portedBy="BL-0059" />);

    expect(screen.getByTestId("pantry.placeholder")).toHaveTextContent(/not ported yet/i);
  });
});
