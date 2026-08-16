import { NAV_ITEMS as SHARED_NAV_ITEMS } from "@pantry/core";
import { NAV_ICONS } from "./navIcons";

describe("NAV_ICONS", () => {
  it("binds a lucide-react-native component to every shared icon name", () => {
    // The premise of BL-0054: the two lucide packages export the same names, so
    // `@pantry/core` can name an icon once. If a name were web-only this fails
    // here rather than as a blank tab on a device.
    for (const item of SHARED_NAV_ITEMS) {
      expect(NAV_ICONS[item.icon]).toBeDefined();
    }
  });

  it("binds nothing the shared list does not ask for", () => {
    // Keeps the map from accumulating icons no destination uses.
    expect(Object.keys(NAV_ICONS).sort()).toEqual(
      [...new Set(SHARED_NAV_ITEMS.map((item) => item.icon))].sort(),
    );
  });
});
