/**
 * Root layout. Everything below sits inside the Convex client, and inside a
 * resolved authentication state.
 */
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthGate } from "../src/auth/AuthGate";
import { ConvexClientProvider } from "../src/convex/ConvexClientProvider";
import "../global.css";

export default function RootLayout() {
  return (
    <ConvexClientProvider>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </AuthGate>
      </SafeAreaProvider>
    </ConvexClientProvider>
  );
}
