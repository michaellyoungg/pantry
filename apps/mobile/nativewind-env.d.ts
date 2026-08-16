/// <reference types="nativewind/types" />

/**
 * `global.css` is consumed by NativeWind's Metro transformer, not by the type
 * system — it has no exports, so this just tells TypeScript the side-effect
 * import is intentional.
 */
declare module "*.css";
