/**
 * A bottom sheet.
 *
 * Anchored to the bottom of the screen, always — not centred, and not a
 * top-anchored dialog. The top third of a phone held one-handed is the part a
 * thumb cannot reach, and everything this screen puts in a sheet is something
 * the shopper has to answer before they can carry on.
 *
 * Built on React Native's `Modal` so the OS back button dismisses it on Android
 * (`onRequestClose`), which is the one dismissal gesture a user will try
 * without being told it exists.
 */
import type { ReactNode } from "react";
import { Modal, Pressable, Text } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "./hitTargets";

export function Sheet({
  title,
  onClose,
  testID,
  children,
}: {
  title: string;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  return (
    <Modal animationType="slide" transparent onRequestClose={onClose} visible>
      {/* Tapping the dimmed area closes, the same as it does on web. */}
      <Pressable
        accessible={false}
        className="flex-1 justify-end bg-black/40"
        onPress={onClose}
        testID={`${testID}-scrim`}
      >
        {/* Swallows presses so a tap inside the sheet does not close it. */}
        <Pressable
          accessible={false}
          className="rounded-t-xl border border-border bg-surface p-5"
          onPress={() => {}}
          testID={testID}
        >
          <Text className="text-lg font-semibold text-text">{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A full-width choice inside a sheet. Sheets are answered, not browsed. */
export function SheetButton({
  label,
  onPress,
  testID,
  tone = "secondary",
}: {
  label: string;
  onPress: () => void;
  testID: string;
  tone?: "primary" | "secondary" | "quiet";
}) {
  const background =
    tone === "primary" ? "bg-primary" : tone === "secondary" ? "bg-border" : "bg-transparent";
  const color = tone === "primary" ? "text-surface" : "text-text";

  return (
    <Pressable
      accessibilityRole="button"
      className={`mt-2 items-center justify-center rounded-lg px-4 ${background}`}
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className={`text-base font-medium ${color}`}>{label}</Text>
    </Pressable>
  );
}
