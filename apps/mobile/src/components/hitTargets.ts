/**
 * The floor for anything tappable: 44pt, the accessibility minimum.
 *
 * A plain number applied through `style` rather than a NativeWind class, so a
 * test can assert the rendered target is actually this tall without
 * re-implementing Tailwind's scale in the assertion. Screens with a harder
 * requirement than the floor state their own — see `grocery/hitTargets.ts`.
 */
export const CONTROL_TARGET_HEIGHT = 44;
