/**
 * "You are shopping offline" (BL-0058).
 *
 * The list keeps working with no signal, which is the feature — and is also
 * exactly why it has to say so. A list that silently accepts taps it has not
 * sent is indistinguishable from one that has sent them, right up until the
 * moment it turns out one could not be replayed. Saying it up front is what
 * makes the conflict prompt later read as a consequence rather than a surprise.
 *
 * At the *top* of the list rather than in the thumb bar, deliberately: the
 * thumb bar is for things to press, and there is nothing to press here. It is
 * status, and status that moves under a thumb gets pressed by accident.
 */
import { Text, View } from "react-native";
import { lastSyncedLabel } from "../offline/lastSyncedLabel";
import { surfaceTestIDs } from "../testing/testIDs";

const id = surfaceTestIDs("list");

export function OfflineBanner({ queued, syncedAt }: { queued: number; syncedAt: number | null }) {
  return (
    <View
      className="mb-2 rounded-lg border border-border bg-surface px-3 py-2"
      testID={id("offline")}
    >
      <Text className="text-sm font-semibold text-text">No connection</Text>
      <Text className="mt-1 text-xs text-muted" testID={id("offline-detail")}>
        {queued === 0
          ? `Showing your list as it was — ${lastSyncedLabel(syncedAt, Date.now())}. Tick things off as normal.`
          : `${queued === 1 ? "1 tick is" : `${queued} ticks are`} saved on this phone and will sync when you have signal.`}
      </Text>
    </View>
  );
}
