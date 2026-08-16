/**
 * Stands in for a route that has not been ported yet.
 *
 * Every tab is navigable from the first build, so the shell can be exercised —
 * by hand, by RNTL, and by Maestro (BL-0072) — before any feature lands. It
 * names the backlog item that replaces it, because an unlabelled placeholder is
 * indistinguishable from a broken screen.
 *
 * Kept intentionally thin: `@pantry/core/data` (BL-0055) is what the real
 * screens will call, and duplicating any of that here would only be thrown away.
 */
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { surfaceTestIDs, type TestIDSurface } from "../testing/testIDs";

export function PlaceholderScreen({
  surface,
  title,
  portedBy,
  children,
}: {
  surface: TestIDSurface;
  title: string;
  portedBy: string;
  /** Anything already built for this route — see `settings.tsx`. */
  children?: ReactNode;
}) {
  const id = surfaceTestIDs(surface);

  return (
    <View className="flex-1 items-center justify-center gap-2 bg-bg p-6" testID={id("screen")}>
      <Text className="text-2xl font-semibold text-text" testID={id("title")}>
        {title}
      </Text>
      <Text className="text-center text-base text-muted" testID={id("placeholder")}>
        Not ported yet. The web app still owns this screen.
      </Text>
      <Text className="text-sm text-muted" testID={id("ported-by")}>
        {portedBy}
      </Text>
      {children}
    </View>
  );
}
