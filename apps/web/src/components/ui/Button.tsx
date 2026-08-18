import type { TestID } from "@pantry/core/testing";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-text hover:bg-border/40",
  ghost: "bg-transparent text-muted hover:bg-border/40 hover:text-text",
  danger: "bg-danger text-white hover:bg-danger-hover",
};

const sizeClasses: Record<Size, string> = {
  sm: "gap-1 px-2.5 py-1 text-sm",
  md: "gap-1.5 px-3.5 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  testId,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /**
   * The button's `data-testid`, and the same string a native `Pressable`
   * carries as its `testID` (BL-0071). `TestID` rather than `string` so it has
   * to come from `@pantry/core/testing` — an id typed by hand skips both the
   * naming rules and the shared catalog.
   */
  testId?: TestID;
}) {
  return (
    <button
      type={type}
      data-testid={testId}
      data-variant={variant}
      className={`${base} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
