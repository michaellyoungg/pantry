/**
 * How big cooking mode has to be drawn.
 *
 * The counterpart of `grocery/hitTargets.ts`, for the other place a phone beats
 * a laptop: propped against a mixing bowl, arm's length away, read by someone
 * whose hands are wet or covered in flour. Neither the reading sizes in the
 * design tokens nor the 44pt accessibility floor is aimed at that.
 *
 * These are plain numbers applied through `style` rather than NativeWind
 * classes, for the same reason the grocery constants are: they are behavioural,
 * the tests assert on the rendered values, and a class name cannot be asserted
 * on without re-implementing Tailwind's scale in the assertion.
 */

/**
 * The step text itself.
 *
 * Deliberately outside the token scale, which stops at `2xl` (24px). That scale
 * is derived from the web app, where the reader is at a desk about 50cm from
 * the screen; a phone propped on a worktop is roughly twice that away, and a
 * step you have to lean in to read is a step you read with your hands full.
 */
export const STEP_FONT_SIZE = 30;

/** Generous leading, because a step is prose read in glances rather than swept. */
export const STEP_LINE_HEIGHT = 40;

/**
 * The floor for the step controls.
 *
 * Well above the 44pt minimum: these are aimed at with the side of a knuckle as
 * often as with a fingertip, and a mis-tap that jumps a step in a recipe you
 * are mid-way through is expensive to recover from — you have to re-read to
 * find out where you were.
 */
export const STEP_CONTROL_HEIGHT = 72;
