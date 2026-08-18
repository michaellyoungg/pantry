/**
 * How big a thing has to be to be hit in a shop.
 *
 * This screen is not used sitting down. It is used one-handed, holding a phone
 * in the hand that is also steering a trolley, glancing between a shelf and the
 * list. The web app already meets the 44pt accessibility floor everywhere and
 * that floor is not the bar here: 44pt assumes a still hand and a still device,
 * and neither holds. So the numbers live here, named and tested, rather than as
 * a utility class somebody trims later to fit more rows on screen.
 *
 * They are plain numbers applied through `style`, not NativeWind classes,
 * deliberately. A hit target is a *behavioural* constant — the test asserts the
 * rendered target is at least this tall — and a class name cannot be asserted
 * on without re-implementing Tailwind's scale in the assertion.
 */

/**
 * The primary target: one grocery line's check-off.
 *
 * Comfortably above the 44pt floor, because a tap that misses costs a second
 * look away from the shelf, and because the row is the only thing on this
 * screen a shopper hits dozens of times per trip.
 */
export const ROW_TARGET_HEIGHT = 64;

/**
 * Padding added around the small in-row chips (provenance, remove, "need it
 * anyway"), which are drawn small on purpose — see `GroceryRow`. `hitSlop`
 * grows the touchable area without growing the ink, so a chip stays visually
 * secondary while still being reachable when it *is* what you meant.
 */
export const CHIP_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;

/**
 * How far a finger may drift off a pressed row before the press is abandoned.
 *
 * React Native's default is generous already; this is more so. A hand that is
 * moving with the trolley will slide several points during the press, and
 * cancelling on that reads as "the app ignored my tap" — the single most
 * expensive failure on this screen, because the shopper does not notice until
 * they are at the till.
 */
export const ROW_PRESS_RETENTION = { top: 24, bottom: 24, left: 24, right: 24 } as const;

/**
 * Everything that makes a grocery row's check-off survivable by a moving hand,
 * as one object the row spreads.
 *
 * Bundled rather than applied prop by prop for a testing reason with teeth.
 * `Pressable` swallows `pressRetentionOffset` into its responder config instead
 * of forwarding it to the host view, and RNTL 14 removed the `UNSAFE_*` queries
 * that could reach the composite element — so there is no longer any way to
 * observe it on a rendered row. `minHeight` *does* reach the host view. Putting
 * both in one object means the assertion that survives (the height) also proves
 * the row picked up the half that cannot be seen: a row that stopped spreading
 * this would fail the height assertion first.
 */
export const ROW_PRESS_PROPS = {
  pressRetentionOffset: ROW_PRESS_RETENTION,
  style: { minHeight: ROW_TARGET_HEIGHT },
};
